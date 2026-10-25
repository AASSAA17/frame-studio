import { describe, expect, it } from "vitest";
import {
  hourlyLine,
  paymentSummary,
  summarizePrice,
} from "../../src/lib/domain/pricing";

describe("money in integer tiyn", () => {
  it("rounds a fractional hourly amount half-up once per line", () => {
    expect(hourlyLine("rent", 101, 30).totalMinor).toBe(51);
    expect(hourlyLine("rent", 1_200_000, 90)).toEqual({
      label: "rent",
      quantity: 1.5,
      unitPriceMinor: 1_200_000,
      totalMinor: 1_800_000,
    });
  });
  it("calculates deposit and remaining amount without float money", () => {
    expect(
      summarizePrice(
        [{ label: "rent", quantity: 1, unitPriceMinor: 105, totalMinor: 105 }],
        30,
      ),
    ).toEqual({ totalMinor: 105, depositMinor: 32, balanceMinor: 73 });
  });
  it("derives payment status from append-only charge/refund operations", () => {
    expect(paymentSummary([], 100).paymentStatus).toBe("unpaid");
    expect(
      paymentSummary([{ kind: "CHARGE", amountMinor: 30 }], 100).paymentStatus,
    ).toBe("partially_paid");
    expect(
      paymentSummary([{ kind: "CHARGE", amountMinor: 100 }], 100).paymentStatus,
    ).toBe("paid");
    expect(
      paymentSummary(
        [
          { kind: "CHARGE", amountMinor: 100 },
          { kind: "REFUND", amountMinor: 30 },
        ],
        100,
      ),
    ).toMatchObject({
      paymentStatus: "partially_refunded",
      paidMinor: 70,
      balanceMinor: 30,
    });
    expect(
      paymentSummary(
        [
          { kind: "CHARGE", amountMinor: 100 },
          { kind: "REFUND", amountMinor: 100 },
        ],
        100,
      ).paymentStatus,
    ).toBe("fully_refunded");
  });
  it("rejects invalid prices and deposit percentages", () => {
    expect(() => hourlyLine("rent", -1, 60)).toThrow();
    expect(() => summarizePrice([], 101)).toThrow();
  });
});
