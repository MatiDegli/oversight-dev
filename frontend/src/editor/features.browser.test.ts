import { expect as browserExpect } from "@playwright/test";
import type { Page } from "@playwright/test";
import { expect, it } from "vitest";

import { data, expectDiff, render, withPage } from "./LiveDiff.browser.support";

async function file(page: Page, content: string) {
  await page.evaluate((content) => {
    window.panelTest.renderFile("main.py", content);
  }, content);
  await browserExpect
    .poll(() =>
      page.evaluate((content) => {
        const editor = window.panelTest.monaco.editor.getEditors()[0];
        return (
          editor?.getModel()?.getValue() === content &&
          !editor.getOption(window.panelTest.monaco.editor.EditorOption.readOnly)
        );
      }, content),
    )
    .toBe(true);
  await page.evaluate(() => window.panelTest.monaco.editor.getEditors()[0]?.focus());
}

async function action(page: Page, id: string) {
  await page.evaluate(async (id) => {
    const editor = window.panelTest.monaco.editor.getEditors()[0];
    const action = editor?.getAction(id);
    if (!action) throw new Error(`Missing editor action: ${id}`);
    await action.run();
  }, id);
}

const value = (page: Page) =>
  page.evaluate(() => window.panelTest.monaco.editor.getEditors()[0]?.getValue());
const position = (page: Page) =>
  page.evaluate(() => window.panelTest.monaco.editor.getEditors()[0]?.getPosition());

it("finds real matches, navigates both ways, and restores editor focus on Escape", async () => {
  await withPage(async (page) => {
    await file(page, "needle = 1\nother = 2\nneedle = 3");
    await page.keyboard.press("Control+f");
    const widget = page.locator(".find-widget.visible");
    const input = widget.locator(".monaco-findInput .input").first();
    await input.fill("needle");
    await browserExpect(widget.locator(".matchesCount")).toHaveText("1 of 2");
    // Find-on-type counts matches before selecting one. First Enter lands on the first match.
    await page.keyboard.press("Enter");
    await browserExpect.poll(() => position(page)).toMatchObject({ lineNumber: 1, column: 7 });
    await page.keyboard.press("Enter");
    await browserExpect(widget.locator(".matchesCount")).toHaveText("2 of 2");
    expect((await position(page))?.lineNumber).toBe(3);
    await page.keyboard.press("Shift+Enter");
    await browserExpect(widget.locator(".matchesCount")).toHaveText("1 of 2");
    expect((await position(page))?.lineNumber).toBe(1);
    await page.keyboard.press("Escape");
    await browserExpect(widget).toHaveCount(0);
    expect(
      await page.evaluate(() => window.panelTest.monaco.editor.getEditors()[0]?.hasTextFocus()),
    ).toBe(true);
  });
}, 60_000);

it("folds ordinary Python code and unfolds it without changing the model", async () => {
  await withPage(async (page) => {
    const content = "def price():\n    subtotal = 1\n    return subtotal\n\nprice()";
    await file(page, content);
    const folding = page.locator(".monaco-editor .codicon-folding-expanded").first();
    await browserExpect(folding).toBeAttached();
    await page.keyboard.press("Control+Shift+[");
    await browserExpect
      .poll(() =>
        page.evaluate(
          () =>
            window.panelTest.monaco.editor
              .getEditors()[0]
              ?.getScrolledVisiblePosition({ lineNumber: 2, column: 1 })?.height,
        ),
      )
      .toBe(0);
    await browserExpect(page.locator(".inline-folded")).toBeVisible();
    await page.keyboard.press("Control+Shift+]");
    await browserExpect
      .poll(() =>
        page.evaluate(
          () =>
            window.panelTest.monaco.editor
              .getEditors()[0]
              ?.getScrolledVisiblePosition({ lineNumber: 2, column: 1 })?.height,
        ),
      )
      .toBe(21);
    expect(await value(page)).toBe(content);
  });
}, 60_000);

