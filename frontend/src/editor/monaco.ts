import { loader } from "@monaco-editor/react";
import * as monaco from "monaco-editor/editor";
// Keep usable standalone defaults and keyboard actions as well as the visible diff features.
// Audit, transitive provisions and behavior checks: docs/performance/monaco-features.md.
import "monaco-editor/features/anchorSelect/register";
import "monaco-editor/features/bracketMatching/register";
import "monaco-editor/features/caretOperations/register";
import "monaco-editor/features/clipboard/register";
import "monaco-editor/features/codicon/register";
// The generic color provider works even with definitions-only language support.
import "monaco-editor/features/colorPicker/register";
import "monaco-editor/features/comment/register";
import "monaco-editor/features/cursorUndo/register";
import "monaco-editor/features/diffEditor/register";
import "monaco-editor/features/dnd/register";
import "monaco-editor/features/dropOrPasteInto/register";
import "monaco-editor/features/find/register";
import "monaco-editor/features/folding/register";
import "monaco-editor/features/fontZoom/register";
import "monaco-editor/features/gotoLine/register";
import "monaco-editor/features/hover/register";
import "monaco-editor/features/indentation/register";
import "monaco-editor/features/inPlaceReplace/register";
import "monaco-editor/features/insertFinalNewLine/register";
import "monaco-editor/features/inspectTokens/register";
import "monaco-editor/features/iPadShowKeyboard/register";
import "monaco-editor/features/lineSelection/register";
import "monaco-editor/features/linesOperations/register";
import "monaco-editor/features/longLinesHelper/register";
import "monaco-editor/features/multicursor/register";
import "monaco-editor/features/quickCommand/register";
import "monaco-editor/features/quickHelp/register";
import "monaco-editor/features/readOnlyMessage/register";
import "monaco-editor/features/smartSelect/register";
import "monaco-editor/features/snippet/register";
// The suggest feature entry registers only an unused inline bridge in 0.57; keep the widget.
import "monaco-editor/editor/contrib/suggest/browser/suggestController";
import "monaco-editor/features/toggleHighContrast/register";
import "monaco-editor/features/toggleTabFocusMode/register";
import "monaco-editor/features/tokenization/register";
import "monaco-editor/features/unicodeHighlighter/register";
import "monaco-editor/features/unusualLineTerminators/register";
import "monaco-editor/features/wordOperations/register";
import "monaco-editor/features/wordPartOperations/register";
import "monaco-editor/languages/definitions/python/register";
import "monaco-editor/languages/definitions/yaml/register";
import "monaco-editor/languages/definitions/markdown/register";
import "monaco-editor/languages/definitions/shell/register";
import "monaco-editor/languages/definitions/ini/register";
import EditorWorker from "monaco-editor/editor/editor.worker.js?worker";
import "./monaco.css";

// Definitions only: all languages share the editor worker, without validation or diagnostics.
self.MonacoEnvironment = { getWorker: () => new EditorWorker() };
loader.config({ monaco });

export { monaco };
