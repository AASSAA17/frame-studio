"use client";
import { useEffect, useRef, useState, type ReactNode } from "react";
import Link from "next/link";
import * as Dialog from "@radix-ui/react-dialog";
import { X, Save, AlertCircle, ArrowUpRight } from "lucide-react";
import { useStudio } from "@/components/studio-provider";
import {
  api,
  ApiError,
  useApi,
  type Catalog,
  type User,
} from "@/components/api";
import {
  frameHistoryPosition,
  installFrameHistoryTracking,
  subscribeFramePopGuard,
} from "./navigation-guard";

export type Revision = {
  id: string;
  revision: number;
  archivedAt?: string | null;
};
export type Closure = Revision & {
  resourceId: string;
  startAt: string;
  endAt: string;
  reason: string;
};
export type Exception = Revision & {
  resourceId: string;
  date: string;
  closed: boolean;
  openHour: number | null;
  closeHour: number | null;
};
export type Unit = Revision & {
  serial: number;
  active: boolean;
  maintenanceNote: string;
  retiredAt: string | null;
};
export type Resource = Revision & {
  name: string;
  type: string;
  active: boolean;
  openHour: number;
  closeHour: number;
  weekdays: number[];
  units: Unit[];
  closures: Closure[];
  exceptions: Exception[];
};
export type Room = Revision & {
  name: string;
  capacity: number;
  resourceId: string;
};
export type Location = Revision &
  Catalog["locations"][number] & { descriptionKk: string; published: boolean };
export type Decor = Revision & {
  locationId: string;
  name: string;
  image: string;
  validFrom: string;
  validUntil: string | null;
  published: boolean;
};
export type Specialist = Revision &
  Catalog["specialists"][number] & { resourceId: string; published: boolean };
export type Equipment = Revision &
  Catalog["equipment"][number] & {
    resourceId: string;
    availableQuantity: number;
    published: boolean;
  };
export type Service = Revision &
  Catalog["services"][number] & {
    description: string;
    published: boolean;
    production: boolean;
  };
export type Settings = Catalog["settings"] &
  Revision & {
    bufferBeforeMinutes: number;
    bufferAfterMinutes: number;
    minimumMinutes: number;
    reminderHours: number[];
    contacts: {
      address?: string;
      email?: string;
      phone?: string;
      instagram?: string;
      website?: string;
    };
  };
export type StudioData = {
  settings: Settings;
  rooms: Room[];
  locations: Location[];
  decorVersions: Decor[];
  specialists: Specialist[];
  equipment: Equipment[];
  services: Service[];
  resources: Resource[];
  paymentMode: string;
};
export type Customer = Revision & {
  name: string;
  email: string | null;
  phone: string | null;
  notes: string;
  tags: string[];
  userId: string | null;
  bookingCount: number;
  paidMinor: number;
};
export type Command = {
  entity: string;
  operation: string;
  id?: string;
  revision?: number;
  [key: string]: unknown;
};
export function refreshStudio() {
  window.dispatchEvent(new Event("studio-updated"));
}
export async function manage(command: Command) {
  const result = await api("/api/studio/manage", {
    method: "POST",
    body: JSON.stringify(command),
  });
  refreshStudio();
  return result;
}
export function useManagement() {
  const studio = useApi<StudioData>("/api/studio");
  const session = useApi<{ user: User | null }>("/api/session");
  return {
    ...studio,
    owner: session.data?.user?.role === "OWNER",
    user: session.data?.user,
  };
}

