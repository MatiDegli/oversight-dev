import { mkdir, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { chromium, expect, type Browser, type Page } from "@playwright/test";
import { createServer, type ViteDevServer } from "vite";
import { afterAll, beforeAll, it } from "vitest";
import { openOversight } from "../workspaceView.browser.support";

declare global {
  interface Window {
    packetTest: typeof import("../app/inbox.browser.fixture").packetTest;
    packetClipboard: { texts: string[]; finish: () => void };
  }
}
// BEFORE at ab9e1d18, before implementation: 2 browser tests passed, exit 0, 22.13s.
// Three inbox rows, graph visible, no Approval packet / Copy packet; desktop/390 dark/day
// captures: .shots/decision-packets/before-*.png. After proof uses the same production inbox.
let server: ViteDevServer, browser: Browser, html: string, url: string;
const out = fileURLToPath(new URL("../../../.shots/decision-packets/", import.meta.url));
beforeAll(async () => {
  server = await createServer({
    root: fileURLToPath(new URL("../../", import.meta.url)),
    server: { host: "127.0.0.1", port: 0, strictPort: false },
  });
  html = await server.transformIndexHtml(
    "/",
    '<!doctype html><html><body><script type="module">import "/src/theme/index.css"; import {packetTest} from "/src/app/inbox.browser.fixture.tsx";window.packetTest=packetTest;packetTest.mount();</script></body></html>',
  );
  await server.listen();
  url = server.resolvedUrls?.local[0] ?? "";
  browser = await chromium.launch();
  await mkdir(out, { recursive: true });
}, 60000);
afterAll(async () => {
  await browser.close();
  await server.close();
});

async function pageFor(theme = "dark", width = 1920) {
  const page = await browser.newPage({
    viewport: { width, height: width === 390 ? 844 : 1080 },
    reducedMotion: "reduce",
  });
  await page.route("**/", (r) => r.fulfill({ contentType: "text/html", body: html }));
  const mutations: string[] = [],
    errors: string[] = [];
  page.on("request", (r) => {
    if (r.method() !== "GET") mutations.push(r.url());
  });
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto(url);
  await page.evaluate((theme) => {
    document.documentElement.dataset.theme = theme;
  }, theme);
  return { page, mutations, errors };
}
async function mount(
  page: Page,
  source: "grants" | "kinds" = "grants",
  standalone = false,
  replay = false,
) {
  await page.evaluate(
    ({ source, standalone, replay }) => {
      window.packetTest.mount(source, standalone, replay);
    },
    { source, standalone, replay },
  );
  if (!standalone) {
    await openOversight(page);
    await page.getByRole("button", { name: /^Decisions:/ }).click();
  }
  await expect(page.getByRole("region", { name: "Decisions inbox" })).toBeVisible();
}
async function clipboard(page: Page, mode: "ok" | "hold" | "hold-deny" | "deny" | "absent" = "ok") {
  await page.evaluate((mode) => {
    window.packetClipboard = { texts: [], finish: () => {} };
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value:
        mode === "absent"
          ? undefined
          : {
              writeText: async (text: string) => {
                window.packetClipboard.texts.push(text);
                if (mode === "deny") throw new DOMException("Clipboard denied", "NotAllowedError");
                if (mode === "hold" || mode === "hold-deny")
                  await new Promise<void>((resolve) => {
                    window.packetClipboard.finish = resolve;
                  });
                if (mode === "hold-deny")
                  throw new DOMException("Clipboard denied", "NotAllowedError");
              },
            },
    });
  }, mode);
}
const packet = (page: Page, row = 0) =>
  page.locator(".inbox-row").nth(row).locator(".approval-packet");
const recordedAuthority = (page: Page) =>
  page.evaluate(() =>
    JSON.stringify([
      window.packetTest.answers.getState().drafts,
      window.packetTest.answers.getState().grants,
      window.packetTest.state().grantEvents,
      window.packetTest.state().decisionEvents,
    ]),
  );
async function preview(page: Page, row = 0) {
  const disclosure = packet(page, row);
  await disclosure.locator("summary").focus();
  await page.keyboard.press("Enter");
  await expect(disclosure.getByRole("button", { name: "Copy packet" })).toBeVisible();
  await expect(disclosure.locator("summary")).toBeFocused();
  return disclosure;
}

