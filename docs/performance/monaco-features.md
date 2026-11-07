# Monaco feature registration audit

Worker branch: `perf/monaco-features`. Dispatch and measurement base:
`f2ea7a1933a8780600d917fa3a19ecb73bcd8ef1` (HEAD and local main, clean at dispatch).
Standing maintainer approval covers this performance front. No delegation, provider calls,
contract edits, dependency changes, push or merge. GLM review and merged-tree verification
belong to the coordinator and remain pending.

Criteria, in order: preserve comfortable reading/editing and rare usable paths; make the
maintainer's import choices explicit and checkable; retain current controls and keyboard
behavior without adding a setting. Theme entries alone were not treated as requirements.

## Premises and package trace

All supplied consumer anchors still apply at the dispatch base. `monaco.ts:3` previously
imported `features/register.all`; `monaco-editor/editor` itself only reexports `editor.api`.
The root `monaco-editor` entry instead imports every language and feature; all other product
imports from that root are type-only. No loader, eligibility, prefetch, options or theme changed:
`loader.ts:7`, `loader.ts:17`, `lazyEditor.tsx:52`, `prefetch.ts:7` retain Chat-first eligibility,
the cached implementation promise, React lazy loading, cancellation and Save-Data handling.
These paths are relative to `frontend/src/editor/` unless explicitly qualified below.

Installed Monaco is 0.57.0, with the existing DOMPurify 3.4.17 patch. Its `package.json`
exports `./*` to `./esm/vs/*.js` and `./*.js` to the same JS files. Every import below resolves
through those exports; no dependency was copied or upgraded. `monaco.test.ts:86` traverses
static JS imports/exports, rejecting broad registries, disabled controllers and language services,
and checks core, suggestion, codicon and sanitizer provisions. Browser language coverage checks
lazy definitions, actual workers and the absence of diagnostics. This static traversal is not a
replacement for browser execution and does not model runtime provider registration.

Package paths in the following trace are relative to the installed `monaco-editor/esm/vs/`:

- `editor.js` → `editor/editor.api.js` → `editor/standalone/browser/standaloneEditor.js`
  → `standaloneCodeEditor.js` supplies code/diff widgets, models, services, keybindings,
  decoration collections, cursor/edit commands, undo/redo and theme APIs. `codeEditorWidget.js`
  reaches `editor/browser/coreCommands.js`. An extra `features/codeEditor/register` is redundant.
- `editor/browser/widget/diffEditor/diffEditorWidget.js` reaches the diff view model, worker-backed
  diff computation, `features/hideUnchangedRegionsFeature.js`, view zones and accessible diff viewer.
  `features/diffEditor/register.js` adds diff commands and decoration/icon registrations.
- `features/find/register.js` reaches the find controller/widget **and** the installed hidden-widget
  tabindex patch. Importing only the controller would lose that patch.
- `features/hover/register.js` reaches marker navigation, definition-link actions, color-picker
  rendering, inline hint widget code and code-action helpers transitively. These remain in the
  bundle; removing their separate entrypoints does not remove all their code. The language-service-dependent helpers have no product
  providers. The generic color provider is retained explicitly, as described below. Hover's accessible-view registrations remain intact.
- `features/colorPicker/register.js` retains `DefaultDocumentColorProviderFeature`, whose generic
  worker provider finds hex/rgb/hsl colors even in Python/plaintext with defaultColorDecorators=auto.
  Its detector, hover picker and standalone picker are usable without a language service.
- `features/suggest/register.js` only registers an inline-completion bridge in 0.57.0, gated on
  `quickSuggestions: inline`. Oversight keeps the default `on`, so that bridge and the separate
  inline engine are omitted. The explicit `editor/contrib/suggest/browser/suggestController`
  entry retains the word-suggestion widget, accept keys, worker-backed suggestions and snippets.
- `features/dropOrPasteInto/register.js` supplies the default drop providers, inline progress and
  post-edit widgets. Normal clipboard commands have their own retained entrypoint. The previously
  absent `copyPasteContribution` is not newly enabled.
- `features/codicon/register.js` imports `base/browser/ui/codicons/codicon/codicon.css`, whose
  `@font-face` URL is `./codicon.ttf`. That font remains local and byte-identical. Code/diff/quick
  input widgets import their supporting CSS; no CSS or font entry is replaced by a CDN.
- `editor/editor.worker.js?worker` remains the sole worker factory for every model language.
  Its entry starts `editor/common/services/editorWorker.js`; diff and word suggestions exercise it.
  Five definition registers reach only their tokenizer/configuration loaders, no language services.

## Feature → provision → consumer → behavior check

