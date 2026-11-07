import type { GraphEdge } from "@contracts";
import cytoscape from "cytoscape";
import type { Core } from "cytoscape";
import { expect, it } from "vitest";

import { applyEvent } from "../state";
import { graphElements } from "./elements";
import { fullUpdateGraph } from "./fullUpdateGraph.testOracle";
import { event, initial, node, theme } from "./graph.support";
import { growthPositions } from "./place";
import { graphStyles } from "./styles";
import { updateGraph } from "./updateGraph";

/** Read routing data, interaction classes and compound bounds as well as projection fields. */
function reading(cy: Core) {
  return cy
    .elements()
    .map((element) => ({
      id: element.id(),
      data: structuredClone(element.data()) as unknown,
      classes: [...element.classes()].sort(),
      position: element.isNode() ? { ...element.position() } : undefined,
      box: element.isNode()
        ? element.boundingBox({ includeLabels: false, includeOverlays: false })
        : undefined,
    }))
    .sort((a, b) => a.id.localeCompare(b.id));
}

function packedGraph() {
  return cytoscape({
    headless: true,
    styleEnabled: true,
    style: [
      ...graphStyles(theme),
      { selector: "#left, #right", style: { width: 4000, height: 8000 } },
      { selector: "#top, #bottom", style: { width: 8000, height: 4000 } },
    ],
  });
}

/** Four walls force placement to save growth history instead of finding space beside the module. */
function hemIn(cy: Core) {
  const frame = cy.getElementById("m").boundingBox({ includeLabels: false });
  cy.getElementById("left").position({ x: frame.x1 - 2008, y: 0 });
  cy.getElementById("right").position({ x: frame.x2 + 2008, y: 0 });
  cy.getElementById("top").position({ x: 0, y: frame.y1 - 2008 });
  cy.getElementById("bottom").position({ x: 0, y: frame.y2 + 2008 });
}

function initialPackedState(edge: GraphEdge) {
  const source = initial();
  if (!source.graph) throw new Error("Missing graph");
  return applyEvent(
    source,
    event(5, "graph.snapshot", {
      ...source.graph,
      nodes: [
        node("m", "module"),
        node("f", "function", "m"),
        node("g", "function", "m"),
        node("s", "function"),
        ...["left", "right", "top", "bottom"].map((id) => node(id, "module")),
      ],
      edges: [edge],
      positions: {
        f: { x: 0, y: 0 },
        g: { x: 0, y: 57 },
        s: { x: 10000, y: 0 },
        left: { x: -2200, y: 0 },
        right: { x: 2200, y: 0 },
        top: { x: 0, y: -2200 },
        bottom: { x: 0, y: 2200 },
      },
    }),
  );
}

it.each(["src", "dst"] as const)(
  "restores growth and an edge whose removed %s is repointed without new ids",
  (endpoint) => {
    const edge = {
      id: "surviving-edge",
      kind: "calls" as const,
      src: "f",
      dst: "g",
      confidence: "exact" as const,
      reason: null,
      [endpoint]: "s",
    };
    let state = initialPackedState(edge);
    const actual = packedGraph(),
      oracle = packedGraph();
    const render = () => {
      expect(state.gap).toBe(false);
      updateGraph(actual, graphElements(state));
      fullUpdateGraph(oracle, graphElements(state));
      expect(reading(actual)).toEqual(reading(oracle));
    };
    const delta = (removing: boolean) => {
      if (!state.graph) throw new Error("Missing graph");
      return event(state.lastSeq + 1, "graph.delta", {
        from_version: state.graph.version,
        to_version: `v${String(state.lastSeq + 1)}`,
        commit: "next",
        cause: "rescan",
        nodes_added: removing ? [] : [node("c", "class", "m")],
        nodes_changed: [],
        nodes_removed: removing ? ["c", "s"] : [],
        edges_added: [],
        edges_changed: removing ? [{ ...edge, [endpoint]: endpoint === "src" ? "f" : "g" }] : [],
        edges_removed: [],
        parse_errors: [],
      });
    };
    try {
      render();
      for (const cy of [actual, oracle]) hemIn(cy);
      state = applyEvent(state, delta(false));
      render();
      expect(growthPositions.get(actual)?.size).toBeGreaterThan(0);
      const ids = new Set(actual.elements().map((element) => element.id()));
      state = applyEvent(state, delta(true));
      expect(state.graph?.edges).toHaveLength(1);
      expect(graphElements(state).every((element) => ids.has(element.data.id))).toBe(true);
      render();
      expect(actual.getElementById(edge.id).nonempty()).toBe(true);
      expect(growthPositions.get(actual)?.size).toBe(0);
    } finally {
      actual.destroy();
      oracle.destroy();
    }
  },
);
