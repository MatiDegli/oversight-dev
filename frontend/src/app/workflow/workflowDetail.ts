import { presentationForPlan, presentationFor } from "../../teams/presentation";
import { flowSteps, type PlanFlowRow, type State } from "../../state";

/** Presentation only: all state and gate evidence comes from the shared projection. */
export function workflowDetail(row: PlanFlowRow, state: State, hasReview: boolean) {
  const agent = row.agentId ? state.agents[row.agentId] : undefined;
  const profile = state.run?.models.find((model) => model.id === agent?.model);
  const change = row.changeId ? state.changes[row.changeId] : undefined;
  const reviewId =
    hasReview && change?.proposal && ["ready_for_review", "conflict"].includes(change.status)
      ? row.changeId
      : null;
  return {
    task: row.task.task,
    word: row.word,
    condition: row.condition,
    wave: row.wave + 1,
    dependencies: row.task.depends_on.map((index) => `#${String(index + 1)}`),
    gates: row.steps.map((step, index) => ({ label: flowSteps[index], ...step })),
    progress: row.progress ?? "Not known",
    note: row.note ?? "Not known",
    agent: row.agentId ?? "Not known",
    team: presentationForPlan(state, row.planId) ?? presentationFor(state, row.agentId),
    role: agent ? "Coding agent · recorded agent.status" : "Not known · no agent status recorded",
    model:
      profile?.label ??
      (agent?.model
        ? `${agent.model} · profile not recorded`
        : "Not known · no agent status recorded"),
    mode: "Not known · workflow control mode is not recorded",
    reasoning: profile
      ? (profile.reasoning ?? "None · profile has no reasoning setting")
      : "Not known · model profile not recorded",
    reviewId,
  };
}
