import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import log from "../../../fixtures/events/recorded-demo.jsonl?raw";
import { applyEvent, createStateStore } from "../state";
import { createReplayPlayer, type ReplaySnapshot } from "./replayPlayer";
import { replayPrefix } from "./replayTimeline";

vi.mock("../state", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../state")>();
  return { ...actual, applyEvent: vi.fn(actual.applyEvent) };
});

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());
function player() {
  const store = createStateStore();
  const control = createReplayPlayer({ store, source: { text: log } });
  return { store, control };
}
describe("controlled replay", () => {
  it("seeks while playing, replaces the timer and advances the new prefix at the selected rate", async () => {
    const { store, control } = player();
    await control.ready;
    control.setSpeed(4);
    await vi.advanceTimersByTimeAsync(17);
    expect(vi.getTimerCount()).toBe(1);
    control.seek(8000);
    expect(control.getSnapshot()).toMatchObject({ position: 8000, speed: 4, status: "playing" });
    expect(vi.getTimerCount()).toBe(1);
    const prefix = store.getState().state;
    await vi.advanceTimersByTimeAsync(39);
    expect(control.getSnapshot().position).toBe(8000);
    await vi.advanceTimersByTimeAsync(1);
    expect(control.getSnapshot()).toMatchObject({ position: 8160, status: "playing" });
    await vi.advanceTimersByTimeAsync(500);
    control.pause();
    expect(control.getSnapshot().position).toBe(10160);
    expect(store.getState().state.lastSeq).toBeGreaterThan(prefix.lastSeq);
    control.dispose();
  });
  it("gives a fresh controller a new identity even when its revision matches", async () => {
    const first = player().control;
    await first.ready;
    first.dispose();
    const fresh = player().control;
    await fresh.ready;
    expect(fresh.getSnapshot().revision).toBe(first.getSnapshot().revision);
    expect(fresh.id).not.toBe(first.id);
    fresh.dispose();
  });
  it("preserves partial gaps across pause/resume and rate changes", async () => {
    const { control } = player();
    await control.ready;
    await vi.advanceTimersByTimeAsync(713);
    control.pause();
    expect(control.getSnapshot().position).toBe(713);
    await vi.advanceTimersByTimeAsync(2000);
    expect(control.getSnapshot().position).toBe(713);
    control.setSpeed(2);
    control.play();
    await vi.advanceTimersByTimeAsync(237);
    control.setSpeed(4);
    expect(control.getSnapshot().position).toBe(1187);
    await vi.advanceTimersByTimeAsync(103);
    control.pause();
    expect(control.getSnapshot().position).toBe(1599);
    control.dispose();
  });
  it("clamps, atomically rebuilds, preserves state, ends and restarts at the selected rate", async () => {
    const { store, control } = player();
    await control.ready;
    control.pause();
    const updates = vi.fn();
    store.subscribe(updates);
    control.seek(15000);
    expect(updates).toHaveBeenCalledTimes(1);
    expect(control.getSnapshot().status).toBe("paused");
    const prefix = store.getState().state;
    control.seek(-10);
    control.seek(15000);
    expect(store.getState().state).toEqual(prefix);
    control.seek(99999);
    expect(control.getSnapshot().status).toBe("ended");
    control.seek(8000);
    expect(control.getSnapshot().status).toBe("paused");
    control.setSpeed(4);
    control.restart();
    expect(control.getSnapshot()).toMatchObject({ position: 0, speed: 4, status: "playing" });
    await vi.advanceTimersByTimeAsync(6000);
    expect(control.getSnapshot()).toMatchObject({ position: 20178, status: "ended" });
    control.play();
    expect(control.getSnapshot().position).toBe(0);
    control.dispose();
  });
  it("rejects bad logs without publishing and ignores loading completed after disposal", async () => {
    const store = createStateStore();
    const broken = createReplayPlayer({
      store,
      source: { text: log.replace('"seq":2,', '"seq":99,') },
    });
    await expect(broken.ready).rejects.toThrow(/mismatch/);
    expect(store.getState().state.lastSeq).toBe(0);
    broken.dispose();
    let resolve!: (response: Response) => void;
    const pending = createReplayPlayer({
      store,
      source: { url: "/recording" },
      request: vi.fn(
        () =>
          new Promise<Response>((done) => {
            resolve = done;
          }),
      ),
    });
    pending.dispose();
    resolve(new Response(log));
    await pending.ready;
    expect(store.getState().state.lastSeq).toBe(0);
  });
  it("cancels obsolete timers and operations after disposal", async () => {
    const { control, store } = player();
    await control.ready;
    control.seek(10000);
    control.restart();
    control.dispose();
    const state = store.getState().state;
    const snapshot = control.getSnapshot();
    await vi.advanceTimersByTimeAsync(30000);
    control.seek(10000);
    control.play();
    control.restart();
    control.setSpeed(4);
    expect(store.getState().state).toBe(state);
    expect(control.getSnapshot()).toBe(snapshot);
  });
  it("ignores callbacks captured before a seek or disposal", async () => {
    const timers = vi.spyOn(globalThis, "setTimeout");
    const { control, store } = player();
    await control.ready;
    const obsolete = timers.mock.calls.at(-1)?.[0];
    control.seek(15000);
    const state = store.getState().state;
    if (typeof obsolete !== "function") throw new Error("No scheduled callback");
    obsolete();
    expect(store.getState().state).toBe(state);
    const late = timers.mock.calls.at(-1)?.[0];
    control.dispose();
    if (typeof late !== "function") throw new Error("No late callback");
    late();
    expect(store.getState().state).toBe(state);
    timers.mockRestore();
  });
  it.each(["", "{broken", "{}"])("rejects malformed recording %s", async (text) => {
    const store = createStateStore();
    const control = createReplayPlayer({ store, source: { text } });
    await expect(control.ready).rejects.toThrow();
    expect(store.getState().state.lastSeq).toBe(0);
    control.dispose();
  });
  it("rejects load errors and stops before a deferred transport import can publish", async () => {
    const store = createStateStore();
    const failed = createReplayPlayer({
      store,
      source: { url: "/recording" },
      request: vi.fn().mockResolvedValue(new Response(null, { status: 500 })),
    });
    await expect(failed.ready).rejects.toThrow("Replay log request failed: 500");
    failed.dispose();
    vi.stubEnv("MODE", "replay");
    vi.resetModules();
    try {
      const { startAppTransport } = await import("./index");
      const onReplay = vi.fn();
      const transport = startAppTransport(store, undefined, undefined, onReplay);
      transport.stop();
      await transport.ready;
      expect(onReplay).not.toHaveBeenCalled();
      expect(store.getState().state.lastSeq).toBe(0);
    } finally {
      vi.unstubAllEnvs();
      vi.resetModules();
    }
  });
});

