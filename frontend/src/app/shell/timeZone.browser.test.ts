import { fileURLToPath } from "node:url";
import { expect as check, type Browser } from "@playwright/test";
import { createServer, type ViteDevServer } from "vite";
import { afterAll, beforeAll, expect, it } from "vitest";
import { launchBrowser } from "../../browserLaunch.support";
import { openOversight } from "../../workspaceView.browser.support";
import type {} from "../shell.browser.fixture";

let server: ViteDevServer, browser: Browser, html: string, url: string;
beforeAll(async () => {
  server = await createServer({
    root: fileURLToPath(new URL("../../../", import.meta.url)),
    server: { host: "127.0.0.1", port: 0, strictPort: false },
  });
  html = await server.transformIndexHtml(
    "/",
    '<html><body><script type="module">import "/src/theme/index.css"; import { shellTest } from "/src/app/shell.browser.fixture.tsx"; window.shellTest = shellTest;</script></body></html>',
  );
  await server.listen();
  url = server.resolvedUrls?.local[0] ?? "";
  browser = await launchBrowser();
}, 60_000);
afterAll(async () => {
  await browser.close();
  await server.close();
});

it("renders the first Activity fixture clock in the browser's UTC zone", async () => {
  const page = await browser.newPage({
    viewport: { width: 1280, height: 800 },
    reducedMotion: "reduce",
    timezoneId: "UTC",
  });
  try {
    await page.route("**/", (route) => route.fulfill({ contentType: "text/html", body: html }));
    await page.goto(url);
    await page.waitForFunction(() => !!window.shellTest);
    await page.evaluate(() => {
      window.shellTest.mount();
    });
    await openOversight(page);
    await page.keyboard.press("Control+Backquote");
    await page.getByRole("tab", { name: "Activity log", exact: true }).click();
    const time = page.getByRole("list", { name: "Run activity" }).locator("time").first();
    await check(time).toBeVisible();
    expect(await time.textContent()).toBe("14:03:16 UTC");
  } finally {
    await page.close();
  }
});

async function preferencePage(zone: string, stored?: string, blocked?: "read" | "write") {
  const page = await browser.newPage({
    viewport: { width: 390, height: 844 },
    reducedMotion: "reduce",
    timezoneId: zone,
  });
  const preferenceHtml = await server.transformIndexHtml(
    "/time-zone",
    '<html><body class="bg-page"><div id="root"></div><script type="module">import "/src/app/shell/timeZone.browser.fixture.tsx";</script></body></html>',
  );
  await page.addInitScript(
    ({ stored, blocked }) => {
      if (stored !== undefined && localStorage.getItem("oversight.timeZone") === null)
        localStorage.setItem("oversight.timeZone", stored);
      if (blocked === "read")
        Object.defineProperty(window, "localStorage", {
          get() {
            throw new Error("blocked");
          },
        });
      if (blocked === "write")
        Storage.prototype.setItem = () => {
          throw new Error("refused");
        };
    },
    { stored, blocked },
  );
  await page.route("**/", (route) =>
    route.fulfill({ contentType: "text/html", body: preferenceHtml }),
  );
  await page.goto(url);
  await check(page.getByRole("region", { name: "Time zone", exact: true })).toBeVisible();
  return page;
}

it.each([
  ["UTC", "14:03:16 UTC"],
  ["Asia/Tokyo", "23:03:16 GMT+9"],
])("resolves automatic clocks in emulated %s", async (zone, expected) => {
  const page = await preferencePage(zone);
  try {
    await check(
      page.getByText(`Effective time zone: ${zone} · Automatic`, { exact: true }),
    ).toBeVisible();
    await check(page.locator('[data-clock="activity"] time').first()).toHaveText(expected);
  } finally {
    await page.close();
  }
});

