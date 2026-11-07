import { fileURLToPath } from "node:url";
import { expect as check } from "@playwright/test";
import type { Browser, Page } from "@playwright/test";
import { createServer, type ViteDevServer } from "vite";
import { afterAll, beforeAll, expect, it } from "vitest";
import { launchBrowser } from "../browserLaunch.support";
import { fixtureCacheDir } from "../../shots/browserCache.support";
import type {} from "./ApproveButton.browser.fixture";

let server: ViteDevServer, browser: Browser, html: string, url: string;
beforeAll(async () => {
  server = await createServer({
    root: fileURLToPath(new URL("../../", import.meta.url)),
    cacheDir: fixtureCacheDir(expect.getState().testPath),
    server: { host: "127.0.0.1", port: 0, strictPort: false },
  });
  html = await server.transformIndexHtml(
    "/",
    '<!doctype html><html><body><script type="module">import "/src/theme/index.css"; import {approvalTest} from "/src/review/ApproveButton.browser.fixture.tsx"; window.approvalTest=approvalTest;</script></body></html>',
  );
  await server.listen();
  url = server.resolvedUrls?.local[0] ?? "";
  browser = await launchBrowser();
}, 60_000);
afterAll(async () => {
  await browser.close();
  await server.close();
});
const calls = (page: Page) => page.evaluate(() => window.approvalTest.calls);

it.each(["bar", "card", "grant"] as const)(
  "%s keeps progress distinct from the button in forced colors",
  async (surface) => {
    const page = await browser.newPage({
      forcedColors: "active",
      reducedMotion: "reduce",
      viewport: { width: 390, height: 844 },
    });
    try {
      await page.route("**/", (route) => route.fulfill({ contentType: "text/html", body: html }));
      await page.goto(url);
      await page.waitForFunction(() => "approvalTest" in window);
      await page.evaluate((surface) => {
        window.approvalTest.mount(surface);
      }, surface);
      const clockStart = new Date("2026-11-06T13:00:00Z");
      await page.clock.install({ time: clockStart });
      await page.clock.pauseAt(new Date(clockStart.getTime() + 1_000));
      const approve = page.getByRole("button", {
        name: surface === "grant" ? "Approve" : "Approve and merge",
        exact: true,
      });
      await approve.focus();
      await page.keyboard.down("Enter");
      await page.clock.runFor(500);
      await check(page.getByRole("progressbar")).toHaveAttribute("aria-valuenow", "50");
      const paint = await approve.evaluate((button) => {
        const progress = getComputedStyle(button, "::after");
        return {
          background: getComputedStyle(button).backgroundColor,
          progress:
            parseFloat(progress.borderBottomWidth) > 0 && progress.borderBottomStyle !== "none"
              ? progress.borderBottomColor
              : progress.backgroundColor,
        };
      });
      expect(paint.progress).not.toBe(paint.background);
      await check(approve).toBeFocused();
      await page.keyboard.up("Enter");
      await page.clock.runFor(1_000);
      await check(page.getByRole("progressbar")).toHaveCount(0);
      expect(await calls(page)).toEqual([]);
    } finally {
      await page.close();
    }
  },
);

