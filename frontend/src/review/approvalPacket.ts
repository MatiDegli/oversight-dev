import type { ChangeFacts, GrantRequest } from "@contracts";
import type { DecisionInboxEntry, InboxIdentity, State } from "../state";
import type { Answers } from "./AnswerChoices";
import { cardKey } from "./AnswerChoices";
import { selectPlanEvidence } from "./planSelectors";

export const packetNotice = "Proposed approval wording; copying records no decision.";
export interface PacketDrafts {
  answers?: Answers;
  grant?: GrantRequest;
}
export interface PacketSection {
  id: string;
  title: string;
  text: string;
}
export interface ApprovalPacketText {
  target: string;
  sections: PacketSection[];
  text: string;
}
type Target = { change_id: string; revision: number; head_commit: string };
type DecisionEvent = State["decisionEvents"][number];
const json = (value: unknown) => JSON.stringify(value, null, 2);
const matches = (value: Target, target: Target) =>
  value.change_id === target.change_id &&
  value.revision === target.revision &&
  value.head_commit === target.head_commit;

function identityWords(ref: InboxIdentity): string {
  if (ref.kind === "lead_plan") return `Lead ${ref.agent_id} · revision ${String(ref.revision)}`;
  if (ref.kind === "revert_needs_you")
    return `Revert ${ref.change_id} · revision ${String(ref.revision)} · resolution seq ${String(ref.resolution_seq)} · merge ${ref.merge_commit}`;
  return `Change ${ref.change_id} · revision ${String(ref.revision)} · head ${ref.head_commit}`;
}

function consequence(entry: DecisionInboxEntry, state: State): string {
  if (entry.decisions.some((d) => d.kind === "revert_needs_you"))
    return "No approval action exists for this Revert intervention. Revert needs intervention on the recorded merge; inspect the recorded conflict paths and reason. Copying cannot retry or resolve it.";
  if (entry.decisions.some((d) => d.kind === "follow_main"))
    return "No approval action is available for this follow-main decision. Follow main before deciding; inspect the conflict in Review and request changes or reject where offered.";
  if (entry.decisions.some((d) => d.kind === "lead_plan"))
    return "Proposed action: Queue this exact plan revision.\nQueue plan schedules this plan revision's work when slots and gates allow. It does not approve or merge the resulting changes. Reject plan is a separate action.";
  if (!entry.changeId || !state.changes[entry.changeId]?.proposal)
    return "No approval action exists before a proposal. The pending intervention is confirmation of proposed examples before code; inspect the recorded examples. This packet supplies no confirmation control.";
  return "Proposed action: Approve this exact change revision/head, subject to the existing guards.\nApproving the reviewed change attempts its guarded merge. The server checks the observed revision and full head before effects; it may refuse a stale target or report a conflict. Current questions still require Yes. Request changes and Reject remain separate actions.";
}

/** Pure snapshot of the displayed prefix and explicitly supplied browser drafts. No store reads. */
export function buildApprovalPacket(
  state: State,
  entry: DecisionInboxEntry,
  drafts: PacketDrafts = {},
  prefix = "approval-packet",
  readOnly = false,
): ApprovalPacketText {
  const groups = new Map<string, DecisionInboxEntry["decisions"]>();
  for (const decision of entry.decisions) {
    const ref = decision.identity;
    const key =
      ref.kind === "revert_needs_you"
        ? json(ref)
        : ref.kind === "lead_plan"
          ? json([ref.agent_id, ref.revision])
          : json([ref.change_id, ref.revision, ref.head_commit]);
    groups.set(key, [...(groups.get(key) ?? []), decision]);
  }
  if (groups.size > 1) {
    const packets = [...groups.values()].map((decisions, index) =>
      buildEntryPacket(
        state,
        { ...entry, decisions },
        drafts,
        `${prefix}-${String(index)}`,
        readOnly,
      ),
    );
    return assemblePacket(
      packets.map((p) => p.target).join("; "),
      packets.flatMap((p) => p.sections),
    );
  }
  return buildEntryPacket(state, entry, drafts, prefix, readOnly);
}

