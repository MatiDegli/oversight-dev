import { readFileSync } from "node:fs";
import type { GraphSnapshot } from "@contracts";
import cytoscape from "cytoscape";
import type { Core } from "cytoscape";
import { expect, it, vi } from "vitest";
import type { ServerEvent } from "@contracts";
import { applyEvent } from "../state";
import type { State } from "../state";
import { graphElements } from "./elements";
import { elementSnapshot } from "./elementSnapshot";
import { foldController } from "./foldController";
import { fullFoldController } from "./fullFoldController.testOracle";
import { fullUpdateGraph } from "./fullUpdateGraph.testOracle";
import { replacePaintPublication } from "./paintPublication";
import { graphSync } from "./graphSync";
import { graphStyles } from "./styles";
import { updateGraph } from "./updateGraph";
import { a, b, event, initial, node, theme, updated } from "./graph.support";

/** Includes router-owned data/classes and compound frame minima, not just projection output. */
export function graphReading(cy: Core) {
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

function random(seed: number) {
  let value = seed;
  return (limit: number) => {
    value = (Math.imul(value, 1664525) + 1013904223) >>> 0;
    return value % limit;
  };
}

function nextEvent(state: State, draw: (limit: number) => number): ServerEvent {
  const agent = draw(2) ? a : b;
  const id = draw(2) ? "billing:fee" : "billing:Bill.total";
  switch (draw(8)) {
    case 0:
      return event(state.lastSeq + 1, "agent.message", { agent_id: agent.agent_id, text: "Chat" });
    case 1:
      return event(state.lastSeq + 1, "agent.step", {
        agent_id: agent.agent_id,
        step: 2,
        tool: "read_file",
        summary: "Output",
        result: "ok",
        error: null,
        error_kind: null,
        tests: null,
        duration_ms: 1,
      });
    case 2:
      return event(state.lastSeq + 1, "agent.focus", {
        agent_id: agent.agent_id,
        mode: draw(2) ? "read" : "edit",
        node_ids: [id],
        ranges: [],
      });
    case 3:
      return event(state.lastSeq + 1, "agent.status", {
        ...agent,
        state: draw(2) ? "working" : "ready_for_review",
      });
    case 4: {
      const template = updated(state).stageEvents.at(-1);
      if (!template || template.type !== "change.updated") throw new Error("Missing update");
      return {
        ...template,
        payload: {
          ...template.payload,
          file: { ...template.payload.file, modified: String(draw(100)) },
          graph: {
            ...template.payload.graph,
            nodes_added: draw(2) ? [node("billing:discount", "function", "billing")] : [],
          },
        },
      };
    }
    case 5:
      return event(state.lastSeq + 1, "change.resolved", {
        change_id: a.change_id,
        agent_id: a.agent_id,
        revision: 1,
        decision: "rejected",
        merge: null,
        merge_commit: null,
        comment: null,
        conflict: null,
        decided_by: "person",
        review_seq: null,
        requested_by: null,
        head_commit: "base",
        reasons: [],
        assessment: null,
        answers: [],
        reason: null,
      });
    default: {
      const graph = state.graph;
      if (!graph) throw new Error("Missing graph");
      const add = draw(2) === 1;
      return event(state.lastSeq + 1, "graph.snapshot", {
        ...graph,
        nodes: [
          ...graph.nodes.filter((n) => n.id !== "extra"),
          ...(add ? [node("extra", "function", draw(2) ? "billing" : null)] : []),
        ].map((n) => (n.id === id ? { ...n, name: `name${String(draw(5))}` } : n)),
        positions: { ...graph.positions, extra: { x: 600, y: 300 } },
      });
    }
  }
}

it.each(Array.from({ length: 24 }, (_, i) => i + 1))(
  "matches the full path after every step of random sequence %i, including hidden catch-up",
  (seed) => {
    vi.stubGlobal("matchMedia", () => ({ matches: true }));
    const draw = random(seed);
    const make = () => cytoscape({ headless: true, styleEnabled: true, style: graphStyles(theme) });
    const actual = make(),
      oracle = make(),
      hidden = make();
    const folding = foldController(actual),
      oldFolding = fullFoldController(oracle),
      hiddenFolding = foldController(hidden);
    const snapshot = elementSnapshot(),
      hiddenSnapshot = elementSnapshot();
    let state = initial();
    let visible = false;
    const updates = graphSync({
      read: () => state,
      apply: (value) => {
        hiddenFolding.render(value, hiddenSnapshot(value, {}));
      },
      visible: () => visible,
      resize: () => undefined,
    });
    try {
      for (let step = 0; step < 48; step++) {
        if (step > 0) state = applyEvent(state, nextEvent(state, draw));
        expect(state.gap).toBe(false);
        folding.render(state, snapshot(state, {}));
        oldFolding.render(state, graphElements(state));
        updates.publish();
        expect(graphReading(actual), `seed ${String(seed)}, step ${String(step)}`).toEqual(
          graphReading(oracle),
        );
        if (step % 8 === 7) {
          visible = true;
          updates.visibility();
          expect(graphReading(hidden)).toEqual(graphReading(oracle));
          visible = false;
          updates.visibility();
        }
        if (step % 11 === 5) {
          updates.force();
          for (const controller of [folding, oldFolding, hiddenFolding])
            controller.toggle("billing");
        }
      }
    } finally {
      updates.dispose();
      actual.destroy();
      oracle.destroy();
      hidden.destroy();
      vi.unstubAllGlobals();
    }
  },
);

it("writes only changed ids in one batch and skips geometry for paint-only classes", () => {
  const cy = cytoscape({ headless: true, styleEnabled: true, style: graphStyles(theme) });
  const old = cytoscape({ headless: true, styleEnabled: true, style: graphStyles(theme) });
  const elements = graphElements(initial());
  try {
    updateGraph(cy, elements);
    fullUpdateGraph(old, structuredClone(elements));
    const lookup = vi.spyOn(cy, "getElementById");
    const batch = vi.spyOn(cy, "batch");
    const next = elements.map((e) =>
      e.data.id === "billing:fee" ? { ...e, classes: `${e.classes} dimmed` } : e,
    );
    updateGraph(cy, next);
    fullUpdateGraph(old, structuredClone(next));
    expect(lookup.mock.calls).toEqual([["billing:fee"]]);
    expect(batch).toHaveBeenCalledOnce();
    expect(graphReading(cy)).toEqual(graphReading(old));
    lookup.mockClear();
    batch.mockClear();
    updateGraph(cy, next);
    expect(lookup).not.toHaveBeenCalled();
    expect(batch).not.toHaveBeenCalled();
  } finally {
    cy.destroy();
    old.destroy();
  }
});

it("matches growth restoration when unplaced additions disappear and others arrive together", () => {
  const fixture = (path: string) =>
    JSON.parse(
      readFileSync(new URL(`../../../fixtures/${path}`, import.meta.url), "utf8"),
    ) as unknown;
  const graph = fixture("graph/demo-repo.json") as GraphSnapshot;
  const positions = fixture("layouts/demo-repo.json") as GraphSnapshot["positions"];
  const make = () => cytoscape({ headless: true, styleEnabled: true, style: graphStyles(theme) });
  const actual = make(),
    oracle = make();
  const parent = graph.nodes.find((n) => n.id === "shop.pricing");
  if (!parent) throw new Error("Missing pricing module");
  const added = { ...node("shop.pricing:NewClass", "class", parent.id), path: parent.path };
  const method = { ...node("shop.pricing:NewClass.method", "method", added.id), path: parent.path };
  const other = { ...node("shop.pricing:other", "function", parent.id), path: parent.path };
  try {
    for (const additions of [[], [added, method], [other], [], [added, method], []]) {
      const state = {
        ...initial(),
        graph: { ...graph, positions, nodes: [...graph.nodes, ...additions] },
      };
      updateGraph(actual, graphElements(state));
      fullUpdateGraph(oracle, graphElements(state));
      expect(graphReading(actual)).toEqual(graphReading(oracle));
    }
  } finally {
    actual.destroy();
    oracle.destroy();
  }
});

it("preserves the full path's distinction between omitted and explicitly cleared data", () => {
  const make = () => cytoscape({ headless: true, styleEnabled: true, style: graphStyles(theme) });
  const actual = make(),
    oracle = make();
  const base = graphElements(initial());
  const first = base.map((e) =>
    e.data.id === "billing:fee" ? { ...e, data: { ...e.data, measured: "differs" as const } } : e,
  );
  const clear = base.map((e) =>
    e.data.id === "billing:fee" ? { ...e, data: { ...e.data, measured: undefined } } : e,
  );
  try {
    for (const elements of [first, base, clear]) {
      updateGraph(actual, structuredClone(elements));
      fullUpdateGraph(oracle, structuredClone(elements));
      expect(graphReading(actual)).toEqual(graphReading(oracle));
    }
    expect(actual.getElementById("billing:fee").data("measured")).toBeUndefined();
  } finally {
    actual.destroy();
    oracle.destroy();
  }
});

it.each([false, true])(
  "one hidden paint flush matches 100 full applications (pending: %s)",
  (pending) => {
    const source = pending ? updated() : initial();
    if (!source.graph) throw new Error("Missing graph");
    // This comparison starts after a deterministic first layout, like the retained view.
    const state = {
      ...source,
      graph: {
        ...source.graph,
        positions: Object.fromEntries(
          source.graph.nodes.map((n, i) => [n.id, { x: i * 400, y: i * 100 }]),
        ),
      },
    };
    const make = () => cytoscape({ headless: true, styleEnabled: true, style: graphStyles(theme) });
    const actual = make(),
      oracle = make();
    const folding = foldController(actual),
      oldFolding = fullFoldController(oracle);
    const snapshot = elementSnapshot();
    let props: import("./GraphView").GraphViewProps = {};
    let visible = false;
    const apply = vi.fn((input: { state: State; props: import("./GraphView").GraphViewProps }) => {
      folding.render(input.state, snapshot(input.state, input.props));
    });
    const updates = graphSync({
      read: () => ({ state, props }),
      apply,
      visible: () => visible,
      resize: () => undefined,
      replace: replacePaintPublication,
    });
    try {
      folding.render(state, snapshot(state, props));
      oldFolding.render(state, graphElements(state));
      for (let i = 0; i < 100; i++) {
        props = { litIds: i % 2 ? ["billing:fee"] : undefined };
        oldFolding.render(
          state,
          graphElements(state, false, props.litIds ? new Set(props.litIds) : null),
        );
        updates.publish();
      }
      expect(apply).not.toHaveBeenCalled();
      visible = true;
      updates.visibility();
      expect(apply).toHaveBeenCalledOnce();
      expect(graphReading(actual)).toEqual(graphReading(oracle));
    } finally {
      updates.dispose();
      actual.destroy();
      oracle.destroy();
    }
  },
);
