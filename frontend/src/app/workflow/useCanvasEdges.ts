import { useLayoutEffect, useRef } from "react";

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
      svg.setAttribute("viewBox", `0 0 ${String(bounds.width)} ${String(bounds.height)}`);
      edges.forEach((edge, index) => {
        const from = nodes.get(edge.from)?.getBoundingClientRect();
        const to = nodes.get(edge.to)?.getBoundingClientRect();
        if (!from || !to) return;
        const startX = (from.left + from.right) / 2 - bounds.left;
        const endX = (to.left + to.right) / 2 - bounds.left;
        const startY = from.bottom - bounds.top;
        const endY = to.top - bounds.top - 8;
        paths[index]?.setAttribute(
          "d",
          `M ${String(startX)} ${String(startY)} L ${String(endX)} ${String(endY)}`,
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
