import { expect, it, vi } from "vitest";
import { applyEvent, createInitialState } from "../state";
import { a, event, initial } from "./graph.support";
import { graphSync } from "./graphSync";
import { replacePaintPublication } from "./paintPublication";
import type { GraphViewProps } from "./GraphView";

it("applies one final pure class scope on show across many hidden publications", () => {
  const state = createInitialState();
  let props: GraphViewProps = {};
  let visible = false;
  const apply = vi.fn();
  const updates = graphSync({
    read: () => ({ state, props }),
    apply,
    visible: () => visible,
    resize: vi.fn(),
    replace: replacePaintPublication,
  });
  for (let i = 0; i < 100; i++) {
    props = { litIds: [String(i)] };
    updates.publish();
  }
  expect(apply).not.toHaveBeenCalled();
  visible = true;
  updates.visibility();
  expect(apply).toHaveBeenCalledExactlyOnceWith({
    state,
    props: { litIds: ["99"] },
  });
});

it("retains transitions that can affect geometry, fold choices, identity or camera scope", () => {
  const state = initial();
  const first = { state, props: {} };
  expect(replacePaintPublication(first, { state, props: { litIds: [] } })).toBe(true);
  for (const changed of [
    {
      state: {
        ...state,
        graph: null,
        focus: { a: { agent_id: "a", node_ids: [], mode: "read" as const, ranges: [] } },
      },
      props: {},
    },
    { state: { ...state, changes: {} }, props: {} },
    { state, props: { frameKey: "other" } },
    { state, props: {}, revision: 1 },
  ])
    expect(replacePaintPublication(first, changed)).toBe(false);
});

it("keeps one final graph-relevant agent publication while hidden", () => {
  let state = initial();
  let visible = false;
  const apply = vi.fn();
  let props: GraphViewProps = {};
  const updates = graphSync({
    read: () => ({ state, props }),
    apply,
    visible: () => visible,
    resize: vi.fn(),
    replace: replacePaintPublication,
  });
  for (let i = 0; i < 100; i++) {
    state = applyEvent(state, event(state.lastSeq + 1, "agent.status", { ...a, step: i + 1 }));
    props = { field: { mode: "watch", lights: [] } };
    updates.publish();
  }
  expect(apply).not.toHaveBeenCalled();
  visible = true;
  updates.visibility();
  expect(apply).toHaveBeenCalledOnce();
  expect(apply).toHaveBeenLastCalledWith({ state, props });
});

it("retains field mode changes that affect read marks", () => {
  const state = initial();
  expect(
    replacePaintPublication(
      { state, props: { field: { mode: "watch", lights: [] } } },
      { state, props: { field: { mode: "live-diff", lights: [] } } },
    ),
  ).toBe(false);
});

it("collapses repeated focus nodes but retains changes to fold history", () => {
  const state = initial();
  const focus = {
    agent_id: a.agent_id,
    node_ids: ["billing:fee"],
    mode: "read" as const,
    ranges: [],
  };
  const first = { state: { ...state, focus: { [a.agent_id]: focus } }, props: {} };
  expect(
    replacePaintPublication(first, {
      ...first,
      state: { ...first.state, focus: { [a.agent_id]: { ...focus, mode: "edit" } } },
    }),
  ).toBe(true);
  expect(
    replacePaintPublication(first, {
      ...first,
      state: {
        ...first.state,
        focus: { [a.agent_id]: { ...focus, node_ids: ["billing:Bill.total"] } },
      },
    }),
  ).toBe(false);
});

it("applies one final pure class scope per visible animation frame", () => {
  const state = createInitialState();
  let props: GraphViewProps = {};
  let frame: FrameRequestCallback | undefined;
  const request = vi.fn((callback: FrameRequestCallback) => {
    frame = callback;
    return 1;
  });
  vi.stubGlobal("requestAnimationFrame", request);
  vi.stubGlobal("cancelAnimationFrame", vi.fn());
  const apply = vi.fn();
  const updates = graphSync({
    read: () => ({ state, props }),
    apply,
    visible: () => true,
    resize: vi.fn(),
    replace: replacePaintPublication,
  });
  try {
    for (let i = 0; i < 100; i++) {
      props = { litIds: [String(i)] };
      updates.publish();
    }
    expect(request).toHaveBeenCalledOnce();
    expect(apply).not.toHaveBeenCalled();
    frame?.(0);
    expect(apply).toHaveBeenCalledExactlyOnceWith({
      state,
      props: { litIds: ["99"] },
    });
  } finally {
    updates.dispose();
    vi.unstubAllGlobals();
  }
});