function buildEntryPacket(
  state: State,
  entry: DecisionInboxEntry,
  drafts: PacketDrafts,
  prefix: string,
  readOnly: boolean,
): ApprovalPacketText {
  const sections: PacketSection[] = [];
  const run = state.run?.run_id ?? "Not recorded";
  const add = (title: string, content: string) => {
    const id = `${prefix}-${String(sections.length)}`;
    sections.push({ id, title, text: `<a id="${id}"></a>\n## ${title}\n${content}\n\n` });
  };
  const source = (seq: number, fields: string) => `Run ${run} · seq ${String(seq)} · ${fields}`;
  const events = state.decisionEvents.filter((event) => event.seq <= state.lastSeq);
  const first = entry.decisions[0];
  const lead = entry.decisions.find((d) => d.identity.kind === "lead_plan");
  const plan = lead?.planId ? selectPlanEvidence(state).plans.get(lead.planId) : undefined;
  const target = first ? identityWords(first.identity) : "Identity not recorded";
  add(
    "Decision snapshot",
    `Run ID: ${run}\nDisplayed event horizon: seq ${String(state.lastSeq)} · ${state.clock ?? "Time not recorded"}\n${state.gap ? "Event gap recorded: this prefix is incomplete.\n" : ""}${target}\n${plan ? `Plan ID: ${plan.payload.plan_id} · plan revision ${String(plan.payload.revision)} (separate from lead revision)\n` : ""}${readOnly ? "Replay/history: no decision commands are available.\n" : ""}${consequence(entry, state)}`,
  );
  add(
    "Pending decisions and exact questions",
    entry.decisions
      .map(
        (d) =>
          `${d.kind}\n${d.reason}\nRecorded identity:\n${json(d.identity)}\nExample:\n${json(d.example)}`,
      )
      .join("\n\n"),
  );
  const ref = first?.identity;
  const original = originalResolution(events, ref);
  if (ref?.kind === "revert_needs_you" && !original)
    add(
      "Original resolution omission",
      `Original change.resolved payload at seq ${String(ref.resolution_seq)} is unavailable. The recorded Revert identity is retained.`,
    );
  const candidate =
    ref && "head_commit" in ref
      ? ref
      : original?.type === "change.resolved" && original.payload.head_commit
        ? { ...original.payload, head_commit: original.payload.head_commit }
        : undefined;
  if (candidate)
    addChangeEvidence(
      state,
      events,
      candidate,
      drafts,
      ref?.kind !== "revert_needs_you",
      add,
      source,
    );
  else
    add(
      "Change evidence",
      "No reviewed change revision/head for this decision. Change tests, review, facts and assessment are not applicable or not recorded.",
    );
  addIdentityEvidence(events, entry, plan, original, add, source);
  return assemblePacket(
    `${target}${plan ? ` · plan ${plan.payload.plan_id} revision ${String(plan.payload.revision)}` : ""}`,
    sections,
  );
}

function originalResolution(events: DecisionEvent[], ref: InboxIdentity | undefined) {
  return ref?.kind === "revert_needs_you"
    ? events.find(
        (event) =>
          event.type === "change.resolved" &&
          event.seq === ref.resolution_seq &&
          event.payload.change_id === ref.change_id &&
          event.payload.revision === ref.revision &&
          event.payload.merge_commit === ref.merge_commit,
      )
    : undefined;
}

function assemblePacket(target: string, sections: PacketSection[]): ApprovalPacketText {
  sections = sections.map((s, index) => ({
    ...s,
    text: s.text.trimEnd() + (index === sections.length - 1 ? "" : "\n\n"),
  }));
  const index = sections
    .filter((s) => s.title.startsWith("Run "))
    .map((s) => `[${s.title}](#${s.id})`)
    .join("\n");
  const header = `# Approval packet\n${packetNotice}\n\nIncluded evidence (internal links):\n${index}\n\n`;
  return {
    target,
    sections,
    text: header + sections.map((s) => s.text).join(""),
  };
}

