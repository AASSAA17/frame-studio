"use client";
import { useEffect, useState, useRef } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  Aperture,
  ArrowUpRight,
  ArrowLeft,
  Check,
  Clock3,
  CalendarDays,
  Users,
  LogOut,
} from "lucide-react";
import { DateTime } from "luxon";
import { authClient } from "@/lib/auth-client";
import { useStudio } from "./studio-provider";
import {
  api,
  useApi,
  money,
  dateLabel,
  bookingArray,
  type Booking,
  type User,
  type Catalog,
} from "./api";
import { PublicShell, State, StatusBadge, Empty } from "./shared";

export function AccessGate({
  children,
  staff = false,
  specialist = false,
}: {
  children: (user: User) => React.ReactNode;
  staff?: boolean;
  specialist?: boolean;
}) {
  const { t, text } = useStudio();
  const pathname = usePathname();
  const { data, loading, error, refresh } = useApi<{ user: User | null }>(
    "/api/session",
  );
  if (loading || error)
    return <State loading={loading} error={error} retry={refresh} />;
  if (!data?.user)
    return (
      <div className="empty-state">
        <h2>
          {text("Это ваше личное пространство", "Бұл сіздің жеке кеңістігіңіз")}
        </h2>
        <p>
          {text(
            "Войдите, чтобы увидеть свои бронирования.",
            "Броньдарыңызды көру үшін кіріңіз.",
          )}
        </p>
        <Link
          className="button"
          href={`/login?next=${encodeURIComponent(pathname)}`}
        >
          {t.signIn}
          <ArrowUpRight size={16} />
        </Link>
      </div>
    );
  if (
    (staff && !["OWNER", "ADMIN"].includes(data.user.role)) ||
    (specialist && data.user.role !== "SPECIALIST")
  )
    return (
      <State
        error={text(
          "У этой учётной записи нет доступа к разделу.",
          "Бұл аккаунттың бөлімге кіру құқығы жоқ.",
        )}
      />
    );
  return <>{children(data.user)}</>;
}
export function SignOutButton() {
  const { t } = useStudio();
  const [busy, setBusy] = useState(false);
  return (
    <button
      className="button secondary small"
      disabled={busy}
      onClick={async () => {
        setBusy(true);
        await authClient.signOut();
        window.location.assign("/");
      }}
    >
      <LogOut size={14} />
      {t.signOut}
    </button>
  );
}
function AccountBookings({ user }: { user: User }) {
  const { t, locale, text } = useStudio();
  const { data: catalog } = useApi<Catalog>("/api/catalog");
  const timezone = catalog?.settings.timezone || "Asia/Almaty";
  const { data, loading, error, refresh } = useApi<
    Booking[] | { bookings: Booking[] }
  >("/api/bookings");
  const list = bookingArray(data);
  const [sessionMessage, setSessionMessage] = useState("");
  return (
    <>
      <div className="account-heading">
        <div>
          <p className="eyebrow">YOUR NEXT CHAPTER</p>
          <h1>{t.myBookings}</h1>
          <p>
            {text("Рады видеть вас,", "Қош келдіңіз,")} {user.name}.
          </p>
        </div>
        <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
          {["OWNER", "ADMIN"].includes(user.role) && (
            <Link className="button secondary small" href="/crm">
              CRM
              <ArrowUpRight size={14} />
            </Link>
          )}
          {user.role === "SPECIALIST" && (
            <Link className="button secondary small" href="/specialist">
              {text("Мои съёмки", "Менің түсірілімдерім")}
            </Link>
          )}
          <SignOutButton />
        </div>
      </div>
      {loading || error ? (
        <State loading={loading} error={error} retry={refresh} />
      ) : !list.length ? (
        <Empty title={t.noBookings} text={t.noBookingsText} />
      ) : (
        <div className="booking-list">
          {list.map((booking) => (
            <Link
              className="booking-list-card"
              href={`/account/bookings/${booking.id}`}
              key={booking.id}
            >
              <div className="booking-icon">
                <Aperture size={28} strokeWidth={1} />
              </div>
              <div>
                <span className="order-number">{booking.number}</span>
                <h3>{booking.locationName}</h3>
                <p>
                  {dateLabel(booking.startAt, locale, timezone)} ·{" "}
                  {Math.round(
                    (+new Date(booking.endAt) - +new Date(booking.startAt)) /
                      60000,
                  )}{" "}
                  {text("мин", "мин")}
                </p>
              </div>
              <div className="booking-list-right">
                <StatusBadge status={booking.status} />
                <strong>{money(booking.totalMinor)}</strong>
              </div>
            </Link>
          ))}
        </div>
      )}
      <div style={{ marginTop: 28 }}>
        <button
          className="inline-button"
          onClick={async () => {
            const result = await authClient.revokeOtherSessions();
            setSessionMessage(
              result.error
                ? result.error.message || t.error
                : text("Другие сеансы завершены.", "Басқа сеанстар аяқталды."),
            );
          }}
        >
          {text("Завершить другие сеансы", "Басқа сеанстарды аяқтау")}
        </button>
        {sessionMessage && (
          <p role="status" style={{ fontSize: 12, marginTop: 10 }}>
            {sessionMessage}
          </p>
        )}
      </div>
    </>
  );
}
export function AccountPage() {
  return (
    <PublicShell>
      <section className="section page-width">
        <AccessGate>{(user) => <AccountBookings user={user} />}</AccessGate>
      </section>
    </PublicShell>
  );
}
function HoldTimer({ expiresAt }: { expiresAt: string }) {
  const { text } = useStudio();
  const [seconds, setSeconds] = useState(0);
  useEffect(() => {
    const tick = () =>
      setSeconds(
        Math.max(0, Math.floor((+new Date(expiresAt) - Date.now()) / 1000)),
      );
    tick();
    const timer = setInterval(tick, 1000);
    return () => clearInterval(timer);
  }, [expiresAt]);
  return (
    <>
      <p style={{ fontSize: 12 }}>
        {seconds > 0
          ? text("Время удерживается ещё", "Уақыт әлі сақталады")
          : text(
              "Срок удержания истёк. Доступность потребуется проверить заново.",
              "Сақтау мерзімі аяқталды. Қолжетімділікті қайта тексеру қажет.",
            )}
      </p>
      {seconds > 0 && (
        <div className="payment-timer">
          <Clock3 size={18} style={{ display: "inline", marginRight: 9 }} />
          {String(Math.floor(seconds / 60)).padStart(2, "0")}:
          {String(seconds % 60).padStart(2, "0")}
        </div>
      )}
    </>
  );
}
export function OrderDetail({
  id,
  staff = false,
}: {
  id: string;
  staff?: boolean;
}) {
  const { t, text, locale } = useStudio();
  const { data: catalog } = useApi<Catalog>("/api/catalog");
  const timezone = catalog?.settings.timezone || "Asia/Almaty";
  const pendingIntent = useRef<{ signature: string; key: string } | null>(null);
  const {
    data: booking,
    loading,
    error,
    refresh,
  } = useApi<Booking>(`/api/bookings/${id}`);
  const [busy, setBusy] = useState(false),
    [actionError, setActionError] = useState(""),
    [notice, setNotice] = useState(""),
    [panel, setPanel] = useState<
      "" | "payment" | "refund" | "reschedule" | "cancel"
    >(""),
    [amount, setAmount] = useState(""),
    [method, setMethod] = useState(""),
    [comment, setComment] = useState(""),
    [start, setStart] = useState(""),
    [duration, setDuration] = useState(60);
  async function action(body: Record<string, unknown>) {
    setBusy(true);
    setActionError("");
    setNotice("");
    try {
      const signature = JSON.stringify(body);
      if (
        !pendingIntent.current ||
        pendingIntent.current.signature !== signature
      )
        pendingIntent.current = { signature, key: crypto.randomUUID() };
      await api(`/api/bookings/${id}/actions`, {
        method: "POST",
        body: JSON.stringify({
          ...body,
          idempotencyKey: pendingIntent.current.key,
        }),
      });
      pendingIntent.current = null;
      setNotice(text("Изменения сохранены.", "Өзгерістер сақталды."));
      setPanel("");
      refresh();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : t.error);
    } finally {
      setBusy(false);
    }
  }
  if (loading || error)
    return <State loading={loading} error={error} retry={refresh} />;
  if (!booking) return null;
  const terminal = ["canceled", "expired", "completed", "no_show"].includes(
    booking.status,
  );
  const ownBrief = typeof booking.totalMinor !== "number";
  const mutable = ["awaiting_payment", "confirmed"].includes(booking.status);
  const remainingDeposit = Math.max(
    0,
    booking.depositMinor - booking.paidMinor,
  );
  return (
    <>
      <Link href={staff ? "/crm/bookings" : "/account"} className="breadcrumb">
        <ArrowLeft size={14} />
        {staff ? text("Бронирования", "Броньдар") : t.myBookings}
      </Link>
      <div className="detail-top">
        <div>
          <p className="eyebrow">
            {t.order} / {booking.number}
          </p>
          <h1 style={{ fontSize: 42, marginTop: 15 }}>
            {booking.locationName}
          </h1>
          <p>{booking.versionName}</p>
        </div>
        <StatusBadge status={booking.status} />
      </div>
      {notice && (
        <div className="notice" role="status">
          {notice}
        </div>
      )}
      {actionError && (
        <div className="notice error" role="alert">
          {actionError}
        </div>
      )}
      <div className="order-layout">
        <div>
          <section className="order-panel">
            <h2>{text("Детали съёмки", "Түсірілім мәліметтері")}</h2>
            <dl className="review-grid">
              {[
                [t.date, dateLabel(booking.startAt, locale, timezone)],
                [
                  t.duration,
                  `${Math.round((+new Date(booking.endAt) - +new Date(booking.startAt)) / 60000)} ${text("минут", "минут")}`,
                ],
                [t.name, booking.name],
                [
                  t.team,
                  booking.specialistName ||
                    text("Свой специалист", "Өз маманыңыз"),
                ],
                [t.comment, booking.comment || "—"],
              ].map(([label, value]) => (
                <div key={label}>
                  <dt>{label}</dt>
                  <dd>{value}</dd>
                </div>
              ))}
            </dl>
          </section>
          {!ownBrief && (
            <section className="order-panel">
              <h2>{text("Состав заказа", "Тапсырыс құрамы")}</h2>
              {booking.items?.map((item, i) => (
                <div className="summary-row" key={i}>
                  <span>{item.label}</span>
                  <strong>{money(item.totalMinor)}</strong>
                </div>
              ))}
              <div className="summary-total">
                <span>{t.total}</span>
                <span>{money(booking.totalMinor)}</span>
              </div>
            </section>
          )}
          {!ownBrief && booking.payments && booking.payments.length > 0 && (
            <section className="order-panel">
              <h2>{text("История операций", "Операциялар тарихы")}</h2>
              {booking.payments.map((payment) => (
                <div
                  key={payment.id}
                  style={{
                    padding: "15px 0",
                    borderBottom: "1px solid var(--line)",
                  }}
                >
                  <div className="summary-row" style={{ margin: 0 }}>
                    <span>
                      {payment.kind === "refund"
                        ? text("Возврат", "Қайтарым")
                        : text("Платёж", "Төлем")}{" "}
                      ·{" "}
                      {payment.method === "TEST"
                        ? text("Тестовый", "Сынақ")
                        : text("Ручной учёт", "Қолмен тіркеу")}
                    </span>
                    <strong>{money(payment.amountMinor)}</strong>
                  </div>
                  <p className="summary-note" style={{ marginTop: 7 }}>
                    {dateLabel(payment.createdAt, locale, timezone)}
                    {staff && payment.comment ? ` · ${payment.comment}` : ""}
                  </p>
                </div>
              ))}
            </section>
          )}
          {!ownBrief && booking.rulesText && (
            <section className="order-panel">
              <h3>{text("Принятые условия", "Қабылданған шарттар")}</h3>
              <p style={{ fontSize: 12 }}>{booking.rulesText}</p>
              <p className="summary-note">
                {text("Версия", "Нұсқа")}: {booking.rulesVersion}
              </p>
            </section>
          )}
          {staff && (
            <section className="order-panel">
              <h2>{text("Работа с заказом", "Тапсырыспен жұмыс")}</h2>
              <div className="action-stack">
                {!terminal && (
                  <>
                    <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
                      {booking.status === "confirmed" && (
                        <button
                          className="button small"
                          disabled={busy}
                          onClick={() =>
                            action({ action: "status", status: "in_progress" })
                          }
                        >
                          {text("Отметить приход", "Келгенін белгілеу")}
                        </button>
                      )}
                      {booking.status === "in_progress" && (
                        <button
                          className="button small"
                          disabled={busy}
                          onClick={() =>
                            action({ action: "status", status: "completed" })
                          }
                        >
                          {text("Завершить съёмку", "Түсірілімді аяқтау")}
                        </button>
                      )}
                      {booking.status === "confirmed" && (
                        <button
                          className="button secondary small"
                          disabled={busy}
                          onClick={() =>
                            action({ action: "status", status: "no_show" })
                          }
                        >
                          {text("Неявка", "Келмеді")}
                        </button>
                      )}
                    </div>
                    {mutable && (
                      <button
                        className="button secondary"
                        disabled={busy}
                        onClick={() => {
                          setPanel("reschedule");
                          setStart(
                            DateTime.fromISO(booking.startAt)
                              .setZone(timezone)
                              .toFormat("yyyy-MM-dd'T'HH:mm"),
                          );
                          setDuration(
                            Math.round(
                              (+new Date(booking.endAt) -
                                +new Date(booking.startAt)) /
                                60000,
                            ),
                          );
                        }}
                      >
                        {text("Перенести съёмку", "Түсірілімді ауыстыру")}
                      </button>
                    )}
                  </>
                )}
                {booking.paidMinor > 0 && (
                  <button
                    className="button secondary"
                    disabled={busy}
                    onClick={() => {
                      setPanel("refund");
                      setAmount("");
                      setComment("");
                    }}
                  >
                    {text("Записать возврат", "Қайтарымды тіркеу")}
                  </button>
                )}
              </div>
            </section>
          )}
          {panel === "reschedule" && (
            <section className="order-panel">
              <h3>{text("Новое время", "Жаңа уақыт")}</h3>
              <p style={{ fontSize: 12, marginBottom: 20 }}>
                {text(
                  "Время указано в часовом поясе студии. Стоимость будет пересчитана по текущему тарифу. При конфликте исходная запись сохранится.",
                  "Уақыт студияның уақыт белдеуінде көрсетілген. Құн ағымдағы тарифпен қайта есептеледі. Қақтығыс болса, бастапқы бронь сақталады.",
                )}{" "}
                {timezone}
              </p>
              <div className="form-stack">
                <label className="field">
                  {t.date}
                  <input
                    type="datetime-local"
                    value={start}
                    onChange={(e) => setStart(e.target.value)}
                  />
                </label>
                <label className="field">
                  {t.duration}
                  <input
                    type="number"
                    min={30}
                    step={30}
                    max={720}
                    value={duration}
                    onChange={(e) => setDuration(Number(e.target.value))}
                  />
                </label>
                <button
                  className="button"
                  disabled={busy || !start}
                  onClick={() =>
                    action({
                      action: "reschedule",
                      startAt: DateTime.fromISO(start, { zone: timezone })
                        .toUTC()
                        .toISO(),
                      durationMinutes: duration,
                    })
                  }
                >
                  {text("Проверить и перенести", "Тексеру және ауыстыру")}
                </button>
                <button className="inline-button" onClick={() => setPanel("")}>
                  {t.cancel}
                </button>
              </div>
            </section>
          )}
          {(panel === "payment" || panel === "refund") && (
            <section className="order-panel">
              <h3>
                {panel === "payment"
                  ? text("Ручной учёт платежа", "Төлемді қолмен тіркеу")
                  : text("Возврат", "Қайтарым")}
              </h3>
              <form
                className="form-stack"
                onSubmit={(e) => {
                  e.preventDefault();
                  action({
                    action: panel === "payment" ? "manual-payment" : "refund",
                    amountMinor: Math.round(Number(amount) * 100),
                    comment,
                    ...(panel === "payment" ? { method } : {}),
                  });
                }}
              >
                <label className="field">
                  {text("Сумма, ₸", "Сома, ₸")}
                  <input
                    type="number"
                    min="0.01"
                    step="0.01"
                    value={amount}
                    onChange={(e) => setAmount(e.target.value)}
                    required
                  />
                </label>
                {panel === "payment" && (
                  <label className="field">
                    {text("Способ оплаты", "Төлем тәсілі")}
                    <input
                      value={method}
                      onChange={(e) => setMethod(e.target.value)}
                      placeholder={text(
                        "Например, банковский перевод",
                        "Мысалы, банк аударымы",
                      )}
                      required
                    />
                  </label>
                )}
                <label className="field">
                  {t.comment}
                  <textarea
                    value={comment}
                    onChange={(e) => setComment(e.target.value)}
                    required
                    maxLength={1000}
                  />
                </label>
                <p className="summary-note">
                  {text(
                    "Это запись о фактически выполненной операции. Деньги через приложение не переводятся.",
                    "Бұл нақты орындалған операцияның жазбасы. Қосымша арқылы ақша аударылмайды.",
                  )}
                </p>
                <button className="button" disabled={busy}>
                  {t.save}
                </button>
                <button
                  type="button"
                  className="inline-button"
                  onClick={() => setPanel("")}
                >
                  {t.cancel}
                </button>
              </form>
            </section>
          )}
          {panel === "cancel" && (
            <section className="order-panel">
              <h3>
                {text(
                  "Отменить эту съёмку?",
                  "Бұл түсірілімнен бас тартасыз ба?",
                )}
              </h3>
              <p style={{ fontSize: 13, marginBottom: 20 }}>
                {text(
                  "Бронирование будет отменено, а время освобождено. Оплата не возвращается автоматически; возврат учитывает сотрудник отдельной операцией.",
                  "Бронь жойылып, уақыт босатылады. Төлем автоматты түрде қайтарылмайды; қайтарымды қызметкер бөлек тіркейді.",
                )}
              </p>
              <div style={{ display: "flex", gap: 12 }}>
                <button
                  className="button danger"
                  disabled={busy}
                  onClick={() => action({ action: "cancel" })}
                >
                  {text("Да, отменить", "Иә, бас тарту")}
                </button>
                <button
                  className="button secondary"
                  onClick={() => setPanel("")}
                >
                  {t.back}
                </button>
              </div>
            </section>
          )}
        </div>
        {!ownBrief && (
          <aside>
            <section className="order-panel">
              <h2>{t.payment}</h2>
              <StatusBadge status={booking.paymentStatus} />
              <div className="summary-row">
                <span>{t.total}</span>
                <strong>{money(booking.totalMinor)}</strong>
              </div>
              <div className="summary-row">
                <span>{text("Внесено", "Төленген")}</span>
                <strong>{money(booking.paidMinor)}</strong>
              </div>
              <div className="summary-total">
                <span>{t.balance}</span>
                <span>{money(booking.balanceMinor)}</span>
              </div>
              {booking.status === "awaiting_payment" && booking.expiresAt && (
                <div style={{ marginTop: 22 }}>
                  <HoldTimer expiresAt={booking.expiresAt} />
                </div>
              )}
              <div className="action-stack">
                {!staff &&
                  booking.status === "awaiting_payment" &&
                  booking.paidMinor < booking.depositMinor && (
                    <>
                      <button
                        data-testid="test-payment"
                        className="button full"
                        disabled={busy}
                        onClick={() =>
                          action({ action: "test-payment", target: "deposit" })
                        }
                      >
                        {busy
                          ? text("Обрабатываем…", "Өңделуде…")
                          : text(
                              "Тестовая предоплата",
                              "Сынақ алдын ала төлемі",
                            )}
                        <Check size={17} />
                      </button>
                      <p className="summary-note">
                        {money(remainingDeposit)} ·{" "}
                        {text(
                          "Деньги не списываются. Это проверка сценария оплаты.",
                          "Ақша алынбайды. Бұл төлем сценарийін тексеру.",
                        )}
                      </p>
                    </>
                  )}
                {!staff &&
                  ["confirmed", "in_progress"].includes(booking.status) &&
                  booking.balanceMinor > 0 && (
                    <>
                      <button
                        data-testid="test-balance"
                        className="button full"
                        disabled={busy}
                        onClick={() =>
                          action({ action: "test-payment", target: "balance" })
                        }
                      >
                        {text("Тестовая доплата", "Сынақ қосымша төлемі")}
                      </button>
                      <p className="summary-note">
                        {money(booking.balanceMinor)} ·{" "}
                        {text(
                          "Реальные деньги не списываются.",
                          "Нақты ақша алынбайды.",
                        )}
                      </p>
                    </>
                  )}
                {staff &&
                  booking.balanceMinor > 0 &&
                  ["awaiting_payment", "confirmed", "in_progress"].includes(
                    booking.status,
                  ) && (
                    <button
                      className="button full"
                      disabled={busy}
                      onClick={() => {
                        setPanel("payment");
                        setAmount("");
                        setMethod("");
                        setComment("");
                      }}
                    >
                      {text("Записать платёж", "Төлемді тіркеу")}
                    </button>
                  )}
                {mutable && (
                  <button
                    className="button secondary full"
                    disabled={busy}
                    onClick={() => setPanel("cancel")}
                  >
                    {text("Отменить бронирование", "Броньнан бас тарту")}
                  </button>
                )}
              </div>
            </section>
            <p className="summary-note">
              {text(
                "Подтверждение бронирования не является фискальным чеком. Реальная платёжная интеграция не подключена.",
                "Бронь растауы фискалдық чек емес. Нақты төлем интеграциясы қосылмаған.",
              )}
            </p>
          </aside>
        )}
      </div>
    </>
  );
}
export function AccountOrderPage({ id }: { id: string }) {
  return (
    <PublicShell>
      <div className="page-width order-content">
        <AccessGate>{() => <OrderDetail id={id} />}</AccessGate>
      </div>
    </PublicShell>
  );
}