it("seeks an exact sequence at an equal timestamp and cancels captured playback", async () => {
  const store = createStateStore();
  const rows = log
    .trim()
    .split("\n")
    .map((line) => ({ ...(JSON.parse(line) as { seq: number }), ts: "2026-11-03T00:00:00Z" }));
  const control = createReplayPlayer({
    store,
    source: { text: rows.map((row) => JSON.stringify(row)).join("\n") },
  });
  await control.ready;
  control.seekSeq(3);
  expect(store.getState().state.lastSeq).toBe(3);
  expect(control.getSnapshot().status).toBe("paused");
  control.setSpeed(2);
  expect(store.getState().state.lastSeq).toBe(3);
  control.seekSeq(5, 0);
  expect(store.getState().state.lastSeq).toBe(5);
  const snapshot = control.getSnapshot();
  control.seekSeq(99999);
  expect(control.getSnapshot()).toBe(snapshot);
  control.dispose();
  control.seekSeq(2);
  expect(store.getState().state.lastSeq).toBe(5);
});

/** Full refolds use the unchanged timeline oracle, independently of the player's cursor. */
function traceOracle({ store, control }: ReturnType<typeof player>) {
  const { events, offsets } = control.getSnapshot();
  let snapshot = control.getSnapshot();
  let state = store.getState().state;
  let anchor = performance.now();
  let disposed = false;
  type Entry = { listener: string; state: typeof state; snapshot: ReplaySnapshot };
  const observed: Entry[] = [];
  let expected: Entry[] = [];
  const capture = (listener: string) => () => {
    observed.push({ listener, state: store.getState().state, snapshot: control.getSnapshot() });
  };
  const unsubscribe = [
    store.subscribe(capture("store 1")),
    store.subscribe(capture("store 2")),
    control.subscribe(capture("player 1")),
    control.subscribe(capture("player 2")),
  ];
  const emit = (kind: "store" | "player") => {
    for (const n of [1, 2]) expected.push({ listener: `${kind} ${String(n)}`, state, snapshot });
  };
  const publish = (next: Partial<ReplaySnapshot>) => {
    snapshot = { ...snapshot, ...next };
    emit("player");
  };
  const seek = (position: number, status = snapshot.status, seq = Infinity) => {
    if (disposed) return;
    position = Math.max(0, Math.min(snapshot.duration, Number.isNaN(position) ? 0 : position));
    state = replayPrefix(events, offsets, position, seq);
    emit("store");
    anchor = performance.now();
    publish({
      position,
      status: Number.isFinite(seq)
        ? "paused"
        : position >= snapshot.duration
          ? "ended"
          : status === "ended"
            ? "paused"
            : status,
      revision: snapshot.revision + 1,
    });
  };
  const advance = () => {
    const position = Math.min(
      snapshot.duration,
      snapshot.position + (performance.now() - anchor) * snapshot.speed,
    );
    const next = replayPrefix(events, offsets, position);
    if (next.lastSeq !== state.lastSeq) {
      state = next;
      emit("store");
    }
    anchor = performance.now();
    publish({ position, status: position >= snapshot.duration ? "ended" : snapshot.status });
  };
  return {
    seek,
    seekSeq: (seq: number, position?: number) => {
      const index = events.findIndex((event) => event.seq === seq);
      if (index >= 0) seek(position ?? offsets[index] ?? 0, "paused", seq);
    },
    tick: advance,
    pause: () => {
      if (disposed || snapshot.status !== "playing") return;
      advance();
      if (snapshot.position < snapshot.duration) publish({ status: "paused" });
    },
    play: () => {
      if (disposed || snapshot.status === "playing") return;
      if (snapshot.status === "ended") {
        seek(0, "playing");
        return;
      }
      anchor = performance.now();
      publish({ status: "playing" });
    },
    restart: () => {
      seek(0, "playing");
    },
    setSpeed: (speed: 1 | 2 | 4) => {
      if (disposed) return;
      if (snapshot.status === "playing") advance();
      publish({ speed });
    },
    dispose: () => {
      disposed = true;
    },
    check: async (action: () => unknown, reference: () => void) => {
      observed.length = 0;
      expected = [];
      await action();
      reference();
      expect(observed).toEqual(expected);
      expect(store.getState().state).toEqual(state);
      expect(control.getSnapshot()).toEqual(snapshot);
      expect(control.getSnapshot().events).toBe(events);
      expect(control.getSnapshot().offsets).toBe(offsets);
    },
    unsubscribe: () => {
      unsubscribe.forEach((stop) => {
        stop();
      });
    },
  };
}

