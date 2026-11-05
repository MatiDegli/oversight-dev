import type { State } from "../state";
import type { GraphViewProps } from "./GraphView";
import { sameProjectionState } from "./projectionState";

type Publication = {
  state: State;
  props: GraphViewProps;
  revision?: number;
};

/** Collapse pure dimming scopes; keep edits, focus/folds and topology in their original order. */
export function replacePaintPublication(a: Publication, b: Publication): boolean {
  if (
    a.revision !== b.revision ||
    a.state.run?.run_id !== b.state.run?.run_id ||
    !sameProjectionState(a.state, b.state)
  )
    return false;
  // Without fresh reads or cones, litIds changes opacity only: pending marks stay visible.
  if (
    Object.keys(a.state.focus).length ||
    a.props.cone ||
    a.props.liveCone ||
    b.props.cone ||
    b.props.liveCone
  )
    return false;
  const keys = new Set([...Object.keys(a.props), ...Object.keys(b.props)]);
  return [...keys].every(
    (key) =>
      key === "litIds" ||
      a.props[key as keyof GraphViewProps] === b.props[key as keyof GraphViewProps],
  );
}
