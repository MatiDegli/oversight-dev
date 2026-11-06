import { createContext, useContext, useEffect, useState } from "react";
// eslint-disable-next-line no-restricted-imports -- Signal eligibility without loading the editor implementation.
import { allowEditorWithoutGraph } from "../../editor/loader";

import {
  readWorkspacePreferences,
  writeWorkspacePreference,
  type ShellLayout,
  type StartupView,
} from "./workspacePreferences";
export type { ShellLayout } from "./workspacePreferences";
/** Explicit fixture overrides ignore persisted startup/maximize and never write preferences. */
export const InitialShellLayout = createContext<ShellLayout | undefined>(undefined);

/** Includes Monaco's hidden input and native edit context, not just ordinary fields. */
export function isTyping(target: EventTarget | null): boolean {
  return (
    target instanceof Element &&
    target.closest("input, textarea, select, [contenteditable], .monaco-editor") !== null
  );
}

/** Monaco exposes readOnly through its accessible input, including native EditContext. */
export function isEditableMonaco(target: EventTarget | null): boolean {
  const editor = target instanceof Element ? target.closest(".monaco-editor") : null;
  if (!editor) return false;
  return !editor.querySelector('[role="textbox"][aria-autocomplete="none"]');
}

export function useShell(hasPanel: boolean, onClose: () => void, hiddenChatPanel = false) {
  const initial = useContext(InitialShellLayout);
  const [preferences] = useState(readWorkspacePreferences);
  const [startupView, setStartupView] = useState<StartupView>(preferences.startup);
  const [layout, setLayout] = useState<ShellLayout>(
    initial ?? (preferences.startup === "last-used" ? preferences.lastView : preferences.startup),
  );
  useEffect(() => {
    if (initial === undefined) writeWorkspacePreference("lastView", layout);
  }, [initial, layout]);
  // Hidden Chat tabs remain available, but only a visible panel can be closed by a shortcut.
  const open = hasPanel && (layout !== "Chat" || !hiddenChatPanel);
  const [oversightVisited, setOversightVisited] = useState(layout === "Oversight");
  useEffect(() => {
    if (layout !== "Oversight" && !oversightVisited) allowEditorWithoutGraph();
  }, [layout, oversightVisited]);
  const [layoutRevision, setLayoutRevision] = useState(0);
  useEffect(() => {
    const resized = () => {
      setLayoutRevision((value) => value + 1);
    };
    window.addEventListener("resize", resized);
    return () => {
      window.removeEventListener("resize", resized);
    };
  }, []);
  const [otherSidebar, setOtherSidebar] = useState<"Files" | "Changes" | null>(null);
  const [codeSidebar, setCodeSidebar] = useState<"Files" | "Changes" | null>("Files");
  const sidebar = layout === "Code" ? codeSidebar : otherSidebar;
  const setSidebar = layout === "Code" ? setCodeSidebar : setOtherSidebar;
  const [dock, setDock] = useState(false);
  const [shortcuts, setShortcuts] = useState(false);
  const [maximized, setMaximized] = useState(initial === undefined && preferences.maximized);
  useEffect(() => {
    if (initial === undefined) writeWorkspacePreference("maximized", maximized);
  }, [initial, maximized]);
  const [palette, setPalette] = useState<{ returnFocus: HTMLElement | null } | null>(null);
  const openPalette = () => {
    const returnFocus =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;
    setShortcuts(false);
    setPalette((current) => current ?? { returnFocus });
  };
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (
        event.defaultPrevented ||
        event.isComposing ||
        event.repeat ||
        event.metaKey ||
        event.altKey ||
        event.shiftKey ||
        !event.ctrlKey ||
        event.key.toLowerCase() !== "k" ||
        isEditableMonaco(event.target)
      )
        return;
      event.preventDefault();
      event.stopPropagation();
      openPalette();
    };
    // Read-only Monaco must not consume Ctrl K before the shell sees it.
    window.addEventListener("keydown", onKey, true);
    return () => {
      window.removeEventListener("keydown", onKey, true);
    };
  }, []);
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.isComposing || event.metaKey || isTyping(event.target))
        return;
      if (palette) return;
      if (shortcuts) {
        if (event.key === "Escape") {
          event.preventDefault();
          setShortcuts(false);
        }
        return;
      }
      if (event.ctrlKey && !event.altKey && !event.shiftKey && event.key.toLowerCase() === "b") {
        event.preventDefault();
        setSidebar((current) => (current ? null : "Files"));
      } else if (event.ctrlKey && !event.altKey && event.code === "Backquote") {
        event.preventDefault();
        setDock((current) => !current);
      } else if (
        event.altKey &&
        !event.ctrlKey &&
        !event.shiftKey &&
        event.key.toLowerCase() === "w" &&
        open
      ) {
        event.preventDefault();
        onClose();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
    };
  }, [open, onClose, shortcuts, palette, setSidebar]);
  return {
    panelOpen: open,
    layout,
    setLayout: (choice: ShellLayout) => {
      setLayout(choice);
      if (choice === "Oversight") setOversightVisited(true);
    },
    oversightVisited,
    layoutRevision,
    sidebar,
    dock,
    shortcuts,
    maximized,
    startupView,
    chooseStartupView: (choice: StartupView) => {
      setStartupView(choice);
      if (initial === undefined) writeWorkspacePreference("startup", choice);
    },
    palette,
    openPalette,
    closePalette: () => {
      setPalette(null);
    },
    toggleSidebar: () => {
      setSidebar((current) => (current ? null : "Files"));
    },
    setShortcuts,
    openSidebar: (section: "Files" | "Changes" | null) => {
      setSidebar((current) => (current === section ? null : section));
    },
    toggleDock: () => {
      setDock((current) => !current);
    },
    toggleMaximize: () => {
      setMaximized((current) => !current);
    },
  };
}
