# Graph invalidation evidence

Base checked at dispatch: `c55fac027dd9394c02703bb2642d7e61ae65e68d`, on
`frontend/graph-invalidation`, with a clean worktree. Contracts, events, reducer, layout solver,
styles and tokens are unchanged. Frame passes one retained-stage flag through its existing container.

Run separately from `make check`:

```sh
pnpm -C frontend exec node src/graph/invalidation.bench.ts
```

The runner uses the existing Vite/Playwright browser setup and writes
`invalidation.bench.results.json`. It asserts application counts and finite measurements for all
24 size/scenario/path combinations. The baseline uses the frozen c55fac02 full updater; the new
path uses the production snapshot, signature diff, visibility and publication scheduler.
Initialization is excluded. This measures the expanded Cytoscape graph, not the entire application,
Map layer, fold projection or WebGL field. All graph nodes have preset positions; fcose is unchanged.

There are 100, 1,000 and 10,000 nodes, one module per 20 nodes, and up to eight exact call edges.
The viewport is 1280 × 800, with existing graph styles. Each case has seven samples:

- Class: change only the first module's dimming class, alternating the scope on each sample.
- Unrelated: publish 30 alternating chat and tool-output events through the real reducer per sample.
- Hidden: change that class scope while the retained stage is hidden; measure showing it separately.
- Pan/zoom: the unrelated-event burst together with a real Cytoscape viewport change.

`performance.mark`/`measure` bracket publication and two requestAnimationFrames. The table reports
median event-to-two-frame time and mean projection/application work per sample, in milliseconds.
For hidden samples the two-frame boundary is a scheduling measure: no graph pixel is visible;
`resumeMs` reports show-to-two-frame time. A PerformanceObserver counts Chromium long tasks during
the seven samples, excluding initialization by entry start time. Separate marks time the unchanged
`applyFrames` and `applyRoutes` phases after each case. Raw values, browser version and UTC recording
time are in the JSON artifact. Measurements are synthetic observations, not Windows acceptance.

Recorded 2026-11-05T22:49:14.261Z; Chromium 156.0.8078.4. The benchmark ran after the targeted checks finished.

|  Nodes | Scenario  | Pixel/tick ms before → after | Work ms before → after | Long tasks before → after |
| -----: | --------- | ---------------------------: | ---------------------: | ------------------------: |
|    100 | class     |                  33.5 → 31.9 |              4.5 → 0.6 |                     0 → 0 |
|    100 | unrelated |                  40.3 → 33.3 |             30.9 → 0.0 |                     0 → 0 |
|    100 | hidden    |                  33.1 → 33.2 |              3.6 → 0.0 |                     0 → 0 |
|    100 | pan/zoom  |                  56.2 → 33.4 |             36.2 → 0.0 |                     1 → 0 |
|  1,000 | class     |                  33.3 → 39.3 |             14.3 → 2.2 |                     0 → 0 |
|  1,000 | unrelated |                 300.3 → 33.0 |            283.0 → 0.0 |                     6 → 0 |
|  1,000 | hidden    |                  33.0 → 33.2 |             11.0 → 0.0 |                     0 → 0 |
|  1,000 | pan/zoom  |                 404.3 → 33.3 |            390.9 → 0.0 |                     6 → 0 |
| 10,000 | class     |                318.1 → 166.5 |           163.9 → 31.5 |                    13 → 8 |
| 10,000 | unrelated |                3447.6 → 33.3 |           3710.9 → 0.0 |                     7 → 1 |
| 10,000 | hidden    |                 218.3 → 33.3 |            131.3 → 0.0 |                    13 → 1 |
| 10,000 | pan/zoom  |                5907.3 → 34.6 |           5645.8 → 0.0 |                     7 → 1 |

Hidden graph applications during measurement were 7 → 0 at each size. Showing the new path applied exactly one final paint projection; show-to-two-frame times were 100: 33.4 ms, 1,000: 42.0 ms, 10,000: 126.1 ms. Unrelated and pan/zoom graph applications were 210 → 0; visible class applications were 7 → 7.

At 10,000 nodes, the separate settle phase measurements after the class case were 55.9 ms for frames and 29.9 ms for routes (85.8 ms total). Those passes remain global and unchanged. Class-only application avoids them; projection/application still took 31.5 ms on average, while event-to-two-frame latency was 166.5 ms. The remaining end-to-end cost includes scheduling and rendering. Incremental settle and WebGL rendering remain outside this front.

For 1,000 nodes the class median regressed from 33.3 to 39.3 ms despite lower projection/application work (14.3 → 2.2 ms). Frame scheduling can dominate small updates; this seven-sample run is not a statistical latency guarantee. Some optimized 10,000-node cases still recorded one browser long task with zero graph applications.

The parity suite keeps the old full updater and fold controller as independent test oracles.
It compares exact data (including routing fields and frame minima), class sets, positions and
bounds after every step of 24 seeded sequences of 48 steps (1,152 steps), including hidden catch-up,
fold choices, focus, agent status, pending updates, resolution, snapshot replacements, renames,
additions/removals and edge endpoint/confidence changes. Two further cases compare one resumed
paint application against 100 full applications, with and without pending changes. Those cases
use a complete deterministic initial preset so they compare updates rather than separate fcose
initializations. No numeric tolerance or rounded comparisons are used. Separate cases cover
simultaneous growth restoration/new arrivals and omitted versus explicitly undefined data.

Publications share one scheduled animation-frame flush. Unrelated slices enqueue nothing.
Pure dimming scopes collapse to their last value when reads, cones and other props are unchanged.
Other transitions retain their order: removing intermediate topology or fold observations can
change final positions. A resumed flush can therefore apply multiple historical projections.

The single-application-batch requirement has one explicit exception. When all growth-triggering
additions disappear while new nodes arrive, the old algorithm removes/restores first, measures
restored compound bounds, then places arrivals. Cytoscape's bounds are stale inside a batch.
The implementation preserves that pre-placement batch plus the application batch to retain exact
parity. Restoration without new arrivals uses only the application batch. This exception needs
the maintainer's decision if a single batch is absolute; changing placement is outside this front.

The component remains over 500 lines and its existing GraphView/effect/create callbacks exceed
80 lines: the camera, pointer, fold, map and disposal lifecycle remains together while this front
extracts invalidation. The frozen fold oracle exceeds 80 lines to preserve the original control
flow. The benchmark's run function exceeds 80 lines to keep setup, performance observation, marks
and cleanup within one auditable experiment. The reviewer decides these size exceptions.

Validation (all commands unpiped, each exited 0):

- `pnpm -C frontend exec tsc --noEmit`: 0 errors.
- `pnpm -C frontend exec vitest run src/graph`: 92 files passed; 729 tests passed, 7 existing skips.
- `pnpm -C frontend exec vitest related --run --maxWorkers 2` with the 22 changed TS/TSX files: 54 files passed, 1 existing skipped file; 525 tests passed, 20 existing skips.
- `pnpm -C frontend exec eslint src/graph src/app/Frame.tsx`: 0 errors/warnings.
- `pnpm -C frontend exec eslint --max-warnings 0` with the same changed TS/TSX files: 0 errors/warnings.
- `pnpm -C frontend exec node src/graph/invalidation.bench.ts`: 24 browser measurement cases passed their count/finite-value assertions.

No Python files changed. Full gates, application browser acceptance and screenshot comparison remain with the coordinating loop as requested; this hand-back does not claim new screenshot evidence.