`F(name)` means the exact supported import `monaco-editor/features/name/register`.
`D(name)` means `monaco-editor/languages/definitions/name/register`.
`E` is `features.browser.test.ts`; `X` is `featureEdges.browser.test.ts`.
These abbreviations describe exact paths, not feature guesses from theme colors.

| Kept feature | Exact import or core provision | Consumer (including inherited defaults) | Behavior check |
| --- | --- | --- | --- |
| Standalone/models/whole-line spans | `monaco-editor/editor` | `FileView.tsx:34`, `:74`, `:144`, `:151` | `frontend/src/app/fileView.browser.test.ts:15`; `LiveDiff.browser.test.ts:6` |
| Inline diff, worker hunks and unchanged disclosure | `F(diffEditor)` + core diff widget | `LiveDiff.tsx:38`, `:101`, `:149`; `diffViewport.ts:90` | `E:97` also opens/closes the accessible diff viewer with F7/Escape; `diffViewport.browser.test.ts:41` |
| Find, navigation, Ctrl+F/Escape | `F(find)` | Both editors via `FileView.tsx:144`, `LiveDiff.tsx:149`; find default enabled | `E:39`; `LiveDiff.browser.test.ts:124` |
| Ordinary folding | `F(folding)` | Both editors; inherited folding=true; `diffViewport.ts:59` hidden-area subscription | `E:64` folds/unfolds real Python lines |
| Bracket matching | `F(bracketMatching)` | Both editors; matchBrackets=always | `LiveDiff.browser.test.ts:160` renders bracket matches |
| Generic color decorators/picker | `F(colorPicker)` | Both editors; inherited colorDecorators=true, defaultColorDecorators=auto | `X:263` renders the real hex swatch and opens its picker |
| Hover and marker plumbing | `F(hover)` + core marker service/decorations | Both editors; hover enabled; `LiveDiff.tsx:189` read-only | `X:6` renders marker hover and clears markers; `language.browser.test.ts:68`, `:145` |
| Unicode highlights | `F(unicodeHighlighter)` | Both editors; inherited ambiguous/invisible character highlighting | `X:6` asserts rendered Unicode decoration |
| Clipboard | `F(clipboard)` | Editable `FileView.tsx:144`, review via `ReviewEditor.tsx:50` | `X:58` actual Ctrl+C/X/V clipboard contents and model |
| Drag selected text | `F(dnd)` | Both editors; dragAndDrop=true, writable guard | `X:126` moves text using real mouse geometry |
| Text drop/default providers | `F(dropOrPasteInto)` | Editable file; dropIntoEditor enabled | `X:89` dispatches DOM drop and checks baseline output; limitation below |
| Comment toggling | `F(comment)` | File/review editing and language comment configuration | `E:134` checks text, undo and redo |
| Letter transpose | `F(caretOperations)` | Editable code; command palette action | `E:134` checks transposed letters, undo/redo |
| Line operations | `F(linesOperations)` | File/review editing and keyboard actions | `E:134` copies a line, undo/redo |
| Indentation actions | `F(indentation)` + core indent commands | File/review editing, inherited autoIndent=advanced | `E:134` indents with undo/redo |
| Previous/next numeric value | `F(inPlaceReplace)` | Editable code, worker-backed command | `E:134` replaces numeric value, undo/redo |
| Final newline action | `F(insertFinalNewLine)` | Editable code, command palette | `E:134` inserts newline, undo/redo |
| Line selection | `F(lineSelection)` | Both editors, Ctrl+L | `E:158` asserts selected line text |
| Word navigation/deletion | `F(wordOperations)` | Both editors, Ctrl+Arrow default bindings | `E:158` asserts cursor position |
| Subword navigation/deletion | `F(wordPartOperations)` | Both editors, camel-case commands | `E:158` asserts subword cursor position |
| Selection anchor | `F(anchorSelect)` | Both editors, selection keyboard actions | `E:158` sets and returns to anchor |
| Cursor undo | `F(cursorUndo)` | Both editors, cursor navigation history | `E:158` restores prior cursor position |
| Smart selection | `F(smartSelect)` | Both editors; built-in word/bracket fallback without providers | `E:158` expands selection before multicursor |
| Multicursor | `F(multicursor)` | Both editors, add next occurrence | `E:158` asserts two selections |
| Suggestions | `monaco-editor/editor/contrib/suggest/browser/suggestController` | Editable code; wordBasedSuggestions=matchingDocuments, quickSuggestions=on | `E:193` Ctrl+Space and Tab insert actual worker suggestion |
| Snippet editing/tab stops | `F(snippet)` (also reached by suggestion controller) | Editable code; snippet suggestions default enabled | `X:199` replaces selected tab stop and exits with Tab |
| Go to line | `F(gotoLine)` | Both editors, Ctrl+G | `E:209` navigates to requested line |
| Command palette | `F(quickCommand)` | Both editors, F1 | `E:209` opens actual quick input |
| Quick help | `F(quickHelp)` | Empty quick-input prefix | `E:209` lists Go to Line |
| Token inspection | `F(inspectTokens)` | Both editors, developer command | `E:209` renders token inspection widget |
| Force retokenize action | `F(tokenization)`; tokenization itself is core | Both editors, developer command | `E:209` executes before token inspection; `language.browser.test.ts:68` checks token types |
| Font zoom/reset | `F(fontZoom)` | Both editors, keyboard/palette actions | `E:209` checks font size changes and reset |
| Read-only feedback | `F(readOnlyMessage)` + core writable guards | `LiveDiff.tsx:189`; file/review state guards | `E:245` typing refused with feedback; file/review browser suites |
| Tab focus accessibility | `F(toggleTabFocusMode)` | Both editors, Ctrl+M | `E:245` asserts announcement and actual focus transfer |
| High contrast toggle | `F(toggleHighContrast)` | Both editors, existing palette action | `E:245` switches to high contrast and restores app theme |
| iPad keyboard affordance | `F(iPadShowKeyboard)` | Editable file/review on iOS | `X:174` emulated iOS branch, focus and read-only removal |
| Long truncated lines | `F(longLinesHelper)` | Both editors; stopRenderingLineAfter=10000 | `X:225` checks default, exercises shortened threshold with mouse |
| Unusual line terminators | `F(unusualLineTerminators)` | Editable code; inherited prompt mode | `X:156` accepts real dialog and verifies text cleanup |
| Codicons/local font | `F(codicon)` | Find/fold/diff/quick-input controls | Registration traversal + ordinary fold/disclosure tests; asset hash comparison |
| Local fonts/theme/accessibility core | `monaco-editor/editor` | `LiveDiff.tsx:222`, `:236`; `FileView.tsx:141`; accessibilityVerbose=true | `LiveDiff.browser.test.ts:87`, `:109`, `:160`; `E:245` |
| Five definitions and fallback | `D(python)`, `D(yaml)`, `D(markdown)`, `D(shell)`, `D(ini)` | `language.ts:1`, `:18`; `LiveDiff.tsx:110`; `FileView.tsx:34` | `language.browser.test.ts:68` opens file and both diff sides; TOML=INI, JSON=plaintext |
| Undo/EOL/save/model lifecycle | Core text model, keybinding and edit services | `ReviewEditor.tsx:50`, `:81`; `FileView.tsx:113`; `fileDocument.ts:158` | `E:134`; `ReviewDiscard.browser.test.ts:6`; `frontend/src/app/fileView.browser.test.ts:15` |

