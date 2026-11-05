import type { Plan, ServerEvent, SuiteExecution } from "@contracts";
import { applyEvent, createInitialState, type State } from "../../state";
// eslint-disable-next-line no-restricted-imports -- Scripted envelopes, no API calls.
import { agent, event, proposal, resolution, run, snapshot } from "../../state/state.support";
export { agent, event, proposal, resolution, run, snapshot };
export const evidencePlan: Plan = {
  plan_id: "workflow-evidence",
  revision: 1,
  task: "Synthetic checkout plan",
  graph_version: "v1",
  state: "running",
  started_by: "lead",
  queued_task_id: null,
  detail: null,
  subtasks: [0, 1, 2].map((index) => ({
    task: `Task ${String(index + 1)}`,
    zone: { node_ids: [], paths: [] },
    depends_on: index === 2 ? [0, 1] : [],
    agent_id: index === 0 ? agent.agent_id : index === 1 ? "second" : null,
    state: index === 2 ? "waiting" : "running",
  })),
};
export function append<T extends ServerEvent["type"]>(
  state: State,
  type: T,
  payload: Extract<ServerEvent, { type: T }>["payload"],
) {
  return applyEvent(state, {
    seq: state.lastSeq + 1,
    ts: "2026-11-03T19:00:00Z",
    type,
    payload,
  } as ServerEvent);
}
export function candidateState() {
  return [
    event(1, "run.started", run),
    event(2, "plan.updated", evidencePlan),
    event(3, "agent.status", { ...agent, plan_id: evidencePlan.plan_id, base_commit: "base" }),
    event(4, "change.proposed", proposal),
  ].reduce(applyEvent, createInitialState());
}
export function execution(
  state: State,
  phase: SuiteExecution["phase"],
  failed = false,
  revision = 1,
) {
  return append(state, "tests.executed", {
    change_id: proposal.change_id,
    agent_id: agent.agent_id,
    revision,
    phase,
    tested_commit: phase === "proposal" ? proposal.head_commit : "combined",
    tested_tree: "tree",
    suite: {
      ...proposal.tests,
      outcome: failed ? "failed" : "passed",
      passed: 31,
      failed: failed ? 2 : 0,
    },
  });
}
