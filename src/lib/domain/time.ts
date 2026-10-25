import { DateTime, IANAZone } from "luxon";
import { invariant } from "./types";

export function checkTimezone(zone: string) {
  invariant(
    IANAZone.isValidZone(zone),
    "INVALID_TIMEZONE",
    "В настройках студии указан неверный часовой пояс.",
    503,
  );
}
export function localDay(date: string, zone: string) {
  checkTimezone(zone);
  invariant(
    /^\d{4}-\d{2}-\d{2}$/.test(date),
    "INVALID_DATE",
    "Укажите дату в формате ГГГГ-ММ-ДД.",
  );
  const day = DateTime.fromISO(date, { zone });
  invariant(day.isValid, "INVALID_DATE", "Некорректная дата.");
  return day.startOf("day");
}
export function withinSchedule(
  startAt: Date,
  endAt: Date,
  zone: string,
  openHour: number,
  closeHour: number,
  weekdays = [1, 2, 3, 4, 5, 6, 7],
) {
  checkTimezone(zone);
  const localStart = DateTime.fromJSDate(startAt, { zone });
  const localEnd = DateTime.fromJSDate(endAt, { zone });
  let day = localStart.startOf("day");
  if (closeHour <= openHour && localStart.hour < closeHour)
    day = day.minus({ days: 1 });
  const open = day.plus({ hours: openHour });
  const close = day.plus({
    hours: closeHour <= openHour ? closeHour + 24 : closeHour,
  });
  return (
    weekdays.includes(day.weekday) && localStart >= open && localEnd <= close
  );
}
export function overlaps(startA: Date, endA: Date, startB: Date, endB: Date) {
  return startA < endB && endA > startB;
}