## Omitted registrations and default audit

`LiveDiff.tsx:27` supplies options shared by standalone files and diff editors. Explicitly disabled:
contextmenu, links, selectionHighlight, occurrencesHighlight, stickyScroll, minimap, bracket-pair
colorization/guides and margin revert. Core wrapping, layout, scrollbars, cursor, selection, undo,
indentation, bracket auto-closing, input, screen-reader support and decoration handling remain.
`editor.api.js` sets standalone autoIndent=advanced, wrappingIndent=none, glyphMargin=false and
2 overview lanes; no defaults were overridden to make an import removable.

The separate registrations for contextmenu, links, wordHighlighter, stickyScroll and sectionHeaders
are omitted because their surfaces are disabled. Middle scrolling is false by inherited default.
Placeholder text is absent; GPU acceleration is off; the floating-menu menu has no supplied actions.
No symbol/definition/reference, code lens, formatter, code-action, signature, inlay, rename,
linked-editing or semantic-token providers are installed by the definitions-only language modules.
The generic color provider is an exception and remains registered. The other provider-dependent
feature registrations, documentSymbols, quickOutline and diffEditorBreadcrumbs are
therefore omitted. Hover still brings some helpers and registrations transitively, as traced above.
The inline engine has no applicable provider under Oversight's default quickSuggestions=on.
A future option, provider or Monaco version change must revisit this inventory and browser checks.

## Measurements

Same WSL host `DESKTOP-23G7J80`, 32 logical CPUs, Linux 6.18.33.2-microsoft-standard-WSL2.
Node 24.20.0; pnpm 12.5.1; Vite 8.3.4; Monaco 0.57.0. Frozen lock SHA-256:
`ab1cf059a1237ec52cdf983876cca6c46ce6b551afc73f56ec07d3f54e0c872c`.
Before: 2026-11-06 10:39:30 ART; after: 10:58:03 ART. Both exact production commands used nice 10,
with provider keys removed. No local test/build overlapped either measurement. Host load averages
were 19.82/26.04/29.43 before and 33.68/29.33/26.58 after: **the shared host was not quiet**.
The quiet-host requirement is unmet; build timings are not evidence of performance improvement.

