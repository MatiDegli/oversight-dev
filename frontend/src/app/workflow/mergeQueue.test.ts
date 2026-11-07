import { expect, it } from "vitest";
import { createInitialState } from "../../state";
import { mergeQueue } from "./mergeQueue";
import {
  append,
  candidateState,
  evidencePlan,
  execution,
  proposal,
  resolution,
  snapshot,
} from "./workflowEvidence.testSupport";
const queue = (state: ReturnType<typeof candidateState>) =>
  mergeQueue(state, evidencePlan.plan_id, true);

it("shows exact proposal identity, gates and Review eligibility without asserting admission", () => {
  const state = candidateState();
  expect(queue(state)).toMatchObject([
    {
      changeId: proposal.change_id,
      revision: 1,
      head: proposal.head_commit,
      index: 0,
      planRevision: 1,
      detail: { reviewId: proposal.change_id },
    },
  ]);
  expect(queue(state)[0]?.detail.gates[1]?.mark).toBe("not known");
  expect(queue(state)[0]?.detail.gates[3]?.mark).toBe("not needed");
  expect(mergeQueue(state, evidencePlan.plan_id)[0]?.detail.reviewId).toBeNull();
});
it("shows multiple proposals in plan order, never the coding-slot queue", () => {
  const state = append(candidateState(), "change.proposed", {
    ...proposal,
    agent_id: "second",
    change_id: "second-change",
  });
  expect(queue(state).map((item) => item.changeId)).toEqual([proposal.change_id, "second-change"]);
  const queued = append(state, "queue.updated", {
    queued_task_id: "slot-queue",
    revision: 1,
    state: "queued",
    plan_id: evidencePlan.plan_id,
    plan_revision: 1,
    agent: null,
    agent_ids: [],
    detail: null,
    started_by: null,
  });
  expect(queue(queued)).toEqual(queue(state));
});
it("keeps failed proposal and combined executions and moved main visible", () => {
  let state = execution(candidateState(), "proposal", true);
  state = append(state, "graph.snapshot", { ...snapshot, commit: "moved" });
  expect(queue(state)[0]?.main).toBe("moved");
  expect(queue(state)[0]?.detail.gates[1]?.mark).toBe("failed");
  expect(queue(state)[0]?.detail.gates[3]?.mark).toBe("not known");
  state = execution(state, "combined", true);
  expect(queue(state)[0]?.detail.word).toBe("Not merged");
  expect(queue(state)[0]?.detail.gates[3]?.detail).toContain("2 failed");
});
it("retains a conflict as an observed candidate without treating approval as merge", () => {
  const state = append(candidateState(), "change.resolved", {
    ...resolution,
    merge: "conflict",
    merge_commit: null,
    conflict: { kind: "merge", paths: ["shop.py"], tests: null },
  });
  expect(queue(state)).toMatchObject([
    { detail: { word: "Not merged", reviewId: proposal.change_id } },
  ]);
  expect(queue(state)[0]?.detail.gates[2]?.mark).toBe("passed");
});
it.each(["rejected", "changes_requested"] as const)("withdraws a %s proposal", (decision) => {
  const state = append(candidateState(), "change.resolved", {
    ...resolution,
    decision,
    merge: null,
    merge_commit: null,
  });
  expect(queue(state)).toEqual([]);
});
it("withdraws confirmed merges and replaces proposal-revision evidence", () => {
  const tested = execution(candidateState(), "proposal", true);
  const replaced = append(tested, "change.proposed", {
    ...proposal,
    revision: 2,
    head_commit: "head-2",
  });
  expect(queue(replaced)).toMatchObject([{ revision: 2, head: "head-2" }]);
  expect(queue(replaced)[0]?.detail.gates[1]?.mark).toBe("not known");
  expect(queue(append(replaced, "change.resolved", { ...resolution, revision: 2 }))).toEqual([]);
});
it("returns honest empty views for absent, unaccepted and replaced plans", () => {
  expect(queue(createInitialState())).toEqual([]);
  const state = candidateState();
  for (const plan of [
    { ...evidencePlan, state: "proposed" as const },
    { ...evidencePlan, subtasks: null },
  ])
    expect(queue(append(state, "plan.updated", { ...plan, revision: 2 }))).toEqual([]);
  expect(mergeQueue(state, "other-plan")).toEqual([]);
});
