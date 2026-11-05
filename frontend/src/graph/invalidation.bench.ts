/** Opt in: pnpm -C frontend exec node src/graph/invalidation.bench.ts (outside make check). */
import { writeFile } from "node:fs/promises";
import { strict as assert } from "node:assert";
import { fileURLToPath } from "node:url";
import { createServer } from "vite";
import { launchBrowser } from "../browserLaunch.support.ts";
import type { runInvalidationBench, Scenario } from "./invalidation.bench.fixture.ts";

declare global {
  interface Window {
    runInvalidationBench: typeof runInvalidationBench;
  }
}
const server = await createServer({
  root: fileURLToPath(new URL("../../", import.meta.url)),
  cacheDir: fileURLToPath(new URL("../../../.shots/invalidation-bench-cache", import.meta.url)),
  server: { host: "127.0.0.1", port: 0, strictPort: false },
});
const browser = await launchBrowser();
try {
  const results: Awaited<ReturnType<typeof runInvalidationBench>>[] = [];
  const html = await server.transformIndexHtml(
    "/",
    '<!doctype html><html data-theme="dark"><body><script type="module">import "/src/theme/index.css"; import { runInvalidationBench } from "/src/graph/invalidation.bench.fixture.ts"; window.runInvalidationBench = runInvalidationBench;</script></body></html>',
  );
  await server.listen();
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  page.on("pageerror", (error) => {
    throw error;
  });
  await page.route("**/", (route) => route.fulfill({ contentType: "text/html", body: html }));
  await page.goto(server.resolvedUrls?.local[0] ?? "");
  await page.waitForFunction(() => typeof window.runInvalidationBench === "function");
  console.log(
    "nodes | scenario | path | event→2rAF median ms | work ms/burst | long tasks | applications | frames ms | routes ms",
  );
  for (const size of [100, 1000, 10000])
    for (const scenario of ["class", "unrelated", "hidden", "pan/zoom"] satisfies Scenario[]) {
      for (const path of ["before", "after"] as const) {
        const result = await page.evaluate(
          ({ size, scenario, path }) => window.runInvalidationBench(size, scenario, path),
          { size, scenario, path },
        );
        assert.equal(
          result.applications,
          path === "after"
            ? scenario === "class"
              ? 7
              : 0
            : scenario === "class" || scenario === "hidden"
              ? 7
              : 210,
        );
        assert.equal(result.resumeApplications, path === "after" && scenario === "hidden" ? 1 : 0);
        assert.ok(
          [result.pixelMs, result.workMs, result.framesMs, result.routesMs, result.resumeMs].every(
            Number.isFinite,
          ),
        );
        results.push(result);
        console.log(JSON.stringify(result));
      }
    }
  await writeFile(
    new URL("./invalidation.bench.results.json", import.meta.url),
    JSON.stringify(
      {
        baseline: "c55fac02",
        recordedAt: new Date().toISOString(),
        browser: browser.version(),
        viewport: { width: 1280, height: 800 },
        samples: 7,
        results,
      },
      null,
      2,
    ) + "\n",
  );
} finally {
  await browser.close();
  await server.close();
}
