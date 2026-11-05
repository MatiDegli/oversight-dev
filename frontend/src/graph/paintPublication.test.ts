import { expect, it, vi } from "vitest";
import { createInitialState } from "../state";
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
  const state = createInitialState();
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
