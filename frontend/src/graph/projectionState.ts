import type { State } from "../state";

/** graphElements -> agentMarks -> teams/presentation (including palette allocation history). */
export type ProjectionState = Pick<
  State,
  "graph" | "agents" | "changes" | "focus" | "decisionEvents" | "runStartedAt"
>;

export function projectionState(state: ProjectionState): ProjectionState {
  return {
    graph: state.graph,
    agents: state.agents,
    changes: state.changes,
    focus: state.focus,
    decisionEvents: state.decisionEvents,
    runStartedAt: state.runStartedAt,
  };
}

export const sameProjectionState = (a: ProjectionState, b: ProjectionState) =>
  Object.entries(projectionState(a)).every(
    ([key, value]) => value === b[key as keyof ProjectionState],
  );
