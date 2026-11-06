import { expect, it } from "vitest";
import type { CrossReview, ServerEvent } from "@contracts";
import grants from "../../../fixtures/events/handwritten-inbox-grants.jsonl?raw";
import kinds from "../../../fixtures/events/handwritten-inbox-kinds.jsonl?raw";
import revisions from "../../../fixtures/events/handwritten-inbox-revisions.jsonl?raw";
import answers from "../../../fixtures/events/handwritten-inbox-answers.jsonl?raw";
import { applyEvent, createInitialState, selectDecisionInbox, type State } from "../state";
import { parseEvent } from "../transport";
import { cardKey } from "./AnswerChoices";
import { buildApprovalPacket, packetNotice } from "./approvalPacket";
import { sendDecision } from "./decisions";

const events = (log: string) => log.trim().split("\n").map(parseEvent);
const stateFor = (log: string) => events(log).reduce(applyEvent, createInitialState());
const entryFor = (state: State, id: string) => {
  const entry = selectDecisionInbox(state).find(
    (entry) => entry.changeId === id || entry.decisions.some((d) => d.planId === id),
  );
  if (!entry) throw new Error(`Missing ${id}`);
  return entry;
};
const section = (packet: ReturnType<typeof buildApprovalPacket>, match: string) =>
  packet.sections.find((s) => s.title.includes(match))?.text;

it("is pure and preserves every pending category, identity, exact reason and example", () => {
  const state = stateFor(kinds);
  const before = structuredClone(state);
  const seen = new Set<string>();
  for (const entry of selectDecisionInbox(state)) {
    const packet = buildApprovalPacket(state, entry);
    expect(packet).toEqual(buildApprovalPacket(state, entry));
    expect(packet.text).toContain(`Run ID: ${state.run?.run_id ?? ""}`);
    expect(packet.text).toContain(`Displayed event horizon: seq ${String(state.lastSeq)}`);
    for (const d of entry.decisions) {
      seen.add(d.kind);
      expect(packet.text).toContain(d.reason);
      expect(packet.text).toContain(JSON.stringify(d.identity, null, 2));
      expect(packet.text).toContain(JSON.stringify(d.example, null, 2));
    }
  }
  expect([...seen].sort()).toEqual([
    "change",
    "checks_unavailable",
    "examples_before_code",
    "follow_main",
    "lead_plan",
    "revert_needs_you",
    "review_card",
    "risky_area",
  ]);
  expect(state).toEqual(before);
});

