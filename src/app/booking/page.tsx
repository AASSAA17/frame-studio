"use client";
import { useEffect, useState, useRef } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import {
  ArrowLeft,
  ArrowRight,
  Check,
  CalendarDays,
  Clock3,
  Users,
  MapPin,
} from "lucide-react";
import { PublicShell, State } from "@/components/shared";
import { useStudio } from "@/components/studio-provider";
import {
  api,
  ApiError,
  useApi,
  money,
  localDate,
  dateLabel,
  type Catalog,
  type Booking,
  type User,
} from "@/components/api";

type Quote = {
  items: {
    label: string;
    quantity: number;
    unitPriceMinor: number;
    totalMinor: number;
  }[];
  totalMinor: number;
  depositMinor: number;
  balanceMinor: number;
  currency: string;
  version: { name: string; id: string; image?: string };
  fingerprint?: string;
  rulesText?: string;
  rulesVersion?: string;
};
type Draft = {
  purpose: string;
  locationId: string;
  date: string;
  durationMinutes: number;
  startAt: string;
  specialistId: string;
  serviceIds: string[];
  equipmentIds: string[];
  guests: number;
};
const initial: Draft = {
  purpose: "photo",
  locationId: "",
  date: "",
  durationMinutes: 60,
  startAt: "",
  specialistId: "",
  serviceIds: [],
  equipmentIds: [],
  guests: 1,
};
export default function BookingPage() {
  const { t, text, locale } = useStudio();
  const router = useRouter();
  const pendingIntent = useRef<{ signature: string; key: string } | null>(null);
  const [quoteRevision, setQuoteRevision] = useState(0);
  const catalog = useApi<Catalog>("/api/catalog");
  const session = useApi<{ user: User | null }>("/api/session");
  const [draft, setDraft] = useState<Draft>(initial),
    [ready, setReady] = useState(false),
    [step, setStep] = useState(0),
    [name, setName] = useState(""),
    [phone, setPhone] = useState(""),
    [comment, setComment] = useState(""),
    [accepted, setAccepted] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [quote, setQuote] = useState<Quote | null>(null),
    [quoteBusy, setQuoteBusy] = useState(false),
    [quoteError, setQuoteError] = useState("");
  useEffect(() => {
    let saved: Partial<Draft> = {};
    try {
      saved = JSON.parse(sessionStorage.getItem("frame-booking-draft") || "{}");
    } catch {}
    const params = new URLSearchParams(window.location.search);
    setDraft({
      ...initial,
      ...saved,
      date: saved.date && saved.date >= localDate() ? saved.date : localDate(),
      locationId: params.get("location") || saved.locationId || "",
      specialistId: params.get("specialist") || saved.specialistId || "",
      serviceIds: Array.isArray(saved.serviceIds) ? saved.serviceIds : [],
      equipmentIds: Array.isArray(saved.equipmentIds) ? saved.equipmentIds : [],
    });
    setReady(true);
  }, []);
  useEffect(() => {
    if (ready)
      sessionStorage.setItem("frame-booking-draft", JSON.stringify(draft));
  }, [draft, ready]);
  useEffect(() => {
    if (session.data?.user?.name && !name) setName(session.data.user.name);
  }, [session.data?.user?.name, name]);
  const timezone = catalog.data?.settings.timezone || "Asia/Almaty";
  const stepMinutes = catalog.data?.settings.stepMinutes || 30;
  const minimumMinutes =
    Math.ceil((catalog.data?.settings.minimumMinutes || 60) / stepMinutes) *
    stepMinutes;
  const durationOptions = Array.from(
    {
      length:
        Math.floor(
          (Math.max(240, minimumMinutes) - minimumMinutes) / stepMinutes,
        ) + 1,
    },
    (_, i) => minimumMinutes + i * stepMinutes,
  );
  useEffect(() => {
    if (
      catalog.data &&
      ready &&
      (draft.durationMinutes < minimumMinutes ||
        draft.durationMinutes % stepMinutes !== 0)
    )
      setDraft((old) => ({
        ...old,
        durationMinutes: minimumMinutes,
        startAt: "",
      }));
  }, [catalog.data, ready, draft.durationMinutes, minimumMinutes, stepMinutes]);
  const location = catalog.data?.locations.find(
    (item) => item.id === draft.locationId,
  );
  const specialist = catalog.data?.specialists.find(
    (item) => item.id === draft.specialistId,
  );
  const query = new URLSearchParams({
    locationId: draft.locationId,
    date: draft.date,
    durationMinutes: String(draft.durationMinutes),
    ...(draft.specialistId ? { specialistId: draft.specialistId } : {}),
    ...(draft.equipmentIds.length
      ? { equipmentIds: draft.equipmentIds.join(",") }
      : {}),
  });
  const availability = useApi<{
    slots: {
      startAt: string;
      endAt: string;
      label: string;
      available: boolean;
    }[];
    timezone: string;
  }>(draft.locationId && draft.date ? `/api/availability?${query}` : null);
  const body = {
    locationId: draft.locationId,
    startAt: draft.startAt,
    durationMinutes: draft.durationMinutes,
    ...(draft.specialistId ? { specialistId: draft.specialistId } : {}),
    serviceIds: draft.serviceIds,
    equipmentIds: draft.equipmentIds,
    purpose: draft.purpose,
    guests: draft.guests,
  };
  const bodyKey = JSON.stringify(body);
  useEffect(() => {
    if (!draft.locationId || !draft.startAt) {
      setQuote(null);
      return;
    }
    let active = true;
    setAccepted(false);
    setQuoteBusy(true);
    setQuoteError("");
    setQuote(null);
    api<Quote>("/api/quote", { method: "POST", body: bodyKey })
      .then((value) => {
        if (active) setQuote(value);
      })
      .catch((err) => {
        if (active) setQuoteError(err.message);
      })
      .finally(() => {
        if (active) setQuoteBusy(false);
      });
    return () => {
      active = false;
    };
  }, [bodyKey, draft.locationId, draft.startAt, quoteRevision, catalog.data]);
  const update = (value: Partial<Draft>, resetTime = false) => {
    setDraft((old) => ({
      ...old,
      ...value,
      ...(resetTime ? { startAt: "" } : {}),
    }));
    setError("");
  };
  const toggle = (key: "serviceIds" | "equipmentIds", id: string) => {
    update(
      {
        [key]: draft[key].includes(id)
          ? draft[key].filter((x) => x !== id)
          : [...draft[key], id],
      },
      key === "equipmentIds",
    );
  };
  const next = () => {
    setError("");
    if (step === 0 && !draft.locationId) {
      setError(text("Выберите локацию.", "Локацияны таңдаңыз."));
      return;
    }
    if (step === 1 && !draft.startAt) {
      setError(text("Выберите доступное время.", "Бос уақытты таңдаңыз."));
      return;
    }
    if (step === 2 && (!name.trim() || !phone.trim())) {
      setError(
        text(
          "Укажите имя и телефон.",
          "Аты-жөніңізді және телефонды енгізіңіз.",
        ),
      );
      return;
    }
    setStep((s) => s + 1);
    window.scrollTo({ top: 180, behavior: "smooth" });
  };
  const submit = async () => {
    if (!accepted || !quote) return;
    setBusy(true);
    setError("");
    const submission = {
      ...body,
      name,
      phone,
      comment,
      acceptRules: true,
      expectedTotalMinor: quote.totalMinor,
      expectedQuoteFingerprint: quote.fingerprint,
    };
    const signature = JSON.stringify(submission);
    if (!pendingIntent.current || pendingIntent.current.signature !== signature)
      pendingIntent.current = { signature, key: crypto.randomUUID() };
    try {
      const booking = await api<Booking>("/api/bookings", {
        method: "POST",
        body: JSON.stringify({
          ...submission,
          idempotencyKey: pendingIntent.current.key,
        }),
      });
      sessionStorage.removeItem("frame-booking-draft");
      router.push(`/account/bookings/${booking.id}`);
    } catch (err) {
      const changed =
        err instanceof ApiError &&
        ["QUOTE_CHANGED", "PRICE_CHANGED"].includes(err.code || "");
      setError(
        changed
          ? text(
              "Условия заказа изменились. Проверьте новый расчёт и правила, затем подтвердите их снова.",
              "Тапсырыс шарттары өзгерді. Жаңа есеп пен ережелерді тексеріп, қайта растаңыз.",
            )
          : err instanceof Error
            ? err.message
            : t.error,
      );
      if (changed) {
        setAccepted(false);
        setQuoteRevision((value) => value + 1);
      }
      availability.refresh();
    } finally {
      setBusy(false);
    }
  };
  const purposes = [
    ["photo", text("Фотосъёмка", "Фототүсірілім")],
    ["video", text("Видеосъёмка", "Бейнетүсірілім")],
    ["reels", "Reels / TikTok"],
    ["advertising", text("Реклама", "Жарнама")],
    ["podcast", text("Подкаст", "Подкаст")],
    ["personal", text("Личный контент", "Жеке контент")],
  ];
  return (
    <PublicShell>
      <div className="page-width">
        <section className="page-intro">
          <p className="eyebrow">LET’S CREATE SOMETHING</p>
          <h1>
            {t.book}
            <span className="serif">.</span>
          </h1>
          <p>
            {text(
              "Ваше пространство, время и команда — в нескольких шагах.",
              "Сіздің кеңістігіңіз, уақытыңыз және командаңыз — бірнеше қадамда.",
            )}
          </p>
        </section>
        {catalog.loading || catalog.error ? (
          <State
            loading={catalog.loading}
            error={catalog.error}
            retry={catalog.refresh}
          />
        ) : (
          <div className="booking-layout">
            <div>
              <div className="wizard-steps">
                {[
                  text("Идея и локация", "Идея және орын"),
                  text("Время и команда", "Уақыт және команда"),
                  text("Ваши данные", "Деректеріңіз"),
                  text("Проверка", "Тексеру"),
                ].map((label, i) => (
                  <span key={label} className={i === step ? "active" : ""}>
                    <b>{i < step ? <Check size={12} /> : i + 1}</b>
                    {label}
                  </span>
                ))}
              </div>
              <div className="wizard-body">
                {step === 0 && (
                  <>
                    <h2>{text("Начнём с идеи", "Идеядан бастайық")}</h2>
                    <p>
                      {text("Что вы хотите создать?", "Не жасағыңыз келеді?")}
                    </p>
                    <div className="choice-grid" data-testid="booking-purpose">
                      {purposes.map(([value, label]) => (
                        <button
                          key={value}
                          className={`choice-card ${draft.purpose === value ? "selected" : ""}`}
                          aria-pressed={draft.purpose === value}
                          onClick={() => update({ purpose: value })}
                        >
                          <span className="check-marker">
                            {draft.purpose === value && <Check size={11} />}
                          </span>
                          {label}
                        </button>
                      ))}
                    </div>
                    <div className="wizard-section">
                      <h3>{t.locations}</h3>
                      <div className="choice-grid">
                        {catalog.data?.locations.map((item) => (
                          <button
                            data-testid={`booking-location-${item.id}`}
                            key={item.id}
                            className={`choice-card location-choice ${draft.locationId === item.id ? "selected" : ""}`}
                            aria-pressed={draft.locationId === item.id}
                            onClick={() =>
                              update({ locationId: item.id }, true)
                            }
                          >
                            <img
                              className="choice-image"
                              src={item.image}
                              alt=""
                            />
                            <div>
                              <h3>{item.name}</h3>
                              <p>
                                {money(item.hourlyPriceMinor)} {t.perHour}
                              </p>
                            </div>
                          </button>
                        ))}
                      </div>
                    </div>
                  </>
                )}
                {step === 1 && (
                  <>
                    <h2>{text("Найдём ваше время", "Сізге ыңғайлы уақыт")}</h2>
                    <p>
                      {text(
                        "Часовой пояс студии указан ниже. При изменении команды или техники выберите время заново.",
                        "Студияның уақыт белдеуі төменде көрсетілген. Команда немесе жабдық өзгерсе, уақытты қайта таңдаңыз.",
                      )}{" "}
                      {timezone}
                    </p>
                    <div className="field-row">
                      <label className="field">
                        {t.date}
                        <input
                          data-testid="booking-date"
                          type="date"
                          min={localDate(timezone)}
                          value={draft.date}
                          onChange={(e) =>
                            update({ date: e.target.value }, true)
                          }
                        />
                      </label>
                      <label className="field">
                        {t.duration}
                        <select
                          data-testid="booking-duration"
                          value={draft.durationMinutes}
                          onChange={(e) =>
                            update(
                              { durationMinutes: Number(e.target.value) },
                              true,
                            )
                          }
                        >
                          {durationOptions.map((v) => (
                            <option value={v} key={v}>
                              {v} {text("минут", "минут")}
                            </option>
                          ))}
                        </select>
                      </label>
                    </div>
                    <div className="wizard-section">
                      <h3>{text("Ваша команда", "Сіздің командаңыз")}</h3>
                      <label className="field">
                        {text("Специалист", "Маман")}
                        <select
                          value={draft.specialistId}
                          onChange={(e) =>
                            update({ specialistId: e.target.value }, true)
                          }
                        >
                          <option value="">
                            {text(
                              "Приду со своим специалистом — без доплаты",
                              "Өз маманыммен келемін — қосымша төлемсіз",
                            )}
                          </option>
                          {catalog.data?.specialists.map((person) => (
                            <option key={person.id} value={person.id}>
                              {person.name} · {person.specialty} ·{" "}
                              {money(person.hourlyPriceMinor)} {t.perHour}
                            </option>
                          ))}
                        </select>
                      </label>
                    </div>
                    <div className="wizard-section">
                      <h3>{t.services}</h3>
                      <div className="check-list">
                        {catalog.data?.services.map((service) => (
                          <label className="check-option" key={service.id}>
                            <input
                              type="checkbox"
                              checked={draft.serviceIds.includes(service.id)}
                              onChange={() => toggle("serviceIds", service.id)}
                            />
                            <span>{service.name}</span>
                            <small>{money(service.priceMinor)}</small>
                          </label>
                        ))}
                      </div>
                    </div>
                    <div className="wizard-section">
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
                            <input
                              type="checkbox"
                              checked={draft.equipmentIds.includes(item.id)}
                              disabled={
                                !draft.equipmentIds.includes(item.id) &&
                                draft.equipmentIds.length >= 20
                              }
                              onChange={() => toggle("equipmentIds", item.id)}
                            />
                            <span>{item.name}</span>
                            <small>{money(item.priceMinor)}</small>
                          </label>
                        ))}
                      </div>
                    </div>
                    <div className="wizard-section">
                      <h3>{text("Доступное время", "Бос уақыт")}</h3>
                      {availability.loading || availability.error ? (
                        <State
                          loading={availability.loading}
                          error={availability.error}
                          retry={availability.refresh}
                        />
                      ) : availability.data?.slots.length ? (
                        <div className="time-slots">
                          {availability.data.slots.map((slot, index) => (
                            <button
                              data-testid={`booking-slot-${index}`}
                              key={slot.startAt}
                              disabled={!slot.available}
                              aria-pressed={draft.startAt === slot.startAt}
                              className={
                                draft.startAt === slot.startAt ? "selected" : ""
                              }
                              onClick={() => update({ startAt: slot.startAt })}
                            >
                              {slot.label}
                            </button>
                          ))}
                        </div>
                      ) : (
                        <div className="notice">
                          {text(
                            "На эту дату свободного времени нет. Выберите другой день.",
                            "Бұл күнге бос уақыт жоқ. Басқа күнді таңдаңыз.",
                          )}
                        </div>
                      )}
                    </div>
                  </>
                )}
                {step === 2 && (
                  <>
                    <h2>{text("Познакомимся?", "Танысайық?")}</h2>
                    <p>
                      {text(
                        "Эти данные нужны для организации вашей съёмки.",
                        "Бұл деректер түсірілімді ұйымдастыру үшін қажет.",
                      )}
                    </p>
                    {!session.data?.user && (
                      <div className="notice" style={{ marginBottom: 22 }}>
                        {text(
                          "Для оформления войдите с подтверждённой почтой. Выбранная съёмка сохранится в этой вкладке.",
                          "Брондау үшін расталған поштамен кіріңіз. Таңдалған түсірілім осы қойындыда сақталады.",
                        )}{" "}
                        <Link className="text-link" href="/login?next=/booking">
                          {t.signIn}
                        </Link>
                      </div>
                    )}
                    <div className="form-stack">
                      <div className="field-row">
                        <label className="field">
                          {t.name}
                          <input
                            data-testid="booking-name"
                            autoComplete="name"
                            value={name}
                            onChange={(e) => setName(e.target.value)}
                            maxLength={100}
                            required
                          />
                        </label>
                        <label className="field">
                          {t.phone}
                          <input
                            data-testid="booking-phone"
                            type="tel"
                            autoComplete="tel"
                            value={phone}
                            onChange={(e) => setPhone(e.target.value)}
                            placeholder="+7 …"
                            maxLength={30}
                            required
                          />
                        </label>
                      </div>
                      <label className="field">
                        {t.guests}
                        <input
                          type="number"
                          min="1"
                          max={location?.capacity || 30}
                          value={draft.guests}
                          onChange={(e) =>
                            update({ guests: Number(e.target.value) })
                          }
                        />
                        <small>
                          {text(
                            "Включая фотографа и других участников команды.",
                            "Фотограф пен басқа команда мүшелерін қоса алғанда.",
                          )}
                        </small>
                      </label>
                      <label className="field">
                        {t.comment}
                        <textarea
                          value={comment}
                          onChange={(e) => setComment(e.target.value)}
                          maxLength={2000}
                          placeholder={text(
                            "Расскажите, что важно учесть перед съёмкой…",
                            "Түсірілім алдында нені ескеру керектігін жазыңыз…",
                          )}
                        />
                      </label>
                    </div>
                  </>
                )}
                {step === 3 && (
                  <>
                    <h2>{text("Всё на своих местах", "Бәрі өз орнында")}</h2>
                    <p>
                      {text(
                        "Проверьте детали перед созданием бронирования.",
                        "Бронь жасамас бұрын мәліметтерді тексеріңіз.",
                      )}
                    </p>
                    <dl className="review-grid">
                      {[
                        [
                          t.locations,
                          `${location?.name} · ${quote?.version.name || location?.versionName}`,
                        ],
                        [
                          t.date,
                          draft.startAt
                            ? dateLabel(draft.startAt, locale, timezone)
                            : "—",
                        ],
                        [
                          t.duration,
                          `${draft.durationMinutes} ${text("минут", "минут")}`,
                        ],
                        [
                          t.team,
                          specialist?.name ||
                            text("Свой специалист", "Өз маманыңыз"),
                        ],
                        [t.name, name],
                        [t.phone, phone],
                        [t.guests, String(draft.guests)],
                      ].map(([label, value]) => (
                        <div key={label}>
                          <dt>{label}</dt>
                          <dd>{value}</dd>
                        </div>
                      ))}
                    </dl>
                    <div className="notice" style={{ marginTop: 22 }}>
                      {quote?.rulesText ||
                        catalog.data?.settings.rulesText ||
                        text(
                          "Тестовые условия аренды. Перед реальной работой правила должны быть утверждены студией.",
                          "Жалдаудың сынақ шарттары. Нақты жұмыс алдында студия ережелерді бекітуі тиіс.",
                        )}
                    </div>
                    <label className="check-label" style={{ marginTop: 20 }}>
                      <input
                        data-testid="booking-rules"
                        type="checkbox"
                        checked={accepted}
                        onChange={(e) => setAccepted(e.target.checked)}
                      />
                      <span>
                        {text(
                          "Я ознакомился с составом заказа, тестовыми условиями и ",
                          "Мен тапсырыс құрамымен, сынақ шарттарымен және ",
                        )}
                        <Link
                          className="inline-button"
                          href="/rules"
                          target="_blank"
                        >
                          {t.rules.toLowerCase()}
                        </Link>
                        {locale === "kk" ? " таныстым." : "."}
                      </span>
                    </label>
                    {!session.data?.user && (
                      <div className="notice" style={{ marginTop: 18 }}>
                        <Link href="/login?next=/booking" className="text-link">
                          {text(
                            "Войдите, чтобы продолжить",
                            "Жалғастыру үшін кіріңіз",
                          )}
                        </Link>
                      </div>
                    )}
                  </>
                )}
                {error && (
                  <div
                    role="alert"
                    className="notice error"
                    style={{ marginTop: 20 }}
                  >
                    {error}
                  </div>
                )}
                {quoteError && step > 0 && (
                  <div
                    className="notice error"
                    role="alert"
                    style={{ marginTop: 20 }}
                  >
                    {quoteError}
                  </div>
                )}
                <div className="wizard-actions">
                  <button
                    className="button secondary"
                    disabled={step === 0 || busy}
                    onClick={() => {
                      setStep(step - 1);
                      setError("");
                    }}
                  >
                    <ArrowLeft size={16} />
                    {t.back}
                  </button>
                  {step < 3 ? (
                    <button
                      data-testid="booking-next"
                      className="button"
                      onClick={next}
                    >
                      {t.next}
                      <ArrowRight size={16} />
                    </button>
                  ) : (
                    <button
                      data-testid="booking-submit"
                      className="button"
                      disabled={
                        busy ||
                        !accepted ||
                        !quote ||
                        quoteBusy ||
                        !session.data?.user
                      }
                      onClick={submit}
                    >
                      {busy
                        ? text("Оформляем…", "Рәсімделуде…")
                        : text("Создать бронирование", "Бронь жасау")}
                      <ArrowRight size={16} />
                    </button>
                  )}
                </div>
              </div>
            </div>
            <aside className="order-summary">
              <img
                className="summary-image"
                src={
                  quote?.version.image ||
                  location?.currentVersion?.image ||
                  location?.image ||
                  "/images/daylight.svg"
                }
                alt={location?.name || t.illustration}
              />
              <div className="summary-body">
                <p className="eyebrow">
                  YOUR FRAME / {text("Ваша съёмка", "Сіздің түсіріліміңіз")}
                </p>
                <h3>
                  {location?.name ||
                    text("Выберите пространство", "Кеңістікті таңдаңыз")}
                </h3>
                <div className="summary-details">
                  <div>
                    <MapPin size={15} />
                    {t.city}
                  </div>
                  <div>
                    <CalendarDays size={15} />
                    {draft.startAt
                      ? dateLabel(draft.startAt, locale, timezone)
                      : text(
                          "Дата и время не выбраны",
                          "Күн мен уақыт таңдалмаған",
                        )}
                  </div>
                  <div>
                    <Clock3 size={15} />
                    {draft.durationMinutes} {text("минут", "минут")}
                  </div>
                  <div>
                    <Users size={15} />
                    {draft.guests} {t.people}
                  </div>
                </div>
                {quoteBusy ? (
                  <p className="summary-note">
                    {text("Рассчитываем стоимость…", "Құны есептелуде…")}
                  </p>
                ) : quote ? (
                  <>
                    {quote.items.map((item, i) => (
                      <div className="summary-row" key={i}>
                        <span>{item.label}</span>
                        <strong>{money(item.totalMinor)}</strong>
                      </div>
                    ))}
                    <div className="summary-total">
                      <span>{t.total}</span>
                      <span>{money(quote.totalMinor)}</span>
                    </div>
                    <div className="summary-row">
                      <span>
                        {t.deposit} (
                        {catalog.data?.settings.depositPercent || 30}%)
                      </span>
                      <strong>{money(quote.depositMinor)}</strong>
                    </div>
                    <div className="summary-row">
                      <span>{t.balance}</span>
                      <strong>{money(quote.balanceMinor)}</strong>
                    </div>
                  </>
                ) : (
                  <p className="summary-note">
                    {text(
                      "Выберите время, чтобы получить точный расчёт.",
                      "Нақты есепті алу үшін уақытты таңдаңыз.",
                    )}
                  </p>
                )}
                <p className="summary-note">
                  {text(
                    "Демонстрационный режим. Все цены тестовые. После оформления время удерживается для тестовой предоплаты.",
                    "Демонстрациялық режим. Барлық бағалар сынақ үшін. Рәсімдеуден кейін уақыт сынақ төлеміне сақталады.",
                  )}{" "}
                  {catalog.data?.settings.holdMinutes} {text("минут", "минут")}.
                </p>
              </div>
            </aside>
          </div>
        )}
      </div>
    </PublicShell>
  );
}
