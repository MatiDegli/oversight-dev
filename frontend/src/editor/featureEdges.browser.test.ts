import { expect as browserExpect } from "@playwright/test";
import { expect, it } from "vitest";

import { data, expectDiff, render, withPage } from "./LiveDiff.browser.support";

it("renders Unicode highlights and a real marker hover, then clears markers", async () => {
  await withPage(async (page) => {
    await render(page, {
      ...data,
      modified: data.modified.replace("first_7 = 99", "first_7 = 't\u0435xt'"),
    });
    await expectDiff(page, 8);
    await browserExpect(page.locator(".modified .unicode-highlight")).toBeVisible();
    await page.evaluate(() => {
      window.panelTest.renderFile("main.py", "hover_target = 1");
    });
    await browserExpect(page.locator('[aria-label="File view"]')).toHaveAttribute(
      "data-state",
      "clean",
    );
    await page.evaluate(() => {
      const { monaco } = window.panelTest;
      const editor = monaco.editor.getEditors()[0];
      const model = editor?.getModel();
      if (!model) throw new Error("Missing model");
      monaco.editor.setModelMarkers(model, "fixture", [
        {
          severity: monaco.MarkerSeverity.Warning,
          message: "Fixture marker hover",
          startLineNumber: 1,
          endLineNumber: 1,
          startColumn: 1,
          endColumn: 8,
        },
      ]);
      editor?.focus();
      editor?.setPosition({ lineNumber: 1, column: 3 });
    });
    await browserExpect(page.locator(".squiggly-warning")).toBeVisible();
    await page.evaluate(async () => {
      await window.panelTest.monaco.editor
        .getEditors()[0]
        ?.getAction("editor.action.showHover")
        ?.run();
    });
    await browserExpect(page.locator(".monaco-hover")).toContainText("Fixture marker hover");
    await page.keyboard.press("Escape");
    await page.evaluate(() => {
      const model = window.panelTest.monaco.editor.getEditors()[0]?.getModel();
      if (model) window.panelTest.monaco.editor.setModelMarkers(model, "fixture", []);
    });
    expect(await page.evaluate(() => window.panelTest.monaco.editor.getModelMarkers({}))).toEqual(
      [],
    );
  });
}, 60_000);

it("copies, cuts and pastes using the keyboard clipboard path", async () => {
  await withPage(async (page) => {
    await page.context().grantPermissions(["clipboard-read", "clipboard-write"]);
    await page.evaluate(() => {
      window.panelTest.renderFile("main.py", "alpha beta");
    });
    await browserExpect(page.locator('[aria-label="File view"]')).toHaveAttribute(
      "data-state",
      "clean",
    );
    await page.evaluate(() => {
      const editor = window.panelTest.monaco.editor.getEditors()[0];
      editor?.focus();
      editor?.setSelection({ startLineNumber: 1, startColumn: 1, endLineNumber: 1, endColumn: 6 });
    });
    await page.keyboard.press("Control+c");
    await browserExpect
      .poll(() => page.evaluate(() => navigator.clipboard.readText()))
      .toBe("alpha");
    await page.keyboard.press("Control+x");
    await browserExpect
      .poll(() => page.evaluate(() => window.panelTest.monaco.editor.getEditors()[0]?.getValue()))
      .toBe(" beta");
    await page.keyboard.press("End");
    await page.keyboard.press("Control+v");
    await browserExpect
      .poll(() => page.evaluate(() => window.panelTest.monaco.editor.getEditors()[0]?.getValue()))
      .toBe(" betaalpha");
  });
}, 60_000);

it("preserves the installed standalone default text-drop behavior", async () => {
  await withPage(async (page) => {
    await page.evaluate(() => {
      window.panelTest.renderFile("main.py", "alpha");
    });
    await browserExpect(page.locator('[aria-label="File view"]')).toHaveAttribute(
      "data-state",
      "clean",
    );
    await page.evaluate(() => {
      const editor = window.panelTest.monaco.editor.getEditors()[0];
      const position = editor?.getScrolledVisiblePosition({ lineNumber: 1, column: 1 });
      const node = editor?.getDomNode();
      if (!node || !position) throw new Error("Missing editor surface");
      const box = node.getBoundingClientRect();
      const transfer = new DataTransfer();
      transfer.setData("text/plain", "dropped ");
      const target = document.elementFromPoint(box.x + position.left + 1, box.y + position.top + 5);
      if (!target) throw new Error("Missing drop target");
      target.dispatchEvent(
        new DragEvent("drop", {
          bubbles: true,
          cancelable: true,
          dataTransfer: transfer,
          clientX: box.x + position.left + 1,
          clientY: box.y + position.top + 5,
        }),
      );
    });
    // Baseline also inserts a literal $0: StandaloneBulkEditService ignores insertAsSnippet.
    // Keep this upstream limitation visible; trimming registrations must not change the path.
    await browserExpect
      .poll(() => page.evaluate(() => window.panelTest.monaco.editor.getEditors()[0]?.getValue()))
      .toBe("dropped $0alpha");
  });
}, 60_000);