it("preserves proposal wording, full heads, examples, paths and source fields without permanent URLs", () => {
  const state = stateFor(grants);
  const proposal = state.changes["change-3"]?.proposal;
  if (!proposal) throw new Error("Missing proposal");
  const packet = buildApprovalPacket(state, entryFor(state, proposal.change_id));
  expect(packet.text).toContain(proposal.task);
  expect(packet.text).toContain(proposal.summary);
  expect(packet.text).toContain(proposal.head_commit);
  expect(section(packet, "change.proposed.payload")).toContain(JSON.stringify(proposal, null, 2));
  for (const s of packet.sections) {
    if (s.title.startsWith("Run ")) expect(packet.text).toContain(`[${s.title}](#${s.id})`);
    expect(s.text).toContain(`<a id="${s.id}"></a>`);
  }
  expect(packet.text).not.toMatch(/https?:\/\//);
  expect(packet.text).toContain("attempts its guarded merge");
});

it("includes a shared decision source once while retaining every question and identity", () => {
  const state = stateFor(grants);
  const entry = entryFor(state, "change-3");
  const sourceSeqs = entry.decisions.flatMap((d) =>
    "evidence_seq" in d.identity ? [d.identity.evidence_seq] : [],
  );
  const uniqueSeqs = new Set(sourceSeqs);
  expect(sourceSeqs.length).toBeGreaterThan(uniqueSeqs.size);
  const packet = buildApprovalPacket(state, entry);
  const sources = packet.sections.filter((s) => s.title.endsWith("(decision source)"));
  expect(sources).toHaveLength(uniqueSeqs.size);
  for (const seq of uniqueSeqs) {
    const event = state.decisionEvents.find((e) => e.seq === seq);
    expect(event).toBeDefined();
    expect(sources.find((s) => s.title.includes(`seq ${String(seq)} ·`))?.text).toContain(
      JSON.stringify(event?.payload, null, 2),
    );
  }
  for (const decision of entry.decisions) {
    expect(section(packet, "Pending decisions")).toContain(decision.reason);
    expect(section(packet, "Pending decisions")).toContain(
      JSON.stringify(decision.identity, null, 2),
    );
  }
  expect(packet.text.split(packetNotice)).toHaveLength(2);
});

it("reports plan and lead counters separately and explains scheduling", () => {
  const state = stateFor(kinds);
  const packet = buildApprovalPacket(state, entryFor(state, "plan-1"));
  expect(packet.target).toBe("Lead agent-5 · revision 4 · plan plan-1 revision 9");
  expect(packet.text).toContain("Queue plan schedules this plan revision's work");
  expect(packet.text).toContain("Update prices");
  expect(packet.text).toContain("tests/test_pricing.py");
  expect(packet.text).toContain("lead.status.payload: agent_id, revision");
  const plan = state.decisionEvents.findLast((e) => e.type === "plan.updated");
  if (plan?.type !== "plan.updated") throw new Error("Missing plan");
  const next = applyEvent(state, {
    ...plan,
    seq: state.lastSeq + 1,
    payload: { ...plan.payload, revision: 10, task: "Exact revised plan" },
  });
  const updated = buildApprovalPacket(next, entryFor(next, "plan-1"));
  expect(updated.target).toBe("Lead agent-5 · revision 4 · plan plan-1 revision 10");
  expect(updated.text).toContain("Exact revised plan");
});

it("keeps Revert attached to its original resolution when a newer change proposal exists", () => {
  const state = stateFor(kinds);
  const proposal = state.changes["change-1"]?.proposal;
  if (!proposal) throw new Error("Missing proposal");
  const next = applyEvent(state, {
    type: "change.proposed",
    seq: state.lastSeq + 1,
    ts: state.clock ?? "",
    payload: {
      ...proposal,
      change_id: "change-4",
      revision: 99,
      head_commit: "new-head",
      task: "Unrelated new proposal",
    },
  });
  const entry = selectDecisionInbox(next).find((e) =>
    e.decisions.some((d) => d.kind === "revert_needs_you"),
  );
  if (!entry) throw new Error("Missing Revert");
  const packet = buildApprovalPacket(next, entry);
  expect(packet.target).toBe(
    "Revert change-4 · revision 1 · resolution seq 17 · merge merged; Change change-4 · revision 99 · head new-head",
  );
  const snapshots = packet.sections.filter((s) => s.title === "Decision snapshot");
  expect(snapshots).toHaveLength(2);
  expect(snapshots[0]?.text).toContain("resolution seq 17 · merge merged");
  expect(snapshots[0]?.text).not.toContain("revision 99");
  expect(snapshots[1]?.text).toContain("revision 99 · head new-head");
  expect(section(packet, "original resolution")).not.toContain("Unrelated new proposal");
  expect(section(packet, "change.proposed.payload")).toContain("Unrelated new proposal");
});

it.each(["follow_main", "revert_needs_you", "examples_before_code"] as const)(
  "names the %s intervention without inventing approval",
  (kind) => {
    const state = stateFor(kinds);
    const entry = selectDecisionInbox(state).find(
      (e) =>
        e.decisions.some((d) => d.kind === kind) &&
        (kind !== "examples_before_code" || e.changeId === "change-2"),
    );
    if (!entry) throw new Error("Missing category");
    const packet = buildApprovalPacket(state, entry);
    expect(packet.text).toContain("No approval action");
    if (kind === "revert_needs_you") {
      expect(packet.target).toBe("Revert change-4 · revision 1 · resolution seq 17 · merge merged");
      expect(packet.text).toContain("original resolution, merge_commit");
      expect(packet.text).toContain("revert.resolved.payload");
    }
  },
);

it("does not substitute earlier optional facts and explicitly records omissions", () => {
  let state = stateFor(kinds);
  const fact = state.decisionEvents.findLast((e) => e.type === "change.facts_recorded");
  if (fact?.type !== "change.facts_recorded") throw new Error("Missing facts");
  state = applyEvent(state, {
    ...fact,
    seq: state.lastSeq + 1,
    payload: {
      ...fact.payload,
      review_cards: null,
      problems: ["Coverage unavailable"],
      test_runs: [999],
    },
  });
  const packet = buildApprovalPacket(state, entryFor(state, "change-1"));
  expect(section(packet, "change.facts_recorded.payload")).toContain('"review_cards": null');
  expect(section(packet, "change.facts_recorded.payload")).not.toContain("Keep negative prices?");
  expect(packet.text).toContain("Coverage unavailable");
  expect(packet.text).toContain("Referenced test execution is unavailable");
  expect(packet.text).toContain("No recorded cross-review");
  expect(packet.text).toContain("No matching recorded tests.executed payload");
});

it("keeps recorded answers distinct from changing drafts and ignores stale question keys", () => {
  const state = stateFor(answers);
  const entry = selectDecisionInbox(state).find(
    (e) => e.changeId && state.changeFacts[e.changeId]?.at(-1)?.review_cards?.length,
  );
  if (!entry?.changeId) throw new Error("Missing questions");
  const cards = state.changeFacts[entry.changeId]?.at(-1)?.review_cards ?? [];
  const card = cards[0];
  if (!card) throw new Error("Missing card");
  const recorded = buildApprovalPacket(state, entry);
  const selected = buildApprovalPacket(state, entry, {
    answers: { [cardKey(card)]: "no", obsolete: "yes" },
    grant: {
      reason: "possible_callers",
      scope: { kind: "run", value: state.run?.run_id ?? "", expires: "run" },
    },
  });
  expect(section(selected, "change.facts_recorded.payload")).toBe(
    section(recorded, "change.facts_recorded.payload"),
  );
  expect(section(selected, "Browser drafts")).toContain('"selected_answer": "no"');
  expect(section(selected, "Browser drafts")).not.toContain("obsolete");
  expect(selected.text).toContain("This grant does not exist yet");
  expect(selected.text).toContain(`end of run ${state.run?.run_id ?? ""}`);
  expect(selected.text).toContain("Other gates still apply");
  expect(section(recorded, "Browser drafts")).toContain("No proposed grant selected");
});

it.each(["revision", "head"])(
  "isolates evidence after a changed %s and retains the captured packet",
  (field) => {
    const state = stateFor(grants);
    const proposal = state.changes["change-3"]?.proposal;
    if (!proposal) throw new Error("Missing proposal");
    const original = buildApprovalPacket(state, entryFor(state, proposal.change_id));
    const next = applyEvent(state, {
      type: "change.proposed",
      seq: state.lastSeq + 1,
      ts: state.clock ?? "",
      payload: {
        ...proposal,
        revision: field === "revision" ? proposal.revision + 1 : proposal.revision,
        head_commit: field === "head" ? "a".repeat(40) : proposal.head_commit,
        task: "Exact new task\nDo not paraphrase",
      },
    });
    const packet = buildApprovalPacket(next, entryFor(next, proposal.change_id));
    expect(packet.text).toContain("Exact new task\nDo not paraphrase");
    expect(packet.text).toContain("No recorded facts for this exact change/revision/head");
    expect(packet.text).toContain("No recorded assessment for this exact change/revision/head");
    expect(packet.text).not.toContain("Was this behavior change asked for?");
    expect(original).toEqual(buildApprovalPacket(state, entryFor(state, proposal.change_id)));
  },
);

it("selects matching cross-review and executions, preserving path and line references", () => {
  let state = stateFor(kinds);
  const proposal = state.changes["change-1"]?.proposal;
  const facts = state.changeFacts["change-1"]?.at(-1);
  if (!proposal || !facts) throw new Error("Missing candidate");
  const review: CrossReview = {
    change_id: facts.change_id,
    revision: facts.revision,
    base_commit: facts.base_commit,
    head_commit: facts.head_commit,
    main_commit: facts.main_commit,
    candidate_tree: facts.candidate_tree,
    author_model: "fake",
    reviewer_model: "fake",
    reviewer_provider: "fake",
    reasoning: null,
    verdict: "changes_requested",
    findings: [
      {
        severity: "BLOCKING",
        text: "Inspect shop/pricing.py:42",
        path: "shop/pricing.py",
        line: 42,
        node_id: null,
      },
    ],
    complete: false,
    problems: ["Missing input"],
  };
  const more: ServerEvent[] = [
    { type: "change.reviewed", payload: review, seq: 22, ts: state.clock ?? "" },
    {
      type: "change.reviewed",
      payload: { ...review, head_commit: "stale", findings: [] },
      seq: 23,
      ts: state.clock ?? "",
    },
    {
      type: "tests.executed",
      payload: {
        change_id: proposal.change_id,
        agent_id: proposal.agent_id,
        revision: 1,
        phase: "proposal",
        tested_commit: proposal.head_commit,
        tested_tree: facts.candidate_tree,
        suite: proposal.tests,
      },
      seq: 24,
      ts: state.clock ?? "",
    },
    {
      type: "tests.executed",
      payload: {
        change_id: proposal.change_id,
        agent_id: proposal.agent_id,
        revision: 1,
        phase: "proposal",
        tested_commit: "stale",
        tested_tree: "wrong-tree",
        suite: proposal.tests,
      },
      seq: 25,
      ts: state.clock ?? "",
    },
  ];
  state = more.reduce(applyEvent, state);
  const packet = buildApprovalPacket(state, entryFor(state, proposal.change_id));
  expect(section(packet, "change.reviewed.payload")).toContain(JSON.stringify(review, null, 2));
  expect(packet.text).toContain("shop/pricing.py:42");
  expect(packet.text).toContain('"line": 42');
  expect(packet.text).toContain("seq 24 · tests.executed.payload");
  expect(packet.text).not.toContain("seq 25 · tests.executed.payload");
});

it("reports replay horizons and event gaps without changing state", () => {
  const state = stateFor(revisions);
  state.gap = true;
  const entry = selectDecisionInbox(state)[0];
  if (!entry) throw new Error("Missing entry");
  const packet = buildApprovalPacket(state, entry, {}, "replay", true);
  expect(packet.text).toContain("Replay/history: no decision commands are available");
  expect(packet.text).toContain("Event gap recorded");
});

it("leaves the existing unanswered-question approval guard intact", async () => {
  const state = stateFor(grants);
  let sent = 0;
  const client = {
    approveChange: () => {
      sent++;
      return Promise.resolve();
    },
    rejectChange: () => {
      sent++;
      return Promise.resolve();
    },
    requestChanges: () => {
      sent++;
      return Promise.resolve();
    },
  };
  buildApprovalPacket(state, entryFor(state, "change-3"));
  await sendDecision(client, state, "change-3", "approve", "", () => {});
  expect(sent).toBe(0);
});
