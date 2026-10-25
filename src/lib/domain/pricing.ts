import type { QuoteItem } from "./types";
import { invariant } from "./types";

/** Money is stored in tiyn (1 ₸ = 100); round half-up once per line and once for deposit. */
export function hourlyLine(
  label: string,
  unitPriceMinor: number,
  minutes: number,
): QuoteItem {
  invariant(
    Number.isSafeInteger(unitPriceMinor) &&
      unitPriceMinor >= 0 &&
      Number.isSafeInteger(minutes) &&
      minutes > 0,
    "INVALID_PRICE",
    "Некорректный тариф.",
  );
  const totalMinor = Math.floor((unitPriceMinor * minutes + 30) / 60);
  invariant(
    Number.isSafeInteger(totalMinor),
    "INVALID_PRICE",
    "Сумма выходит за допустимые пределы.",
  );
  return { label, quantity: minutes / 60, unitPriceMinor, totalMinor };
}
export function summarizePrice(items: QuoteItem[], depositPercent: number) {
  invariant(
    Number.isInteger(depositPercent) &&
      depositPercent >= 0 &&
      depositPercent <= 100,
    "INVALID_DEPOSIT",
    "Некорректная настройка предоплаты.",
  );
  const totalMinor = items.reduce((sum, item) => sum + item.totalMinor, 0);
  invariant(
    Number.isSafeInteger(totalMinor) && totalMinor <= 2_000_000_000,
    "INVALID_PRICE",
    "Сумма выходит за допустимые пределы.",
  );
  const depositMinor = Math.floor((totalMinor * depositPercent + 50) / 100);
  return { totalMinor, depositMinor, balanceMinor: totalMinor - depositMinor };
}
export function paymentSummary(
  payments: { kind: string; amountMinor: number }[],
  totalMinor: number,
) {
  const chargedMinor = payments
    .filter((p) => p.kind === "CHARGE")
    .reduce((sum, p) => sum + p.amountMinor, 0);
  const refundedMinor = payments
    .filter((p) => p.kind === "REFUND")
    .reduce((sum, p) => sum + p.amountMinor, 0);
  const paidMinor = chargedMinor - refundedMinor;
  const paymentStatus =
    refundedMinor > 0
      ? paidMinor === 0
        ? "fully_refunded"
        : "partially_refunded"
      : paidMinor >= totalMinor
        ? "paid"
        : paidMinor > 0
          ? "partially_paid"
          : "unpaid";
  return {
    chargedMinor,
    refundedMinor,
    paidMinor,
    balanceMinor: Math.max(0, totalMinor - paidMinor),
    paymentStatus,
  };
}