it("moves an existing selection with drag and drop", async () => {
  await withPage(async (page) => {
    await page.evaluate(() => {
      window.panelTest.renderFile("main.py", "alpha beta");
    });
    await browserExpect(page.locator('[aria-label="File view"]')).toHaveAttribute(
      "data-state",
      "clean",
    );
    const points = await page.evaluate(() => {
      const editor = window.panelTest.monaco.editor.getEditors()[0];
      editor?.focus();
      editor?.setSelection({ startLineNumber: 1, startColumn: 1, endLineNumber: 1, endColumn: 6 });
      const node = editor?.getDomNode();
      const from = editor?.getScrolledVisiblePosition({ lineNumber: 1, column: 3 });
      const to = editor?.getScrolledVisiblePosition({ lineNumber: 1, column: 11 });
      if (!node || !from || !to) throw new Error("Missing drag geometry");
      const box = node.getBoundingClientRect();
      return { x: box.x + from.left, y: box.y + from.top + 8, end: box.x + to.left + 3 };
    });
    await page.mouse.move(points.x, points.y);
    await page.mouse.down();
    await page.mouse.move(points.end, points.y, { steps: 20 });
    await page.mouse.up();
    await browserExpect
      .poll(() => page.evaluate(() => window.panelTest.monaco.editor.getEditors()[0]?.getValue()))
      .toBe(" betaalpha");
  });
}, 60_000);

it("allows the person to remove unusual line terminators", async () => {
  await withPage(async (page) => {
    const dialogs: string[] = [];
    page.on("dialog", async (dialog) => {
      dialogs.push(dialog.message());
      await dialog.accept();
    });
    await page.evaluate(() => {
      window.panelTest.renderFile("main.py", "alpha\u2028beta");
    });
    await browserExpect.poll(() => dialogs.length).toBe(1);
    expect(dialogs[0]).toContain("unusual line terminators");
    await browserExpect
      .poll(() => page.evaluate(() => window.panelTest.monaco.editor.getEditors()[0]?.getValue()))
      .toBe("alphabeta");
  });
}, 60_000);

it("shows the iPad keyboard affordance only for an editable file and focuses the editor", async () => {
  await withPage(async (page) => {
    // Emulates Monaco's iOS platform branch; this is not native iPad acceptance.
    await page.addInitScript(() => {
      Object.defineProperty(navigator, "userAgent", { get: () => "iPad" });
      Object.defineProperty(navigator, "maxTouchPoints", { get: () => 5 });
    });
    await page.reload();
    await page.waitForFunction(() => "panelTest" in window);
    await page.evaluate(() => {
      window.panelTest.renderFile("main.py", "x = 1");
    });
    const keyboard = page.locator(".iPadShowKeyboard");
    await browserExpect(keyboard).toBeVisible();
    await keyboard.dispatchEvent("touchstart");
    expect(
      await page.evaluate(() => window.panelTest.monaco.editor.getEditors()[0]?.hasTextFocus()),
    ).toBe(true);
    await page.evaluate(() =>
      window.panelTest.monaco.editor.getEditors()[0]?.updateOptions({ readOnly: true }),
    );
    await browserExpect(keyboard).toHaveCount(0);
  });
}, 60_000);

it("inserts snippets with selectable tab stops", async () => {
  await withPage(async (page) => {
    await page.evaluate(() => {
      window.panelTest.renderFile("main.py", "");
    });
    await browserExpect(page.locator('[aria-label="File view"]')).toHaveAttribute(
      "data-state",
      "clean",
    );
    await page.evaluate(() => {
      const editor = window.panelTest.monaco.editor.getEditors()[0];
      editor?.focus();
      const snippets = editor?.getContribution<{ dispose(): void; insert(template: string): void }>(
        "snippetController2",
      );
      if (!snippets) throw new Error("Missing snippet controller");
      snippets.insert("hello ${1:world}$0");
    });
    await page.keyboard.type("person");
    await page.keyboard.press("Tab");
    await browserExpect
      .poll(() => page.evaluate(() => window.panelTest.monaco.editor.getEditors()[0]?.getValue()))
      .toBe("hello person");
  });
}, 60_000);

it("expands a truncated long line when the person clicks its end", async () => {
  await withPage(async (page) => {
    await page.evaluate(() => {
      window.panelTest.renderFile("main.py", "x".repeat(50));
    });
    await browserExpect(page.locator('[aria-label="File view"]')).toHaveAttribute(
      "data-state",
      "clean",
    );
    const point = await page.evaluate(() => {
      const editor = window.panelTest.monaco.editor.getEditors()[0];
      if (!editor) throw new Error("Missing editor");
      if (
        editor.getOption(window.panelTest.monaco.editor.EditorOption.stopRenderingLineAfter) !==
        10000
      )
        throw new Error("Default truncation changed");
      // Exercise the same boundary with a short visible line instead of a 10,000-column fixture.
      editor.updateOptions({ stopRenderingLineAfter: 20, wordWrap: "off" });
      editor.render(true);
      const position = editor.getScrolledVisiblePosition({ lineNumber: 1, column: 21 });
      const box = editor.getDomNode()?.getBoundingClientRect();
      if (!position || !box) throw new Error("Missing truncated line geometry");
      return { x: box.x + position.left - 1, y: box.y + position.top + 8 };
    });
    await page.mouse.click(point.x, point.y);
    await browserExpect
      .poll(() =>
        page.evaluate(() =>
          window.panelTest.monaco.editor
            .getEditors()[0]
            ?.getOption(window.panelTest.monaco.editor.EditorOption.stopRenderingLineAfter),
        ),
      )
      .toBe(-1);
  });
}, 60_000);

it("keeps generic hex-color decorators and their picker without a language service", async () => {
  await withPage(async (page) => {
    await page.evaluate(() => {
      window.panelTest.renderFile("main.py", "accent = '#123456'");
    });
    const decorator = page.locator(".colorpicker-color-decoration");
    await browserExpect(decorator).toBeVisible();
    await browserExpect(decorator).toHaveCSS("background-color", "rgb(18, 52, 86)");
    await decorator.click();
    await browserExpect(page.locator(".colorpicker-widget")).toBeVisible();
    await browserExpect(page.locator(".colorpicker-widget .picked-color")).toContainText("#123456");
  });
}, 60_000);
