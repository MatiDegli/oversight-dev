import { expect, test } from "@playwright/test";
import { readFileSync } from "node:fs";
import { writeFile } from "node:fs/promises";
import type { ServerEvent } from "@contracts";
import type { Page, TestInfo } from "@playwright/test";
import { openOversight } from "./graph-support";
import { before, engaged, installHolds } from "./holds";
import { a, holds, proposal } from "./level2-log";
import { interceptCommands, removeRoutes } from "./level2-support";
import { E2E_LOG } from "./log";

const instruction = "Hold Enter for 1 second to approve and merge. Release early to cancel.";
const ordinaryEvents = readFileSync(
  new URL(`../../fixtures/events/${E2E_LOG}`, import.meta.url),
  "utf8",
)
  .trim()
  .split("\n")
  .map((line) => JSON.parse(line) as ServerEvent);
const ordinaryResolution = ordinaryEvents.find((event) => event.type === "change.resolved");
if (!ordinaryResolution) throw new Error("Missing ordinary replay decision");
const ordinaryHold = before(ordinaryEvents, ordinaryResolution, 1781);
test.afterEach(async ({ page }) => removeRoutes(page));

async function openCandidate(page: Page) {
  const commands = await interceptCommands(page);
  await page.addInitScript(installHolds, [holds.decisions]);
  await page.goto("/level2");
  await openOversight(page);
  await engaged(page, holds.decisions);
  await page
    .locator(`[data-agent-card="${a.agent_id}"]`)
    .getByRole("button", { name: "Review change" })
    .click();
  const review = page.getByRole("complementary", { name: "Review panel", exact: true });
  await expect(review.getByLabel("Editable review file")).toHaveAttribute("data-state", "clean");
  const clockStart = new Date("2026-11-06T13:00:00Z");
  await page.clock.install({ time: clockStart });
  await page.clock.pauseAt(new Date(clockStart.getTime() + 1_000));
  return {
    ...commands,
    review,
    approve: review.getByRole("button", { name: "Approve and merge", exact: true }),
    comment: review.getByRole("textbox", { name: "Comment for the agent" }),
  };
}

async function evidence(page: Page, testInfo: TestInfo) {
  const bar = page.getByRole("region", { name: "Decision", exact: true });
  const accessibility = testInfo.outputPath("approval-accessibility.yaml");
  await writeFile(accessibility, await bar.ariaSnapshot());
  await testInfo.attach("approval-accessibility", {
    path: accessibility,
    contentType: "text/yaml",
  });
  await page.screenshot({ path: testInfo.outputPath("holding-enter.png") });
  await testInfo.attach("holding-enter", {
    path: testInfo.outputPath("holding-enter.png"),
    contentType: "image/png",
  });
}

