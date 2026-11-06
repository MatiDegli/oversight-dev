import cytoscape from "cytoscape";
import type { GraphNode, ServerEvent } from "@contracts";
import { applyEvent, createInitialState } from "../state";
import type { State } from "../state";
import { themes } from "../theme";
import { elementSnapshot } from "./elementSnapshot";
import { graphElements } from "./elements";
import type { GraphViewProps } from "./GraphView";
import { fullUpdateGraph } from "./fullUpdateGraph.testOracle";
import { sameProjectionState } from "./projectionState";
import { replacePaintPublication } from "./paintPublication";
import { graphSync } from "./graphSync";
import { graphVisibility } from "./graphVisibility";
import { graphStyles } from "./styles";
import { applyFrames } from "./frames";
import { applyRoutes } from "./routes";
import { updateGraph } from "./updateGraph";

const frame = () =>
  new Promise<void>((resolve) =>
    requestAnimationFrame(() => {
      resolve();
    }),
  );
const pixel = async () => {
  await frame();
  await frame();
};
const median = (values: number[]) =>
  [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)] ?? 0;
export type Scenario = "class" | "unrelated" | "hidden" | "hidden-events" | "pan/zoom";

function synthetic(size: number): State {
  const state = createInitialState();
  const nodes: GraphNode[] = Array.from({ length: size }, (_, i) => ({
    id: `n${String(i)}`,
    kind: i % 20 === 0 ? "module" : "function",
    parent_id: i % 20 === 0 ? null : `n${String(i - (i % 20))}`,
    name: `node_${String(i)}`,
    qualname: `node_${String(i)}`,
    path: `m${String(Math.floor(i / 20))}.py`,
    start_line: 1,
    end_line: 2,
    is_test: false,
    examples: null,
  }));
  return {
    ...state,
    run: {
      run_id: "benchmark",
      contract_version: "1.0.0",
      prompt_version: "benchmark",
      workspace: "synthetic",
      base_commit: "base",
      models: [],
      slots: [],
      merge_mode: null,
      max_leads: null,
      limits: {
        max_steps: 10,
        max_output_tokens: 100,
        max_wall_clock_s: 60,
        test_timeout_s: 10,
        cone_max_depth: 3,
        cone_max_nodes: 20,
      },
      budget: { budget_usd: null, spent_usd: 0, warn_at: [], block_at: 0.9 },
    },
    graph: {
      version: "v1",
      commit: "base",
      nodes,
      parse_errors: [],
      positions: Object.fromEntries(
        nodes.map((n, i) => [
          n.id,
          {
            x: (Math.floor(i / 20) % 10) * 450,
            y: Math.floor(i / 200) * 1400 + (i % 20) * 60,
          },
        ]),
      ),
      edges: Array.from({ length: Math.min(8, Math.floor(size / 20) - 1) }, (_, i) => ({
        id: `e${String(i)}`,
        kind: "calls",
        src: `n${String(i * 20 + 1)}`,
        dst: `n${String((i + 1) * 20 + 1)}`,
        confidence: "exact",
        reason: null,
      })),
    },
  };
}

