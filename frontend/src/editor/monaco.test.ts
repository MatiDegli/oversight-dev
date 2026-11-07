import { existsSync, readFileSync } from "node:fs";

import { afterEach, expect, it, vi } from "vitest";

vi.mock("@monaco-editor/react", () => ({ loader: { config: vi.fn() } }));
vi.mock("monaco-editor/editor", () => ({ editor: {} }));
vi.mock("monaco-editor/features/anchorSelect/register", () => ({}));
vi.mock("monaco-editor/features/bracketMatching/register", () => ({}));
vi.mock("monaco-editor/features/caretOperations/register", () => ({}));
vi.mock("monaco-editor/features/clipboard/register", () => ({}));
vi.mock("monaco-editor/features/codicon/register", () => ({}));
vi.mock("monaco-editor/features/colorPicker/register", () => ({}));
vi.mock("monaco-editor/features/comment/register", () => ({}));
vi.mock("monaco-editor/features/cursorUndo/register", () => ({}));
vi.mock("monaco-editor/features/diffEditor/register", () => ({}));
vi.mock("monaco-editor/features/dnd/register", () => ({}));
vi.mock("monaco-editor/features/dropOrPasteInto/register", () => ({}));
vi.mock("monaco-editor/features/find/register", () => ({}));
vi.mock("monaco-editor/features/folding/register", () => ({}));
vi.mock("monaco-editor/features/fontZoom/register", () => ({}));
vi.mock("monaco-editor/features/gotoLine/register", () => ({}));
vi.mock("monaco-editor/features/hover/register", () => ({}));
vi.mock("monaco-editor/features/indentation/register", () => ({}));
vi.mock("monaco-editor/features/inPlaceReplace/register", () => ({}));
vi.mock("monaco-editor/features/insertFinalNewLine/register", () => ({}));
vi.mock("monaco-editor/features/inspectTokens/register", () => ({}));
vi.mock("monaco-editor/features/iPadShowKeyboard/register", () => ({}));
vi.mock("monaco-editor/features/lineSelection/register", () => ({}));
vi.mock("monaco-editor/features/linesOperations/register", () => ({}));
vi.mock("monaco-editor/features/longLinesHelper/register", () => ({}));
vi.mock("monaco-editor/features/multicursor/register", () => ({}));
vi.mock("monaco-editor/features/quickCommand/register", () => ({}));
vi.mock("monaco-editor/features/quickHelp/register", () => ({}));
vi.mock("monaco-editor/features/readOnlyMessage/register", () => ({}));
vi.mock("monaco-editor/features/smartSelect/register", () => ({}));
vi.mock("monaco-editor/features/snippet/register", () => ({}));
vi.mock("monaco-editor/editor/contrib/suggest/browser/suggestController", () => ({}));
vi.mock("monaco-editor/features/toggleHighContrast/register", () => ({}));
vi.mock("monaco-editor/features/toggleTabFocusMode/register", () => ({}));
vi.mock("monaco-editor/features/tokenization/register", () => ({}));
vi.mock("monaco-editor/features/unicodeHighlighter/register", () => ({}));
vi.mock("monaco-editor/features/unusualLineTerminators/register", () => ({}));
vi.mock("monaco-editor/features/wordOperations/register", () => ({}));
vi.mock("monaco-editor/features/wordPartOperations/register", () => ({}));
vi.mock("monaco-editor/languages/definitions/python/register", () => ({}));
vi.mock("monaco-editor/languages/definitions/yaml/register", () => ({}));
vi.mock("monaco-editor/languages/definitions/markdown/register", () => ({}));
vi.mock("monaco-editor/languages/definitions/shell/register", () => ({}));
vi.mock("monaco-editor/languages/definitions/ini/register", () => ({}));
vi.mock("monaco-editor/editor/editor.worker.js?worker", () => ({
  default: class LocalEditorWorker {
    readonly name = "local-worker";
  },
}));

afterEach(() => vi.unstubAllGlobals());

