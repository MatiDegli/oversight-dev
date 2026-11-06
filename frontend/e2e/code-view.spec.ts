import { expect, test, type Page } from "@playwright/test";

const view = (page: Page, name: string) =>
  page.getByRole("group", { name: "Workspace view" }).getByRole("button", { name, exact: true });

test("three presets share the production replay session, file tabs and graph; Code returns on reload", async ({
  page,
}) => {
  const backend: string[] = [],
    errors: string[] = [],
    navigations: string[] = [];
  page.on("request", (request) => {
    if (/\/(agents|changes|events|files|graph|health|tree)([/?]|$)/.test(request.url()))
      backend.push(request.url());
  });
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/oversight/");
  await expect(view(page, "Chat")).toHaveAttribute("aria-pressed", "true");
  await view(page, "Code").click();
  await expect(page.getByLabel("Repository graph", { exact: true })).toHaveCount(0);
  // Use production transport/recordedFiles; do not install a fixture owner or intercept commands.
  await page.getByRole("slider", { name: "Position in the recording" }).press("End");
  const sidebar = page.getByRole("complementary", { name: "Files sidebar" });
  await expect(sidebar).toContainText("Recorded files");
  await sidebar.getByRole("treeitem", { name: "shop", exact: true }).click();
  await sidebar.getByRole("treeitem", { name: "pricing.py", exact: true }).click();
  const file = page.getByRole("complementary", { name: "File view", exact: true });
  await expect(file.locator(".monaco-editor .view-lines")).toBeVisible();
  const editor = await file.locator(".monaco-editor").elementHandle();
  const seq = await page.locator("#root").getAttribute("data-seq");
  page.on("framenavigated", (frame) => navigations.push(frame.url()));
  for (const name of ["Chat", "Oversight", "Code", "Oversight", "Chat", "Code"]) {
    await view(page, name).click();
    await expect(view(page, name)).toBeFocused();
    await expect(page.locator("#root")).toHaveAttribute("data-seq", seq ?? "");
    await expect(page.getByRole("tab", { name: "pricing.py", exact: true })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    expect(await editor.evaluate((node) => node.isConnected)).toBe(true);
    if (name !== "Oversight") {
      await expect(page.locator(".oversight-stage")).toHaveAttribute("inert", "");
      await expect(page.getByLabel("Repository graph", { exact: true })).toBeHidden();
    }
  }
  expect(navigations).toEqual([]);
  await page.reload();
  await expect(view(page, "Code")).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByLabel("Repository graph", { exact: true })).toHaveCount(0);
  // The root deployment has independent preferences from /oversight/ on the same origin.
  await page.goto("/");
  await expect(view(page, "Chat")).toHaveAttribute("aria-pressed", "true");
  expect({ backend, errors }).toEqual({ backend: [], errors: [] });
});
