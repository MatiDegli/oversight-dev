import { fileURLToPath } from "node:url";
import { expect as check, type Browser, type Page } from "@playwright/test";
import { createServer, type ViteDevServer } from "vite";
import { launchBrowser } from "../browserLaunch.support";
import type * as fixture from "./mergeQueue.browser.fixture";
declare global {
  interface Window {
    canvasTest: typeof fixture;
  }
}
export const workflow = (page: Page) => page.getByLabel("Workflow", { exact: true });
export const canvasSteps = (page: Page) =>
  workflow(page).getByRole("list", { name: "Workflow steps" }).getByRole("button");
export async function workflowBrowser() {
  const server: ViteDevServer = await createServer({
    root: fileURLToPath(new URL("../../", import.meta.url)),
    cacheDir: fileURLToPath(new URL("../../../.shots/workflow-canvas/vite-cache", import.meta.url)),
    server: { host: "127.0.0.1", port: 0, strictPort: false },
  });
  const html = await server.transformIndexHtml(
    "/",
    '<!doctype html><html><head><meta charset="utf-8"></head><body><script type="module">import "/src/theme/index.css";import * as fixture from "/src/app/mergeQueue.browser.fixture.tsx";window.canvasTest=fixture;await fixture.mountMergeQueue();</script></body></html>',
  );
  await server.listen();
  const browser: Browser = await launchBrowser();
  async function open(width = 1280, multiple = false) {
    const page = await browser.newPage({
      viewport: { width, height: width === 390 ? 844 : width === 1920 ? 1080 : 900 },
      reducedMotion: "reduce",
    });
    await page.route("**/", (route) => route.fulfill({ contentType: "text/html", body: html }));
    await page.goto(server.resolvedUrls?.local[0] ?? "");
    await page.waitForFunction(() => Boolean(window.canvasTest));
    await page.evaluate(
      async ({ width, multiple }) => {
        document.documentElement.dataset.theme = "dark";
        if (multiple) await window.canvasTest.mountMergeQueue(width === 390 ? "Chat" : "Oversight");
        else
          await window.canvasTest.mountWorkflow({
            scene: "gates",
            layout: width === 390 ? "Chat" : "Oversight",
          });
      },
      { width, multiple },
    );
    await page.getByRole("button", { name: "Open workflow", exact: true }).first().click();
    await check(workflow(page)).toBeVisible();
    return page;
  }
  return {
    open,
    close: async () => {
      await browser.close();
      await server.close();
    },
  };
}
