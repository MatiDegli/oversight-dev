import { edgePosition, separateEdgePaths, type EdgePoint } from "./separateEdgePaths";

type Edge = { from: string; to: string };
type Box = Pick<DOMRect, "left" | "right" | "top" | "bottom">;

function port(edges: readonly Edge[], edge: Edge, end: "from" | "to", box: Box) {
  const siblings = edges.filter((other) => other[end] === edge[end]);
  const fraction = (siblings.indexOf(edge) + 1) / (siblings.length + 1);
  // Incoming ports use the right half, outgoing ports the left half. An incoming
  // arrow can never line up with the outgoing stub of a different step below it.
  return box.left + (box.right - box.left) * ((end === "from" ? 0.1 : 0.55) + 0.35 * fraction);
}

function bandTrack(
  edges: readonly Edge[],
  edge: Edge,
  boxes: ReadonlyMap<string, Box>,
  end: "from" | "to",
  gap: number,
) {
  const box = boxes.get(edge[end]);
  const short = (candidate: Edge) =>
    (boxes.get(candidate.to)?.top ?? 0) - (boxes.get(candidate.from)?.bottom ?? 0) <= gap + 1;
  const coordinate = end === "from" ? "bottom" : "top";
  const siblings = edges.filter(
    (other) =>
      boxes.get(other[end])?.[coordinate] === box?.[coordinate] && short(other) === short(edge),
  );
  return (siblings.indexOf(edge) + 1) / (siblings.length + 1);
}

/** Allocate independent ports, gutter lanes and separate short/long horizontal bands. */
export function canvasEdgeRoutes(
  edges: readonly Edge[],
  boxes: ReadonlyMap<string, Box>,
  bounds: Box,
  gap: number,
  gutter: number,
) {
  const routes = edges.map((edge, index): EdgePoint[] => {
    const from = boxes.get(edge.from);
    const to = boxes.get(edge.to);
    if (!from || !to) return [];
    const start = { x: port(edges, edge, "from", from) - bounds.left, y: from.bottom - bounds.top };
    const end = { x: port(edges, edge, "to", to) - bounds.left, y: to.top - bounds.top - 1 };
    const track = (index + 1) / (edges.length + 1);
    if (to.top - from.bottom <= gap + 1) {
      const middle = start.y + gap * (0.35 + 0.2 * bandTrack(edges, edge, boxes, "from", gap));
      return [start, { x: start.x, y: middle }, { x: end.x, y: middle }, end];
    }
    const exit = start.y + gap * (0.1 + 0.15 * bandTrack(edges, edge, boxes, "from", gap));
    const entry =
      to.top - bounds.top - gap * (0.2 + 0.15 * bandTrack(edges, edge, boxes, "to", gap));
    const lane =
      (from.left + from.right) / 2 < (bounds.left + bounds.right) / 2
        ? gutter * track
        : bounds.right - bounds.left - gutter * track;
    return [
      start,
      { x: start.x, y: exit },
      { x: lane, y: exit },
      { x: lane, y: entry },
      { x: end.x, y: entry },
      end,
    ];
  });
  return separateEdgePaths(routes).map((d, index) => {
    const end = routes[index]?.at(-1);
    // A separate terminal stroke gives each dependency exactly one arrow, even
    // when its body contains multiple subpaths at overpasses.
    return {
      d,
      arrow: end ? `M ${edgePosition({ x: end.x, y: end.y - 1 })} L ${edgePosition(end)}` : "",
    };
  });
}