// Link clicks are intercepted before Next navigation. Back/forward cancellation restores
// the previous history entry; beforeunload covers reload, closing and address-bar changes.
export function useDirtyGuard(dirty: boolean) {
  const { text } = useStudio();
  const enabled = useRef(dirty);
  enabled.current = dirty;
  const message = text(
    "Есть несохранённые изменения. Покинуть форму и потерять их?",
    "Сақталмаған өзгерістер бар. Формадан шығып, оларды жоғалтасыз ба?",
  );
  useEffect(() => {
    if (!dirty) return;
    installFrameHistoryTracking();
    let restoring = false;
    let currentPosition = frameHistoryPosition() ?? 0;
    let previousHref = window.location.href;
    const before = (event: BeforeUnloadEvent) => {
      if (enabled.current) {
        event.preventDefault();
        event.returnValue = "";
      }
    };
    const click = (event: MouseEvent) => {
      if (
        !enabled.current ||
        event.defaultPrevented ||
        event.button !== 0 ||
        event.ctrlKey ||
        event.metaKey ||
        event.shiftKey ||
        event.altKey
      )
        return;
      const anchor = (event.target as Element).closest?.(
        "a[href]",
      ) as HTMLAnchorElement | null;
      if (
        !anchor ||
        anchor.target === "_blank" ||
        anchor.hasAttribute("download")
      )
        return;
      const target = new URL(anchor.href, window.location.href);
      if (
        target.href === window.location.href ||
        (target.pathname === window.location.pathname &&
          target.search === window.location.search)
      )
        return;
      if (!window.confirm(message)) {
        event.preventDefault();
        event.stopImmediatePropagation();
      } else enabled.current = false;
    };
    const pop = (event: PopStateEvent) => {
      const targetPosition = frameHistoryPosition() ?? currentPosition - 1;
      if (restoring) {
        event.stopImmediatePropagation();
        restoring = false;
        return;
      }
      // Router/history bookkeeping at the same URL is not consent to discard.
      if (window.location.href === previousHref) {
        currentPosition = targetPosition;
        return;
      }
      if (enabled.current && !window.confirm(message)) {
        event.stopImmediatePropagation();
        restoring = true;
        history.go(currentPosition - targetPosition || 1);
      } else {
        if (enabled.current) enabled.current = false;
        currentPosition = targetPosition;
        previousHref = window.location.href;
      }
    };
    window.addEventListener("beforeunload", before);
    document.addEventListener("click", click, true);
    const unsubscribePop = subscribeFramePopGuard(pop);
    return () => {
      window.removeEventListener("beforeunload", before);
      document.removeEventListener("click", click, true);
      unsubscribePop();
    };
  }, [dirty, message]);
  return () => !enabled.current || window.confirm(message);
}
export function MutationError({
  error,
  onReload,
}: {
  error: unknown;
  onReload?: () => void;
}) {
  const { text, locale } = useStudio();
  if (!error) return null;
  const typed = error as ApiError;
  const details = typed.details as
    | {
        conflicts?: {
          id: string;
          number: string;
          startAt: string;
          locationName?: string;
        }[];
      }
    | undefined;
  const kkCodes: Record<string, string> = {
    FORBIDDEN: "Бұл әрекетті орындауға рұқсатыңыз жоқ.",
    UNAUTHORIZED: "Жүйеге қайта кіріңіз.",
    NOT_FOUND: "Жазба табылмады. Тізімді жаңартыңыз.",
    STALE_REVISION:
      "Жазба басқа терезеде өзгертілген. Ағымдағы деректерді жүктеп, түзетулерді қайталаңыз.",
    REVISION_CONFLICT:
      "Жазба басқа терезеде өзгертілген. Ағымдағы деректерді жүктеңіз.",
    INVALID_INPUT:
      "Енгізілген деректерді тексеріңіз. Міндетті өрістер мен мәндер шектеріне назар аударыңыз.",
    VALIDATION_ERROR:
      "Енгізілген деректерді тексеріңіз. Мәндер рұқсат етілген шекте болуы тиіс.",
    BOOKING_CONFLICT:
      "Өзгеріс бар броньдармен қайшы келеді. Алдымен көрсетілген тапсырыстарды тексеріңіз.",
    CONFLICT: "Таңдалған уақыт не ресурс бос емес. Қолжетімділікті жаңартыңыз.",
    QUOTE_CHANGED:
      "Тапсырыс шарттары өзгерген. Жаңа есеп пен ережелерді тексеріп, қайта растаңыз.",
    PRICE_CHANGED: "Тариф өзгерген. Жаңа соманы тексеріп, қайта растаңыз.",
    RATE_LIMIT: "Сұраулар тым жиі жіберілді. Біраздан кейін қайталаңыз.",
  };
  const message =
    locale === "kk" && typed instanceof ApiError
      ? kkCodes[typed.code || ""] ||
        (typed.status === 409
          ? "Өзгеріс ағымдағы деректермен қайшы келеді. Деректерді жаңартып, қайта тексеріңіз."
          : typed.status === 403
            ? kkCodes.FORBIDDEN
            : "Өзгерістер сақталмады. Енгізілген мәндерді тексеріп, қайта көріңіз.")
      : typed.message ||
        text("Не удалось сохранить изменения.", "Өзгерістер сақталмады.");
  return (
    <div className="notice error" role="alert">
      <div className="management-error-title">
        <AlertCircle size={16} />
        <span>{message}</span>
      </div>
      {details?.conflicts?.length ? (
        <div className="conflict-list">
          <p>
            {text(
              "Сначала разрешите конфликт с заказами. Они не изменены автоматически.",
              "Алдымен тапсырыстармен қақтығысты шешіңіз. Олар автоматты өзгертілмеді.",
            )}
          </p>
          {details.conflicts.map((item) => (
            <Link
              href={`/crm/bookings/${item.id}`}
              target="_blank"
              key={item.id}
            >
              {item.number} · {item.locationName}
              <ArrowUpRight size={13} />
            </Link>
          ))}
        </div>
      ) : null}
      {onReload &&
        (typed.status === 409 || typed.code === "STALE_REVISION") && (
          <button type="button" className="inline-button" onClick={onReload}>
            {text("Загрузить актуальные данные", "Ағымдағы деректерді жүктеу")}
          </button>
        )}
    </div>
  );
}
export type Field = {
  key: string;
  label: string;
  type?:
    | "text"
    | "number"
    | "textarea"
    | "select"
    | "checkbox"
    | "datetime-local"
    | "date"
    | "email"
    | "url";
  required?: boolean;
  min?: number;
  max?: number;
  step?: number;
  help?: string;
  wide?: boolean;
  options?: { value: string; label: string }[];
};
export type Values = Record<string, string | number | boolean>;
export function Fields({
  fields,
  values,
  setValues,
  disabled = false,
}: {
  fields: Field[];
  values: Values;
  setValues: (value: Values) => void;
  disabled?: boolean;
}) {
  return (
    <div className="management-fields">
      {fields.map((field) =>
        field.type === "checkbox" ? (
          <label
            className={`check-label ${field.wide ? "field-wide" : ""}`}
            key={field.key}
          >
            <input
              data-testid={`field-${field.key}`}
              type="checkbox"
              checked={Boolean(values[field.key])}
              disabled={disabled}
              onChange={(e) =>
                setValues({ ...values, [field.key]: e.target.checked })
              }
            />
            <span>
              {field.label}
              {field.help && <small className="field-help">{field.help}</small>}
            </span>
          </label>
        ) : (
          <label
            className={`field ${field.wide ? "field-wide" : ""}`}
            key={field.key}
          >
            {field.label}
            {field.type === "textarea" ? (
              <textarea
                data-testid={`field-${field.key}`}
                value={String(values[field.key] ?? "")}
                disabled={disabled}
                required={field.required}
                onChange={(e) =>
                  setValues({ ...values, [field.key]: e.target.value })
                }
              />
            ) : field.type === "select" ? (
              <select
                data-testid={`field-${field.key}`}
                value={String(values[field.key] ?? "")}
                disabled={disabled}
                required={field.required}
                onChange={(e) =>
                  setValues({ ...values, [field.key]: e.target.value })
                }
              >
                {field.options?.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            ) : (
              <input
                data-testid={`field-${field.key}`}
                type={field.type || "text"}
                value={String(values[field.key] ?? "")}
                required={field.required}
                disabled={disabled}
                min={field.min}
                max={field.max}
                step={field.step}
                onChange={(e) =>
                  setValues({
                    ...values,
                    [field.key]:
                      field.type === "number"
                        ? e.target.value === ""
                          ? ""
                          : Number(e.target.value)
                        : e.target.value,
                  })
                }
              />
            )}{" "}
            {field.help && <small>{field.help}</small>}
          </label>
        ),
      )}
    </div>
  );
}
export function Editor({
  title,
  description,
  initial,
  fields,
  onSave,
  onClose,
  onReload,
  children,
}: {
  title: string;
  description?: string;
  initial: Values;
  fields: Field[];
  onSave: (values: Values) => Promise<unknown>;
  onClose: () => void;
  onReload?: () => void;
  children?: (values: Values) => ReactNode;
}) {
  const { t, text } = useStudio();
  const [initialValues] = useState(() => ({ ...initial }));
  const [values, setValues] = useState(initialValues),
    [error, setError] = useState<unknown>(null),
    [busy, setBusy] = useState(false),
    [saved, setSaved] = useState(false);
  const dirty =
    !saved && JSON.stringify(initialValues) !== JSON.stringify(values);
  const mayClose = useDirtyGuard(dirty);
  const close = () => {
    if (!busy && mayClose()) onClose();
  };
  return (
    <Dialog.Root
      open
      onOpenChange={(open) => {
        if (!open) close();
      }}
    >
      <Dialog.Portal>
        <Dialog.Overlay className="dialog-overlay" />
        <Dialog.Content
          className="management-dialog"
          onEscapeKeyDown={(event) => {
            event.preventDefault();
            close();
          }}
          onPointerDownOutside={(event) => event.preventDefault()}
        >
          <header className="dialog-header">
            <div>
              <Dialog.Title>{title}</Dialog.Title>
              <Dialog.Description>
                {description ||
                  text(
                    "Изменения будут сохранены после проверки на сервере.",
                    "Өзгерістер серверде тексерілгеннен кейін сақталады.",
                  )}
              </Dialog.Description>
            </div>
            <button
              className="icon-button"
              aria-label={text("Закрыть форму", "Форманы жабу")}
              onClick={close}
              disabled={busy}
            >
              <X size={18} />
            </button>
          </header>
          <form
            onSubmit={async (event) => {
              event.preventDefault();
              setError(null);
              setBusy(true);
              try {
                await onSave(values);
                setSaved(true);
                onClose();
              } catch (reason) {
                setError(reason);
              } finally {
                setBusy(false);
              }
            }}
          >
            <div className="dialog-body">
              <Fields
                fields={fields}
                values={values}
                setValues={setValues}
                disabled={busy}
              />
              {children?.(values)}
              <MutationError
                error={error}
                onReload={
                  onReload
                    ? () => {
                        if (mayClose()) {
                          onReload();
                          onClose();
                        }
                      }
                    : undefined
                }
              />
            </div>
            <footer className="dialog-footer">
              <span className="unsaved-label">
                {dirty
                  ? text(
                      "Есть несохранённые изменения",
                      "Сақталмаған өзгерістер бар",
                    )
                  : text(
                      "Форма готова к редактированию",
                      "Форма өңдеуге дайын",
                    )}
              </span>
              <button
                data-testid="manage-cancel"
                type="button"
                className="button secondary small"
                onClick={close}
                disabled={busy}
              >
                {t.cancel}
              </button>
              <button
                data-testid="manage-save"
                className="button small"
                disabled={busy}
              >
                <Save size={14} />
                {busy ? text("Сохраняем…", "Сақталуда…") : t.save}
              </button>
            </footer>
          </form>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
export function SectionHeading({
  title,
  description,
  action,
}: {
  title: string;
  description: string;
  action?: ReactNode;
}) {
  return (
    <div className="crm-heading">
      <div>
        <h1>{title}</h1>
        <p>{description}</p>
      </div>
      {action}
    </div>
  );
}
export function ReadOnlyNote() {
  const { text } = useStudio();
  return (
    <div className="notice">
      {text(
        "Вы можете просматривать данные. Изменять каталог и настройки может владелец студии; расписание и доступность — также администратор.",
        "Деректерді қарай аласыз. Каталог пен параметрлерді студия иесі, кесте мен қолжетімділікті әкімші де өзгерте алады.",
      )}
    </div>
  );
}
export function ArchiveButton({
  entity,
  item,
  onDone,
}: {
  entity: string;
  item: Revision & { name: string };
  onDone: () => void;
}) {
  const { text } = useStudio();
  const [error, setError] = useState<unknown>(null),
    [busy, setBusy] = useState(false);
  return (
    <>
      <button
        data-testid={`archive-${entity}-${item.id}`}
        type="button"
        className="inline-button danger-text"
        disabled={busy || !!item.archivedAt}
        onClick={async () => {
          if (
            !window.confirm(
              text(
                `Архивировать «${item.name}»? Новые бронирования станут недоступны. Существующие заказы сохранятся; конфликтующие изменения будут отклонены.`,
                `«${item.name}» архивке жіберілсін бе? Жаңа броньдар қолжетімсіз болады. Бар тапсырыстар сақталады; қайшы өзгерістер қабылданбайды.`,
              ),
            )
          )
            return;
          setBusy(true);
          setError(null);
          try {
            await manage({
              entity,
              operation: "archive",
              id: item.id,
              revision: item.revision,
            });
            onDone();
          } catch (reason) {
            setError(reason);
          } finally {
            setBusy(false);
          }
        }}
      >
        {item.archivedAt
          ? text("В архиве", "Архивте")
          : text("Архивировать", "Архивтеу")}
      </button>
      <MutationError error={error} />
    </>
  );
}