it("updates every mounted clock without events, persists, validates and returns to automatic with keyboard focus", async () => {
  const page = await preferencePage("UTC");
  try {
    const field = page.getByRole("textbox", { name: "IANA time zone override" });
    const effective = page.getByText("Effective time zone:", { exact: false });
    const sequences = await page.evaluate(() => window.timeZoneFixture.sequences);
    const originalDates = await page
      .locator("time[datetime]")
      .evaluateAll((times) => times.map((time) => time.getAttribute("datetime")));
    const staticText = await page.locator('[data-clock="conversation"]').innerText();
    await field.fill("America/Argentina/Buenos_Aires");
    await field.press("Enter");
    await check(field).toBeFocused();
    await check(effective).toHaveText(
      "Effective time zone: America/Argentina/Buenos_Aires · Override",
    );
    await check(page.locator('[data-clock="activity"] time').first()).toHaveText("11:03:16 ART");
    await check(page.locator('[data-clock="inbox"] time').first()).toHaveText("15:04 ART");
    await check(page.locator('[data-clock="plans"] time').first()).toHaveText("15:00 ART");
    for (const surface of ["grants", "card", "review"]) {
      await check(page.locator(`[data-clock="${surface}"]`)).toContainText(
        surface === "grants" ? "15:03 ART" : "given 15:03 ART",
      );
    }
    for (const surface of ["conversation", "chat-proposal", "chat-merge"]) {
      const times = page.locator(`[data-clock="${surface}"] time`);
      expect(await times.count()).toBeGreaterThan(0);
      expect(await times.allTextContents()).toEqual(
        Array<string>(await times.count()).fill(surface === "chat-merge" ? "15:03" : "11:03"),
      );
    }
    const ba = await page.locator("time").allTextContents();
    await field.fill("Asia/Kolkata");
    await check(field).toBeFocused();
    await check(page.locator('[data-clock="activity"] time').first()).toHaveText(
      "19:33:16 GMT+5:30",
    );
    await check(page.locator('[data-clock="inbox"] time').first()).toHaveText("23:34 GMT+5:30");
    await check(page.locator('[data-clock="plans"] time').first()).toHaveText("23:30 GMT+5:30");
    for (const surface of ["grants", "card", "review"])
      await check(page.locator(`[data-clock="${surface}"]`)).toContainText("23:33 GMT+5:30");
    for (const surface of ["conversation", "chat-proposal", "chat-merge"]) {
      const times = page.locator(`[data-clock="${surface}"] time`);
      expect(await times.allTextContents()).toEqual(
        Array<string>(await times.count()).fill(surface === "chat-merge" ? "23:33" : "19:33"),
      );
    }
    expect(await page.locator("time").allTextContents()).not.toEqual(ba);
    expect(
      await page
        .locator("time[datetime]")
        .evaluateAll((times) => times.map((time) => time.getAttribute("datetime"))),
    ).toEqual(originalDates);
    expect(await page.evaluate(() => window.timeZoneFixture.sequences)).toEqual(sequences);
    // Durations and ages are left in the conversation; changing clocks must not change their text.
    expect(staticText).toContain("Task from you");
    await field.fill("Mars/Olympus");
    await field.press("Enter");
    await check(field).toBeFocused();
    await check(field).toHaveAttribute("aria-invalid", "true");
    await check(
      page.getByRole("status").filter({ hasText: "Time zone not recognized" }),
    ).toBeVisible();
    await check(effective).toContainText("Asia/Kolkata · Override");
    await page.reload();
    await check(field).toHaveValue("Asia/Kolkata");
    await check(effective).toContainText("Asia/Kolkata · Override");
    const automatic = page.getByRole("button", { name: "Automatic", exact: true });
    await automatic.focus();
    await page.keyboard.press("Enter");
    await check(automatic).toBeFocused();
    await check(effective).toHaveText("Effective time zone: UTC · Automatic");
    expect(await page.evaluate(() => localStorage.getItem("oversight.timeZone"))).toBe("automatic");
    await page.reload();
    await check(effective).toContainText("UTC · Automatic");
  } finally {
    await page.close();
  }
});

it.each(["Mars/Olympus", '{"zone":"UTC"}'])("falls back from invalid stored %s", async (stored) => {
  const page = await preferencePage("Asia/Tokyo", stored);
  try {
    await check(page.getByText("Effective time zone:", { exact: false })).toHaveText(
      "Effective time zone: Asia/Tokyo · Automatic",
    );
  } finally {
    await page.close();
  }
});

it.each(["", "   ", "東京/🕒"])(
  "explains an invalid override %j on blur without changing the last valid choice",
  async (draft) => {
    const page = await preferencePage("UTC", "Asia/Kolkata");
    try {
      const field = page.getByRole("textbox", { name: "IANA time zone override" });
      await field.fill(draft);
      await field.press("Tab");
      await check(page.getByRole("button", { name: "Apply time zone" })).toBeFocused();
      await check(field).toHaveValue(draft);
      await check(field).toHaveAttribute("aria-invalid", "true");
      await check(
        page.getByRole("status").filter({ hasText: "Time zone not recognized" }),
      ).toContainText("Enter an IANA name such as Europe/London, or choose Automatic.");
      await check(page.getByText("Effective time zone:", { exact: false })).toContainText(
        "Asia/Kolkata · Override",
      );
      await check(page.locator('[data-clock="activity"] time').first()).toHaveText(
        "19:33:16 GMT+5:30",
      );
      expect(await page.evaluate(() => localStorage.getItem("oversight.timeZone"))).toBe(
        "Asia/Kolkata",
      );
      await field.fill("Europe/London");
      await check(field).toBeFocused();
      await check(field).toHaveAttribute("aria-invalid", "false");
      await check(page.getByText("Effective time zone:", { exact: false })).toContainText(
        "Europe/London · Override",
      );
    } finally {
      await page.close();
    }
  },
);

