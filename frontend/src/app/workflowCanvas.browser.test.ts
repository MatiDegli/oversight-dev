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
it.each(["blur", "graph click", "blur with immediate arrival"])(
  "does not restore a detail action after %s moves focus to the body",
  async (action) => {
    const page = await harness.open();
    try {
      await canvasSteps(page).nth(1).click();
      const review = workflow(page).getByRole("button", { name: "Review change" });
      await review.focus();
      await check(review).toBeFocused();
      if (action === "graph click")
        await page
          .getByLabel("Repository graph", { exact: true })
          .click({ position: { x: 2, y: 2 } });
      else
        await review.evaluate((button: HTMLButtonElement, immediate) => {
          button.blur();
          if (immediate) window.canvasTest.reviseWorkflow();
        }, action === "blur with immediate arrival");
      expect(await page.evaluate(() => document.activeElement === document.body)).toBe(true);
      if (action !== "blur with immediate arrival")
        await page.evaluate(() => {
          window.canvasTest.reviseWorkflow();
        });
      await check(workflow(page).getByText("Select a step to see its evidence.")).toBeVisible();
      await check(review).toHaveCount(0);
      await check(
        workflow(page).getByRole("button", { name: "Close", exact: true }),
      ).not.toBeFocused();
      expect(await page.evaluate(() => document.activeElement === document.body)).toBe(true);
      await page.keyboard.press("Space");
      await check(workflow(page)).toBeVisible();
    } finally {
      await page.close();
    }
  },
);
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
      expect(await workflow(page).locator(".workflow-canvas svg > path").count()).toBe(
        proof.live.edges.length,
      );
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

it.each([390, 1280])(
  "keeps dense multilingual labels inside nodes at double text size at %i",
  async (width) => {
    const page = await harness.open(width);
    try {
      for (const task of ["数量検証".repeat(16), "تحقق من الكمية 🛒 acción ".repeat(6)]) {
        await page.evaluate(
          async ({ task, width }) => {
            await window.canvasTest.mountTextCanvas(task, width === 390 ? "Chat" : "Oversight");
            for (const [token, size] of [
              ["body", 30],
              ["label", 28],
              ["caption", 26],
            ] as const)
              document.documentElement.style.setProperty(`--${token}-size`, `${String(size)}px`);
          },
          { task, width },
        );
        if (width === 390)
          await page.addStyleTag({
            content:
              '.workflow-panel[data-phone="true"] .workflow-step > span:nth-child(2) { font-size: 32px; }',
          });
        await page.getByRole("button", { name: "Open workflow", exact: true }).first().click();
        await check(canvasSteps(page)).toHaveCount(4);
        expect(
          await canvasSteps(page).evaluateAll((buttons) =>
            buttons.every((button) => {
              const bounds = button.getBoundingClientRect();
              return [...button.children].every((child) => {
                const text = child.getBoundingClientRect();
                return (
                  text.top >= bounds.top &&
                  text.bottom <= bounds.bottom &&
                  text.left >= bounds.left &&
                  text.right <= bounds.right
                );
              });
            }),
          ),
        ).toBe(true);
      }
    } finally {
      await page.close();
    }
  },
);

it("reattaches pixel-sized arrowheads after text growth and viewport resizing without moving focus", async () => {
  const page = await harness.open(390);
  try {
    const edge = workflow(page).locator(".workflow-canvas svg > path").first();
    await check(edge).toHaveAttribute("d", /M .+ L .+/);
    const initial = await edge.getAttribute("d");
    await canvasSteps(page).first().focus();
    await page.evaluate(() => {
      document.documentElement.style.setProperty("--caption-size", "32px");
    });
    await check(edge).not.toHaveAttribute("d", initial ?? "");
    const grown = await edge.getAttribute("d");
    await page.setViewportSize({ width: 430, height: 844 });
    await check(edge).not.toHaveAttribute("d", grown ?? "");
    await check(canvasSteps(page).first()).toBeFocused();
    const geometry = await workflow(page).evaluate((panel) => {
      const svg = panel.querySelector<SVGSVGElement>(".workflow-canvas svg");
      const path = svg?.querySelector<SVGPathElement>(":scope > path");
      const from = panel.querySelector("[data-step-key]")?.getBoundingClientRect();
      const to = panel.querySelectorAll("[data-step-key]")[2]?.getBoundingClientRect();
      if (!svg || !path || !from || !to) throw new Error("Missing dependency geometry");
      const bounds = svg.getBoundingClientRect();
      const start = path.getPointAtLength(0);
      const end = path.getPointAtLength(path.getTotalLength());
      return {
        width: svg.viewBox.baseVal.width,
        renderedWidth: bounds.width,
        start: [start.x + bounds.left, start.y + bounds.top],
        end: [end.x + bounds.left, end.y + bounds.top],
        expectedStart: [(from.left + from.right) / 2, from.bottom],
        expectedEnd: [(to.left + to.right) / 2, to.top - 8],
        markerWidth: svg.querySelector("marker")?.getAttribute("markerWidth"),
      };
    });
    expect(geometry.width).toBeCloseTo(geometry.renderedWidth, 1);
    geometry.start.forEach((value, index) => {
      expect(value).toBeCloseTo(geometry.expectedStart[index] ?? 0, 1);
    });
    geometry.end.forEach((value, index) => {
      expect(value).toBeCloseTo(geometry.expectedEnd[index] ?? 0, 1);
    });
    expect(geometry.markerWidth).toBe("8");
  } finally {
    await page.close();
  }
});
