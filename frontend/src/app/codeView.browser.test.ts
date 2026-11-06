import type { TreeResponse } from "@contracts";
import { mkdir, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { expect as check, type Browser, type Page } from "@playwright/test";
import { createServer, type ViteDevServer } from "vite";
import { afterAll, beforeAll, expect, it } from "vitest";
import { launchBrowser } from "../browserLaunch.support";
import type { GraphProbeHost } from "../graph";
import type {} from "./codeView.browser.fixture";
import { workspacePreferenceKeys } from "./shell/workspacePreferences";

let server: ViteDevServer, browser: Browser, html: string, url: string;
const content = Array.from({ length: 160 }, (_, i) => `# line ${String(i + 1)}`).join("\n");
beforeAll(async () => {
  server = await createServer({
    root: fileURLToPath(new URL("../../", import.meta.url)),
    cacheDir: fileURLToPath(new URL("../../../.shots/code-view-cache", import.meta.url)),
    server: { host: "127.0.0.1", port: 0, strictPort: false },
  });
  html = await server.transformIndexHtml(
    "/",
    '<!doctype html><html data-theme="dark"><body><div id="root" style="height:100dvh"></div><script type="module">import "/src/theme/index.css"; import "/src/app/codeView.browser.fixture.tsx";</script></body></html>',
  );
  await server.listen();
  url = server.resolvedUrls?.local[0] ?? "";
  browser = await launchBrowser();
}, 60_000);
afterAll(async () => {
  await browser.close();
  await server.close();
});
const view = (page: Page, name: string) =>
  page.getByRole("group", { name: "Workspace view" }).getByRole("button", { name, exact: true });
const file = (page: Page) => page.getByRole("complementary", { name: "File view" });
async function prepare(width = 1920, height = 1080) {
  const page = await browser.newPage({ viewport: { width, height }, reducedMotion: "reduce" });
  page.setDefaultTimeout(10_000);
  await page.addInitScript(() => {
    Object.defineProperty(window, "EventSource", {
      value: class {
        readyState = 1;
        close() {}
      },
    });
  });
  await page.route(
    (target) => target.pathname === "/",
    (route) => route.fulfill({ contentType: "text/html", body: html }),
  );
  await page.route(
    (target) => target.pathname === "/tree",
    (route) =>
      route.fulfill({
        json: {
          run_id: "run-20261027-140312",
          agent_id: null,
          directories: [],
          files: ["cart.py", "pricing.py"].map((path) => ({ path, hash: "h0" })),
          graph_version: null,
          truncated: false,
        } satisfies TreeResponse,
      }),
  );
  await page.route(
    (target) => target.pathname === "/files" && target.search !== "",
    (route) =>
      route.fulfill({
        json: {
          path: new URL(route.request().url()).searchParams.get("path"),
          content,
          hash: "h0",
          agent_id: null,
        },
      }),
  );
  await page.route(
    (target) => target.pathname === "/settings",
    (route) =>
      route.fulfill({
        status: 501,
        json: { error: { code: "not_available", message: "Scripted fixture" } },
      }),
  );
  return page;
}
async function open(page: Page, initial = "", seq = 20) {
  await page.goto(`${url}?seq=${String(seq)}${initial ? `&initial=${initial}` : ""}`);
  await page.waitForFunction(() => !!window.codeViewTest);
}
async function openFile(page: Page) {
  await page.getByRole("treeitem", { name: "cart.py", exact: true }).click();
  await check(file(page)).toHaveAttribute("data-state", "clean");
  await check(file(page).locator(".monaco-editor .view-lines")).toBeVisible();
}
async function drawn(page: Page) {
  await page.waitForFunction(
    () =>
      !!document.querySelector<GraphProbeHost>('[aria-label="Repository graph"]')?.oversightGraph,
  );
}

it("uses one switch Tab stop with wrapping arrows, Home/End and explicit activation", async () => {
  const page = await prepare();
  try {
    await open(page);
    const switcher = page.getByRole("group", { name: "Workspace view" });
    await check(switcher.locator('button[tabindex="0"]')).toHaveCount(1);
    await view(page, "Chat").focus();
    await page.keyboard.press("ArrowLeft");
    await check(view(page, "Oversight")).toBeFocused();
    await check(view(page, "Chat")).toHaveAttribute("aria-pressed", "true");
    await page.keyboard.press("ArrowRight");
    await check(view(page, "Chat")).toBeFocused();
    await page.keyboard.press("End");
    await check(view(page, "Oversight")).toBeFocused();
    await page.keyboard.press("Home");
    await page.keyboard.press("ArrowRight");
    await page.keyboard.press("Space");
    await check(view(page, "Code")).toHaveAttribute("aria-pressed", "true");
    await check(view(page, "Code")).toBeFocused();
    await page.keyboard.press("Tab");
    await check(switcher.locator("button:focus")).toHaveCount(0);
    await page.keyboard.press("Shift+Tab");
    await check(view(page, "Code")).toBeFocused();
    await page.keyboard.press("End");
    await page.keyboard.press("Enter");
    await drawn(page);
    await check(view(page, "Oversight")).toBeFocused();
  } finally {
    await page.close();
  }
});

it("direct Code releases the real editor, defers the graph and retains model, selection, scroll and unsaved text on all round trips", async () => {
  const page = await prepare();
  const requested: string[] = [];
  page.on("request", (request) => requested.push(new URL(request.url()).pathname));
  try {
    await open(page, "Code");
    await check(page.locator(".agents-rail")).toBeVisible();
    await check(page.getByRole("heading", { name: "Open a file to start coding" })).toBeVisible();
    await openFile(page);
    const input = file(page).locator(
      ".monaco-editor :is(.native-edit-context, textarea.inputarea)",
    );
    await input.focus();
    await page.keyboard.press("Control+End");
    await page.keyboard.insertText("\n# unsaved workspace text");
    await page.keyboard.press("Shift+Home");
    await check(file(page)).toHaveAttribute("data-state", "dirty");
    const before = await page.evaluate(() => window.codeViewTest.editorState());
    expect(before.top).toBeGreaterThan(0);
    expect(
      requested.filter((path) => /GraphView|DotField|cytoscape|OversightStage/.test(path)),
    ).toEqual([]);
    // Each directed transition, including both directions between Chat and Oversight.
    for (const next of ["Chat", "Code", "Oversight", "Code", "Chat", "Oversight", "Chat", "Code"]) {
      await view(page, next).click();
      await check(view(page, next)).toBeFocused();
      expect(await page.evaluate(() => window.codeViewTest.editorState())).toEqual(before);
      if (next !== "Oversight") {
        await check(page.locator(".oversight-stage")).toHaveAttribute("hidden", "");
        await check(page.locator(".oversight-stage")).toHaveAttribute("inert", "");
      }
      if (next === "Oversight") await drawn(page);
    }
    await check(page.getByRole("tab", { name: "cart.py", exact: true })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    const graph = await page.locator('[aria-label="Repository graph"]').elementHandle();
    await view(page, "Oversight").click();
    expect(
      await graph.evaluate(
        (node) => node === document.querySelector('[aria-label="Repository graph"]'),
      ),
    ).toBe(true);
    await view(page, "Chat").click();
    await page.getByRole("button", { name: "New task", exact: true }).click();
    await check(page.getByRole("heading", { name: /What should change/ })).toBeVisible();
    await view(page, "Code").click();
    expect(await page.evaluate(() => window.codeViewTest.editorState())).toEqual(before);
    await view(page, "Chat").click();
    await check(page.locator(".focus-panel")).toHaveAttribute("inert", "");
    await view(page, "Code").click();
    expect(await page.evaluate(() => window.codeViewTest.editorState())).toEqual(before);
    // Inactive tabs and app-owned draft survive the same presets too.
    await page.getByRole("button", { name: "Settings", exact: true }).click();
    for (const next of ["Chat", "Code", "Oversight", "Code"]) await view(page, next).click();
    await page.getByRole("tab", { name: "cart.py", exact: true }).click();
    await check(file(page)).toHaveAttribute("data-state", "dirty");
    expect((await page.evaluate(() => window.codeViewTest.editorState())).value).toContain(
      "# unsaved workspace text",
    );
    expect(
      await page.evaluate(() =>
        Object.keys(localStorage)
          .map((key) => localStorage.getItem(key))
          .join(" "),
      ),
    ).not.toContain("unsaved workspace text");
  } finally {
    await page.close();
  }
});

it("retains conversation drafts and the active review/comment across the three presets", async () => {
  const page = await prepare();
  try {
    await open(page, "Chat", 14);
    await page.getByRole("button", { name: /^Agent A:/ }).click();
    const message = page.getByRole("textbox", { name: "Message Agent A", exact: true });
    await message.fill("Unsent conversation stays here");
    const original = await message.elementHandle();
    for (const next of ["Code", "Oversight", "Chat", "Code", "Chat"]) {
      await view(page, next).click();
      await check(message).toHaveValue("Unsent conversation stays here");
      await check(view(page, next)).toBeFocused();
      expect(await original.evaluate((node) => node.isConnected)).toBe(true);
    }
    await page.getByRole("button", { name: "View in diff", exact: true }).click();
    const diff = page.getByRole("complementary", { name: "Live diff panel", exact: true });
    await check(diff.locator(".monaco-editor .view-lines").last()).toBeVisible();
    const diffEditor = await diff.locator(".monaco-editor .view-lines").last().elementHandle();
    for (const next of ["Code", "Oversight", "Chat"]) {
      await view(page, next).click();
      await check(diff).toBeVisible();
      expect(await diffEditor.evaluate((node) => node.isConnected)).toBe(true);
    }
    await page.getByRole("tab", { name: /Agent A · conversation/ }).click();
    await check(message).toHaveValue("Unsent conversation stays here");
    await page.evaluate(() => {
      window.codeViewTest.advance(20);
    });
    await page.getByRole("button", { name: "Review change", exact: true }).click();
    const review = page.getByRole("complementary", { name: "Review panel", exact: true });
    await check(review.locator(".monaco-editor .view-lines").last()).toBeVisible();
    const comment = review.getByRole("textbox", { name: "Comment for the agent", exact: true });
    await comment.fill("Keep this review comment");
    const mounted = await review.elementHandle();
    for (const next of ["Code", "Oversight", "Chat", "Oversight", "Code"]) {
      await view(page, next).click();
      await check(view(page, next)).toBeFocused();
      await check(comment).toHaveValue("Keep this review comment");
      expect(await mounted.evaluate((node) => node.isConnected)).toBe(true);
    }
    await check(page.getByRole("tab", { name: /Review · change-1/ })).toHaveAttribute(
      "aria-selected",
      "true",
    );
  } finally {
    await page.close();
  }
});

it("remembers last view and only Oversight maximize across reloads; fixed startup applies next opening", async () => {
  const page = await prepare();
  try {
    await open(page);
    await check(view(page, "Chat")).toHaveAttribute("aria-pressed", "true");
    await view(page, "Oversight").click();
    await page.getByRole("button", { name: "Settings", exact: true }).click();
    await page.getByRole("button", { name: "Maximize focus panel", exact: true }).click();
    await view(page, "Code").click();
    await check(page.locator(".shell-center")).not.toHaveClass(/is-maximized/);
    await check(page.getByRole("button", { name: "Show graph", exact: true })).toHaveCount(0);
    const startup = page.getByLabel("View on opening", { exact: true });
    for (const fixed of ["Chat", "Code", "Oversight"]) {
      await startup.selectOption(fixed);
      await check(view(page, "Code")).toHaveAttribute("aria-pressed", "true");
      await page.reload();
      await check(view(page, fixed)).toHaveAttribute("aria-pressed", "true");
      await page.getByRole("button", { name: "Settings", exact: true }).click();
      await check(startup).toHaveValue(fixed);
      if (fixed === "Oversight")
        await check(page.locator(".shell-center")).toHaveClass(/is-maximized/);
      await view(page, "Code").click();
    }
    await startup.selectOption("last-used");
    await page.reload();
    await check(view(page, "Code")).toHaveAttribute("aria-pressed", "true");
    await view(page, "Oversight").click();
    await page.getByRole("button", { name: "Settings", exact: true }).click();
    await check(page.getByRole("button", { name: "Show graph", exact: true })).toBeVisible();
    await page.getByRole("button", { name: "Show graph", exact: true }).click();
    await page.reload();
    await page.getByRole("button", { name: "Settings", exact: true }).click();
    await check(
      page.getByRole("button", { name: "Maximize focus panel", exact: true }),
    ).toBeVisible();
  } finally {
    await page.close();
  }
});

it.each(["corrupt", "denied", "read-failed", "write-failed"])(
  "tolerates %s storage and keeps switching usable",
  async (failure) => {
    const page = await prepare();
    try {
      await page.addInitScript(
        ({ failure, keys }) => {
          if (failure === "corrupt")
            for (const key of Object.values(keys)) localStorage.setItem(key, "{broken");
          if (failure === "denied")
            Object.defineProperty(window, "localStorage", {
              get() {
                throw new Error("denied");
              },
            });
          if (failure === "read-failed")
            Storage.prototype.getItem = () => {
              throw new Error("read failed");
            };
          if (failure === "write-failed")
            Storage.prototype.setItem = () => {
              throw new Error("quota");
            };
        },
        { failure, keys: workspacePreferenceKeys() },
      );
      await open(page);
      await check(view(page, "Chat")).toHaveAttribute("aria-pressed", "true");
      await view(page, "Code").click();
      await page.getByRole("button", { name: "Settings", exact: true }).click();
      await page.getByLabel("View on opening", { exact: true }).selectOption("Oversight");
      await view(page, "Oversight").click();
      await page.getByRole("button", { name: "Maximize focus panel", exact: true }).click();
      await view(page, "Code").click();
      await check(page.getByLabel("View on opening", { exact: true })).toHaveValue("Oversight");
      await check(page.locator(".shell-center")).not.toHaveClass(/is-maximized/);
    } finally {
      await page.close();
    }
  },
);

it("fixture layout/maximize overrides ignore preferences and do not write them", async () => {
  const page = await prepare();
  try {
    await page.addInitScript((keys) => {
      localStorage.setItem(keys.startup, "Oversight");
      localStorage.setItem(keys.lastView, "Oversight");
      localStorage.setItem(keys.maximized, "true");
    }, workspacePreferenceKeys());
    await open(page, "Code");
    await view(page, "Oversight").click();
    await page.getByRole("button", { name: "Settings", exact: true }).click();
    await check(
      page.getByRole("button", { name: "Maximize focus panel", exact: true }),
    ).toBeVisible();
    await page.getByLabel("View on opening", { exact: true }).selectOption("Chat");
    expect(
      await page.evaluate(() =>
        Object.fromEntries(
          Object.keys(localStorage).map((key) => [key, localStorage.getItem(key)]),
        ),
      ),
    ).toEqual({
      [workspacePreferenceKeys().startup]: "Oversight",
      [workspacePreferenceKeys().lastView]: "Oversight",
      [workspacePreferenceKeys().maximized]: "true",
    });
  } finally {
    await page.close();
  }
});

it("Code at phone width exposes Files, editor tabs, settings and dock without shell overflow", async () => {
  const page = await prepare(390, 844);
  try {
    await open(page, "Code");
    await openFile(page);
    await page.getByRole("button", { name: "Close sidebar", exact: true }).click();
    await check(page.getByRole("button", { name: "Files", exact: true })).toHaveAttribute(
      "aria-expanded",
      "false",
    );
    await page.getByRole("button", { name: "Files", exact: true }).click();
    await check(page.getByRole("complementary", { name: "Files sidebar" })).toBeVisible();
    await page.getByRole("button", { name: "Toggle bottom dock", exact: true }).click();
    await check(page.locator(".bottom-dock")).toBeVisible();
    const dockTargets = await page.locator(".dock-header button").evaluateAll((buttons) =>
      buttons.map((button) => {
        const box = button.getBoundingClientRect();
        return box.width >= 44 && box.height >= 44;
      }),
    );
    expect(dockTargets.every(Boolean)).toBe(true);
    await page.getByRole("button", { name: "Toggle bottom dock", exact: true }).click();
    await page.getByRole("button", { name: "Settings", exact: true }).click();
    await page.getByLabel("View on opening", { exact: true }).scrollIntoViewIfNeeded();
    await check(page.getByLabel("View on opening", { exact: true })).toBeInViewport();
    await page.getByRole("tab", { name: "cart.py", exact: true }).click();
    const measures = await page.evaluate(() => ({
      width: document.documentElement.scrollWidth,
      controls: [
        ...document.querySelectorAll<HTMLElement>(
          '.view-switch button, [aria-label="Settings"], .left-rail button:not([aria-label="Watch"]), .focus-tabs button, [aria-label="Toggle bottom dock"]',
        ),
      ].map((node) => ({
        w: node.getBoundingClientRect().width,
        h: node.getBoundingClientRect().height,
      })),
    }));
    expect(measures.width).toBe(390);
    expect(measures.controls.every((box) => box.w >= 44 && box.h >= 44)).toBe(true);
    await view(page, "Oversight").click();
    await check(page.locator(".narrow-notice")).toBeVisible();
  } finally {
    await page.close();
  }
});

it("keeps a usable editor with long filenames at 200% equivalent laptop space", async () => {
  const page = await prepare(640, 400);
  const path = "extremely_long_repository_module_name_and_a_long_file_name_for_navigation.py";
  try {
    await page.route(
      (target) => target.pathname === "/tree",
      (route) =>
        route.fulfill({
          json: {
            run_id: "run-20261027-140312",
            agent_id: null,
            directories: [],
            files: [{ path, hash: "h0" }],
            graph_version: null,
            truncated: false,
          } satisfies TreeResponse,
        }),
    );
    await open(page, "Code");
    await page.getByRole("treeitem", { name: path, exact: true }).click();
    const editor = file(page).locator(".monaco-editor");
    await check(editor.locator(".view-lines")).toBeVisible();
    await editor.scrollIntoViewIfNeeded();
    expect((await editor.boundingBox())?.height).toBeGreaterThanOrEqual(150);
    await check(editor).toBeInViewport();
    await page.getByRole("button", { name: "Settings", exact: true }).click();
    await page.getByLabel("View on opening", { exact: true }).scrollIntoViewIfNeeded();
    await check(page.getByLabel("View on opening", { exact: true })).toBeInViewport();
    await page.getByRole("button", { name: "Toggle bottom dock", exact: true }).click();
    await page.locator(".bottom-dock").scrollIntoViewIfNeeded();
    await check(page.locator(".bottom-dock")).toBeInViewport();
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(640);
  } finally {
    await page.close();
  }
});

if (process.env.CODE_VIEW_SHOTS === "1")
  for (const [width, height] of [
    [1920, 1080],
    [1440, 900],
    [1280, 800],
    [390, 844],
  ])
    for (const theme of ["dark", "day"])
      it(`captures all views ${String(width)}x${String(height)} ${theme}`, async () => {
        const page = await prepare(width, height);
        try {
          await open(page, "Code");
          await page.evaluate((theme) => {
            document.documentElement.dataset.theme = theme;
          }, theme);
          await openFile(page);
          await page.evaluate(() => document.fonts.ready);
          const directory = fileURLToPath(new URL("../../../.shots/code-view/", import.meta.url));
          await mkdir(directory, { recursive: true });
          for (const name of ["Code", "Chat", "Oversight"]) {
            await view(page, name).click();
            if (name === "Oversight") await drawn(page);
            const stem = `${name.toLowerCase()}-file-${String(width)}x${String(height)}-${theme}`;
            await page.screenshot({ path: `${directory}/${stem}.png` });
            await writeFile(
              `${directory}/${stem}.json`,
              JSON.stringify(
                {
                  view: name,
                  state: "open file · scripted events · no provider",
                  theme,
                  viewport: { width, height },
                  base: "f2ea7a1933a8780600d917fa3a19ecb73bcd8ef1",
                  capturedAt: new Date().toISOString(),
                },
                null,
                2,
              ),
            );
          }
        } finally {
          await page.close();
        }
      }, 60_000);
