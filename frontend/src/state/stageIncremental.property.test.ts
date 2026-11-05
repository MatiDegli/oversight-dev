import { readFileSync } from "node:fs";
import type { ServerEvent } from "@contracts";
import { describe, expect, it } from "vitest";
import { startReplay } from "../transport";
import { applyEvent } from "./applyEvent";
import { consumeStage, finishStages, foldStages, stagePoint } from "./stageFold";
import { foldStages as oracle } from "./stageFold.oracle";
import { createStateStore } from "./store";
import { createInitialState } from "./types";

const templates = ["stage-clocks", "handwritten-behavior-review"].flatMap((name) =>
  readFileSync(new URL(`../../../fixtures/events/${name}.jsonl`, import.meta.url), "utf8")
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line) as ServerEvent),
);
const ids = ["change-0", "change-1", "change-2", "change-3"];
const epoch = Date.UTC(2026, 10, 4);
const seeds = Array.from({ length: 500 }, (_, index) => 0x51a9e000 + index);

function choose<T>(values: readonly T[], n: number): T {
  const value = values[n % values.length];
  if (value === undefined) throw new Error("Empty generator choice");
  return value;
}

function envelope(
  type: ServerEvent["type"],
  seq: number,
  overrides: Record<string, unknown> = {},
  ts = new Date(epoch + seq * 10).toISOString(),
): ServerEvent {
  const template = templates.find((event) => event.type === type);
  if (!template) throw new Error(`Missing ${type} template`);
  return {
    ...template,
    seq,
    ts,
    payload: { ...structuredClone(template.payload), ...overrides },
  } as ServerEvent;
}

function randomPayload(
  type: ServerEvent["type"],
  change_id: string,
  revision: number,
  draw: () => number,
): Record<string, unknown> {
  const payload: Record<string, unknown> = { change_id, revision };
  if (type === "agent.status") {
    payload.state = choose(
      ["starting", "working", "working", "revising", "paused", "halted", "done"],
      draw(),
    );
  } else if (type === "tests.executed") {
    const template = templates.find((event) => event.type === "tests.executed");
    if (template?.type !== "tests.executed") throw new Error("Missing suite");
    payload.suite = {
      ...template.payload.suite,
      duration_ms: choose([-1, 0, 1, 30, 10000], draw()),
    };
    payload.phase = choose(["agent", "proposal", "combined", "base_probe", "head_probe"], draw());
  } else if (type === "change.resolved") {
    payload.decided_by = choose(["person", "rules", "cross_review", "lead_agent", null], draw());
    payload.decision = choose(["approved", "rejected", "changes_requested"], draw());
  }
  return payload;
}

function prologue(run: string): ServerEvent[] {
  const events: ServerEvent[] = [];
  const add = (type: ServerEvent["type"], payload: Record<string, unknown> = {}) => {
    events.push(envelope(type, events.length + 1, payload));
  };
  add("run.started", { run_id: run });
  for (const [index, change_id] of ids.entries()) {
    add(index === 3 ? "change.updated" : "agent.status", {
      change_id,
      agent_id: `agent-${String(index)}`,
      state: "working",
    });
  }
  // Every stream includes repeated statuses, interleaving, replacement and resolution.
  add("agent.status", { change_id: ids[0], state: "working" });
  add("change.proposed", { change_id: ids[0], revision: 1 });
  add("change.facts_recorded", { change_id: ids[0], revision: 1 });
  add("change.proposed", { change_id: ids[0], revision: 2 });
  add("change.resolved", { change_id: ids[0], revision: 2 });
  add("agent.status", { change_id: ids[1], state: "paused" });
  return events;
}

/** xorshift32: seeds and draw order are fixed; no dependency or clock randomness. */
function stream(seed: number): ServerEvent[] {
  let word = seed;
  const draw = () => {
    word ^= word << 13;
    word ^= word >>> 17;
    word ^= word << 5;
    return word >>> 0;
  };
  let run = `run-${String(seed)}`;
  const events = prologue(run);
  let seq = events.length;
  const add = (type: ServerEvent["type"], payload: Record<string, unknown> = {}) => {
    events.push(envelope(type, ++seq, payload));
  };
  const kinds = [
    "agent.status",
    "agent.status",
    "change.proposed",
    "change.proposed",
    "change.resolved",
    "change.facts_recorded",
    "change.reviewed",
    "change.assessed",
    "tests.executed",
    "usage.tick",
    "change.updated",
  ] as const;
  for (let index = 0; index < 64; index++) {
    const type = choose(kinds, draw());
    const change_id = choose(ids, draw());
    const revision = 1 + (draw() % 3);
    const payload = randomPayload(type, change_id, revision, draw);
    const ts = choose(
      [
        new Date(epoch + index * 10).toISOString(),
        "invalid",
        "2026-02-30T00:00:00.000Z",
        "0000-01-01T00:00:00.000Z",
        "2026-11-04T00:00:00.000999Z",
        "2026-11-04T00:00:00Z",
        "2026-11-03T00:00:00.000Z",
      ],
      draw(),
    );
    const event = envelope(type, ++seq, payload, ts);
    // Rejected frames are followed by the missing valid frame, as on reconnect.
    if (index % 17 === 0) events.push({ ...event, seq: seq + 2 });
    events.push(event);
    if (index === 23 || index === 47) {
      // Exercise both a new run at seq 1 and the accepted same-run reset above seq 1.
      if ((seed + index) % 2 === 0) {
        run += "-next";
        seq = 0;
      }
      add("run.started", { run_id: run });
    }
  }
  return events;
}