type Add = (title: string, content: string) => void;
type Source = (seq: number, fields: string) => string;
function addChangeEvidence(
  state: State,
  events: DecisionEvent[],
  target: Target,
  drafts: PacketDrafts,
  allowDrafts: boolean,
  add: Add,
  source: Source,
) {
  const proposal = events.findLast(
    (e) => e.type === "change.proposed" && matches(e.payload, target),
  );
  if (proposal?.type === "change.proposed")
    add(
      source(
        proposal.seq,
        "change.proposed.payload: task, summary, examples, tests, files, impact, revision, head_commit",
      ),
      `Exact task:\n${proposal.payload.task}\nExact proposal note:\n${proposal.payload.summary ?? "No recorded proposal note"}\nFull recorded proposal (tests are the proposal summary, not proof of a later combined suite):\n${json(proposal.payload)}`,
    );
  else add("Proposal omission", "No recorded proposal for this exact change/revision/head.");
  const factEvent = events.findLast(
    (e) => e.type === "change.facts_recorded" && matches(e.payload, target),
  );
  const facts = factEvent?.type === "change.facts_recorded" ? factEvent.payload : undefined;
  if (facts && factEvent) {
    const missing = Object.entries(facts)
      .filter(([, value]) => value === null || (Array.isArray(value) && !value.length))
      .map(([field]) => field);
    add(
      source(
        factEvent.seq,
        "change.facts_recorded.payload: review_cards, behavior_diff, measured_cone, test_runs, problems and all facts",
      ),
      `Latest whole matching payload; null means not recorded and [] means no entries recorded.\nFields with no recorded value/entries: ${missing.join(", ") || "none"}.\n${json(facts)}`,
    );
  } else
    add(
      "Facts omission",
      "No recorded facts for this exact change/revision/head. No older facts were substituted.",
    );
  const assessment = events.findLast(
    (e) => e.type === "change.assessed" && matches(e.payload, target),
  );
  if (assessment)
    add(
      source(
        assessment.seq,
        "change.assessed.payload: rules, observed, threshold, result, evidence, main_commit",
      ),
      json(assessment.payload),
    );
  else add("Assessment omission", "No recorded assessment for this exact change/revision/head.");
  addReviewAndTests(state, target, facts, add, source);
  addDrafts(state, target, facts?.review_cards ?? [], drafts, allowDrafts, add);
}

function addReviewAndTests(
  state: State,
  target: Target,
  facts: ChangeFacts | undefined,
  add: Add,
  source: Source,
) {
  const review = state.changes[target.change_id]?.reviews.findLast(
    (r) => r.seq <= state.lastSeq && matches(r.review, target),
  );
  if (review)
    add(
      source(
        review.seq,
        "change.reviewed.payload: verdict, findings, complete, problems, revision, head_commit",
      ),
      json(review.review),
    );
  else add("Review omission", "No recorded cross-review for this exact change/revision/head.");
  const executions = Object.entries(state.testExecutions).filter(
    ([seq, e]) =>
      Number(seq) <= state.lastSeq &&
      e.change_id === target.change_id &&
      ((facts?.test_runs.includes(Number(seq)) &&
        (e.revision === null || e.revision === target.revision)) ||
        (e.revision === target.revision &&
          (e.tested_commit === target.head_commit ||
            (facts && e.tested_tree === facts.candidate_tree)))),
  );
  for (const [seq, execution] of executions)
    add(
      source(
        Number(seq),
        "tests.executed.payload: phase, revision, tested_commit, tested_tree, suite",
      ),
      json(execution),
    );
  if (!executions.length)
    add(
      "Test execution omission",
      "No matching recorded tests.executed payload. A proposal test summary alone does not establish combined tests.",
    );
  for (const seq of facts?.test_runs ?? [])
    if (!executions.some(([n]) => Number(n) === seq))
      add(
        source(seq, "change.facts_recorded.payload.test_runs"),
        "Referenced test execution is unavailable or does not match this candidate; not substituted.",
      );
}

