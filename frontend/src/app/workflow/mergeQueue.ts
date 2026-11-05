import { selectPlanEvidence } from "../../review";
import { projectPlanFlow, type State } from "../../state";
import { workflowDetail } from "./workflowDetail";

/** Observed, unresolved proposals only. Display order carries no scheduling meaning. */
export function mergeQueue(state: State, planId: string, hasReview = false) {
  const plan = selectPlanEvidence(state).plans.get(planId)?.payload;
  if (!plan || !["running", "completed", "failed"].includes(plan.state)) return [];
  return projectPlanFlow(state, plan).flatMap((row) => {
    const change = row.changeId ? state.changes[row.changeId] : undefined;
    const proposal = change?.proposal;
    if (!proposal || row.merged || ["rejected", "cancelled"].includes(row.task.state ?? ""))
      return [];
    const resolution = change.resolution?.revision === proposal.revision ? change.resolution : null;
    if (resolution?.decision === "rejected" || resolution?.decision === "changes_requested")
      return [];
    return [
      {
        key: JSON.stringify([plan.plan_id, row.index, proposal.change_id, proposal.revision]),
        planId: plan.plan_id,
        planRevision: plan.revision,
        index: row.index,
        changeId: proposal.change_id,
        revision: proposal.revision,
        head: proposal.head_commit,
        main: row.main,
        detail: workflowDetail(row, state, hasReview),
      },
    ];
  });
}