it("ships DOMPurify 3.4.17 in Monaco's vendored sanitizer", () => {
  const source = readFileSync(
    new URL(import.meta.resolve("monaco-editor/base/browser/dompurify/dompurify.js")),
    "utf8",
  );
  expect(source, "Restore the Monaco DOMPurify patch before updating Monaco").toContain(
    "@license DOMPurify 3.4.17 |",
  );
  expect(source).toMatch(/DOMPurify\.version = ["']3\.4\.17["']/);
});

it("resolves the configured worker through the installed package exports", () => {
  const source = readFileSync(new URL("./monaco.ts", import.meta.url), "utf8");
  const worker = /from "([^"]+)\?worker"/.exec(source)?.[1];
  if (!worker) throw new Error("Missing bundled worker import");
  expect(existsSync(new URL(import.meta.resolve(worker)))).toBe(true);
});

it("configures the React loader with the local Monaco and a bundled worker", async () => {
  const scope: { MonacoEnvironment?: { getWorker: () => unknown } } = {};
  vi.stubGlobal("self", scope);
  const { monaco } = await import("./monaco");
  const { loader } = await import("@monaco-editor/react");
  const { default: EditorWorker } = await import("monaco-editor/editor/editor.worker.js?worker");
  expect(loader.config).toHaveBeenCalledWith({ monaco });
  expect(scope.MonacoEnvironment?.getWorker()).toBeInstanceOf(EditorWorker);
});

it("uses exported local entrypoints without restoring the broad feature or language registry", () => {
  const source = readFileSync(new URL("./monaco.ts", import.meta.url), "utf8");
  const imports = [...source.matchAll(/(?:from |import )"(monaco-editor\/[^"?]+)"/g)].map(
    (match) => {
      const specifier = match[1];
      if (!specifier) throw new Error("Missing Monaco package specifier");
      return specifier;
    },
  );
  const pending = imports.map((specifier) => new URL(import.meta.resolve(specifier)));
  const visited = new Set<string>();
  while (pending.length) {
    const url = pending.pop();
    if (!url) break;
    if (visited.has(url.href)) continue;
    visited.add(url.href);
    if (!url.pathname.endsWith(".js")) continue;
    const contents = readFileSync(url, "utf8");
    for (const match of contents.matchAll(
      /^(?:import|export)\s+(?:[^"'\n]*?\sfrom\s*)?["'](\.[^"']+)["']/gm,
    )) {
      const relative = match[1];
      if (relative) pending.push(new URL(relative, url));
    }
  }
  const paths = [...visited].map((url) => new URL(url).pathname);
  for (const forbidden of [
    "/features/register.all.js",
    "/vs/index.js",
    "/editor/editor.main.js",
    "/editor/contrib/inlineCompletions/browser/inlineCompletions.contribution.js",
    "/editor/contrib/stickyScroll/browser/stickyScrollContribution.js",
    "/editor/contrib/contextmenu/browser/contextmenu.js",
  ]) {
    expect(
      paths.some((path) => path.endsWith(forbidden)),
      forbidden,
    ).toBe(false);
  }
  for (const provision of [
    "/editor/browser/coreCommands.js",
    "/editor/browser/widget/codeEditor/codeEditorWidget.js",
    "/editor/browser/widget/diffEditor/diffEditorWidget.js",
    "/editor/contrib/suggest/browser/suggestController.js",
    "/editor/contrib/colorPicker/browser/colorPickerContribution.js",
    "/editor/contrib/snippet/browser/snippetController2.js",
    "/base/browser/ui/codicons/codicon/codicon.css",
    "/base/browser/dompurify/dompurify.js",
  ]) {
    expect(
      paths.some((path) => path.endsWith(provision)),
      provision,
    ).toBe(true);
  }
  expect(paths.filter((path) => /\/languages\/features\//.test(path))).toEqual([]);
  expect(
    paths
      .filter((path) => /\/languages\/definitions\/[^/]+\/register.js$/.test(path))
      .map((path) => path.split("/").at(-2))
      .sort(),
  ).toEqual(["ini", "markdown", "python", "shell", "yaml"]);
});