it.each(["bar", "card", "grant"] as const)(
  "%s shares focused hold, interruptions and exactly-once dispatch",
  async (surface) => {
    const page = await browser.newPage();
    try {
      await page.route("**/", (route) => route.fulfill({ contentType: "text/html", body: html }));
      await page.goto(url);
      await page.waitForFunction(() => "approvalTest" in window);
      await page.evaluate((surface) => {
        window.approvalTest.mount(surface);
      }, surface);
      const clockStart = new Date("2026-11-06T13:00:00Z");
      await page.clock.install({ time: clockStart });
      await page.clock.pauseAt(new Date(clockStart.getTime() + 1_000));
      const approve = page.getByRole("button", {
        name: surface === "grant" ? "Approve" : "Approve and merge",
        exact: true,
      });
      const progress = page.getByRole("progressbar");
      await check(approve).toHaveAccessibleDescription(
        /Hold Enter for 1 second to approve and merge\. Release early to cancel\./,
      );
      for (const key of [
        "Enter",
        "Space",
        "Control+Enter",
        "Shift+Enter",
        "Alt+Enter",
        "Meta+Enter",
      ]) {
        await approve.press(key);
        await page.clock.runFor(1_100);
      }
      await approve.evaluate((button: HTMLButtonElement) => {
        button.click();
      });
      await page.getByLabel("Outside comment").fill("typing a comment");
      await page.keyboard.down("Enter");
      await page.clock.runFor(1_100);
      await page.keyboard.up("Enter");
      expect(await calls(page)).toEqual([]);
      for (const interruption of [
        "release",
        "focus",
        "blur",
        "hidden",
        "composition",
        "modifier",
        "eligible",
        "pending",
        "revision",
        "head",
        "run",
      ] as const) {
        await approve.focus();
        await page.keyboard.down("Enter");
        await check(progress).toHaveAttribute("aria-valuenow", "0");
        await page.clock.runFor(500);
        await check(progress).toHaveAttribute("aria-valuenow", "50");
        if (interruption === "release") await page.keyboard.up("Enter");
        else if (interruption === "focus")
          await page.getByRole("button", { name: "Outside", exact: true }).focus();
        else if (interruption === "blur")
          await page.evaluate(() => window.dispatchEvent(new Event("blur")));
        else if (interruption === "hidden")
          await page.evaluate(() => {
            Object.defineProperty(document, "visibilityState", {
              configurable: true,
              value: "hidden",
            });
            document.dispatchEvent(new Event("visibilitychange"));
          });
        else if (interruption === "composition") await approve.dispatchEvent("compositionstart");
        else if (interruption === "modifier") await page.keyboard.down("Control");
        else
          await page.evaluate((kind) => {
            window.approvalTest.update(
              kind === "eligible"
                ? { eligible: false }
                : kind === "pending"
                  ? { pending: true }
                  : kind === "revision"
                    ? { revision: 2 }
                    : kind === "head"
                      ? { head: "b".repeat(40) }
                      : { run: "run-2" },
            );
          }, interruption);
        await page.clock.runFor(1_100);
        await check(progress).toHaveCount(0);
        expect(await calls(page)).toEqual([]);
        await page.keyboard.up("Enter");
        await page.keyboard.up("Control");
        await page.evaluate(() => {
          Object.defineProperty(document, "visibilityState", {
            configurable: true,
            value: "visible",
          });
          window.approvalTest.update({
            eligible: true,
            pending: false,
            revision: 1,
            head: "a".repeat(40),
            run: "run-1",
          });
        });
      }
      await approve.focus();
      await page.keyboard.down("Enter");
      await page.clock.runFor(500);
      // An unrelated render must not reset the timer or replace focus.
      await page.evaluate(() => {
        window.approvalTest.update({});
      });
      await page.keyboard.down("Enter");
      await page.clock.runFor(499);
      expect(await calls(page)).toEqual([]);
      await page.clock.runFor(1);
      expect(await calls(page)).toHaveLength(1);
      await page.keyboard.down("Enter");
      await page.clock.runFor(2_000);
      expect(await calls(page)).toHaveLength(1);
      await check(approve).toBeFocused();
      await page.keyboard.up("Enter");
      await approve.focus();
      await page.keyboard.down("Enter");
      await page.clock.runFor(500);
      await approve.click();
      await page.clock.runFor(1_000);
      expect(await calls(page)).toHaveLength(2);
      await page.keyboard.up("Enter");
      await approve.focus();
      await page.keyboard.down("Enter");
      await page.clock.runFor(500);
      await page.evaluate(() => {
        window.approvalTest.unmount();
      });
      await page.clock.runFor(1_000);
      expect(await calls(page)).toHaveLength(2);
    } finally {
      await page.close();
    }
  },
  60_000,
);