/** Browser canvas, production projection/application and scheduler; initialization is outside marks. */
export async function runInvalidationBench(
  size: number,
  scenario: Scenario,
  path: "before" | "after",
) {
  const host = document.createElement("div");
  host.style.cssText = "width:1280px;height:800px";
  host.dataset.graphHidden = "false";
  document.body.append(host);
  await document.fonts.ready;
  let state = synthetic(size);
  let props: GraphViewProps = {};
  const cy = cytoscape({
    container: host,
    layout: { name: "preset", fit: false },
    style: graphStyles(themes.dark),
    elements: structuredClone(graphElements(state)),
    zoom: 0.5,
    pan: { x: 50, y: 50 },
  });
  const snapshot = elementSnapshot();
  const visibility = graphVisibility(host);
  const costs: number[] = [];
  let applications = 0;
  const apply = (input: { state: State; props: GraphViewProps }) => {
    const start = performance.now();
    const elements =
      path === "before"
        ? graphElements(input.state, false, input.props.litIds ? new Set(input.props.litIds) : null)
        : snapshot(input.state, input.props);
    if (path === "before") fullUpdateGraph(cy, elements);
    else updateGraph(cy, elements);
    costs.push(performance.now() - start);
    applications++;
  };
  const updates = graphSync({
    read: () => ({ state, props }),
    equal: (a, b) => a.props === b.props && sameProjectionState(a.state, b.state),
    replace: replacePaintPublication,
    apply,
    visible: visibility.visible,
    resize: () => {
      cy.resize();
    },
  });
  const stopVisibility = visibility.observe(updates.visibility);
  const publish = () => {
    if (path === "before") apply({ state, props });
    else updates.publish();
  };
  const longTasks: PerformanceEntry[] = [];
  const observer = new PerformanceObserver((list) => {
    longTasks.push(...list.getEntries());
  });
  observer.observe({ type: "longtask", buffered: false });
  try {
    if (path === "before") apply({ state, props });
    else {
      updates.publish();
      updates.force();
    }
    await pixel();
    costs.length = 0;
    applications = 0;
    longTasks.length = 0;
    if (scenario === "hidden" || scenario === "hidden-events") {
      host.dataset.graphHidden = "true";
      host.hidden = true;
      updates.visibility();
    }
    const latencies: number[] = [];
    const measurementStart = performance.now();
    for (let sample = 0; sample < 7; sample++) {
      const mark = `graph-${path}-${String(size)}-${scenario}-${String(sample)}`;
      performance.mark(`${mark}:event`);
      if (scenario === "class" || scenario === "hidden") {
        props = { litIds: sample % 2 ? undefined : state.graph?.nodes.slice(1).map((n) => n.id) };
        publish();
      } else {
        for (let i = 0; i < 30; i++) {
          const envelope = { seq: state.lastSeq + 1, ts: "2026-11-05T19:00:00-03:00" };
          const event: ServerEvent =
            scenario === "hidden-events"
              ? {
                  ...envelope,
                  type: "agent.status",
                  payload: {
                    agent_id: "bench",
                    change_id: "bench-change",
                    slot: "A",
                    state: "working",
                    step: sample * 30 + i + 1,
                    max_steps: 300,
                    task: "Benchmark",
                    model: "fake",
                    detail: null,
                    plan_id: null,
                    zone: null,
                    started_by: null,
                    queued_task_id: null,
                    base_commit: null,
                    examples: null,
                    answering: null,
                  },
                }
              : i % 2
                ? {
                    ...envelope,
                    type: "agent.message",
                    payload: { agent_id: "bench", text: `output ${String(i)}` },
                  }
                : {
                    ...envelope,
                    type: "agent.step",
                    payload: {
                      agent_id: "bench",
                      step: i + 1,
                      tool: "read_file",
                      summary: "Tool output",
                      result: "ok",
                      error: null,
                      error_kind: null,
                      tests: null,
                      duration_ms: 1,
                    },
                  };
          state = applyEvent(state, event);
          publish();
        }
        if (scenario === "pan/zoom")
          cy.viewport({ zoom: sample % 2 ? 0.5 : 0.55, pan: { x: 50 + sample * 10, y: 50 } });
      }
      await pixel();
      performance.mark(`${mark}:pixel`);
      latencies.push(performance.measure(mark, `${mark}:event`, `${mark}:pixel`).duration);
    }
    const measuredApplications = applications;
    const measuredLongTasks = [...longTasks, ...observer.takeRecords()].filter(
      (entry) => entry.startTime >= measurementStart,
    ).length;
    const workMs = costs.reduce((total, value) => total + value, 0) / 7;
    const resumeStart = performance.now();
    host.hidden = false;
    host.dataset.graphHidden = "false";
    updates.visibility();
    await pixel();
    const resumeMs = performance.now() - resumeStart;
    const start = performance.now();
    performance.mark("invalidation:settle:frames:start");
    applyFrames(cy, themes.dark);
    const framesMs = performance.now() - start;
    performance.mark("invalidation:settle:frames:end");
    performance.measure(
      "invalidation:settle:frames",
      "invalidation:settle:frames:start",
      "invalidation:settle:frames:end",
    );
    const routeStart = performance.now();
    performance.mark("invalidation:settle:routes:start");
    applyRoutes(cy, themes.dark);
    performance.mark("invalidation:settle:routes:end");
    performance.measure(
      "invalidation:settle:routes",
      "invalidation:settle:routes:start",
      "invalidation:settle:routes:end",
    );
    const routesMs = performance.now() - routeStart;
    return {
      size,
      scenario,
      path,
      pixelMs: median(latencies),
      workMs,
      longTasks: measuredLongTasks,
      applications: measuredApplications,
      resumeApplications: applications - measuredApplications,
      resumeMs,
      framesMs,
      routesMs,
    };
  } finally {
    observer.disconnect();
    stopVisibility();
    updates.dispose();
    cy.destroy();
    host.remove();
  }
}
