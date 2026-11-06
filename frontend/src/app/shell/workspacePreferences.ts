/** Browser-only workspace preferences. M6 can replace this adapter without moving view owners. */
export const shellLayouts = ["Chat", "Code", "Oversight"] as const;
export type ShellLayout = (typeof shellLayouts)[number];
export type StartupView = "last-used" | ShellLayout;
type StoragePort = Pick<Storage, "getItem" | "setItem">;

/** localStorage is origin-scoped; the normalized deployment base separates apps on that origin. */
export function workspacePreferenceKeys(base = import.meta.env.BASE_URL) {
  const path = new URL(base, "http://workspace.local/").pathname.replace(/\/*$/, "/");
  const prefix = `oversight.workspace.v1:${encodeURIComponent(path)}:`;
  return {
    lastView: `${prefix}last-view`,
    startup: `${prefix}startup`,
    maximized: `${prefix}oversight-maximized`,
  };
}

function storage(): StoragePort | undefined {
  try {
    return typeof window === "undefined" ? undefined : window.localStorage;
  } catch {
    return undefined;
  }
}
function read(key: string, port: StoragePort | undefined): string | null {
  try {
    return port?.getItem(key) ?? null;
  } catch {
    return null;
  }
}
function isLayout(value: unknown): value is ShellLayout {
  return shellLayouts.some((layout) => layout === value);
}
export function readWorkspacePreferences(port = storage()): {
  lastView: ShellLayout;
  startup: StartupView;
  maximized: boolean;
} {
  const keys = workspacePreferenceKeys();
  const last = read(keys.lastView, port);
  const startup = read(keys.startup, port);
  return {
    lastView: isLayout(last) ? last : "Chat",
    startup: isLayout(startup) ? startup : "last-used",
    maximized: read(keys.maximized, port) === "true",
  };
}

/** Failed writes leave the in-memory choice usable. No documents or server settings live here. */
export function writeWorkspacePreference(
  name: keyof ReturnType<typeof workspacePreferenceKeys>,
  value: ShellLayout | StartupView | boolean,
  port = storage(),
) {
  try {
    port?.setItem(workspacePreferenceKeys()[name], String(value));
  } catch {
    // Denied storage or quota: retain the current session's choice.
  }
}
