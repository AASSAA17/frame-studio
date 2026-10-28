"use client";
import { useState } from "react";
import { DateTime } from "luxon";
import {
  CalendarDays,
  Plus,
  Pencil,
  Trash2,
  ArrowLeft,
  Clock3,
} from "lucide-react";
import { useStudio } from "./studio-provider";
import { dateLabel } from "./api";
import {
  Editor,
  MutationError,
  manage,
  type Resource,
  type Closure,
  type Exception,
  type Field,
  type Values,
} from "./management-shared";

type EditState = (
  | { kind: "schedule" }
  | { kind: "closure"; item?: Closure }
  | { kind: "exception"; item?: Exception }
) & { resource: Resource; timezone: string };
export function ScheduleManager({
  resource,
  timezone,
  onBack,
  onRefresh,
}: {
  resource: Resource;
  timezone: string;
  onBack: () => void;
  onRefresh: () => void;
}) {
  const { t, text, locale } = useStudio();
  const [editing, setEditing] = useState<EditState | null>(null),
    [error, setError] = useState<unknown>(null),
    [busy, setBusy] = useState(false);
  const editorResource = editing?.resource ?? resource;
  const editorTimezone = editing?.timezone ?? timezone;
  const days = [
    text("Пн", "Дс"),
    text("Вт", "Сс"),
    text("Ср", "Ср"),
    text("Чт", "Бс"),
    text("Пт", "Жм"),
    text("Сб", "Сб"),
    text("Вс", "Жс"),
  ];
  async function remove(
    entity: "closure" | "exception",
    item: Closure | Exception,
  ) {
    if (
      !window.confirm(
        text(
          "Удалить ограничение? Время снова может стать доступным для бронирования.",
          "Шектеу жойылсын ба? Уақыт қайтадан брондауға қолжетімді болуы мүмкін.",
        ),
      )
    )
      return;
    setBusy(true);
    setError(null);
    try {
      await manage({
        entity,
        operation: "delete",
        id: item.id,
        revision: item.revision,
      });
      onRefresh();
    } catch (reason) {
      setError(reason);
    } finally {
      setBusy(false);
    }
  }
  let initial: Values = {},
    fields: Field[] = [],
    title = "";
  if (editing?.kind === "schedule") {
    title = text("Рабочий график", "Жұмыс кестесі");
    initial = {
      openHour: editorResource.openHour,
      closeHour: editorResource.closeHour,
      ...Object.fromEntries(
        days.map((_, i) => [
          `weekday-${i + 1}`,
          editorResource.weekdays.includes(i + 1),
        ]),
      ),
    };
    fields = [
      {
        key: "openHour",
        label: text("Открытие, час", "Ашылу, сағат"),
        type: "number",
        min: 0,
        max: 23,
        required: true,
      },
      {
        key: "closeHour",
        label: text("Закрытие, час", "Жабылу, сағат"),
        type: "number",
        min: 0,
        max: 24,
        required: true,
      },
      ...days.map((day, i): Field => ({
        key: `weekday-${i + 1}`,
        label: day,
        type: "checkbox",
      })),
    ];
  }
  if (editing?.kind === "closure") {
    const item = editing.item;
    title = item
      ? text("Изменить закрытие", "Жабылуды өзгерту")
      : text("Закрыть период", "Кезеңді жабу");
    const now = DateTime.now()
      .setZone(editorTimezone)
      .plus({ days: 1 })
      .startOf("day")
      .plus({ hours: editorResource.openHour });
    initial = {
      startAt: item
        ? DateTime.fromISO(item.startAt)
            .setZone(editorTimezone)
            .toFormat("yyyy-MM-dd'T'HH:mm")
        : now.toFormat("yyyy-MM-dd'T'HH:mm"),
      endAt: item
        ? DateTime.fromISO(item.endAt)
            .setZone(editorTimezone)
            .toFormat("yyyy-MM-dd'T'HH:mm")
        : now.plus({ hours: 1 }).toFormat("yyyy-MM-dd'T'HH:mm"),
      reason: item?.reason || "",
    };
    fields = [
      {
        key: "startAt",
        label: text("Начало закрытия", "Жабылу басы"),
        type: "datetime-local",
        required: true,
      },
      {
        key: "endAt",
        label: text("Конец закрытия", "Жабылу соңы"),
        type: "datetime-local",
        required: true,
      },
      {
        key: "reason",
        label: text("Причина", "Себебі"),
        type: "textarea",
        wide: true,
        required: true,
      },
    ];
  }
  if (editing?.kind === "exception") {
    const item = editing.item;
    title = item
      ? text("Изменить особый день", "Ерекше күнді өзгерту")
      : text("Особый график на дату", "Күнге ерекше кесте");
    initial = {
      date:
        item?.date?.slice(0, 10) ||
        DateTime.now().setZone(editorTimezone).plus({ days: 1 }).toISODate() ||
        "",
      closed: item?.closed ?? true,
      openHour: item?.openHour ?? editorResource.openHour,
      closeHour: item?.closeHour ?? editorResource.closeHour,
    };
    fields = [
      {
        key: "date",
        label: text(
          "Дата в часовом поясе студии",
          "Студия уақыт белдеуіндегі күн",
        ),
        type: "date",
        required: true,
      },
      {
        key: "closed",
        label: text("Закрыто весь день", "Күні бойы жабық"),
        type: "checkbox",
      },
      {
        key: "openHour",
        label: text(
          "Открытие, час (если день рабочий)",
          "Ашылу, сағат (жұмыс күні болса)",
        ),
        type: "number",
        min: 0,
        max: 23,
      },
      {
        key: "closeHour",
        label: text(
          "Закрытие, час (если день рабочий)",
          "Жабылу, сағат (жұмыс күні болса)",
        ),
        type: "number",
        min: 0,
        max: 24,
      },
    ];
  }
  return (
    <section className="schedule-panel">
      <button className="inline-button" onClick={onBack}>
        <ArrowLeft size={14} style={{ display: "inline", marginRight: 8 }} />
        {text("К списку ресурсов", "Ресурстар тізіміне")}
      </button>
      <div
        className="section-heading"
        style={{ marginTop: 24, marginBottom: 24 }}
      >
        <div>
          <p className="eyebrow">
            {text("Доступность ресурса", "Ресурс қолжетімділігі")}
          </p>
          <h2 style={{ fontSize: 30 }}>{resource.name}</h2>
          <p>{timezone}</p>
        </div>
        <button
          data-testid="schedule-edit"
          className="button small secondary"
          onClick={() => setEditing({ kind: "schedule", resource, timezone })}
        >
          <Pencil size={14} />
          {text("Изменить график", "Кестені өзгерту")}
        </button>
      </div>
      <div
        className="schedule-week"
        aria-label={text("Рабочие дни", "Жұмыс күндері")}
      >
        {days.map((day, i) => (
          <div
            key={day}
            className={resource.weekdays.includes(i + 1) ? "working" : ""}
          >
            <span>{day}</span>
            <strong>
              {resource.weekdays.includes(i + 1)
                ? `${String(resource.openHour).padStart(2, "0")}:00 — ${String(resource.closeHour).padStart(2, "0")}:00`
                : text("Выходной", "Демалыс")}
            </strong>
          </div>
        ))}
      </div>
      <MutationError error={error} />
      <div className="schedule-columns">
        <section className="management-section">
          <header>
            <CalendarDays size={21} />
            <div>
              <h2>{text("Закрытые периоды", "Жабық кезеңдер")}</h2>
              <p>
                {text(
                  "Подготовка, ремонт и временная недоступность.",
                  "Дайындық, жөндеу және уақытша қолжетімсіздік.",
                )}
              </p>
            </div>
            <button
              data-testid="closure-add"
              className="icon-button"
              aria-label={text("Добавить закрытие", "Жабылу қосу")}
              onClick={() =>
                setEditing({ kind: "closure", resource, timezone })
              }
            >
              <Plus size={18} />
            </button>
          </header>
          {resource.closures.length ? (
            <div className="management-record-list">
              {resource.closures.map((item) => (
                <article key={item.id}>
                  <div>
                    <strong>{item.reason}</strong>
                    <p>
                      {dateLabel(item.startAt, locale, timezone)} —{" "}
                      {dateLabel(item.endAt, locale, timezone)}
                    </p>
                  </div>
                  <div className="record-actions">
                    <button
                      className="icon-button"
                      aria-label={text("Изменить закрытие", "Жабылуды өзгерту")}
                      onClick={() =>
                        setEditing({
                          kind: "closure",
                          item,
                          resource,
                          timezone,
                        })
                      }
                    >
                      <Pencil size={14} />
                    </button>
                    <button
                      data-testid={`delete-closure-${item.id}`}
                      className="icon-button"
                      aria-label={text("Удалить закрытие", "Жабылуды жою")}
                      disabled={busy}
                      onClick={() => remove("closure", item)}
                    >
                      <Trash2 size={14} />
                    </button>
                  </div>
                </article>
              ))}
            </div>
          ) : (
            <p className="management-empty">
              {text("Закрытий пока нет.", "Әзірге жабық кезеңдер жоқ.")}
            </p>
          )}
        </section>
        <section className="management-section">
          <header>
            <Clock3 size={21} />
            <div>
              <h2>{text("Особые дни", "Ерекше күндер")}</h2>
              <p>
                {text(
                  "Исключения заменяют обычный график на выбранную дату.",
                  "Ерекше күн кестесі таңдалған күннің қалыпты кестесін ауыстырады.",
                )}
              </p>
            </div>
            <button
              data-testid="exception-add"
              className="icon-button"
              aria-label={text("Добавить особый день", "Ерекше күн қосу")}
              onClick={() =>
                setEditing({ kind: "exception", resource, timezone })
              }
            >
              <Plus size={18} />
            </button>
          </header>
          {resource.exceptions.length ? (
            <div className="management-record-list">
              {resource.exceptions.map((item) => (
                <article key={item.id}>
                  <div>
                    <strong>
                      {DateTime.fromISO(item.date.slice(0, 10))
                        .setLocale(locale)
                        .toFormat("d MMMM yyyy")}
                    </strong>
                    <p>
                      {item.closed
                        ? text("Закрыто весь день", "Күні бойы жабық")
                        : `${String(item.openHour).padStart(2, "0")}:00 — ${String(item.closeHour).padStart(2, "0")}:00`}
                    </p>
                  </div>
                  <div className="record-actions">
                    <button
                      className="icon-button"
                      aria-label={text(
                        "Изменить особый день",
                        "Ерекше күнді өзгерту",
                      )}
                      onClick={() =>
                        setEditing({
                          kind: "exception",
                          item,
                          resource,
                          timezone,
                        })
                      }
                    >
                      <Pencil size={14} />
                    </button>
                    <button
                      data-testid={`delete-exception-${item.id}`}
                      className="icon-button"
                      aria-label={text(
                        "Удалить особый день",
                        "Ерекше күнді жою",
                      )}
                      disabled={busy}
                      onClick={() => remove("exception", item)}
                    >
                      <Trash2 size={14} />
                    </button>
                  </div>
                </article>
              ))}
            </div>
          ) : (
            <p className="management-empty">
              {text("Исключений пока нет.", "Әзірге ерекше күндер жоқ.")}
            </p>
          )}
        </section>
      </div>
      <div className="notice">
        {text(
          "Изменения проверяются на пересечения с действующими заказами, включая подготовку и уборку. При конфликте сначала перенесите или отмените затронутую бронь — сама она не изменится.",
          "Өзгерістер белсенді тапсырыстармен, дайындық және жинау уақытын қоса, тексеріледі. Қақтығыс болса, алдымен броньды ауыстырыңыз немесе жойыңыз — ол өздігінен өзгермейді.",
        )}
      </div>
      {editing && (
        <Editor
          title={title}
          description={`${editorResource.name} · ${editorTimezone}`}
          initial={initial}
          fields={fields}
          onClose={() => setEditing(null)}
          onReload={onRefresh}
          onSave={async (values) => {
            if (
              !window.confirm(
                text(
                  "Сохранить изменение доступности? Новые заказы будут использовать этот график.",
                  "Қолжетімділік өзгерісі сақталсын ба? Жаңа тапсырыстар осы кестені пайдаланады.",
                ),
              )
            )
              throw new Error(
                text("Изменение не подтверждено.", "Өзгеріс расталмады."),
              );
            if (editing.kind === "schedule")
              await manage({
                entity: "schedule",
                operation: "update",
                id: editorResource.id,
                revision: editorResource.revision,
                openHour: Number(values.openHour),
                closeHour: Number(values.closeHour),
                weekdays: days
                  .map((_, i) => i + 1)
                  .filter((day) => values[`weekday-${day}`]),
              });
            if (editing.kind === "closure")
              await manage({
                entity: "closure",
                operation: editing.item ? "update" : "create",
                ...(editing.item
                  ? { id: editing.item.id, revision: editing.item.revision }
                  : {}),
                resourceId: editorResource.id,
                startAt: DateTime.fromISO(String(values.startAt), {
                  zone: editorTimezone,
                })
                  .toUTC()
                  .toISO(),
                endAt: DateTime.fromISO(String(values.endAt), {
                  zone: editorTimezone,
                })
                  .toUTC()
                  .toISO(),
                reason: values.reason,
              });
            if (editing.kind === "exception")
              await manage({
                entity: "exception",
                operation: editing.item ? "update" : "create",
                ...(editing.item
                  ? { id: editing.item.id, revision: editing.item.revision }
                  : {}),
                resourceId: editorResource.id,
                date: values.date,
                closed: values.closed,
                ...(!values.closed
                  ? {
                      openHour: Number(values.openHour),
                      closeHour: Number(values.closeHour),
                    }
                  : {}),
              });
            onRefresh();
          }}
        />
      )}
    </section>
  );
}
