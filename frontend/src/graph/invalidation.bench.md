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
30 size/scenario/path combinations. The baseline uses the frozen c55fac02 full updater; the new
path uses the production snapshot, signature diff, visibility and publication scheduler.
Initialization is excluded. This measures the expanded Cytoscape graph, not the entire application,
Map layer, fold projection or WebGL field. All graph nodes have preset positions; fcose is unchanged.

There are 100, 1,000 and 10,000 nodes, one module per 20 nodes, and up to eight exact call edges.
The viewport is 1280 × 800, with existing graph styles. Each case has seven samples:

- Class: change only the first module's dimming class, alternating the scope on each sample.
- Unrelated: publish 30 alternating chat and tool-output events through the real reducer per sample.
- Hidden: change that class scope while the retained stage is hidden; measure showing it separately.
- Hidden-events: publish 30 agent-status events per sample while hidden; measure showing it separately.
- Pan/zoom: the unrelated-event burst together with a real Cytoscape viewport change.

`performance.mark`/`measure` bracket publication and two requestAnimationFrames. The table reports
median event-to-two-frame time and mean projection/application work per sample, in milliseconds.
For hidden samples the two-frame boundary is a scheduling measure: no graph pixel is visible;
`resumeMs` reports show-to-two-frame time. A PerformanceObserver counts Chromium long tasks during
the seven samples, excluding initialization by entry start time. Separate marks time the unchanged
`applyFrames` and `applyRoutes` phases after each case. Raw values, browser version and UTC recording
time are in the JSON artifact. Measurements are synthetic observations, not Windows acceptance.

Recorded 2026-11-06T02:15:40.544Z; Chromium 156.0.8078.4. This run includes the hidden-layout
retry fix (`e56d1044`) and queued agent-presentation collapse (`0aa5a151`).

|  Nodes | Scenario      | Pixel/tick ms before → after | Work ms before → after | Long tasks before → after |
| -----: | ------------- | ---------------------------: | ---------------------: | ------------------------: |
|    100 | class         |                  33.2 → 33.4 |              4.8 → 0.9 |                     0 → 0 |
|    100 | unrelated     |                  50.3 → 32.5 |             44.8 → 0.0 |                     0 → 0 |
|    100 | hidden        |                  33.3 → 33.3 |              4.2 → 0.0 |                     0 → 0 |
|    100 | hidden-events |                  61.0 → 33.1 |             46.5 → 0.0 |                     2 → 0 |
|    100 | pan/zoom      |                  69.7 → 33.4 |             46.6 → 0.0 |                     3 → 0 |
|  1,000 | class         |                  47.7 → 42.6 |             19.8 → 3.8 |                     1 → 1 |
|  1,000 | unrelated     |                 451.2 → 31.3 |            446.0 → 0.0 |                     6 → 1 |
|  1,000 | hidden        |                  32.3 → 33.3 |             18.7 → 0.0 |                     1 → 0 |
|  1,000 | hidden-events |                 449.8 → 33.1 |            441.2 → 0.0 |                     6 → 0 |
|  1,000 | pan/zoom      |                 487.2 → 33.1 |            464.2 → 0.0 |                     6 → 0 |
| 10,000 | class         |                346.5 → 210.6 |           183.7 → 44.0 |                    13 → 9 |
| 10,000 | unrelated     |                6329.5 → 33.4 |           6339.3 → 0.0 |                     7 → 1 |
| 10,000 | hidden        |                 331.2 → 33.2 |            183.4 → 0.0 |                    13 → 1 |
| 10,000 | hidden-events |                5826.0 → 33.2 |           5869.4 → 0.0 |                     7 → 1 |
| 10,000 | pan/zoom      |                5248.5 → 38.0 |           5188.3 → 0.0 |                     7 → 1 |

Hidden class graph applications during measurement were 7 → 0 at each size. Showing the new path applied exactly one final paint projection; show-to-two-frame times were 100: 33.8 ms, 1,000: 61.3 ms, 10,000: 184.8 ms. Hidden-events applications were 210 → 0 at each size, with exactly one application on show; show-to-two-frame times were 100: 37.0 ms, 1,000: 34.7 ms, 10,000: 65.9 ms. Unrelated and pan/zoom graph applications were 210 → 0; visible class applications were 7 → 7.

At 10,000 nodes, the separate settle phase measurements after the class case were 80.3 ms for frames and 44.3 ms for routes (124.6 ms total). Those passes remain global and unchanged. Class-only application avoids them; projection/application still took 44.0 ms on average, while event-to-two-frame latency was 210.6 ms. The remaining end-to-end cost includes scheduling and rendering. Incremental settle and WebGL rendering remain outside this front.

Frame scheduling can dominate small updates: at 100 nodes the class median was 33.2 → 33.4 ms despite lower projection/application work (4.8 → 0.9 ms). This seven-sample run is not a statistical latency guarantee. Some optimized 10,000-node cases still recorded one browser long task with zero graph applications.

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
Agent presentation and decision-history updates, including focus mode/range changes, also collapse
when the revision, run identity/start time, graph, change records, focus node targets and projection
props remain unchanged. Field payloads compare only their projection-relevant mode. The retained
input recomputes the final presentation from the complete event lists. Other transitions retain
their order: removing intermediate topology, edits or fold observations can change final positions.
A resumed flush can therefore apply multiple historical projections for those transitions.

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

Validation for this evidence refresh (all commands unpiped, each exited 0):

- `pnpm -C frontend exec tsc --noEmit`: 0 errors.
- `pnpm -C frontend exec vitest related --run --maxWorkers 2 src/graph/invalidation.bench.test.ts`: 1 file passed, 2 tests passed. Both tests failed against the stale evidence before this refresh. They check the complete case matrix, hidden-event application counts, table values, recording metadata and documented case counts.
- `pnpm -C frontend exec eslint --max-warnings 0 src/graph/invalidation.bench.test.ts`: 0 errors/warnings.
- `pnpm -C frontend exec node src/graph/invalidation.bench.ts`: 30 browser measurement cases passed their count/finite-value assertions.

No Python files changed. Full gates, application browser acceptance and screenshot comparison remain with the coordinating loop as requested; this evidence refresh does not claim new screenshot evidence.