for (const theme of ["dark", "day"] as const) {
  for (const reducedMotion of ["no-preference", "reduce"] as const) {
    test(`${theme}, ${reducedMotion}: forbidden gestures send nothing; focused hold sends one bound approval`, async ({
      page,
    }, testInfo) => {
      await page.emulateMedia({ reducedMotion });
      await page.addInitScript((theme) => {
        localStorage.setItem("oversight.appearance", theme);
      }, theme);
      const { sent, unexpected, approve, comment } = await openCandidate(page);
      const progress = page.getByRole("progressbar");
      await expect(approve).toHaveAccessibleName("Approve and merge");
      await expect(approve).toHaveAccessibleDescription(new RegExp(instruction));
      await comment.fill("Review comment");
      for (const key of ["Enter", "Control+Enter", "Meta+Enter", "Shift+Enter", "Alt+Enter"]) {
        await comment.press(key);
      }
      await comment.press("Tab");
      await expect(approve).toBeFocused();
      await approve.press("Space");
      await approve.press("Enter");
      await page.clock.runFor(1_100);
      await approve.evaluate((button: HTMLButtonElement) => {
        button.click();
      });
      for (const modifier of ["Control", "Meta", "Alt", "Shift"]) {
        await page.keyboard.down(modifier);
        await page.keyboard.down("Enter");
        await page.clock.runFor(1_100);
        await page.keyboard.up("Enter");
        await page.keyboard.up(modifier);
      }
      await approve.dispatchEvent("keydown", { key: "Enter", isComposing: true });
      await page.clock.runFor(1_100);
      await approve.focus();
      await page.keyboard.down("Enter");
      await page.clock.runFor(500);
      await expect(progress).toHaveAttribute("aria-valuenow", "50");
      await expect(progress).toHaveAttribute("aria-live", "off");
      expect(
        await approve.evaluate((button) => getComputedStyle(button, "::after").transform),
      ).not.toBe("matrix(0, 0, 0, 1, 0, 0)");
      await page.keyboard.up("Enter");
      await expect(progress).toHaveCount(0);
      await expect(approve).toHaveCSS("--approval-progress", "0");
      await page.keyboard.down("Enter");
      await page.clock.runFor(500);
      await comment.focus();
      await approve.focus();
      await page.keyboard.down("Enter"); // repeat after returning focus cannot start a hold
      await page.clock.runFor(1_100);
      await expect(progress).toHaveCount(0);
      await page.keyboard.up("Enter");
      expect(sent).toEqual([]);
      await comment.fill("Ready to merge");
      await approve.focus();
      await page.keyboard.down("Enter");
      await expect(progress).toHaveAttribute("aria-valuenow", "0");
      await page.clock.runFor(500);
      await expect(progress).toHaveAttribute("aria-valuenow", "50");
      await expect(approve).toBeFocused();
      if (reducedMotion === "reduce") {
        await page.clock.runFor(100);
        await expect(progress).toHaveAttribute("aria-valuenow", "50");
        expect(
          await approve.evaluate((button) => {
            const css = getComputedStyle(button, "::after");
            return { animation: css.animationName, transition: css.transitionDuration };
          }),
        ).toEqual({ animation: "none", transition: "0s" });
      }
      await evidence(page, testInfo);
      await page.keyboard.down("Enter");
      await page.clock.runFor(reducedMotion === "reduce" ? 399 : 499);
      expect(sent).toEqual([]);
      await page.clock.runFor(1);
      await expect
        .poll(() => sent)
        .toEqual([
          {
            path: `/changes/${a.change_id}/approve`,
            method: "POST",
            body: {
              revision: proposal.revision,
              head_commit: proposal.head_commit,
              comment: "Ready to merge",
            },
          },
        ]);
      await page.keyboard.down("Enter");
      await page.clock.runFor(2_000);
      await page.keyboard.up("Enter");
      expect(sent).toHaveLength(1);
      expect(unexpected).toEqual([]);
      await expect(approve).toBeDisabled();
    });
  }
}

test("pointer activation cancels a partial hold and uses the same bound request", async ({
  page,
}) => {
  const { sent, approve } = await openCandidate(page);
  await approve.focus();
  await page.keyboard.down("Enter");
  await page.clock.runFor(500);
  await approve.click();
  await page.clock.runFor(1_000);
  await page.keyboard.up("Enter");
  await expect
    .poll(() => sent)
    .toEqual([
      {
        path: `/changes/${a.change_id}/approve`,
        method: "POST",
        body: { revision: proposal.revision, head_commit: proposal.head_commit },
      },
    ]);
});

test("ordinary replay cannot send decisions even while Enter stays down", async ({ page }) => {
  const { sent } = await interceptCommands(page);
  // Retain the ordinary replay's decision window while exercising its disabled controls.
  await page.addInitScript(installHolds, [ordinaryHold]);
  await page.goto("/");
  await openOversight(page);
  await engaged(page, ordinaryHold);
  const reviewButton = page.getByRole("button", { name: "Review change", exact: true }).first();
  await reviewButton.click();
  const approve = page.getByRole("button", { name: "Approve and merge", exact: true });
  await expect(approve).toBeDisabled();
  const clockStart = new Date("2026-11-06T13:00:00Z");
  await page.clock.install({ time: clockStart });
  await page.clock.pauseAt(new Date(clockStart.getTime() + 1_000));
  await page.keyboard.down("Enter");
  await page.clock.runFor(1_100);
  await page.keyboard.up("Enter");
  await approve.dispatchEvent("keydown", { key: "Enter", repeat: false });
  await approve.dispatchEvent("click", { detail: 1 });
  expect(sent).toEqual([]);
});
