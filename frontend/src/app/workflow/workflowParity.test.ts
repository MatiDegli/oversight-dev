import { expect, it } from "vitest";
import type { ServerEvent } from "@contracts";
import recorded from "../../../../fixtures/events/recorded-demo.jsonl?raw";
import handwritten from "../../../../fixtures/events/handwritten-lead-plans.jsonl?raw";
import { parseEvent } from "../../transport";
import { selectPlanEvidence } from "../../review";
import { applyEvent, createInitialState, projectPlanFlow, type State } from "../../state";
import { workflowCanvas } from "./WorkflowCanvas";
import { workflowDetail } from "./workflowDetail";
import { mergeQueue } from "./mergeQueue";
import {
  agent,
  event,
  evidencePlan,
  proposal,
  resolution,
  run,
} from "./workflowEvidence.testSupport";
function projection(state: State) {
  return [...selectPlanEvidence(state).plans.values()].map(({ payload }) => {
    const rows = projectPlanFlow(state, payload);
    return {
      canvas: workflowCanvas(rows),
      detail: rows.map((row) => workflowDetail(row, state, true)),
      candidates: mergeQueue(state, payload.plan_id, true),
    };
  });
}
function freeze(value: unknown) {
  if (value !== null && typeof value === "object") {
    Object.values(value).forEach(freeze);
    Object.freeze(value);
  }
}
export const syntheticPrefixes: ServerEvent[] = [
  event(1, "run.started", run),
  event(2, "plan.updated", evidencePlan),
  event(3, "agent.status", { ...agent, plan_id: evidencePlan.plan_id }),
  event(4, "change.proposed", proposal),
  event(5, "plan.updated", { ...evidencePlan, revision: 2 }),
  event(6, "change.proposed", { ...proposal, revision: 2 }),
  event(7, "change.resolved", { ...resolution, revision: 2 }),
  event(8, "plan.updated", { ...evidencePlan, revision: 3, subtasks: null, state: "failed" }),
  event(1, "run.started", { ...run, run_id: "reset" }),
];
it.each([
  { name: "synthetic revisions and new run", events: syntheticPrefixes },
  { name: "real recording (legacy metadata)", events: recorded.trim().split("\n").map(parseEvent) },
  { name: "handwritten lead plans", events: handwritten.trim().split("\n").map(parseEvent) },
])("compares every prefix and frozen source evidence for $name", ({ events }) => {
  let live = createInitialState();
  const source = JSON.stringify(events);
  freeze(events);
  for (let prefix = 0; prefix <= events.length; prefix++) {
    const next = events[prefix - 1];
    if (next) live = applyEvent(live, next);
    const replay = events.slice(0, prefix).reduce(applyEvent, createInitialState());
    const before = JSON.stringify(replay);
    freeze(replay);
    expect(projection(live)).toEqual(projection(replay));
    expect(JSON.stringify(replay)).toBe(before);
  }
  expect(JSON.stringify(events)).toBe(source);
});
it("keeps accepted evidence on duplicate and gapped envelopes and rebuilds backwards", () => {
  const state = syntheticPrefixes.slice(0, 6).reduce(applyEvent, createInitialState());
  for (const seq of [state.lastSeq, state.lastSeq + 2]) {
    const refused = applyEvent(
      state,
      event(seq, "plan.updated", { ...evidencePlan, revision: 99 }),
    );
    expect(refused.gap).toBe(true);
    expect(projection(refused)).toEqual(projection(state));
  }
  const projections = syntheticPrefixes.map((_, index) =>
    projection(syntheticPrefixes.slice(0, index + 1).reduce(applyEvent, createInitialState())),
  );
  for (const prefix of [5, 2, 7, 6]) {
    const replay = syntheticPrefixes.slice(0, prefix).reduce(applyEvent, createInitialState());
    expect(projection(replay)).toEqual(projections[prefix - 1]);
  }
});
it("keys canvas by plan and local index and draws exact merge dependencies", () => {
  const rows = projectPlanFlow(createInitialState(), evidencePlan);
  const canvas = workflowCanvas(rows);
  expect(canvas.nodes.map((node) => node.key)).toEqual(
    [0, 1, 2].map((index) => JSON.stringify([evidencePlan.plan_id, index])),
  );
  expect(canvas.edges.map((edge) => [edge.from, edge.to])).toEqual([
    [canvas.nodes[0]?.key, canvas.nodes[2]?.key],
    [canvas.nodes[1]?.key, canvas.nodes[2]?.key],
  ]);
  expect(canvas.edges[0]?.label).toBe("Step 3 waits for step 1 to merge");
});