it.each(["read", "write"] as const)(
  "applies a session override when storage refuses %s",
  async (blocked) => {
    const page = await preferencePage("UTC", undefined, blocked);
    try {
      const field = page.getByRole("textbox", { name: "IANA time zone override" });
      await field.fill("Asia/Kolkata");
      await check(field).toBeFocused();
      await check(page.locator('[data-clock="activity"] time').first()).toHaveText(
        "19:33:16 GMT+5:30",
      );
      await check(page.getByRole("status").filter({ hasText: "could not save" })).toBeVisible();
      await page.reload();
      await check(page.getByText("Effective time zone:", { exact: false })).toContainText(
        "UTC · Automatic",
      );
    } finally {
      await page.close();
    }
  },
);

it.each([390, 1280])(
  "keeps the Settings control usable in both themes at %s px, including replay",
  async (width) => {
    const page = await browser.newPage({
      viewport: { width, height: 844 },
      timezoneId: "UTC",
      reducedMotion: "reduce",
    });
    const errors: string[] = [],
      writes: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    page.on("request", (request) => {
      if (request.method() !== "GET") writes.push(request.url());
    });
    try {
      const settingsHtml = await server.transformIndexHtml(
        "/settings-clock",
        '<html><body><div id="root" style="height:100vh"></div><script type="module">import "/src/theme/index.css"; import "/src/app/shell/settingsEditor.browser.fixture.tsx";</script></body></html>',
      );
      await page.route("**/settings", (route) =>
        route.fulfill({ json: { settings: [], restart_required: false, apply: "server_restart" } }),
      );
      await page.route("**/", (route) =>
        route.fulfill({ contentType: "text/html", body: settingsHtml }),
      );
      await page.goto(url);
      await page.getByRole("button", { name: "Settings", exact: true }).click();
      const section = page.getByRole("region", { name: "Time zone", exact: true });
      const field = section.getByRole("textbox");
      await check(field).toHaveCSS("font-size", "15px");
      await field.fill("America/Argentina/ComodRivadavia");
      await check(field).toBeFocused();
      await check(section).toContainText("America/Argentina/ComodRivadavia · Override");
      const { mkdir } = await import("node:fs/promises");
      const shots = fileURLToPath(new URL("../../../../.shots/local-time/", import.meta.url));
      await mkdir(shots, { recursive: true });
      for (const theme of ["dark", "day"]) {
        await page.evaluate((theme) => {
          document.documentElement.dataset.theme = theme;
        }, theme);
        await field.focus();
        await page.keyboard.press("Tab");
        await check(section.getByRole("button", { name: "Apply time zone" })).toBeFocused();
        const ring = await section
          .getByRole("button", { name: "Apply time zone" })
          .evaluate((element) => getComputedStyle(element).outlineStyle);
        expect(ring).toBe("solid");
        const overflow = await section.evaluate(
          (element) => element.scrollWidth > element.clientWidth,
        );
        expect(overflow).toBe(false);
        await page.evaluate(() => document.fonts.ready);
        await section.screenshot({ path: `${shots}settings-${theme}-${String(width)}.png` });
      }
      await page.evaluate(() => {
        window.settingsReplay();
      });
      await page.getByRole("button", { name: "Settings", exact: true }).click();
      await field.fill("Asia/Kolkata");
      await check(section).toContainText("Asia/Kolkata · Override");
      await section.getByRole("button", { name: "Automatic", exact: true }).click();
      await check(section).toContainText("UTC · Automatic");
      expect(writes).toEqual([]);
      expect(errors).toEqual([]);
    } finally {
      await page.close();
    }
  },
);

it("keeps separate browser contexts isolated and gives a stored override precedence", async () => {
  const first = await preferencePage("UTC", "Asia/Kolkata");
  const second = await preferencePage("Asia/Tokyo");
  try {
    await check(first.getByText("Effective time zone:", { exact: false })).toContainText(
      "Asia/Kolkata · Override",
    );
    await check(second.getByText("Effective time zone:", { exact: false })).toContainText(
      "Asia/Tokyo · Automatic",
    );
    await first.getByRole("textbox").fill("Europe/London");
    await check(second.getByText("Effective time zone:", { exact: false })).toContainText(
      "Asia/Tokyo · Automatic",
    );
  } finally {
    await first.close();
    await second.close();
  }
});