it("keeps computed inline hunks and reveals unchanged context", async () => {
  await withPage(async (page) => {
    await render(page);
    await expectDiff(page, 8);
    expect(
      await page.evaluate(() =>
        window.panelTest
          .current()
          ?.getModifiedEditor()
          .getOption(window.panelTest.monaco.editor.EditorOption.readOnly),
      ),
    ).toBe(true);
    await browserExpect(page.locator(".modified .line-insert").first()).toBeVisible();
    const disclosure = page
      .locator('.modified .diff-hidden-lines [title="Show Unchanged Region"]')
      .last();
    await browserExpect(disclosure).toBeVisible();
    await disclosure.click();
    await page.evaluate(() =>
      window.panelTest.current()?.getModifiedEditor().revealLineInCenter(51),
    );
    await browserExpect(
      page.locator(".modified .view-line").filter({ hasText: "first_50 = 50" }),
    ).toBeVisible();
    expect(
      await page.evaluate(() => window.panelTest.current()?.getModel()?.modified.getValue()),
    ).toBe(data.modified);
    await page.evaluate(() => window.panelTest.current()?.getModifiedEditor().focus());
    await page.keyboard.press("F7");
    const accessible = page.getByRole("list", { name: /^Accessible Diff Viewer/ });
    await browserExpect(accessible).toBeVisible();
    await browserExpect(accessible).toContainText("first_7 = 99");
    await page.keyboard.press("Escape");
    await browserExpect(accessible).toBeHidden();
  });
}, 60_000);

it.each([
  ["editor.action.commentLine", "x = 1", "# x = 1"],
  ["editor.action.transposeLetters", "ab", "ba"],
  ["editor.action.copyLinesDownAction", "x = 1", "x = 1\nx = 1"],
  ["editor.action.insertFinalNewLine", "x = 1", "x = 1\n"],
  ["editor.action.indentLines", "x = 1", "    x = 1"],
  ["editor.action.inPlaceReplace.up", "1", "0"],
])(
  "edits with %s and supports undo/redo",
  async (id, content, expected) => {
    await withPage(async (page) => {
      await file(page, content);
      if (id === "editor.action.transposeLetters") await page.keyboard.press("ArrowRight");
      await action(page, id);
      await browserExpect.poll(() => value(page)).toBe(expected);
      await page.keyboard.press("Control+z");
      await browserExpect.poll(() => value(page)).toBe(content);
      await page.keyboard.press("Control+y");
      await browserExpect.poll(() => value(page)).toBe(expected);
    });
  },
  60_000,
);

it("retains line, word, subword, anchor, smart and multicursor selection", async () => {
  await withPage(async (page) => {
    await file(page, "camelCase = camelCase\nsecond = 2");
    await page.evaluate(() =>
      window.panelTest.monaco.editor.getEditors()[0]?.trigger("test", "cursorWordPartRight", {}),
    );
    expect((await position(page))?.column).toBe(6);
    await page.keyboard.press("Control+ArrowRight");
    expect((await position(page))?.column).toBe(10);
    await action(page, "editor.action.setSelectionAnchor");
    await page.keyboard.press("End");
    await action(page, "editor.action.goToSelectionAnchor");
    expect((await position(page))?.column).toBe(10);
    await action(page, "cursorUndo");
    expect((await position(page))?.column).toBe(22);
    await page.keyboard.press("Home");
    await action(page, "editor.action.smartSelect.expand");
    await action(page, "editor.action.addSelectionToNextFindMatch");
    expect(
      await page.evaluate(
        () => window.panelTest.monaco.editor.getEditors()[0]?.getSelections()?.length,
      ),
    ).toBe(2);
    await page.keyboard.press("Escape");
    await page.keyboard.press("Control+l");
    expect(
      await page.evaluate(() => {
        const editor = window.panelTest.monaco.editor.getEditors()[0];
        const selection = editor?.getSelection();
        return selection && editor?.getModel()?.getValueInRange(selection);
      }),
    ).toBe("camelCase = camelCase\n");
  });
}, 60_000);

