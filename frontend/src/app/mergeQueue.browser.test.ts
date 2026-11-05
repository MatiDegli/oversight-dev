import { mkdir, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { expect as check } from "@playwright/test";
import { afterAll, beforeAll, expect, it } from "vitest";
import { canvasSteps, workflow, workflowBrowser } from "./workflowCanvas.browser.support";
let harness: Awaited<ReturnType<typeof workflowBrowser>>;
beforeAll(async () => {
  harness = await workflowBrowser();
}, 60_000);
afterAll(async () => {
  await harness.close();
});

it("shows multiple exact candidates and recorded gates, with honest scheduling unknowns", async () => {
  const page = await harness.open(1280, true);
  try {
    await workflow(page).getByRole("button", { name: "Merge queue", exact: true }).click();
    const queue = workflow(page).getByRole("region", { name: "Merge queue", exact: true });
    await check(queue.locator(".merge-candidates > li")).toHaveCount(2);
    await check(queue).toContainText("change-flow-2 · Proposal revision 1");
    await check(queue).toContainText("change-flow-3 · Proposal revision 1");
    await check(queue).toContainText("Display order is not scheduler order");
    await check(queue.locator(".workflow-facts")).toHaveText(
      "Scheduler positionNot knownMerge timingNot known",
    );
    await check(
      queue.getByText("No current-revision execution recorded", { exact: true }),
    ).toHaveCount(1);
    await check(queue.getByRole("button", { name: "Approve", exact: true })).toHaveCount(0);
    const first = queue.locator(".merge-candidates > li").first();
    await first.getByRole("button", { name: "Review change" }).focus();
    await page.evaluate(() => {
      window.canvasTest.settleReview();
    });
    await check(queue.locator(".merge-candidates > li")).toHaveCount(1);
    await check(workflow(page).getByRole("button", { name: "Close", exact: true })).toBeFocused();
    expect(await page.evaluate(() => window.canvasTest.navigation)).toEqual([]);
    await queue.getByRole("button", { name: "Review change" }).click();
    expect(await page.evaluate(() => window.canvasTest.navigation)).toEqual(["change-flow-3"]);
  } finally {
    await page.close();
  }
});
it("uses an observed-empty message at an earlier replay prefix", async () => {
  const page = await harness.open();
  try {
    await workflow(page).getByRole("button", { name: "Merge queue", exact: true }).click();
    await page.evaluate(() => window.canvasTest.seekBeforeReview());
    await check(
      workflow(page).getByText("No candidates observed at this point in the run."),
    ).toBeVisible();
    await check(
      workflow(page).getByRole("button", { name: "Merge queue", exact: true }),
    ).toBeFocused();
  } finally {
    await page.close();
  }
});
it.each([1920, 390])(
  "captures dark canvas, known/missing detail and multiple candidates at %i",
  async (width) => {
    const page = await harness.open(width, true);
    const directory = new URL("../../../.shots/workflow-canvas/", import.meta.url);
    await mkdir(directory, { recursive: true });
    const captures: object[] = [];
    try {
      await page.evaluate(() => document.fonts.ready);
      if (width === 1920)
        await check(page.getByLabel("Repository graph", { exact: true })).toBeVisible();
      else await check(page.getByRole("dialog", { name: "Workflow", exact: true })).toBeVisible();
      for (const scene of ["canvas", "known-detail", "missing-detail", "merge-queue"] as const) {
        if (scene.includes("detail")) {
          await canvasSteps(page)
            .nth(scene === "known-detail" ? 1 : 2)
            .click();
          const detail = workflow(page).getByRole("region", { name: "Step detail" });
          await detail.scrollIntoViewIfNeeded();
          await workflow(page)
            .locator(".workflow-body")
            .evaluate((node) => {
              const detail = document.querySelector<HTMLElement>(".workflow-detail");
              if (detail)
                node.scrollTop +=
                  detail.getBoundingClientRect().top - node.getBoundingClientRect().top;
            });
          await check(detail).toContainText("Team A");
          await check(detail).toContainText(
            scene === "known-detail" ? "Muse Spark" : "profile not recorded",
          );
        } else if (scene === "merge-queue") {
          await workflow(page).getByRole("button", { name: "Merge queue", exact: true }).click();
          await workflow(page)
            .locator(".workflow-body")
            .evaluate((node) => {
              node.scrollTop = 0;
            });
          await check(workflow(page).locator(".merge-candidates > li")).toHaveCount(2);
        }
        expect(await workflow(page).evaluate((node) => node.scrollWidth <= node.clientWidth)).toBe(
          true,
        );
        const filename = `${scene}-${String(width)}-dark.png`;
        await page.screenshot({ path: fileURLToPath(new URL(filename, directory)) });
        captures.push({
          filename,
          prefix: await page.evaluate(() => window.canvasTest.currentSeq()),
          viewport: page.viewportSize(),
          theme: "dark",
          provenance:
            "Synthetic flowEvents(gates) plus mergeEvents, production applyEvent and mounted Frame; not a real recording",
          command:
            "python3 /tmp/run-target.py pnpm -C frontend exec vitest run --project browser src/app/workflowPanel.browser.test.ts src/app/planFlow.browser.test.ts src/app/mergeQueue.browser.test.ts src/app/workflowCanvas.browser.test.ts",
        });
      }
      await writeFile(
        new URL(`manifest-${String(width)}.json`, directory),
        JSON.stringify(captures, null, 2),
      );
    } finally {
      await page.close();
    }
  },
);
