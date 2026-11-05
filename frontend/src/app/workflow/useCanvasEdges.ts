import { useLayoutEffect, useRef } from "react";

function edgePath(
  from: DOMRect,
  to: DOMRect,
  bounds: DOMRect,
  gap: number,
  lane: number,
  offset: number,
) {
  const startX = (from.left + from.right) / 2 - bounds.left;
  const endX = (to.left + to.right) / 2 - bounds.left;
  const startY = from.bottom - bounds.top;
  const endY = to.top - bounds.top - 8;
  const start = `M ${String(startX)} ${String(startY)}`;
  const end = `L ${String(endX)} ${String(endY)}`;
  // Adjacent rows share an empty gutter. Longer edges must bypass every row
  // between their endpoints, including wrapped rows within the same wave.
  if (to.top - from.bottom <= gap + 1) return `${start} ${end}`;
  const exitY = startY + offset;
  const entryY = to.top - bounds.top - offset;
  return `${start} L ${String(startX)} ${String(exitY)} L ${String(lane)} ${String(exitY)} L ${String(lane)} ${String(entryY)} L ${String(endX)} ${String(entryY)} ${end}`;
}

/** Size only the edge drawing from the rendered grid; never move nodes, scroll or focus. */
export function useCanvasEdges(edges: readonly { from: string; to: string }[]) {
  const host = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const canvas = host.current;
    const svg = canvas?.querySelector("svg");
    if (!canvas || !svg) return;
    const nodes = new Map(
      [...canvas.querySelectorAll<HTMLElement>("[data-step-key]")].map((node) => [
        node.dataset.stepKey,
        node,
      ]),
    );
    const paths = [...svg.querySelectorAll(":scope > path")];
    const draw = () => {
      const bounds = canvas.getBoundingClientRect();
      const grid = canvas.querySelector("ol");
      if (!grid) return;
      const style = getComputedStyle(grid);
      const gap = parseFloat(style.rowGap);
      const gutter = parseFloat(style.paddingLeft);
      svg.setAttribute("viewBox", `0 0 ${String(bounds.width)} ${String(bounds.height)}`);
      edges.forEach((edge, index) => {
        const from = nodes.get(edge.from)?.getBoundingClientRect();
        const to = nodes.get(edge.to)?.getBoundingClientRect();
        if (!from || !to) return;
        const track = (index + 1) / (edges.length + 1);
        const leftLane = gutter * track;
        const lane =
          (from.left + from.right) / 2 < (bounds.left + bounds.right) / 2
            ? leftLane
            : bounds.width - leftLane;
        paths[index]?.setAttribute(
          "d",
          edgePath(from, to, bounds, gap, lane, (gap * (1 + track)) / 4),
        );
      });
    };
    draw();
    const observer = new ResizeObserver(draw);
    observer.observe(canvas);
    nodes.forEach((node) => {
      observer.observe(node);
    });
    return () => {
      observer.disconnect();
    };
  }, [edges]);
  return host;
}
