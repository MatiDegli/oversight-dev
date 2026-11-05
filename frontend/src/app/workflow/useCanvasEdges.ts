import { useLayoutEffect, useRef } from "react";

import { canvasEdgeRoutes } from "./canvasEdgeRoutes";

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
      const boxes = new Map(
        [...nodes].map(([key, node]) => [key ?? "", node.getBoundingClientRect()]),
      );
      const arrows = [...svg.querySelectorAll(":scope > g > path")];
      canvasEdgeRoutes(edges, boxes, bounds, gap, gutter).forEach((route, index) => {
        paths[index]?.setAttribute("d", route.d);
        arrows[index]?.setAttribute("d", route.arrow);
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