| Asset/set | Before raw B | After raw B | Raw delta B (%) | Before Vite gzip kB | After Vite gzip kB | Gzip delta kB (%) |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| Implementation JS | 3,948,630 | 3,511,566 | −437,064 (−11.07%) | 1,012.20 | 898.42 | −113.78 (−11.24%) |
| Implementation CSS | 186,117 | 166,526 | −19,591 (−10.53%) | 27.29 | 24.61 | −2.68 (−9.82%) |
| JS + CSS combined | 4,134,747 | 3,678,092 | −456,655 (−11.04%) | 1,039.49 | 923.03 | −116.46 (−11.20%) |
| Entire dist (`du -sb`) | 6,773,184 | 6,316,529 | −456,655 (−6.74%) | — | — | — |

Before names: `implementation-jDLTGlAd.js`, `implementation-BsT8Oyvd.css`.
After names: `implementation-BC92QbKm.js`, `implementation-DbW3G5GJ.css`.
Each build emitted 75 files, one implementation JS and one CSS; there are no replacement split
chunks to hide. Modules transformed: 3348 → 3261. Worker `editor.worker-C8DPLl6p.js` (303,843 B),
`codicon-DF1abBS2.ttf` (153,228 B), both Mono font formats (10,056/12,760 B), all six Next font
assets and notices remain byte-identical. Raw file bytes were recorded immediately after each
build, before replay modified dist. Gzip values above are Vite's reported decimal kB, rounded to
0.01 kB. Per-file supplementary Python gzip(level=6) values in the asset manifests use a different
compressor and are not substituted for Vite's figures. The survey's 25–35% estimate is not met
and was never an acceptance target.

## Verification and hand-back evidence

Final targeted verification (all exits 0):

| Gate | Complete log | Result |
| --- | --- | --- |
| Identical production builds / immediate dist bytes | `before-build.log`, `before-du.log`, `final-build.log`, `final-du.log` | Both builds and both byte captures pass |
| TypeScript | `tsc-verified-tree.log` | Pass |
| Changed-file ESLint / Prettier | `style-final-tree.log`, `format-final-tree.log` | Pass |
| Editor unit tests | `unit-verified-tree.log` | 130 pass |
| Requested editor + app browser tests | `browser-verified-tree.log` | 72 pass, 1 existing caption-capture skip |
| Changed-file related tests, maxWorkers=2 | `related-verified-tree.log` | 646 pass, 20 existing skips; 54 files pass, 1 file skipped |
| Six requested Playwright specs | `e2e-verified-tree.log` | 11 pass |

The replay runner logs two expected backend-less `/files` proxy refusals during prefetch fixtures;
all 11 Playwright assertions pass. No new skip or test gating was introduced. The measured source
hashes still match the verified source. The largest touched source file is 275 lines; the longest
changed-file function is 62 lines (`length-audit.log`).

Complete command logs, exit codes, host snapshots, per-file asset bytes/hashes, import closures
and the bounded asyncio command runner are retained under `.runtime/perf/monaco-features/`.
The report and tests are committed; generated measurement logs remain local. See `commands.md`
in that directory for exact invocations and exits, including exploratory failures.
The final measurement is `final-build.log` / `final-du.log` /
`final-assets.json`; `after-*` records an intermediate candidate before preserving the generic color
provider. `final-source-hashes.json` binds the measured production source and tests to this hand-back.

Disclosed: shared-host quietness was unavailable; `tools/capped.sh` reports no 6 GiB enforcement
because user systemd is unavailable. iOS coverage emulates Monaco's branch in Chromium and is not
native iPad acceptance; no native Windows browser acceptance was performed. Default external text
drop already inserts a literal `$0`: reproduced with the base's broad registration, caused by
`StandaloneBulkEditService.apply` applying snippet text literally. The regression deliberately
records that existing limitation; no upstream fix is folded into this performance front.
Initial test-authoring, lint and cache-transition failures are retained in the logs. The final
user instruction restricts verification to targeted gates, so repository-wide lint/format,
ruff/pyright/pytest (no Python changes), full make check and landing verification are not run here.
The focused browser suite skips only the pre-existing DESIGN_AUDIT_SHOTS caption capture
(`frontend/src/app/review.browser.test.ts:347`). GLM cross-provider review remains for the coordinator.
No file changed here exceeds 500 lines;
no changed function exceeds 80 lines.

CONTESTED: none
