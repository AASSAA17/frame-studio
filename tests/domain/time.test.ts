import { describe, expect, it } from "vitest";
import { localDay, overlaps, withinSchedule } from "../../src/lib/domain/time";

describe("studio-local time and half-open intervals", () => {
  it("uses Kazakhstan local time rather than the host timezone", () => {
    expect(localDay("2026-10-25", "Asia/Almaty").toUTC().toISO()).toBe(
      "2026-10-24T19:00:00.000Z",
    );
  });
  it("rejects invalid dates and timezones", () => {
    expect(() => localDay("2026-02-31", "Asia/Almaty")).toThrow();
    expect(() => localDay("2026-10-25", "Mars/Almaty")).toThrow();
  });
  it("supports opening hours crossing midnight", () => {
    expect(
      withinSchedule(
        new Date("2026-10-25T18:00:00Z"),
        new Date("2026-10-25T20:00:00Z"),
        "Asia/Almaty",
        20,
        2,
      ),
    ).toBe(true);
    expect(
      withinSchedule(
        new Date("2026-10-25T20:00:00Z"),
        new Date("2026-10-25T22:00:00Z"),
        "Asia/Almaty",
        20,
        2,
      ),
    ).toBe(false);
  });
  it("does not overlap adjacent intervals", () => {
    const start = new Date("2026-10-25T10:00:00Z");
    const boundary = new Date("2026-10-25T11:00:00Z");
    const end = new Date("2026-10-25T12:00:00Z");
    expect(overlaps(start, boundary, boundary, end)).toBe(false);
    expect(overlaps(start, end, boundary, end)).toBe(true);
  });
});