it.each(["time", "sequence"])(
  "reduces only newly eligible events in a monotone %s sweep",
  async (mode) => {
    const spy = vi.mocked(applyEvent);
    spy.mockClear();
    const { store, control } = player();
    await control.ready;
    control.pause();
    control.seekSeq(1);
    const setup = spy.mock.calls.length;
    const { events, offsets, duration } = control.getSnapshot();
    const startSeq = store.getState().state.lastSeq;
    spy.mockClear();
    let steps = 0;
    let oracleSteps = 0;
    const bounds: { steps: number; newlyEligible: number }[] = [];
    for (const [index, event] of events.entries()) {
      const position = offsets[index] ?? duration;
      for (const repeat of [false, true]) {
        const before = store.getState().state.lastSeq;
        if (mode === "time") control.seek(position);
        else control.seekSeq(event.seq);
        const count = spy.mock.calls.length;
        steps += count;
        spy.mockClear();
        const expected = replayPrefix(
          events,
          offsets,
          position,
          mode === "time" ? Infinity : event.seq,
        );
        oracleSteps += spy.mock.calls.length;
        spy.mockClear();
        expect(store.getState().state).toEqual(expected);
        bounds.push({ steps: count, newlyEligible: repeat ? 0 : expected.lastSeq - before });
      }
    }
    console.info({ mode, setup, steps, oracleSteps, bound: events.length - startSeq });
    expect(steps).toBeLessThanOrEqual(events.length - startSeq);
    for (const bound of bounds) expect(bound.steps).toBeLessThanOrEqual(bound.newlyEligible);
    control.dispose();
  },
);