function addDrafts(
  state: State,
  target: Target,
  cards: NonNullable<ChangeFacts["review_cards"]>,
  drafts: PacketDrafts,
  allowDrafts: boolean,
  add: Add,
) {
  const current = state.changes[target.change_id]?.proposal;
  const matching = allowDrafts && current && matches(current, target);
  const answers = matching
    ? cards
        .filter((card) => Object.hasOwn(drafts.answers ?? {}, cardKey(card)))
        .map((card) => ({
          node_id: card.node_id,
          question: card.question,
          evidence_seq: card.evidence_seq,
          selected_answer: drafts.answers?.[cardKey(card)],
        }))
    : [];
  const grant = matching ? drafts.grant : undefined;
  add(
    "Browser drafts — not recorded facts",
    `Selected answer drafts (not saved by copying; recorded answers remain in facts above):\n${answers.length ? json(answers) : "No selected answer drafts for this candidate."}\nProposed grant:\n${grant ? `${json(grant)}\nExact scope: ${grant.scope.kind} = ${grant.scope.value}; expiry: ${grant.scope.expires}, end of run ${state.run?.run_id ?? "not recorded"}.\nCreated only by the separate Approve action if accepted. It would allow possible callers, not followed, within this scope for the rest of this run; future eligible changes may merge without asking about those callers. Other gates still apply. This grant does not exist yet.` : "No proposed grant selected for this candidate."}`,
  );
}

function addIdentityEvidence(
  events: DecisionEvent[],
  entry: DecisionInboxEntry,
  plan: ReturnType<typeof selectPlanEvidence>["plans"] extends Map<string, infer T>
    ? T | undefined
    : never,
  original: DecisionEvent | undefined,
  add: Add,
  source: Source,
) {
  if (plan)
    add(
      source(
        plan.seq,
        "plan.updated.payload: plan_id, revision, task, detail, subtasks, started_by",
      ),
      `Exact plan task:\n${plan.payload.task}\n${json(plan.payload)}`,
    );
  if (original)
    add(
      source(
        original.seq,
        "change.resolved.payload: original resolution, merge_commit, assessment, answers",
      ),
      json(original.payload),
    );
  const includedSources = new Set<number>();
  for (const decision of entry.decisions) {
    const ref = decision.identity;
    const evidence =
      ref.kind === "revert_needs_you"
        ? events.findLast(
            (e) =>
              e.type === "revert.resolved" &&
              e.payload.change_id === ref.change_id &&
              e.payload.revision === ref.revision &&
              e.payload.resolution_seq === ref.resolution_seq &&
              e.payload.merge_commit === ref.merge_commit,
          )
        : events.find((e) => e.seq === ref.evidence_seq);
    if (evidence && !includedSources.has(evidence.seq)) {
      includedSources.add(evidence.seq);
      add(
        source(evidence.seq, `${evidence.type}.payload (decision source)`),
        `Recorded source for this decision identity; current whole-candidate evidence is selected separately above.\n${json(evidence.payload)}`,
      );
    } else if (!evidence)
      add("Decision source omission", `No retained source payload for ${json(ref)}.`);
    if (ref.kind === "lead_plan") {
      const lead = events.find(
        (e) =>
          e.type === "lead.status" &&
          e.payload.agent_id === ref.agent_id &&
          e.payload.revision === ref.revision,
      );
      if (lead)
        add(
          source(lead.seq, "lead.status.payload: agent_id, revision, task, requested_plan_id"),
          json(lead.payload),
        );
    }
  }
}
