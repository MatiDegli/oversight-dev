import type { State } from "../state";
import type { GraphViewProps } from "./GraphView";
import { sameProjectionState } from "./projectionState";

type Publication = {
  state: State;
  props: GraphViewProps;
  revision?: number;
};

const sameFocusNodes = (a: State["focus"], b: State["focus"]) => {
  const agents = Object.keys(a);
  return (
    agents.length === Object.keys(b).length &&
    agents.every((id) => {
      const before = a[id]?.node_ids;
      const after = b[id]?.node_ids;
      return before?.length === after?.length && before?.every((node, i) => node === after?.[i]);
    })
  );
};

// agent.status copies the changes dictionary even when all change records are retained.
const sameChanges = (a: State["changes"], b: State["changes"]) =>
  a === b ||
  (Object.keys(a).length === Object.keys(b).length &&
    Object.entries(a).every(([id, change]) => change === b[id]));

/** Keep topology, edits and fold targets in order; collapse adjacent presentation updates. */
export function replacePaintPublication(a: Publication, b: Publication): boolean {
  if (
    a.revision !== b.revision ||
    a.state.run?.run_id !== b.state.run?.run_id ||
    a.state.runStartedAt !== b.state.runStartedAt
  )
    return false;
  const keys = new Set([...Object.keys(a.props), ...Object.keys(b.props)]);
  const sameProp = (key: string) =>
    // Field light payloads follow every store event; projection reads only their mode.
    key === "field"
      ? a.props.field?.mode === b.props.field?.mode
      : a.props[key as keyof GraphViewProps] === b.props[key as keyof GraphViewProps];
  // Agent status and decision history change marks, but not placement or edit revisions.
  // Focus modes/ranges can change paint; only fresh node targets can open another module.
  if (
    [...keys].every(sameProp) &&
    a.state.graph === b.state.graph &&
    sameChanges(a.state.changes, b.state.changes) &&
    sameFocusNodes(a.state.focus, b.state.focus)
  )
    return true;
  if (!sameProjectionState(a.state, b.state)) return false;
  // Without fresh reads or cones, litIds changes opacity only: pending marks stay visible.
  if (
    Object.keys(a.state.focus).length ||
    a.props.cone ||
    a.props.liveCone ||
    b.props.cone ||
    b.props.liveCone
  )
    return false;
  return [...keys].every((key) => key === "litIds" || sameProp(key));
}