it("offers worker-backed word suggestions and inserts the selected completion", async () => {
  await withPage(async (page) => {
    await file(page, "distinctive_variable = 1\ndistinctive_");
    await page.keyboard.press("Control+End");
    await page.keyboard.press("Control+Space");
    await browserExpect(page.locator(".suggest-widget.visible")).toBeVisible();
    await browserExpect(page.locator(".suggest-widget .monaco-list-row.focused")).toContainText(
      "distinctive_variable",
    );
    await page.keyboard.press("Tab");
    await browserExpect
      .poll(() => value(page))
      .toBe("distinctive_variable = 1\ndistinctive_variable");
  });
}, 60_000);

it("retains go-to-line, command/help access, token inspection and font zoom", async () => {
  await withPage(async (page) => {
    await file(page, "first = 1\nsecond = 2\nthird = 3");
    await page.keyboard.press("Control+g");
    const quick = page.locator(".quick-input-widget input");
    await quick.fill(":3");
    await page.keyboard.press("Enter");
    expect((await position(page))?.lineNumber).toBe(3);
    await page.keyboard.press("F1");
    await browserExpect(quick).toBeVisible();
    await quick.fill("");
    await browserExpect(page.locator(".quick-input-widget")).toContainText("Go to Line");
    await page.keyboard.press("Escape");
    await action(page, "editor.action.forceRetokenize");
    await action(page, "editor.action.inspectTokens");
    await browserExpect(page.locator(".tokens-inspect-widget")).toBeVisible();
    await page.keyboard.press("Escape");
    await action(page, "editor.action.fontZoomIn");
    expect(
      await page.evaluate(() =>
        window.panelTest.monaco.editor
          .getEditors()[0]
          ?.getOption(window.panelTest.monaco.editor.EditorOption.fontSize),
      ),
    ).toBe(16.5);
    await action(page, "editor.action.fontZoomReset");
    expect(
      await page.evaluate(() =>
        window.panelTest.monaco.editor
          .getEditors()[0]
          ?.getOption(window.panelTest.monaco.editor.EditorOption.fontSize),
      ),
    ).toBe(15);
  });
}, 60_000);

it("blocks typing in the live diff and retains keyboard accessibility controls", async () => {
  await withPage(async (page) => {
    await render(page);
    await expectDiff(page, 8);
    await page.evaluate(() => window.panelTest.current()?.getModifiedEditor().focus());
    await page.keyboard.type("forbidden");
    expect(
      await page.evaluate(() => window.panelTest.current()?.getModel()?.modified.getValue()),
    ).toBe(data.modified);
    await browserExpect(page.locator(".monaco-editor-overlaymessage")).toContainText("read-only");
    await file(page, "x = 1");
    await page.keyboard.press("Control+m");
    await browserExpect(page.locator(".monaco-aria-container")).toContainText(
      "Pressing Tab will now move focus",
    );
    await page.keyboard.press("Tab");
    expect(
      await page.evaluate(() => window.panelTest.monaco.editor.getEditors()[0]?.hasTextFocus()),
    ).toBe(false);
    await page.evaluate(() => window.panelTest.monaco.editor.getEditors()[0]?.focus());
    await page.keyboard.press("Control+m");
    await browserExpect(page.locator(".monaco-aria-container")).toContainText(
      "Pressing Tab will now insert",
    );
    await action(page, "editor.action.toggleHighContrast");
    await browserExpect(page.locator(".monaco-editor.hc-black")).toBeVisible();
    await action(page, "editor.action.toggleHighContrast");
    await browserExpect(page.locator(".monaco-editor.vs-dark")).toBeVisible();
  });
}, 60_000);
