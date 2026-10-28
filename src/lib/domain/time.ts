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

export type ScheduleException = {
  date: string;
  closed: boolean;
  openHour: number | null;
  closeHour: number | null;
};
export function resourceScheduleAllows(
  startAt: Date,
  endAt: Date,
  zone: string,
  resource: {
    openHour: number;
    closeHour: number;
    weekdays: number[];
    exceptions: ScheduleException[];
  },
) {
  checkTimezone(zone);
  const start = DateTime.fromJSDate(startAt, { zone });
  const end = DateTime.fromJSDate(endAt, { zone });
  // A closed calendar date also blocks spill-over from an overnight shift.
  for (let day = start.startOf("day"); day < end; day = day.plus({ days: 1 })) {
    if (
      resource.exceptions.some(
        (exception) => exception.date === day.toISODate() && exception.closed,
      )
    )
      return false;
  }
  for (const day of [
    start.startOf("day").minus({ days: 1 }),
    start.startOf("day"),
  ]) {
    const exception = resource.exceptions.find(
      (value) => value.date === day.toISODate(),
    );
    if (
      exception?.closed ||
      (!exception && !resource.weekdays.includes(day.weekday))
    )
      continue;
    const openHour = exception?.openHour ?? resource.openHour;
    const closeHour = exception?.closeHour ?? resource.closeHour;
    const open = day.plus({ hours: openHour });
    const close = day.plus({
      hours: closeHour <= openHour ? closeHour + 24 : closeHour,
    });
    if (start >= open && end <= close) return true;
  }
  return false;
}
