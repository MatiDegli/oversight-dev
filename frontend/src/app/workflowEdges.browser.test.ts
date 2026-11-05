import { expect as check } from "@playwright/test";
import { afterAll, beforeAll, expect, it } from "vitest";
import { canvasSteps, workflow, workflowBrowser } from "./workflowCanvas.browser.support";
import { edgeContacts } from "./workflow/edgeCollision.browser.support";

let harness: Awaited<ReturnType<typeof workflowBrowser>>;
beforeAll(async () => {
  harness = await workflowBrowser();
}, 60_000);
afterAll(async () => {
  await harness.close();
});

it.each([1920, 1280, 390])(
  "routes every large-plan dependency around unrelated steps at %i",
  async (width) => {
    const page = await harness.open(width);
    try {
      await page.evaluate(async (width) => {
        await window.canvasTest.mountWorkflow({
          scene: "large",
          layout: width === 390 ? "Chat" : "Oversight",
        });
      }, width);
      await page.getByRole("button", { name: "Open workflow", exact: true }).first().click();
      await check(canvasSteps(page)).toHaveCount(8);
      const paths = workflow(page).locator(".workflow-canvas svg > path");
      await check(paths).toHaveCount(8);
      await check(paths.last()).toHaveAttribute("d", /M .+ L .+/);
      for (const scale of [1, 2]) {
        await page.evaluate((scale) => {
          document.documentElement.style.setProperty("--label-size", `${String(14 * scale)}px`);
        }, scale);
        await check
          .poll(() =>
            workflow(page).evaluate((panel) => {
              const svg = panel.querySelector<SVGSVGElement>(".workflow-canvas svg");
              if (!svg) throw new Error("Missing dependency drawing");
              const origin = svg.getBoundingClientRect();
              const boxes = [...panel.querySelectorAll("[data-step-key]")].map((node) =>
                node.getBoundingClientRect(),
              );
              return [...svg.querySelectorAll<SVGPathElement>(":scope > path")].flatMap((path) => {
                const label = path.querySelector("title")?.textContent ?? "";
                const [child, parent] = (label.match(/\d+/g) ?? []).map(Number);
                const collisions = new Set<number>();
                for (let distance = 0; distance <= path.getTotalLength(); distance++) {
                  const point = path.getPointAtLength(distance);
                  const x = point.x + origin.left;
                  const y = point.y + origin.top;
                  boxes.forEach((box, index) => {
                    if (index + 1 === parent || index + 1 === child) return;
                    if (x >= box.left && x <= box.right && y >= box.top && y <= box.bottom)
                      collisions.add(index + 1);
                  });
                }
                return [...collisions].map((step) => `${label} crosses step ${String(step)}`);
              });
            }),
          )
          .toEqual([]);
        expect(await workflow(page).evaluate((node) => node.scrollWidth <= node.clientWidth)).toBe(
          true,
        );
        expect(await edgeContacts(workflow(page))).toEqual([]);
        expect(
          await workflow(page).evaluate((panel) => {
            const svg = panel.querySelector(".workflow-canvas svg");
            const bodies = [...(svg?.querySelectorAll<SVGPathElement>(":scope > path") ?? [])];
            const arrows = [...(svg?.querySelectorAll<SVGPathElement>(":scope > g > path") ?? [])];
            return (
              bodies.length === arrows.length &&
              bodies.every((body, index) => {
                const arrow = arrows[index];
                if (!arrow?.hasAttribute("marker-end") && !arrow?.style.markerEnd) {
                  // React writes markerEnd as the SVG marker-end attribute.
                  return false;
                }
                const tip = body.getPointAtLength(body.getTotalLength());
                const arrowTip = arrow.getPointAtLength(arrow.getTotalLength());
                return (
                  !body.hasAttribute("marker-end") &&
                  Math.hypot(tip.x - arrowTip.x, tip.y - arrowTip.y) < 0.1 &&
                  Math.abs(arrow.getTotalLength() - 1) < 0.1
                );
              })
            );
          }),
        ).toBe(true);
      }
    } finally {
      await page.close();
    }
  },
);
