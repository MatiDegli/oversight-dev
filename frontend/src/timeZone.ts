import { useSyncExternalStore } from "react";

export const TIME_ZONE_KEY = "oversight.timeZone";
export const AUTOMATIC = "automatic";
type ZoneStorage = Pick<Storage, "getItem" | "setItem">;

/** Storage access can itself throw in privacy modes. */
export function timeZoneStorage(): ZoneStorage | undefined {
  try {
    return typeof window === "undefined" ? undefined : window.localStorage;
  } catch {
    return undefined;
  }
}

export function validTimeZone(value: string): boolean {
  if (!value || value === AUTOMATIC || /^[+-]/u.test(value)) return false;
  try {
    new Intl.DateTimeFormat("en-GB", { timeZone: value });
    return true;
  } catch {
    return false;
  }
}

export function readTimeZone(storage = timeZoneStorage()): string {
  try {
    const stored = storage?.getItem(TIME_ZONE_KEY);
    return stored && validTimeZone(stored) ? stored : AUTOMATIC;
  } catch {
    return AUTOMATIC;
  }
}

export function resolveTimeZone(
  preference: string,
  browserZone = new Intl.DateTimeFormat().resolvedOptions().timeZone,
): string {
  return preference === AUTOMATIC ? browserZone : preference;
}

let chosen: string | undefined;
const listeners = new Set<() => void>();
const notify = () => {
  for (const listener of listeners) listener();
};
export const timeZonePreference = () => (chosen ??= readTimeZone());

/** Also used to reset isolated renders; does not persist anything. */
export function applyTimeZone(preference = readTimeZone()): boolean {
  if (preference !== AUTOMATIC && !validTimeZone(preference)) return false;
  chosen = preference;
  notify();
  return true;
}

/** Validation precedes both writes and notification. Refused writes still apply in memory. */
export function chooseTimeZone(value: string, storage = timeZoneStorage()) {
  const preference = value.trim();
  if (preference !== AUTOMATIC && !validTimeZone(preference)) {
    return { valid: false, persisted: false };
  }
  let persisted = false;
  try {
    storage?.setItem(TIME_ZONE_KEY, preference);
    persisted = storage !== undefined;
  } catch {
    // A valid session choice survives a refused write until reload.
  }
  applyTimeZone(preference);
  return { valid: true, persisted };
}

// One browser subscription regardless of the number of mounted clock leaves.
const refresh = () => {
  notify();
};
const stored = (event: StorageEvent) => {
  if (event.key === TIME_ZONE_KEY || event.key === null) applyTimeZone();
};
export function subscribeTimeZone(listener: () => void): () => void {
  listeners.add(listener);
  if (listeners.size === 1 && typeof window !== "undefined") {
    window.addEventListener("focus", refresh);
    window.addEventListener("pageshow", refresh);
    window.addEventListener("storage", stored);
  }
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0 && typeof window !== "undefined") {
      window.removeEventListener("focus", refresh);
      window.removeEventListener("pageshow", refresh);
      window.removeEventListener("storage", stored);
    }
  };
}

const snapshot = () => `${timeZonePreference()}|${resolveTimeZone(timeZonePreference())}`;
export function useTimeZone() {
  const value = useSyncExternalStore(subscribeTimeZone, snapshot, snapshot);
  const [preference, effectiveZone] = value.split("|") as [string, string];
  return { preference, effectiveZone };
}

const clockFormatters = new Map<string, Intl.DateTimeFormat>();

/** All instant clocks use en-GB and 24 hours; labels describe the offset at this instant. */
export function formatClock(
  ts: string,
  zone: string,
  { seconds = false, label = false }: { seconds?: boolean; label?: boolean } = {},
): string {
  const date = new Date(ts);
  const key = `${zone}|${String(seconds)}|${String(label)}`;
  let formatter = clockFormatters.get(key);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat("en-GB", {
      timeZone: zone,
      hour: "2-digit",
      minute: "2-digit",
      ...(seconds ? { second: "2-digit" } : {}),
      hour12: false,
      ...(label ? { timeZoneName: "shortOffset" } : {}),
    });
    clockFormatters.set(key, formatter);
  }
  return formatter
    .formatToParts(date)
    .map((part) => {
      if (part.type !== "timeZoneName") return part.value;
      if (zone === "America/Argentina/Buenos_Aires" || zone === "America/Buenos_Aires")
        return "ART";
      return part.value === "GMT" || part.value === "GMT+0" ? "UTC" : part.value;
    })
    .join("");
}

export function useClock() {
  const { effectiveZone } = useTimeZone();
  return (ts: string, options?: { seconds?: boolean; label?: boolean }) =>
    formatClock(ts, effectiveZone, options);
}
