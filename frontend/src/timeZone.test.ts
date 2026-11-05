import { afterEach, expect, it, vi } from "vitest";
import {
  AUTOMATIC,
  TIME_ZONE_KEY,
  applyTimeZone,
  chooseTimeZone,
  formatClock,
  readTimeZone,
  resolveTimeZone,
  subscribeTimeZone,
  timeZonePreference,
  timeZoneStorage,
  validTimeZone,
} from "./timeZone";

afterEach(() => {
  applyTimeZone(AUTOMATIC);
  vi.unstubAllGlobals();
});
const storage = (value: string | null = null) => ({
  getItem: vi.fn(() => value),
  setItem: vi.fn(),
});

it.each(["UTC", "Europe/London", "Asia/Kolkata", "America/Argentina/Buenos_Aires"])(
  "validates %s",
  (zone) => {
    expect(validTimeZone(zone)).toBe(true);
  },
);
it.each(["", "automatic", "Mars/Olympus", "+03:00", "<script>"])("refuses %s", (zone) => {
  expect(validTimeZone(zone)).toBe(false);
});
it.each([null, "automatic", "Mars/Olympus", '{"zone":"UTC"}'])("reads %s as automatic", (value) => {
  expect(readTimeZone(storage(value))).toBe(AUTOMATIC);
});
it("reads valid stored names and resolves automatic without overriding the browser zone", () => {
  expect(readTimeZone(storage("Europe/London"))).toBe("Europe/London");
  for (const zone of ["UTC", "Asia/Tokyo"]) expect(resolveTimeZone(AUTOMATIC, zone)).toBe(zone);
  expect(resolveTimeZone("Asia/Kolkata", "UTC")).toBe("Asia/Kolkata");
});
it("validates before applying, storing or notifying; unsubscribes independently", () => {
  const store = storage(),
    first = vi.fn(),
    second = vi.fn();
  applyTimeZone("UTC");
  const stopFirst = subscribeTimeZone(first),
    stopSecond = subscribeTimeZone(second);
  expect(chooseTimeZone("Mars/Olympus", store).valid).toBe(false);
  expect(applyTimeZone("Mars/Olympus")).toBe(false);
  expect(timeZonePreference()).toBe("UTC");
  expect(store.setItem).not.toHaveBeenCalled();
  expect(first).not.toHaveBeenCalled();
  expect(chooseTimeZone(" Asia/Kolkata ", store)).toEqual({ valid: true, persisted: true });
  expect(store.setItem).toHaveBeenCalledExactlyOnceWith(TIME_ZONE_KEY, "Asia/Kolkata");
  expect(first).toHaveBeenCalledTimes(1);
  stopFirst();
  chooseTimeZone(AUTOMATIC, store);
  expect(first).toHaveBeenCalledTimes(1);
  expect(second).toHaveBeenCalledTimes(2);
  stopSecond();
});
it("handles unavailable storage, throwing reads and refused writes with a session choice", () => {
  vi.stubGlobal("window", {
    get localStorage() {
      throw new Error("blocked");
    },
  });
  expect(timeZoneStorage()).toBeUndefined();
  expect(readTimeZone()).toBe(AUTOMATIC);
  expect(chooseTimeZone("Asia/Tokyo")).toEqual({ valid: true, persisted: false });
  expect(timeZonePreference()).toBe("Asia/Tokyo");
  vi.unstubAllGlobals();
  const refused = {
    getItem() {
      throw new Error("blocked");
    },
    setItem() {
      throw new Error("full");
    },
  };
  expect(readTimeZone(refused)).toBe(AUTOMATIC);
  expect(chooseTimeZone("Europe/London", refused)).toEqual({ valid: true, persisted: false });
  expect(timeZonePreference()).toBe("Europe/London");
});
it.each([
  ["2026-01-15T16:58:09Z", "Europe/London", "16:58", "16:58:09 UTC"],
  ["2026-07-15T16:58:09Z", "Europe/London", "17:58", "17:58:09 GMT+1"],
  ["2026-07-15T16:58:09Z", "Asia/Kolkata", "22:28", "22:28:09 GMT+5:30"],
  ["2026-01-15T23:58:09Z", "Asia/Kathmandu", "05:43", "05:43:09 GMT+5:45"],
  ["2026-01-15T00:03:09Z", "America/New_York", "19:03", "19:03:09 GMT-5"],
  ["2026-01-15T00:00:00Z", "UTC", "00:00", "00:00:00 UTC"],
  ["2026-07-15T16:58:09Z", "America/Argentina/Buenos_Aires", "13:58", "13:58:09 ART"],
])("formats %s in %s at each surface's precision", (ts, zone, minutes, seconds) => {
  expect(formatClock(ts, zone)).toBe(minutes);
  expect(formatClock(ts, zone, { seconds: true, label: true })).toBe(seconds);
  expect(formatClock(ts, zone, { label: true })).toBe(seconds.replace(/:\d{2} /u, " "));
});
