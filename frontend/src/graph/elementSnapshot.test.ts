import { expect, it, vi } from "vitest";

import { applyEvent, createInitialState } from "../state";
import * as themeApi from "../theme";

import { event, initial } from "./graph.support";
import { elementSnapshot } from "./elementSnapshot";

it("reuses fold input until state or the graph's visual scope changes", () => {
  const snapshot = elementSnapshot();
  const state = createInitialState();
  const first = snapshot(state, {});
  expect(snapshot(state, {})).toBe(first);
  const next = snapshot({ ...state }, {});
  expect(next).toBe(first);
  const scoped = snapshot(state, { litIds: ["module"] });
  expect(scoped).not.toBe(next);
  const live = snapshot(state, { field: { mode: "live-diff", lights: [] } });
  expect(live).not.toBe(scoped);
});

it("rebuilds fold input when geometry changes on the same theme object", () => {
  const snapshot = elementSnapshot();
  const state = createInitialState();
  const theme = { ...themeApi.themes.dark };
  const active = vi.spyOn(themeApi, "getActiveTheme").mockReturnValue(theme);
  try {
    const first = snapshot(state, {});
    Object.assign(theme, { "node-height": "56px" });
    expect(snapshot(state, {})).not.toBe(first);
  } finally {
    active.mockRestore();
  }
});

it("ignores chat and tool-output envelopes but invalidates every transitive projection slice", () => {
  const snapshot = elementSnapshot();
  let state = initial();
  const first = snapshot(state, {});
  for (let i = 0; i < 100; i++) {
    state = applyEvent(
      state,
      event(state.lastSeq + 1, "agent.message", {
        agent_id: "agent-A",
        text: `Chat ${String(i)}`,
      }),
    );
    expect(state.gap).toBe(false);
    expect(snapshot(state, {})).toBe(first);
    state = applyEvent(
      state,
      event(state.lastSeq + 1, "agent.step", {
        agent_id: "agent-A",
        step: i + 1,
        tool: "read_file",
        summary: "Tool output",
        result: "ok",
        error: null,
        error_kind: null,
        duration_ms: 1,
        tests: null,
      }),
    );
    expect(state.gap).toBe(false);
    expect(snapshot(state, {})).toBe(first);
  }
  for (const key of ["graph", "agents", "changes", "focus", "decisionEvents"] as const) {
    const changed = {
      ...state,
      [key]: Array.isArray(state[key]) ? [...state[key]] : { ...state[key] },
    };
    expect(snapshot(changed, {}), key).not.toBe(snapshot(state, {}));
  }
  expect(snapshot({ ...state, runStartedAt: "2026-11-05T19:00:00-03:00" }, {})).not.toBe(first);
});
