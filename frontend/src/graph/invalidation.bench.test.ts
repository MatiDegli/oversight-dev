import { readFileSync } from "node:fs";
import { expect, it } from "vitest";
import type { runInvalidationBench } from "./invalidation.bench.fixture";

const evidence = JSON.parse(
  readFileSync(new URL("./invalidation.bench.results.json", import.meta.url), "utf8"),
) as {
  recordedAt: string;
  browser: string;
  results: Awaited<ReturnType<typeof runInvalidationBench>>[];
};
const document = readFileSync(new URL("./invalidation.bench.md", import.meta.url), "utf8");
const sizes = [100, 1000, 10000];
const scenarios = ["class", "unrelated", "hidden", "hidden-events", "pan/zoom"];

it("retains both paths for every benchmark size and scenario", () => {
  const expected = sizes.flatMap((size) =>
    scenarios.flatMap((scenario) =>
      ["before", "after"].map((path) => `${String(size)}:${scenario}:${path}`),
    ),
  );
  expect(
    evidence.results.map(({ size, scenario, path }) => `${String(size)}:${scenario}:${path}`),
  ).toEqual(expected);
  for (const result of evidence.results.filter((row) => row.scenario === "hidden-events")) {
    expect(result.applications).toBe(result.path === "before" ? 210 : 0);
    expect(result.resumeApplications).toBe(result.path === "before" ? 0 : 1);
  }
});

it("publishes every before/after measurement from the recorded artifact", () => {
  const rows = document
    .split("\n")
    .filter((line) => /^\|\s*[\d,]+\s*\|/.test(line))
    .map((line) =>
      line
        .split("|")
        .slice(1, -1)
        .map((cell) => cell.trim()),
    );
  const expected = sizes.flatMap((size) =>
    scenarios.map((scenario) => {
      const before = evidence.results.find(
        (row) => row.size === size && row.scenario === scenario && row.path === "before",
      );
      const after = evidence.results.find(
        (row) => row.size === size && row.scenario === scenario && row.path === "after",
      );
      if (!before || !after) throw new Error(`Missing benchmark pair: ${String(size)} ${scenario}`);
      return [
        size.toLocaleString("en-US"),
        scenario,
        `${before.pixelMs.toFixed(1)} → ${after.pixelMs.toFixed(1)}`,
        `${before.workMs.toFixed(1)} → ${after.workMs.toFixed(1)}`,
        `${String(before.longTasks)} → ${String(after.longTasks)}`,
      ];
    }),
  );
  expect(rows).toEqual(expected);
  expect(document).toContain(`Recorded ${evidence.recordedAt}; Chromium ${evidence.browser}.`);
  expect(document).toContain(`${String(evidence.results.length)} size/scenario/path combinations`);
  expect(document).toContain(`${String(evidence.results.length)} browser measurement cases passed`);
});
