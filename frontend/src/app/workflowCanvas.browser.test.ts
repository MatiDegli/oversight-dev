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

it.each([1280, 390])(
  "clears surviving indices before displaying another revision, retaining external focus at %i",
  async (width) => {
    const page = await harness.open(width);
    try {
      await canvasSteps(page).nth(1).click();
      await page.evaluate(() => {
        window.canvasTest.arrive();
      });
      await check(canvasSteps(page).nth(1)).toHaveAttribute("aria-pressed", "true");
      await check(canvasSteps(page).nth(1)).toBeFocused();
      await page.evaluate(() => {
        window.canvasTest.reviseWorkflow();
      });
      await check(workflow(page).getByText("Select a step to see its evidence.")).toBeVisible();
      await check(canvasSteps(page).nth(1)).toHaveAttribute("aria-pressed", "false");
      await check(canvasSteps(page).nth(1)).toBeFocused();
      await canvasSteps(page).nth(0).click();
      await check(
        workflow(page).getByRole("heading", { name: "Revision replacement task" }),
      ).toBeVisible();
      const revisionPrefix = await page.evaluate(() => window.canvasTest.currentSeq());
      await page.evaluate(() => window.canvasTest.seekBeforeReview());
      await check(workflow(page).getByText("Select a step to see its evidence.")).toBeVisible();
      await canvasSteps(page).nth(0).click();
      await page.evaluate((prefix) => window.canvasTest.replayThrough(prefix), revisionPrefix);
      await check(workflow(page).getByText("Select a step to see its evidence.")).toBeVisible();
      await check(canvasSteps(page).nth(0)).toHaveAttribute("aria-pressed", "false");
    } finally {
      await page.close();
    }
  },
);
it("restores removed detail action focus within the workflow on a revision reset", async () => {
  const page = await harness.open();
  try {
    await canvasSteps(page).nth(1).click();
    await workflow(page).getByRole("button", { name: "Review change" }).focus();
    await page.evaluate(() => {
      window.canvasTest.reviseWorkflow();
    });
    await check(workflow(page).getByText("Select a step to see its evidence.")).toBeVisible();
    await check(workflow(page).getByRole("button", { name: "Close", exact: true })).toBeFocused();
  } finally {
    await page.close();
  }
});
it.each(["composer", "replay"])(
  "leaves external %s focus untouched by surviving-index revision changes",
  async (control) => {
    const page = await harness.open();
    try {
      await canvasSteps(page).nth(1).click();
      await page.evaluate((control) => {
        const input = document.createElement("input");
        input.type = control === "composer" ? "text" : "range";
        input.setAttribute("aria-label", "External control");
        document.querySelector(".shell-center")?.append(input);
        input.focus();
      }, control);
      await page.evaluate(() => {
        window.canvasTest.reviseWorkflow();
      });
      await check(page.getByLabel("External control")).toBeFocused();
      await check(workflow(page).getByText("Select a step to see its evidence.")).toBeVisible();
    } finally {
      await page.close();
    }
  },
);
it("resets all canvas and detail evidence on a new run", async () => {
  const page = await harness.open();
  try {
    await canvasSteps(page).nth(1).click();
    await page.evaluate(() => {
      window.canvasTest.resetRun();
    });
    await check(canvasSteps(page)).toHaveCount(0);
    await check(workflow(page)).toHaveCount(0);
    await check(page.getByLabel("Repository graph", { exact: true })).toBeVisible();
  } finally {
    await page.close();
  }
});
it("compares streamed and reconstructed evidence and mounted canvas at every prefix", async () => {
  const page = await harness.open();
  try {
    await page.evaluate(() =>
      window.canvasTest.mountWorkflow({
        mode: "live",
        prefix: 0,
        layout: "Oversight",
        inbox: true,
      }),
    );
    const count = await page.evaluate(() => window.canvasTest.prefixLength());
    let opened = false;
    for (let prefix = 0; prefix <= count; prefix++) {
      const proof = await page.evaluate((prefix) => {
        window.canvasTest.ingestThrough(prefix);
        return window.canvasTest.prefixProof(prefix);
      }, prefix);
      expect(proof.live).toEqual(proof.reconstructed);
      expect(proof.unchanged).toBe(true);
      if (!proof.live) continue;
      if (!opened) {
        await page.getByRole("button", { name: "Open workflow", exact: true }).first().click();
        opened = true;
      }
      await check(canvasSteps(page)).toHaveCount(proof.live.nodes.length);
      expect(await workflow(page).locator(".workflow-canvas svg > path").count()).toBe(proof.live.edges.length);
      await canvasSteps(page).first().click();
      const detail = workflow(page).getByRole("region", { name: "Step detail" });
      await check(detail).toContainText(proof.live.details[0]?.model ?? "");
      const team = proof.live.details[0]?.team;
      if (team) await check(detail).toContainText(`Team ${team.letter}`);
    }
  } finally {
    await page.close();
  }
});