it.each([0x5eed, 0xc0ffee, 0xdecafbad])("matches full-refold traces for seed %i", async (seed) => {
  const session = player();
  const { control } = session;
  await control.ready;
  control.pause();
  const oracle = traceOracle(session);
  const { events, offsets, duration } = control.getSnapshot();
  let random = seed;
  const next = () => (random = (Math.imul(random, 1664525) + 1013904223) >>> 0);
  for (let i = 0; i < 100; i++) {
    const event = events[next() % events.length];
    if (!event) throw new Error("Missing random event");
    const position =
      i % 3 ? (offsets[next() % offsets.length] ?? 0) : (next() / 2 ** 32) * duration;
    if (i % 2)
      await oracle.check(
        () => {
          control.seek(position);
        },
        () => {
          oracle.seek(position);
        },
      );
    else
      await oracle.check(
        () => {
          control.seekSeq(event.seq, position);
        },
        () => {
          oracle.seekSeq(event.seq, position);
        },
      );
  }
  oracle.unsubscribe();
  control.dispose();
});

it("matches full-refold traces at boundaries, equal offsets and explicit sequence positions", async () => {
  const session = player();
  const { control } = session;
  await control.ready;
  control.pause();
  const oracle = traceOracle(session);
  const { events, offsets, duration } = control.getSnapshot();
  for (const position of [
    NaN,
    Infinity,
    -Infinity,
    -10,
    duration + 1,
    0,
    duration,
    duration,
    8.5,
    8.5,
  ]) {
    await oracle.check(
      () => {
        control.seek(position);
      },
      () => {
        oracle.seek(position);
      },
    );
  }
  for (let index = 0; index < events.length; index++) {
    const seq = events[index]?.seq ?? 0;
    const position = offsets[index] ?? 0;
    // The ceiling can move backward while the explicit position stays at the end.
    for (const target of [seq, seq - 1, seq, seq]) {
      await oracle.check(
        () => {
          control.seekSeq(target, duration);
        },
        () => {
          oracle.seekSeq(target, duration);
        },
      );
    }
    await oracle.check(
      () => {
        control.seekSeq(seq, position - 0.5);
      },
      () => {
        oracle.seekSeq(seq, position - 0.5);
      },
    );
    await oracle.check(
      () => {
        control.seek(position);
      },
      () => {
        oracle.seek(position);
      },
    );
  }
  for (const position of [NaN, -Infinity, Infinity, -1, duration + 1]) {
    await oracle.check(
      () => {
        control.seekSeq(13, position);
      },
      () => {
        oracle.seekSeq(13, position);
      },
    );
  }
  await oracle.check(
    () => {
      control.seekSeq(99999);
    },
    () => {
      oracle.seekSeq(99999);
    },
  );
  oracle.unsubscribe();
  control.dispose();
});

