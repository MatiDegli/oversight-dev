import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, expect, it } from "vitest";
import { applyTimeZone, AUTOMATIC } from "../../timeZone";
import { TimeZoneSettings } from "./TimeZoneSettings";
beforeEach(() => {
  applyTimeZone("Asia/Kolkata");
});
afterEach(() => {
  applyTimeZone(AUTOMATIC);
});
it("labels the browser preference, effective zone, override and recovery control", () => {
  const html = renderToStaticMarkup(<TimeZoneSettings />);
  for (const copy of [
    "Time zone",
    "IANA time zone override",
    "Europe/London",
    "Effective time zone:",
    "Asia/Kolkata",
    "Override",
    "This choice applies in this browser.",
    "Automatic",
  ])
    expect(html).toContain(copy);
  expect(html).toContain('aria-pressed="false"');
  expect(html).toContain('aria-invalid="false"');
  expect(html).toContain('type="submit"');
  expect(html).not.toContain("restart");
});
it("shows automatic and the resolved browser zone", () => {
  applyTimeZone(AUTOMATIC);
  const html = renderToStaticMarkup(<TimeZoneSettings />);
  expect(html).toContain('aria-pressed="true"');
  expect(html).toContain(new Intl.DateTimeFormat().resolvedOptions().timeZone);
});

it("preserves calendar dates, event-relative ages, durations and replay offsets across zone choices", async () => {
  const { chooseReplaySource } = await import("../../transport");
  const { default: fixture } =
    await import("../../../../fixtures/events/handwritten-level1.jsonl?raw");
  const { UsageContent } = await import("../usage/UsageContent");
  const { recorded } = await import("../usage/usage.fixture");
  const { createInitialState } = await import("../../state");
  const { ageWords } = await import("../../age");
  // eslint-disable-next-line no-restricted-syntax -- Test the existing duration helper without adding a production export.
  const { stageDuration } = await import("../../review/StageTimes");
  const { duration: activityDuration } = await import("./dock/selectors");
  const { duration: usageDuration } = await import("../usage/model");
  const { replayTime } = await import("../replay/model");
  const provenance = {
    exporter: "oversight.record_run.v1",
    sha256: "a".repeat(64),
    run_id: "run-20261027-140312",
    event_count: fixture.trim().split("\n").length,
  };
  for (const zone of ["America/Los_Angeles", "Asia/Tokyo", "UTC"]) {
    applyTimeZone(zone);
    expect(chooseReplaySource(fixture, fixture, provenance).label).toBe(
      "Recorded run · Oct 27, 2026",
    );
    expect(
      renderToStaticMarkup(
        <UsageContent data={recorded} state={createInitialState()} choose={() => {}} />,
      ),
    ).toContain("Oct 30, 2026");
    expect(ageWords("2026-01-15T23:59:00Z", "2026-01-16T00:01:00Z")).toBe("2 min ago");
    expect(stageDuration(65000)).toEqual({ short: "1m 5s", full: "1 minute 5 seconds" });
    expect(activityDuration(40)).toBe("0.04 s");
    expect(usageDuration(65000)).toBe("1 min 05 s");
    expect(replayTime(65000)).toBe("1:05");
  }
});