describe("incremental stage parity (500 seeds, 0x51a9e000..0x51a9e1f3)", () => {
  it.each(seeds)("matches the frozen full fold at every accepted prefix: seed %i", (seed) => {
    const events = stream(seed);
    let state = createInitialState();
    let accepted: ServerEvent[] = [];
    for (const event of events) {
      const before = state;
      const saved = JSON.stringify(before.stageAcc);
      state = applyEvent(state, event);
      expect(JSON.stringify(before.stageAcc)).toBe(saved);
      if (state.gap) {
        // The existing reducer changes only gap; rejected frames are not in the oracle inventory.
        expect(state).toEqual({ ...before, gap: true });
        expect(oracle([...accepted, event], ids[0] ?? "")).toBeNull();
        continue;
      }
      accepted = event.type === "run.started" ? [event] : [...accepted, event];
      for (const id of ids) {
        const expected = oracle(accepted, id);
        expect(foldStages(accepted, id)).toEqual(expected);
        if (id in state.changes) {
          expect(state.changeStages[id]).toEqual(expected);
          if (
            event.type !== "run.started" &&
            JSON.stringify(before.changeStages[id]) === JSON.stringify(expected)
          ) {
            expect(state.changeStages[id]).toBe(before.changeStages[id]);
          }
        } else expect(Object.hasOwn(state.changeStages, id)).toBe(false);
      }
      for (const [id, acc] of Object.entries(state.stageAcc)) {
        expect(acc.problems.length).toBeLessThanOrEqual(20);
        if (acc.active !== null || acc.window !== null) continue;
        // Closed changes are horizon-independent, including invalid/backward/future horizons.
        const closed = finishStages(acc, { seq: 0, ms: null });
        expect(finishStages(acc, { seq: 999999, ms: epoch + 999999 })).toEqual(closed);
        expect(finishStages(acc, { seq: -1, ms: -1 })).toEqual(closed);
        if (
          before.stageAcc[id] === acc &&
          Object.hasOwn(before.changeStages, id) &&
          event.type !== "run.started"
        ) {
          expect(state.changeStages[id]).toBe(before.changeStages[id]);
        }
      }
    }
    // Replay's batch entry and live-style one-frame calls use the same reducer.
    const replay = createStateStore();
    replay.getState().applyEvents(events);
    expect(replay.getState().state).toEqual(state);
    const restored = JSON.parse(JSON.stringify(state)) as typeof state;
    expect(restored).toEqual(state);
    const tail = envelope("usage.tick", state.lastSeq + 1);
    expect(applyEvent(restored, tail)).toEqual(applyEvent(state, tail));
  });
});

it("keeps the null versus empty reading for a change with no consumed events", () => {
  const initial = createInitialState();
  const events = [
    envelope("run.started", 1),
    envelope("change.updated", 2, { change_id: "absent" }),
  ];
  const state = events.reduce(applyEvent, initial);
  const last = events.at(-1);
  if (!last) throw new Error("Missing envelope");
  expect(finishStages(undefined, stagePoint(last))).toEqual(oracle(events, "absent"));
  expect(state.changeStages.absent).toEqual(oracle(events, "absent"));
  expect(state.stageAcc.absent).toBeUndefined();
  expect(initial.changeStages.absent).toBeUndefined();
  expect(oracle([], "absent")).toBeNull();
});

it("caps retained diagnostics with stable ties, including late problems at old start seqs", () => {
  const events = [envelope("agent.status", 1, { state: "working", change_id: "c" }, "invalid")];
  events.push(envelope("change.proposed", 2, { change_id: "c", revision: 1 }, "invalid"));
  for (let n = 0; n < 40; n++) {
    const event = envelope("tests.executed", n + 3, { change_id: "c" });
    if (event.type !== "tests.executed") throw new Error("Missing suite");
    event.payload.suite.duration_ms = -1;
    events.push(event);
  }
  events.push(envelope("agent.status", 43, { state: "done", change_id: "c" }));
  events.push(envelope("change.facts_recorded", 44, { change_id: "c", revision: 1 }, "invalid"));
  events.push(
    envelope("change.resolved", 45, { change_id: "c", revision: 1, decided_by: "person" }),
  );
  let acc;
  for (const [index, event] of events.entries()) {
    acc = consumeStage(acc, event, stagePoint(event));
    expect(acc?.problems.length ?? 0).toBeLessThanOrEqual(20);
    expect(finishStages(acc, stagePoint(event))).toEqual(oracle(events.slice(0, index + 1), "c"));
  }
  expect(acc?.problems[0]?.seq).toBe(1);
  expect(acc?.problems[1]?.seq).toBe(2);
  expect(acc?.problems[2]?.seq).toBe(3);
});

it("replays a whole generated wire stream identically to individual live frames", async () => {
  // The transport rejects nonparseable timestamps and gaps; the reducer property above covers both.
  const events = stream(seeds[0] ?? 0);
  const wire: ServerEvent[] = [];
  let state = createInitialState();
  for (const event of events) {
    const frame = { ...event, ts: new Date(epoch + wire.length).toISOString() };
    const next = applyEvent(state, frame);
    if (next.gap) continue;
    state = next;
    wire.push(frame);
  }
  const store = createStateStore();
  const replay = startReplay({
    store,
    source: { text: wire.map((event) => JSON.stringify(event)).join("\n") },
    speed: 0,
  });
  await replay.ready;
  expect(store.getState().state).toEqual(state);
  replay.stop();
});
