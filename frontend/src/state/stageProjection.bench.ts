/** Run explicitly (excluded from make check):
 * pnpm -C frontend exec vitest bench --run --project "unit (bench)" --maxWorkers 1 --reporter verbose src/state/stageProjection.bench.ts
 *
 * Each sample measures one event arriving at a 1k/10k/100k committed prefix. Both paths
 * start from the same prepared prefix. Old includes history copying, full folding of
 * every change and JSON comparison; new calls the actual incremental projection.
 * Preparation and unrelated reducer inventories (eventFacts, decisions, etc.) are excluded.
 * Totals are measured totals for 21 arrivals, not extrapolated quadratic replay totals.
 * All changes retain active work/windows to exercise the worst case for horizon refreshes.
 */
import { deepStrictEqual } from "node:assert";
import { readFileSync } from "node:fs";
import type { ChangeStages, ServerEvent } from "@contracts";
import { test } from "vitest";
import { projectStages } from "./applyEvent";
import { foldStages } from "./stageFold.oracle";
import { createInitialState } from "./types";

const fixture = readFileSync(
  new URL("../../../fixtures/events/stage-clocks.jsonl", import.meta.url),
  "utf8",
)
  .trim()
  .split("\n")
  .map((line) => JSON.parse(line) as ServerEvent);
const cases = [1000, 10000, 100000].flatMap((events) =>
  [1, 10, 100].map((changes) => ({ events, changes })),
);
const samples = 21;
const kinds = [
  "agent.status",
  "agent.status",
  "change.proposed",
  "change.facts_recorded",
  "tests.executed",
] as const;

function synthetic(length: number, changeCount: number): ServerEvent[] {
  const start = fixture[0];
  if (start?.type !== "run.started") throw new Error("Missing run");
  return Array.from({ length }, (_, index) => {
    if (index === 0) return start;
    const change = (index - 1) % changeCount;
    const lap = Math.floor((index - 1) / changeCount);
    const candidate = kinds[lap % kinds.length];
    const kind =
      candidate === "change.proposed" && lap >= kinds.length ? "change.facts_recorded" : candidate;
    const template = fixture.find((event) => event.type === kind);
    if (!template) throw new Error("Missing template");
    return {
      ...template,
      seq: index + 1,
      ts: new Date(Date.UTC(2026, 10, 4) + index).toISOString(),
      payload: {
        ...template.payload,
        change_id: `change-${String(change)}`,
        revision: 1,
        ...(kind === "agent.status" ? { state: "working" } : {}),
      },
    } as ServerEvent;
  });
}

for (const { events, changes } of cases) {
  test(`${String(events)} events / ${String(changes)} changes`, async ({ bench }) => {
    const stream = synthetic(events, changes);
    const incoming = stream.at(-1);
    if (!incoming) throw new Error("Empty stream");
    const prefix = stream.slice(0, -1);
    const ids = Array.from({ length: changes }, (_, index) => `change-${String(index)}`);
    let prepared = projectStages(createInitialState(), stream[0] ?? incoming, []);
    for (const event of prefix.slice(1)) prepared = projectStages(prepared, event, ids);
    const before = Object.fromEntries(ids.map((id) => [id, foldStages(prefix, id)]));
    deepStrictEqual(prepared.changeStages, before);
    let oldResult: Record<string, ChangeStages | null> = before;
    let newResult = prepared;
    const old = bench("old full fold", () => {
      const inventory = [...prefix, incoming];
      let stages = before;
      for (const id of ids) {
        const next = foldStages(inventory, id);
        if (JSON.stringify(next) !== JSON.stringify(stages[id])) {
          if (stages === before) stages = { ...stages };
          stages[id] = next;
        }
      }
      oldResult = stages;
    });
    const incremental = bench("incremental", () => {
      newResult = projectStages(prepared, incoming, ids);
    });
    const results = await bench.compare(old, incremental, {
      iterations: samples,
      retainSamples: true,
      time: 0,
      warmupIterations: 2,
      warmupTime: 0,
    });
    deepStrictEqual(newResult.changeStages, oldResult);
    const format = (name: "old full fold" | "incremental") => {
      const result = results.get(name);
      const sorted = result.latency.samples;
      const p95 = sorted?.[Math.ceil(result.latency.samplesCount * 0.95) - 1];
      if (p95 === undefined || result.latency.samplesCount !== samples)
        throw new Error("Incomplete samples");
      return `${(result.latency.p50 * 1000).toFixed(2)}/${(p95 * 1000).toFixed(2)}/${result.totalTime.toFixed(2)}`;
    };
    console.log(
      `STAGES events=${String(events)} changes=${String(changes)} old=${format("old full fold")} new=${format("incremental")} (median_us/p95_us/total_ms; ${String(samples)} arrivals)`,
    );
  }, 300000);
}