it.each(["dark", "day"])(
  "copies exact preview and linked evidence, retaining graph and focus in %s",
  async (theme) => {
    const { page, mutations, errors } = await pageFor(theme);
    try {
      await mount(page);
      await clipboard(page);
      await expect(page.locator(".approval-packet")).toHaveCount(3);
      await expect(page.locator(".approval-packet[open]")).toHaveCount(0);
      await expect(page.locator(".graph-stage")).toBeVisible();
      const graph = page.locator('[aria-label="Repository graph"]');
      await page.waitForFunction(() => {
        const host = document.querySelector<
          HTMLElement & { oversightGraph?: { animating: () => boolean } }
        >('[aria-label="Repository graph"]');
        return host?.oversightGraph && !host.oversightGraph.animating();
      });
      await graph.evaluate((e) => {
        e.setAttribute("data-packet-proof", "retained");
      });
      const disclosure = await preview(page, 1);
      const beforeAuthority = await recordedAuthority(page);
      const text = await disclosure.getByLabel("Complete approval packet").textContent();
      expect(text).toContain("Proposed approval wording; copying records no decision.");
      const links = disclosure.getByRole("navigation").getByRole("link");
      const evidenceTitles = await links.allTextContents();
      expect(new Set(evidenceTitles).size).toBe(evidenceTitles.length);
      for (const link of await links.all()) {
        const href = await link.getAttribute("href");
        expect(href).toMatch(/^#packet-/);
        if (!href) throw new Error("Missing evidence link");
        const target = page.locator(`[id="${href.slice(1)}"]`);
        await expect(target).toHaveCount(1);
        expect(await target.textContent()).toContain(await link.textContent());
      }
      await links.filter({ hasText: "change.facts_recorded.payload" }).first().click();
      const copy = disclosure.getByRole("button", { name: "Copy packet" });
      await copy.focus();
      await page.keyboard.press("Enter");
      await expect(disclosure.getByRole("status")).toContainText(
        "Copied Change change-3 · revision 1 · head",
      );
      expect(await page.evaluate(() => window.packetClipboard.texts)).toEqual([text]);
      await expect(copy).toBeFocused();
      await expect(graph).toHaveAttribute("data-packet-proof", "retained");
      await expect(page.locator(".graph-stage")).toBeVisible();
      expect(await recordedAuthority(page)).toBe(beforeAuthority);
      await page.keyboard.press("Control+Enter");
      expect(await page.evaluate(() => window.packetClipboard.texts)).toEqual([text]);
      await page.screenshot({ path: `${out}/after-desktop-${theme}.png` });
      await writeFile(`${out}/copied-${theme}.md`, text ?? "");
      await page.setViewportSize({ width: 390, height: 844 });
      await expect(
        page.getByText("This window is too narrow. Widen it to at least 1280 px."),
      ).toBeVisible();
      await page.screenshot({ path: `${out}/after-phone-shell-${theme}.png` });
      expect(mutations).toEqual([]);
      expect(errors).toEqual([]);
    } finally {
      await page.close();
    }
  },
  60000,
);

it.each(["dark", "day"])(
  "keeps long selectable content operable in an isolated 390px %s inbox",
  async (theme) => {
    const { page, mutations, errors } = await pageFor(theme, 390);
    try {
      await mount(page, "grants", true);
      await clipboard(page, "deny");
      await page.evaluate(() => {
        const state = window.packetTest.state(),
          proposal = state.changes["change-3"]?.proposal;
        if (!proposal) throw new Error("Missing proposal");
        window.packetTest.emit({
          type: "change.proposed",
          seq: state.lastSeq + 1,
          ts: state.clock ?? "",
          payload: {
            ...proposal,
            task: `Exact task\n${"Long wording 界 👁 العربية עברית ".repeat(120)}`,
            files: [
              {
                path: "path/".repeat(100) + "module.py:4242",
                status: "modified",
                lines_added: 1,
                lines_removed: 0,
              },
            ],
          },
        });
      });
      const disclosure = await preview(page, 1),
        text = disclosure.getByLabel("Complete approval packet");
      await expect(text).toContainText("module.py:4242");
      const copy = disclosure.getByRole("button", { name: "Copy packet" });
      await copy.focus();
      await page.keyboard.press("Space");
      await expect(disclosure.getByRole("status")).toContainText("Clipboard refused");
      await expect(disclosure.getByRole("status")).toContainText(
        "Select the packet text and copy it manually",
      );
      await expect(copy).toBeFocused();
      await text.focus();
      const selected = await text.evaluate((element) => {
        const range = document.createRange();
        range.selectNodeContents(element);
        const selection = window.getSelection();
        selection?.removeAllRanges();
        selection?.addRange(range);
        return selection?.toString();
      });
      expect(selected).toBe(await text.textContent());
      expect(await text.evaluate((e) => e.scrollWidth <= e.clientWidth)).toBe(true);
      expect(
        await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
      ).toBe(true);
      expect(await copy.evaluate((e) => e.getBoundingClientRect().height)).toBeGreaterThanOrEqual(
        44,
      );
      await page.screenshot({ path: `${out}/after-phone-isolated-denial-${theme}.png` });
      await text.evaluate((element) => {
        const span = [...element.querySelectorAll("span")].find((node) =>
          node.textContent.includes('"path": "path/path/'),
        );
        const node = span?.firstChild;
        if (!node?.textContent) throw new Error("Missing long-path text node");
        const range = document.createRange(),
          start = node.textContent.indexOf('"path": "path/path/');
        range.setStart(node, start);
        range.setEnd(
          node,
          node.textContent.indexOf("module.py:4242", start) + "module.py:4242".length,
        );
        const selection = window.getSelection();
        selection?.removeAllRanges();
        selection?.addRange(range);
        element.scrollTop +=
          range.getBoundingClientRect().top - element.getBoundingClientRect().top;
      });
      await expect(text).toBeFocused();
      await page.screenshot({ path: `${out}/after-phone-long-path-${theme}.png` });
      await disclosure.evaluate((element) => {
        element.style.zoom = "2";
      });
      expect(await text.evaluate((e) => e.scrollWidth <= e.clientWidth)).toBe(true);
      expect(
        await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
      ).toBe(true);
      await expect(text).toBeFocused();
      await copy.focus();
      await page.keyboard.press("Enter");
      await expect(disclosure.getByRole("status")).toContainText("Clipboard refused");
      await expect(copy).toBeFocused();
      expect(mutations).toEqual([]);
      expect(errors).toEqual([]);
    } finally {
      await page.close();
    }
  },
  60000,
);

it.each(["hold", "hold-deny"] as const)(
  "freezes one %s copy across new revisions/heads while preview and drafts follow the target",
  async (mode) => {
    const { page, mutations, errors } = await pageFor();
    try {
      await mount(page, "grants", true);
      await clipboard(page, mode);
      await preview(page, 1);
      const disclosure = page.locator(".approval-packet[open]"),
        pre = disclosure.getByLabel("Complete approval packet");
      await page.evaluate(() => {
        const card = window.packetTest.state().changeFacts["change-3"]?.at(-1)?.review_cards?.[0];
        if (!card) throw new Error("Missing card");
        window.packetTest.answers
          .getState()
          .answer(
            window.packetTest.draft("change-3"),
            JSON.stringify([card.node_id, card.question, card.evidence_seq]),
            "yes",
          );
      });
      await expect(pre).toContainText('"selected_answer": "yes"');
      const captured = await pre.textContent(),
        copy = disclosure.getByRole("button", { name: "Copy packet" });
      await copy.click();
      await expect(copy).toHaveAttribute("aria-disabled", "true");
      await copy.dispatchEvent("click");
      expect(await page.evaluate(() => window.packetClipboard.texts)).toEqual([captured]);
      await page.evaluate(() => {
        const state = window.packetTest.state(),
          proposal = state.changes["change-3"]?.proposal;
        if (!proposal) throw new Error("Missing proposal");
        window.packetTest.emit({
          type: "change.proposed",
          seq: state.lastSeq + 1,
          ts: state.clock ?? "",
          payload: {
            ...proposal,
            revision: 2,
            head_commit: "f".repeat(40),
            task: "Exact replacement task",
          },
        });
      });
      await expect(pre).toContainText("revision 2");
      await expect(pre).toContainText("Exact replacement task");
      await expect(pre).toContainText("No recorded facts for this exact change/revision/head");
      await expect(pre).not.toContainText('"selected_answer": "yes"');
      await expect(copy).toBeFocused();
      await page.evaluate(() => {
        window.packetClipboard.finish();
      });
      await expect(disclosure.getByRole("status")).toContainText(
        `${mode === "hold" ? "Copied" : "Clipboard refused"} Change change-3 · revision 1 · head`,
      );
      if (mode === "hold-deny")
        expect(
          await disclosure
            .getByRole("region", { name: "Captured packet refused by clipboard" })
            .locator("pre")
            .textContent(),
        ).toBe(captured);
      await expect(copy).toBeFocused();
      await expect(disclosure.getByRole("status")).not.toContainText("revision 2");
      expect(await page.evaluate(() => window.packetClipboard.texts)).toEqual([captured]);
      await clipboard(page);
      const replacement = await pre.textContent();
      await copy.click();
      expect(await page.evaluate(() => window.packetClipboard.texts)).toEqual([replacement]);
      await expect(disclosure.getByRole("status")).toContainText(
        `revision 2 · head ${"f".repeat(40)}`,
      );
      expect(mutations).toEqual([]);
      expect(errors).toEqual([]);
    } finally {
      await page.close();
    }
  },
  60000,
);

it("updates proposed grant scope from existing choices without creating it", async () => {
  const { page, mutations, errors } = await pageFor();
  try {
    await mount(page, "grants", true);
    await clipboard(page);
    const disclosure = await preview(page),
      pre = disclosure.getByLabel("Complete approval packet");
    await page.getByText("Don't ask again", { exact: false }).click();
    await page.getByRole("radio", { name: /This module/ }).check();
    await expect(pre).toContainText('"kind": "module"');
    await expect(pre).toContainText("This grant does not exist yet");
    await page.getByRole("radio", { name: "This run", exact: true }).check();
    await expect(pre).toContainText('"kind": "run"');
    await expect(pre).not.toContainText('"kind": "module"');
    const text = await pre.textContent();
    await disclosure.getByRole("button", { name: "Copy packet" }).click();
    expect(await page.evaluate(() => window.packetClipboard.texts)).toEqual([text]);
    await page.getByText("Don't ask again", { exact: false }).click();
    await expect(pre).toContainText("No proposed grant selected");
    expect(mutations).toEqual([]);
    expect(errors).toEqual([]);
  } finally {
    await page.close();
  }
}, 60000);

it("copies every category in replay and handles an absent clipboard API", async () => {
  const { page, mutations, errors } = await pageFor();
  try {
    await mount(page, "kinds", true, true);
    await clipboard(page);
    const count = await page.locator(".approval-packet").count();
    expect(count).toBe(5);
    const copied: string[] = [];
    for (let row = 0; row < count; row++) {
      const disclosure = await preview(page, row),
        text = await disclosure.getByLabel("Complete approval packet").textContent();
      expect(text).toContain("Replay/history: no decision commands are available");
      await disclosure.getByRole("button", { name: "Copy packet" }).click();
      await expect(disclosure.getByRole("status")).toContainText("Copied");
      copied.push(text ?? "");
    }
    expect(await page.evaluate(() => window.packetClipboard.texts)).toEqual(copied);
    for (const kind of [
      "change",
      "checks_unavailable",
      "examples_before_code",
      "follow_main",
      "lead_plan",
      "review_card",
      "revert_needs_you",
      "risky_area",
    ])
      expect(copied.join("\n")).toContain(`\n${kind}\n`);
    await page.locator(".inbox-answer > summary").first().click();
    await expect(
      page.getByRole("button", { name: "Approve and merge", exact: true }),
    ).toBeDisabled();
    await clipboard(page, "absent");
    await packet(page).getByRole("button", { name: "Copy packet" }).click();
    await expect(packet(page).getByRole("status")).toContainText("Clipboard refused");
    await expect(packet(page).getByLabel("Complete approval packet")).toBeVisible();
    expect(mutations).toEqual([]);
    expect(errors).toEqual([]);
  } finally {
    await page.close();
  }
}, 60000);
