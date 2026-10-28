"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import { DateTime } from "luxon";
import {
  LayoutDashboard,
  CalendarDays,
  BookOpen,
  Box,
  ArrowUpRight,
  Plus,
  Search,
  Download,
  ArrowLeft,
  Users,
  Settings2,
  Building2,
  MapPin,
  Aperture,
  Sparkles,
} from "lucide-react";
import { AccessGate, OrderDetail, SignOutButton } from "./account-ui";
import { useStudio } from "./studio-provider";
import {
  useApi,
  money,
  dateLabel,
  localDate,
  bookingArray,
  type Booking,
  type Catalog,
  type User,
} from "./api";
import { State, Empty, StatusBadge, PublicShell, Brand } from "./shared";

export function CrmShell({ children }: { children: React.ReactNode }) {
  const { t, text, locale, setLocale, settings } = useStudio();
  const pathname = usePathname();
  return (
    <div className="crm-shell">
      <aside className="crm-sidebar">
        <Brand />
        <p className="eyebrow">STUDIO WORKSPACE</p>
        <nav className="crm-nav">
          {[
            ["/crm", text("Обзор", "Шолу"), LayoutDashboard],
            ["/crm/calendar", text("Календарь", "Күнтізбе"), CalendarDays],
            ["/crm/bookings", text("Бронирования", "Броньдар"), BookOpen],
            ["/crm/clients", text("Клиенты", "Клиенттер"), Users],
            [
              "/crm/rooms",
              text("Физические залы", "Физикалық залдар"),
              Building2,
            ],
            ["/crm/locations", t.locations, MapPin],
            ["/crm/team", t.team, Aperture],
            ["/crm/equipment", text("Оборудование", "Жабдық"), Box],
            ["/crm/services", t.services, Sparkles],
            ["/crm/settings", text("Настройки", "Параметрлер"), Settings2],
            [
              "/crm/resources",
              text("Ресурсы студии", "Студия ресурстары"),
              Box,
            ],
          ].map(([href, label, Icon]) => {
            const ItemIcon = Icon as typeof Box;
            return (
              <Link
                href={String(href)}
                key={String(href)}
                className={
                  pathname === href ||
                  (href !== "/crm" && pathname.startsWith(String(href) + "/"))
                    ? "active"
                    : ""
                }
              >
                <ItemIcon size={17} />
                {String(label)}
              </Link>
            );
          })}
        </nav>
        <div className="crm-sidebar-bottom">
          <span>{text("Управление студией", "Студияны басқару")}</span>
          <Link href="/">
            <ArrowUpRight
              size={13}
              style={{ display: "inline", marginRight: 8 }}
            />
            {text("Открыть сайт", "Сайтты ашу")}
          </Link>
          <span>
            {text("Платежи в тестовом режиме", "Төлемдер сынақ режимінде")}
          </span>
        </div>
      </aside>
      <div className="crm-main">
        <header className="crm-topbar">
          <span>
            {settings?.name || "FRAME STUDIO"} / {t.city}
          </span>
          <div>
            <div className="language-switch">
              <button
                aria-pressed={locale === "ru"}
                onClick={() => setLocale("ru")}
              >
                RU
              </button>
              <span>/</span>
              <button
                aria-pressed={locale === "kk"}
                onClick={() => setLocale("kk")}
              >
                KZ
              </button>
            </div>
            <Link href="/account">{t.account}</Link>
          </div>
        </header>
        <main id="main" className="crm-content">
          <AccessGate staff>{() => children}</AccessGate>
        </main>
      </div>
    </div>
  );
}
function BookingTable({ bookings }: { bookings: Booking[] }) {
  const { t, text, locale } = useStudio();
  const { data: catalog } = useApi<Catalog>("/api/catalog");
  const timezone = catalog?.settings.timezone || "Asia/Almaty";
  return (
    <div className="table-wrap">
      <table>
        <thead>
          <tr>
            <th>{t.order}</th>
            <th>{text("Клиент", "Клиент")}</th>
            <th>{t.date}</th>
            <th>{t.status}</th>
            <th>{t.balance}</th>
            <th>
              <span className="visually-hidden">{t.details}</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {bookings.map((item) => (
            <tr key={item.id}>
              <td>
                <Link href={`/crm/bookings/${item.id}`}>
                  <strong>{item.locationName}</strong>
                  <small>{item.number}</small>
                </Link>
              </td>
              <td data-label={text("Клиент", "Клиент")}>{item.name}</td>
              <td data-label={t.date}>
                {dateLabel(item.startAt, locale, timezone)}
                <small>
                  {Math.round(
                    (+new Date(item.endAt) - +new Date(item.startAt)) / 60000,
                  )}{" "}
                  {text("минут", "минут")}
                </small>
              </td>
              <td data-label={t.status}>
                <StatusBadge status={item.status} />
              </td>
              <td data-label={t.balance}>
                {money(item.balanceMinor)}
                <small>
                  {money(item.totalMinor)} {text("всего", "барлығы")}
                </small>
              </td>
              <td>
                <Link
                  aria-label={`${t.details}: ${item.number}`}
                  href={`/crm/bookings/${item.id}`}
                >
                  <ArrowUpRight size={17} />
                </Link>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
function useBookings() {
  const result = useApi<Booking[] | { bookings: Booking[] }>(
    "/api/bookings?scope=crm",
  );
  return { ...result, bookings: bookingArray(result.data) };
}
export function CrmOverview() {
  const { t, text, locale } = useStudio();
  const { bookings, loading, error, refresh } = useBookings();
  const { data: catalog } = useApi<Catalog>("/api/catalog");
  const timezone = catalog?.settings.timezone || "Asia/Almaty";
  const today = localDate(timezone);
  const active = bookings.filter((b) =>
    ["confirmed", "in_progress", "awaiting_payment"].includes(b.status),
  );
  const todays = active.filter(
    (b) => DateTime.fromISO(b.startAt).setZone(timezone).toISODate() === today,
  );
  return (
    <>
      <div className="crm-heading">
        <div>
          <p className="eyebrow">STUDIO AT A GLANCE</p>
          <h1>{text("Сегодня в студии", "Бүгін студияда")}</h1>
          <p>
            {DateTime.fromISO(today).setLocale(locale).toFormat("d MMMM yyyy")}{" "}
            · {text("Все физические залы", "Барлық физикалық залдар")}
          </p>
        </div>
        <Link className="button small" href="/crm/bookings/new">
          <Plus size={15} />
          {text("Новая бронь", "Жаңа бронь")}
        </Link>
      </div>
      {loading || error ? (
        <State loading={loading} error={error} retry={refresh} />
      ) : (
        <>
          <div className="stat-grid">
            <article className="stat-card">
              <p>{text("Съёмки сегодня", "Бүгінгі түсірілімдер")}</p>
              <strong>{todays.length}</strong>
              <small>{text("По дате съёмки", "Түсірілім күні бойынша")}</small>
            </article>
            <article className="stat-card">
              <p>{text("Ожидают предоплаты", "Алдын ала төлем күтілуде")}</p>
              <strong>
                {active.filter((b) => b.status === "awaiting_payment").length}
              </strong>
              <small>{text("Активные удержания", "Белсенді сақтаулар")}</small>
            </article>
            <article className="stat-card">
              <p>
                {text(
                  "Остатки по активным заказам",
                  "Белсенді тапсырыстар қалдығы",
                )}
              </p>
              <strong>
                {money(active.reduce((sum, b) => sum + b.balanceMinor, 0))}
              </strong>
              <small>
                {text(
                  "Не является денежными поступлениями",
                  "Ақша түсімі болып саналмайды",
                )}
              </small>
            </article>
            <article className="stat-card">
              <p>{text("Завершённые съёмки", "Аяқталған түсірілімдер")}</p>
              <strong>
                {bookings.filter((b) => b.status === "completed").length}
              </strong>
              <small>
                {text("В последних 200 заказах", "Соңғы 200 тапсырыста")}
              </small>
            </article>
          </div>
          <div className="section-heading" style={{ marginBottom: 20 }}>
            <h2 className="crm-section-title" style={{ margin: 0 }}>
              {text("Ближайшие съёмки", "Алдағы түсірілімдер")}
            </h2>
            <Link className="text-link" href="/crm/calendar">
              {text("Календарь", "Күнтізбе")}
              <ArrowUpRight size={15} />
            </Link>
          </div>
          {active.length ? (
            <BookingTable
              bookings={[...active]
                .sort((a, b) => +new Date(a.startAt) - +new Date(b.startAt))
                .slice(0, 8)}
            />
          ) : (
            <Empty
              title={text("Расписание свободно", "Кесте бос")}
              text={text(
                "Новые бронирования появятся здесь после оформления на сайте.",
                "Жаңа броньдар сайтта рәсімделгеннен кейін осында көрінеді.",
              )}
              action={false}
            />
          )}
          <p className="demo-note">
            {text(
              "Показатели рассчитаны по последним 200 заказам. Тестовые платежи не означают поступление реальных денег.",
              "Көрсеткіштер соңғы 200 тапсырыстан есептелген. Сынақ төлемдері нақты ақша түсімін білдірмейді.",
            )}
          </p>
        </>
      )}
    </>
  );
}
export function CrmBookings() {
  const { t, text } = useStudio();
  const { bookings, loading, error, refresh } = useBookings();
  const [query, setQuery] = useState(""),
    [status, setStatus] = useState("");
  const filtered = bookings.filter(
    (b) =>
      (!status || b.status === status) &&
      `${b.name} ${b.number} ${b.locationName}`
        .toLowerCase()
        .includes(query.toLowerCase()),
  );
  function exportCsv() {
    const cell = (value: unknown) =>
      '"' +
      String(value ?? "")
        .replaceAll('"', '""')
        .replace(/^[=+@-]/, "'$&") +
      '"';
    const csv =
      "\uFEFF" +
      [
        [
          "Номер",
          "Клиент",
          "Локация",
          "Дата UTC",
          "Статус",
          "Стоимость ₸",
          "Остаток ₸",
        ],
        ...filtered.map((b) => [
          b.number,
          b.name,
          b.locationName,
          b.startAt,
          b.status,
          b.totalMinor / 100,
          b.balanceMinor / 100,
        ]),
      ]
        .map((row) => row.map(cell).join(";"))
        .join("\r\n");
    const url = URL.createObjectURL(
      new Blob([csv], { type: "text/csv;charset=utf-8;" }),
    );
    const link = document.createElement("a");
    link.href = url;
    link.download = `frame-bookings-${localDate()}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  }
  return (
    <>
      <div className="crm-heading">
        <div>
          <h1>{text("Бронирования", "Броньдар")}</h1>
          <p>
            {text(
              "Клиенты, время и расчёты. Показаны последние 200 заказов.",
              "Клиенттер, уақыт және есеп. Соңғы 200 тапсырыс көрсетілген.",
            )}
          </p>
        </div>
        <button
          className="button secondary small"
          onClick={exportCsv}
          disabled={!filtered.length}
        >
          <Download size={14} />
          CSV
        </button>
      </div>
      <div className="filter-bar">
        <label>
          {t.search}
          <input
            placeholder={text("Имя, номер, локация", "Аты, нөмірі, локация")}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </label>
        <label>
          {t.status}
          <select value={status} onChange={(e) => setStatus(e.target.value)}>
            <option value="">{text("Все статусы", "Барлық күйлер")}</option>
            {[
              "awaiting_payment",
              "confirmed",
              "in_progress",
              "completed",
              "canceled",
              "expired",
              "no_show",
            ].map((v) => (
              <option value={v} key={v}>
                {(t as Record<string, string>)[v]}
              </option>
            ))}
          </select>
        </label>
      </div>
      {loading || error ? (
        <State loading={loading} error={error} retry={refresh} />
      ) : filtered.length ? (
        <BookingTable bookings={filtered} />
      ) : (
        <Empty
          title={text("Бронирования не найдены", "Броньдар табылмады")}
          action={false}
        />
      )}
    </>
  );
}
export function CrmCalendar() {
  const { t, text, locale } = useStudio();
  const { bookings, loading, error, refresh } = useBookings();
  const { data: catalog } = useApi<Catalog>("/api/catalog");
  const [date, setDate] = useState(localDate),
    [view, setView] = useState("week"),
    [room, setRoom] = useState("");
  const zone = catalog?.settings.timezone || "Asia/Almaty";
  const start = DateTime.fromISO(date, { zone }).startOf(
    view === "month" ? "month" : view === "week" ? "week" : "day",
  );
  const end = start.plus(
    view === "month"
      ? { months: 1 }
      : view === "week"
        ? { weeks: 1 }
        : { days: 1 },
  );
  const events = bookings
    .filter(
      (b) =>
        !["canceled", "expired"].includes(b.status) &&
        DateTime.fromISO(b.startAt) >= start &&
        DateTime.fromISO(b.startAt) < end &&
        (!room ||
          catalog?.locations.find((l) => l.id === b.locationId)?.roomId ===
            room),
    )
    .sort((a, b) => +new Date(a.startAt) - +new Date(b.startAt));
  const grouped = events.reduce<Record<string, Booking[]>>((groups, event) => {
    const key = DateTime.fromISO(event.startAt).setZone(zone).toISODate() || "";
    (groups[key] ??= []).push(event);
    return groups;
  }, {});
  return (
    <>
      <div className="crm-heading">
        <div>
          <h1>{text("Календарь студии", "Студия күнтізбесі")}</h1>
          <p>
            {zone} ·{" "}
            {text(
              "Время съёмок без буферов подготовки",
              "Дайындық буферінсіз түсірілім уақыты",
            )}
          </p>
        </div>
      </div>
      <div className="calendar-toolbar">
        <label className="field">
          {t.date}
          <input
            type="date"
            value={date}
            onChange={(e) => setDate(e.target.value)}
          />
        </label>
        <label className="field">
          {text("Физический зал", "Физикалық зал")}
          <select value={room} onChange={(e) => setRoom(e.target.value)}>
            <option value="">{text("Все залы", "Барлық залдар")}</option>
            {Array.from(
              new Set(catalog?.locations.map((l) => l.roomId) || []),
            ).map((id, i) => (
              <option value={id} key={id}>
                {text("Зал", "Зал")} {i + 1} ·{" "}
                {catalog?.locations
                  .filter((l) => l.roomId === id)
                  .map((l) => l.name)
                  .join(" / ")}
              </option>
            ))}
          </select>
        </label>
        <div className="segment-control">
          {[
            ["day", text("День", "Күн")],
            ["week", text("Неделя", "Апта")],
            ["month", text("Месяц", "Ай")],
          ].map(([value, label]) => (
            <button
              className={view === value ? "active" : ""}
              onClick={() => setView(value)}
              key={value}
            >
              {label}
            </button>
          ))}
        </div>
      </div>
      {loading || error ? (
        <State loading={loading} error={error} retry={refresh} />
      ) : events.length ? (
        <div className="calendar-days">
          {Object.entries(grouped).map(([day, items]) => (
            <section className="calendar-day" key={day}>
              <h3>
                {DateTime.fromISO(day)
                  .setLocale(locale)
                  .toFormat("cccc, d MMMM")}
              </h3>
              {items.map((item) => (
                <div className="calendar-event" key={item.id}>
                  <span>
                    {DateTime.fromISO(item.startAt)
                      .setZone(zone)
                      .toFormat("HH:mm")}{" "}
                    —{" "}
                    {DateTime.fromISO(item.endAt)
                      .setZone(zone)
                      .toFormat("HH:mm")}
                  </span>
                  <div>
                    <strong>{item.locationName}</strong>
                    <p>
                      {item.name}{" "}
                      {item.specialistName ? `/ ${item.specialistName}` : ""}
                    </p>
                  </div>
                  <Link href={`/crm/bookings/${item.id}`}>
                    <StatusBadge status={item.status} />
                    <ArrowUpRight size={16} />
                  </Link>
                </div>
              ))}
            </section>
          ))}
        </div>
      ) : (
        <Empty
          title={text("На этот период съёмок нет", "Бұл кезеңде түсірілім жоқ")}
          text={text(
            "Выберите другой период или дождитесь новых бронирований.",
            "Басқа кезеңді таңдаңыз немесе жаңа броньдарды күтіңіз.",
          )}
          action={false}
        />
      )}
    </>
  );
}
export function CrmResources() {
  const { text, t } = useStudio();
  const { data, loading, error, refresh } = useApi<Catalog>("/api/catalog");
  return (
    <>
      <div className="crm-heading">
        <div>
          <h1>{text("Ресурсы студии", "Студия ресурстары")}</h1>
          <p>
            {text(
              "Опубликованные локации, исполнители и техника. Просмотр текущей конфигурации.",
              "Жарияланған локациялар, мамандар және жабдық. Ағымдағы конфигурацияны қарау.",
            )}
          </p>
        </div>
      </div>
      {loading || error ? (
        <State loading={loading} error={error} retry={refresh} />
      ) : (
        <>
          <h2 className="crm-section-title">{t.locations}</h2>
          <div className="service-list">
            {data?.locations.map((l) => (
              <article className="service-card" key={l.id}>
                <h3>{l.name}</h3>
                <p>
                  {l.area} {t.meters} · {l.capacity} {t.people} ·{" "}
                  {l.versionName}
                </p>
                <strong>
                  {money(l.hourlyPriceMinor)} {t.perHour}
                </strong>
              </article>
            ))}
          </div>
          <h2 className="crm-section-title">
            {text("Оборудование", "Жабдық")}
          </h2>
          <div className="service-list">
            {data?.equipment.map((e) => (
              <article className="service-card" key={e.id}>
                <h3>{e.name}</h3>
                <p>
                  {text("В рабочем состоянии", "Жұмысқа жарамды")}: {e.quantity}
                </p>
                <strong>{money(e.priceMinor)}</strong>
              </article>
            ))}
          </div>
          <div className="notice">
            {text(
              "Изменяйте данные и расписание в разделах «Физические залы», «Локации», «Команда», «Оборудование» и «Настройки».",
              "Деректер мен кестені «Физикалық залдар», «Локациялар», «Команда», «Жабдық» және «Параметрлер» бөлімдерінде өзгертіңіз.",
            )}
          </div>
        </>
      )}
    </>
  );
}
export function SpecialistPage() {
  const { text, t, locale } = useStudio();
  return (
    <PublicShell>
      <section className="section page-width">
        <AccessGate specialist>
          {(user) => (
            <SpecialistBookings
              user={user}
              locale={locale}
              title={text("Мои съёмки", "Менің түсірілімдерім")}
            />
          )}
        </AccessGate>
      </section>
    </PublicShell>
  );
}
function SpecialistBookings({
  user,
  locale,
  title,
}: {
  user: User;
  locale: string;
  title: string;
}) {
  const { text } = useStudio();
  const { data: catalog } = useApi<Catalog>("/api/catalog");
  const timezone = catalog?.settings.timezone || "Asia/Almaty";
  const { data, loading, error, refresh } = useApi<
    Booking[] | { bookings: Booking[] }
  >("/api/bookings?scope=specialist");
  const list = bookingArray(data);
  return (
    <>
      <div className="account-heading">
        <div>
          <p className="eyebrow">CREATOR WORKSPACE</p>
          <h1>{title}</h1>
          <p>{user.name}</p>
        </div>
        <SignOutButton />
      </div>
      {loading || error ? (
        <State loading={loading} error={error} retry={refresh} />
      ) : list.length ? (
        <div className="booking-list">
          {list.map((item) => (
            <article className="booking-list-card" key={item.id}>
              <div>
                <span className="order-number">{item.number}</span>
                <h3>{item.locationName}</h3>
                <p>
                  {dateLabel(item.startAt, locale, timezone)} · {item.name}
                </p>
                {item.comment && (
                  <p style={{ marginTop: 12 }}>{item.comment}</p>
                )}
              </div>
              <div className="booking-list-right">
                <StatusBadge status={item.status} />
              </div>
            </article>
          ))}
        </div>
      ) : (
        <Empty
          title={text(
            "Назначенных съёмок пока нет",
            "Әзірге тағайындалған түсірілім жоқ",
          )}
          action={false}
        />
      )}
    </>
  );
}