it("keeps full-refold publication traces across playback, partial ticks, restart and disposal", async () => {
  const session = player();
  const { control } = session;
  await control.ready;
  control.pause();
  const oracle = traceOracle(session);
  const timers = vi.spyOn(globalThis, "setTimeout");
  await oracle.check(control.play, oracle.play);
  await oracle.check(() => vi.advanceTimersByTimeAsync(40), oracle.tick);
  await vi.advanceTimersByTimeAsync(17);
  await oracle.check(
    () => {
      control.setSpeed(2);
    },
    () => {
      oracle.setSpeed(2);
    },
  );
  await oracle.check(() => vi.advanceTimersByTimeAsync(40), oracle.tick);
  await vi.advanceTimersByTimeAsync(13);
  await oracle.check(control.pause, oracle.pause);
  await oracle.check(control.pause, oracle.pause);
  await oracle.check(
    () => {
      control.seekSeq(12, 3970);
    },
    () => {
      oracle.seekSeq(12, 3970);
    },
  );
  await oracle.check(
    () => {
      control.setSpeed(4);
    },
    () => {
      oracle.setSpeed(4);
    },
  );
  await oracle.check(control.play, oracle.play);
  await oracle.check(() => vi.advanceTimersByTimeAsync(40), oracle.tick);
  const stale = timers.mock.calls.at(-1)?.[0];
  await oracle.check(
    () => {
      control.seek(8000);
    },
    () => {
      oracle.seek(8000);
    },
  );
  if (typeof stale !== "function") throw new Error("Missing stale callback");
  await oracle.check(
    () => {
      stale();
    },
    () => undefined,
  );
  await oracle.check(() => vi.advanceTimersByTimeAsync(40), oracle.tick);
  await oracle.check(control.pause, oracle.pause);
  await oracle.check(
    () => {
      control.seek(Infinity);
    },
    () => {
      oracle.seek(Infinity);
    },
  );
  await oracle.check(control.play, oracle.play);
  await oracle.check(() => vi.advanceTimersByTimeAsync(40), oracle.tick);
  const nearEnd = control.getSnapshot().duration - 20;
  await oracle.check(
    () => {
      control.seek(nearEnd);
    },
    () => {
      oracle.seek(nearEnd);
    },
  );
  await oracle.check(() => vi.advanceTimersByTimeAsync(5), oracle.tick);
  expect(vi.getTimerCount()).toBe(0);
  await oracle.check(control.restart, oracle.restart);
  await oracle.check(() => vi.advanceTimersByTimeAsync(40), oracle.tick);
  const late = timers.mock.calls.at(-1)?.[0];
  await oracle.check(control.dispose, oracle.dispose);
  if (typeof late !== "function") throw new Error("Missing disposed callback");
  await oracle.check(
    () => {
      late();
    },
    () => undefined,
  );
  await oracle.check(
    () => vi.advanceTimersByTimeAsync(30000),
    () => undefined,
  );
  for (const method of ["play", "pause", "restart"] as const)
    await oracle.check(control[method], oracle[method]);
  await oracle.check(
    () => {
      control.seek(0);
    },
    () => {
      oracle.seek(0);
    },
  );
  await oracle.check(
    () => {
      control.seekSeq(2);
    },
    () => {
      oracle.seekSeq(2);
    },
  );
  await oracle.check(
    () => {
      control.setSpeed(1);
    },
    () => {
      oracle.setSpeed(1);
    },
  );
  oracle.unsubscribe();
  timers.mockRestore();
});

it("initializes a fresh recording prefix over an already populated store before notifying the player", async () => {
  const previous = player();
  await previous.control.ready;
  previous.control.seek(Infinity);
  previous.control.dispose();
  const { store } = previous;
  const notifications: string[] = [];
  store.subscribe(() => notifications.push("store"));
  // Defer loading so observers can subscribe before initialization publishes.
  const control = createReplayPlayer({
    store,
    source: { url: "/recording" },
    request: vi.fn().mockResolvedValue(new Response(log)),
  });
  control.subscribe(() => notifications.push("player"));
  await control.ready;
  const { events, offsets } = control.getSnapshot();
  expect(store.getState().state).toEqual(replayPrefix(events, offsets, 0));
  expect(notifications).toEqual(["store", "player"]);
  control.dispose();
});
