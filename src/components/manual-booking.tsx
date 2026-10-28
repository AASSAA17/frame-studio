"use client";
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import {
  Plus,
  ArrowLeft,
  Check,
  CalendarDays,
  Users,
  ArrowRight,
} from "lucide-react";
import { useStudio } from "./studio-provider";
import {
  api,
  ApiError,
  useApi,
  money,
  dateLabel,
  localDate,
  type Catalog,
  type Booking,
} from "./api";
import { State } from "./shared";
import {
  MutationError,
  SectionHeading,
  useDirtyGuard,
  type Customer,
} from "./management-shared";
import { CustomerEditor, customerArray } from "./client-management";

type Quote = {
  fingerprint?: string;
  items: {
    label: string;
    quantity: number;
    unitPriceMinor: number;
    totalMinor: number;
  }[];
  totalMinor: number;
  depositMinor: number;
  balanceMinor: number;
  version: { id: string; name: string; image?: string };
  rulesText: string;
  rulesVersion: string;
};
export function ManualBookingPage() {
  const { t, text, locale } = useStudio();
  const router = useRouter();
  const catalog = useApi<Catalog>("/api/catalog");
  const [customerQuery, setCustomerQuery] = useState(""),
    [customerId, setCustomerId] = useState(""),
    [source, setSource] = useState("phone"),
    [locationId, setLocationId] = useState(""),
    [date, setDate] = useState(""),
    [duration, setDuration] = useState(60),
    [specialistId, setSpecialistId] = useState(""),
    [serviceIds, setServiceIds] = useState<string[]>([]),
    [equipmentIds, setEquipmentIds] = useState<string[]>([]),
    [guests, setGuests] = useState(1),
    [purpose, setPurpose] = useState("photo"),
    [startAt, setStartAt] = useState(""),
    [comment, setComment] = useState(""),
    [accepted, setAccepted] = useState(false),
    [createCustomer, setCreateCustomer] = useState(false),
    [selectedCustomer, setSelectedCustomer] = useState<Customer | null>(null),
    [busy, setBusy] = useState(false),
    [submitted, setSubmitted] = useState(false),
    [error, setError] = useState<unknown>(null),
    [quote, setQuote] = useState<Quote | null>(null),
    [quoteBusy, setQuoteBusy] = useState(false),
    [quoteError, setQuoteError] = useState<unknown>(null),
    [quoteRevision, setQuoteRevision] = useState(0);
  const pending = useRef<{ signature: string; key: string } | null>(null);
  const customers = useApi<Customer[] | { customers: Customer[] }>(
    `/api/studio/clients?q=${encodeURIComponent(customerQuery)}`,
  );
  const customer =
    selectedCustomer?.id === customerId
      ? selectedCustomer
      : customerArray(customers.data).find((item) => item.id === customerId) ||
        null;
  const clientList = customerArray(customers.data).filter(
    (item) => !item.archivedAt,
  );
  const zone = catalog.data?.settings.timezone || "Asia/Almaty";
  const step = catalog.data?.settings.stepMinutes || 30;
  const minimum =
    Math.ceil((catalog.data?.settings.minimumMinutes || 60) / step) * step;
  const location = catalog.data?.locations.find(
    (item) => item.id === locationId,
  );
  const durationOptions = Array.from(
    { length: Math.floor((Math.max(240, minimum) - minimum) / step) + 1 },
    (_, i) => minimum + i * step,
  );
  useDirtyGuard(!submitted && !!(customerId || locationId || comment));
  useEffect(() => {
    const id = new URLSearchParams(window.location.search).get("customer");
    if (id) {
      setCustomerId(id);
      api<Customer>(`/api/studio/clients/${id}`)
        .then(setSelectedCustomer)
        .catch(setError);
    }
  }, []);
  useEffect(() => {
    if (catalog.data && !date) setDate(localDate(zone));
  }, [catalog.data, date, zone]);
  useEffect(() => {
    if (duration < minimum || duration % step !== 0) {
      setDuration(minimum);
      setStartAt("");
    }
  }, [minimum, step, duration]);
  const query = new URLSearchParams({
    locationId,
    date,
    durationMinutes: String(duration),
    ...(specialistId ? { specialistId } : {}),
    ...(equipmentIds.length ? { equipmentIds: equipmentIds.join(",") } : {}),
  });
  const availability = useApi<{
    slots: {
      startAt: string;
      endAt: string;
      label: string;
      available: boolean;
    }[];
    timezone: string;
  }>(locationId && date ? `/api/availability?${query}` : null);
  const quoteInput = {
    locationId,
    startAt,
    durationMinutes: duration,
    ...(specialistId ? { specialistId } : {}),
    serviceIds,
    equipmentIds,
    purpose,
    guests,
  };
  const quoteSignature = JSON.stringify(quoteInput);
  useEffect(() => {
    setQuote(null);
    setQuoteError(null);
    if (!locationId || !startAt) return;
    let active = true;
    setAccepted(false);
    setQuoteBusy(true);
    api<Quote>("/api/quote", { method: "POST", body: quoteSignature })
      .then((result) => {
        if (active) setQuote(result);
      })
      .catch((reason) => {
        if (active) setQuoteError(reason);
      })
      .finally(() => {
        if (active) setQuoteBusy(false);
      });
    return () => {
      active = false;
    };
  }, [quoteSignature, locationId, startAt, quoteRevision, catalog.data]);
  async function submit() {
    if (!quote || !customer || !accepted) return;
    setBusy(true);
    setError(null);
    const body = {
      ...quoteInput,
      customerId: customer.id,
      source,
      comment,
      acceptRules: true,
      expectedTotalMinor: quote.totalMinor,
      expectedQuoteFingerprint: quote.fingerprint,
    };
    const signature = JSON.stringify(body);
    if (!pending.current || pending.current.signature !== signature)
      pending.current = { signature, key: crypto.randomUUID() };
    try {
      const booking = await api<Booking>("/api/bookings/manual", {
        method: "POST",
        body: JSON.stringify({ ...body, idempotencyKey: pending.current.key }),
      });
      setSubmitted(true);
      router.push(`/crm/bookings/${booking.id}`);
    } catch (reason) {
      setError(reason);
      if (
        reason instanceof ApiError &&
        ["PRICE_CHANGED", "QUOTE_CHANGED"].includes(reason.code || "")
      )
        setAccepted(false);
      availability.refresh();
      setQuoteRevision((value) => value + 1);
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <Link
        className="breadcrumb"
        href="/crm/bookings"
        style={{ marginTop: 0 }}
      >
        <ArrowLeft size={14} />
        {text("Бронирования", "Броньдар")}
      </Link>
      <div style={{ marginTop: 24 }}>
        <SectionHeading
          title={text("Бронь для клиента", "Клиентке бронь")}
          description={text(
            "Заказ из звонка, сообщения или личного обращения. Доступность и стоимость проверяются так же, как на сайте.",
            "Қоңыраудан, хабарламадан немесе жеке өтініштен тапсырыс. Қолжетімділік пен құн сайттағыдай тексеріледі.",
          )}
        />
      </div>
      {catalog.loading || catalog.error ? (
        <State
          loading={catalog.loading}
          error={catalog.error}
          retry={catalog.refresh}
        />
      ) : (
        <div className="manual-booking-layout">
          <div>
            <section className="management-section">
              <header>
                <Users size={21} />
                <div>
                  <h2>{text("Клиент и источник", "Клиент және дереккөз")}</h2>
                  <p>
                    {text(
                      "Выберите карточку или создайте новый контакт.",
                      "Карточка таңдаңыз немесе жаңа байланыс жасаңыз.",
                    )}
                  </p>
                </div>
                <button
                  data-testid="manual-client-add"
                  className="button secondary small"
                  onClick={() => setCreateCustomer(true)}
                >
                  <Plus size={13} />
                  {text("Новый", "Жаңа")}
                </button>
              </header>
              <div className="field-row">
                <label className="field">
                  {text("Поиск клиента", "Клиентті іздеу")}
                  <input
                    data-testid="manual-client-search"
                    value={customerQuery}
                    onChange={(event) => setCustomerQuery(event.target.value)}
                    placeholder={text(
                      "Имя, телефон, почта",
                      "Аты, телефон, пошта",
                    )}
                  />
                </label>
                <label className="field">
                  {text("Источник заказа", "Тапсырыс дереккөзі")}
                  <select
                    data-testid="manual-source"
                    value={source}
                    onChange={(event) => setSource(event.target.value)}
                  >
                    <option value="phone">{text("Звонок", "Қоңырау")}</option>
                    <option value="message">
                      {text("Сообщение", "Хабарлама")}
                    </option>
                    <option value="walk_in">
                      {text("Личное обращение", "Жеке өтініш")}
                    </option>
                    <option value="other">{text("Другое", "Басқа")}</option>
                  </select>
                </label>
              </div>
              {customers.loading || customers.error ? (
                <State
                  loading={customers.loading}
                  error={customers.error}
                  retry={customers.refresh}
                />
              ) : (
                <label className="field" style={{ marginTop: 20 }}>
                  {text("Карточка клиента", "Клиент карточкасы")}
                  <select
                    data-testid="manual-client"
                    required
                    value={customerId}
                    onChange={(event) => {
                      setCustomerId(event.target.value);
                      setSelectedCustomer(
                        clientList.find(
                          (item) => item.id === event.target.value,
                        ) || null,
                      );
                    }}
                  >
                    <option value="">
                      {text("Выберите клиента", "Клиентті таңдаңыз")}
                    </option>
                    {customer &&
                      !clientList.some((item) => item.id === customer.id) && (
                        <option value={customer.id}>{customer.name}</option>
                      )}
                    {clientList.map((item) => (
                      <option value={item.id} key={item.id}>
                        {item.name} ·{" "}
                        {item.phone ||
                          item.email ||
                          text("без контактов", "байланыссыз")}
                      </option>
                    ))}
                  </select>
                </label>
              )}
              {customer && (
                <div className="selected-client">
                  <strong>{customer.name}</strong>
                  <p>
                    {[customer.phone, customer.email]
                      .filter(Boolean)
                      .join(" · ") ||
                      text("Контакты не указаны", "Байланыстар көрсетілмеген")}
                  </p>
                  <small>
                    {text(
                      "Неподтверждённый контакт не даёт доступ к личному кабинету.",
                      "Расталмаған байланыс жеке кабинетке кіру құқығын бермейді.",
                    )}
                  </small>
                </div>
              )}
            </section>
            <section className="management-section">
              <header>
                <CalendarDays size={21} />
                <div>
                  <h2>
                    {text("Съёмка и ресурсы", "Түсірілім және ресурстар")}
                  </h2>
                  <p>
                    {text(
                      "Все даты и время в часовом поясе",
                      "Барлық күн мен уақыт белдеуі",
                    )}
                    : {zone}
                  </p>
                </div>
              </header>
              <div className="field-row">
                <label className="field">
                  {t.locations}
                  <select
                    data-testid="manual-location"
                    value={locationId}
                    onChange={(event) => {
                      setLocationId(event.target.value);
                      setStartAt("");
                    }}
                  >
                    <option value="">
                      {text("Выберите локацию", "Локацияны таңдаңыз")}
                    </option>
                    {catalog.data?.locations.map((item) => (
                      <option value={item.id} key={item.id}>
                        {item.name}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="field">
                  {text("Цель съёмки", "Түсірілім мақсаты")}
                  <select
                    value={purpose}
                    onChange={(event) => setPurpose(event.target.value)}
                  >
                    {[
                      ["photo", text("Фотосъёмка", "Фототүсірілім")],
                      ["video", text("Видео", "Видео")],
                      ["reels", "Reels / TikTok"],
                      ["advertising", text("Реклама", "Жарнама")],
                      ["podcast", text("Подкаст", "Подкаст")],
                      ["personal", text("Личный контент", "Жеке контент")],
                      ["other", text("Другое", "Басқа")],
                    ].map(([value, label]) => (
                      <option key={value} value={value}>
                        {label}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="field">
                  {t.date}
                  <input
                    data-testid="manual-date"
                    type="date"
                    value={date}
                    min={localDate(zone)}
                    onChange={(event) => {
                      setDate(event.target.value);
                      setStartAt("");
                    }}
                  />
                </label>
                <label className="field">
                  {t.duration}
                  <select
                    data-testid="manual-duration"
                    value={duration}
                    onChange={(event) => {
                      setDuration(Number(event.target.value));
                      setStartAt("");
                    }}
                  >
                    {durationOptions.map((value) => (
                      <option key={value} value={value}>
                        {value} {text("минут", "минут")}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="field">
                  {text("Специалист", "Маман")}
                  <select
                    value={specialistId}
                    onChange={(event) => {
                      setSpecialistId(event.target.value);
                      setStartAt("");
                    }}
                  >
                    <option value="">
                      {text("Со своим специалистом", "Өз маманымен")}
                    </option>
                    {catalog.data?.specialists.map((item) => (
                      <option key={item.id} value={item.id}>
                        {item.name} · {money(item.hourlyPriceMinor)} {t.perHour}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="field">
                  {t.guests}
                  <input
                    type="number"
                    min={1}
                    max={location?.capacity || 500}
                    value={guests}
                    onChange={(event) => setGuests(Number(event.target.value))}
                  />
                </label>
              </div>
              <div className="manual-addons">
                <div>
                  <h3>{t.services}</h3>
                  <div className="check-list">
                    {catalog.data?.services.map((item) => (
                      <label className="check-option" key={item.id}>
                        <input
                          type="checkbox"
                          checked={serviceIds.includes(item.id)}
                          onChange={() =>
                            setServiceIds((ids) =>
                              ids.includes(item.id)
                                ? ids.filter((id) => id !== item.id)
                                : [...ids, item.id],
                            )
                          }
                        />
                        <span>{item.name}</span>
                        <small>{money(item.priceMinor)}</small>
                      </label>
                    ))}
                  </div>
                </div>
                <div>
                  <h3>{text("Оборудование", "Жабдық")}</h3>
                  <p className="field-help">
                    {text(
                      "До 20 единиц оборудования на заказ.",
                      "Бір тапсырысқа 20 бірлікке дейін жабдық.",
                    )}
                  </p>
                  <div className="check-list">
                    {catalog.data?.equipment.map((item) => (
                      <label className="check-option" key={item.id}>
                        <span>{item.name}</span>
                        <small>{money(item.priceMinor)}</small>
                        <select
                          data-testid={`manual-equipment-${item.id}`}
                          aria-label={text(
                            `Количество: ${item.name}`,
                            `Саны: ${item.name}`,
                          )}
                          style={{
                            width: 72,
                            minHeight: 38,
                            padding: "8px",
                            flex: "none",
                          }}
                          value={
                            equipmentIds.filter((id) => id === item.id).length
                          }
                          onChange={(event) => {
                            const quantity = Number(event.target.value);
                            setEquipmentIds((ids) => [
                              ...ids.filter((id) => id !== item.id),
                              ...Array.from(
                                { length: quantity },
                                () => item.id,
                              ),
                            ]);
                            setStartAt("");
                          }}
                        >
                          {Array.from(
                            {
                              length:
                                Math.min(
                                  item.quantity,
                                  20 -
                                    equipmentIds.filter((id) => id !== item.id)
                                      .length,
                                ) + 1,
                            },
                            (_, quantity) => (
                              <option value={quantity} key={quantity}>
                                {quantity}
                              </option>
                            ),
                          )}
                        </select>
                      </label>
                    ))}
                  </div>
                </div>
              </div>
              <h3 className="section-subtitle">
                {text("Доступное время", "Бос уақыт")}
              </h3>
              {!locationId ? (
                <p className="management-empty">
                  {text(
                    "Сначала выберите локацию.",
                    "Алдымен локацияны таңдаңыз.",
                  )}
                </p>
              ) : availability.loading || availability.error ? (
                <State
                  loading={availability.loading}
                  error={availability.error}
                  retry={availability.refresh}
                />
              ) : (
                <>
                  <div className="time-slots">
                    {availability.data?.slots.map((slot, index) => (
                      <button
                        data-testid={`manual-slot-${index}`}
                        key={slot.startAt}
                        disabled={!slot.available}
                        className={startAt === slot.startAt ? "selected" : ""}
                        aria-pressed={startAt === slot.startAt}
                        onClick={() => setStartAt(slot.startAt)}
                      >
                        {slot.label}
                      </button>
                    ))}
                  </div>
                  {!availability.data?.slots.some((slot) => slot.available) && (
                    <p className="management-empty">
                      {text(
                        "Свободного времени нет. Выберите другую дату или состав ресурсов.",
                        "Бос уақыт жоқ. Басқа күнді немесе ресурс құрамын таңдаңыз.",
                      )}
                    </p>
                  )}
                </>
              )}
            </section>
            <section className="management-section">
              <label className="field">
                {t.comment}
                <textarea
                  value={comment}
                  maxLength={2000}
                  onChange={(event) => setComment(event.target.value)}
                  placeholder={text(
                    "Детали договорённости с клиентом…",
                    "Клиентпен келісім мәліметтері…",
                  )}
                />
              </label>
            </section>
          </div>
          <aside className="manual-summary">
            <section className="order-panel">
              <p className="eyebrow">
                {text("Проверка заказа", "Тапсырысты тексеру")}
              </p>
              <h2 style={{ marginTop: 15 }}>
                {location?.name || text("Новая съёмка", "Жаңа түсірілім")}
              </h2>
              {customer && <p>{customer.name}</p>}
              {startAt && (
                <p style={{ fontSize: 12, marginTop: 10 }}>
                  {dateLabel(startAt, locale, zone)} · {duration}{" "}
                  {text("мин", "мин")}
                </p>
              )}
              {quoteBusy ? (
                <p className="summary-note">
                  {text("Рассчитываем…", "Есептелуде…")}
                </p>
              ) : quote ? (
                <>
                  <p className="summary-note">{quote.version.name}</p>
                  {quote.items.map((item, index) => (
                    <div className="summary-row" key={index}>
                      <span>{item.label}</span>
                      <strong>{money(item.totalMinor)}</strong>
                    </div>
                  ))}
                  <div className="summary-total">
                    <span>{t.total}</span>
                    <strong>{money(quote.totalMinor)}</strong>
                  </div>
                  <div className="summary-row">
                    <span>{t.deposit}</span>
                    <strong>{money(quote.depositMinor)}</strong>
                  </div>
                  <p className="summary-note">{quote.rulesText}</p>
                </>
              ) : (
                <p className="summary-note">
                  {text(
                    "Выберите время для расчёта стоимости.",
                    "Құнды есептеу үшін уақытты таңдаңыз.",
                  )}
                </p>
              )}
              <MutationError error={quoteError} />
              <label className="check-label" style={{ marginTop: 25 }}>
                <input
                  data-testid="manual-rules"
                  type="checkbox"
                  checked={accepted}
                  onChange={(event) => setAccepted(event.target.checked)}
                />
                <span>
                  {text(
                    "Клиенту переданы состав заказа, стоимость и правила аренды.",
                    "Клиентке тапсырыс құрамы, құны және жалдау ережелері берілді.",
                  )}
                </span>
              </label>
              <MutationError error={error} />
              <button
                data-testid="manual-submit"
                className="button full"
                style={{ marginTop: 22 }}
                disabled={
                  busy ||
                  !quote ||
                  quoteBusy ||
                  !accepted ||
                  !customer ||
                  !!customer.archivedAt
                }
                onClick={submit}
              >
                {busy
                  ? text("Создаём…", "Жасалуда…")
                  : text("Создать бронирование", "Бронь жасау")}
                <ArrowRight size={15} />
              </button>
              <p className="summary-note">
                {text(
                  "Платёж не создаётся автоматически. Время удерживается до предоплаты по настройкам студии; поступление денег сотрудник фиксирует отдельно.",
                  "Төлем автоматты жасалмайды. Уақыт студия параметрлері бойынша алдын ала төлемге дейін сақталады; ақша түсімін қызметкер бөлек тіркейді.",
                )}
              </p>
            </section>
          </aside>
        </div>
      )}
      {createCustomer && (
        <CustomerEditor
          onClose={() => setCreateCustomer(false)}
          onSaved={(customer) => {
            setSelectedCustomer(customer);
            setCustomerId(customer.id);
            customers.refresh();
          }}
        />
      )}
    </>
  );
}
