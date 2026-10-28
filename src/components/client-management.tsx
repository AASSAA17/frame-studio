"use client";
import { useState } from "react";
import Link from "next/link";
import {
  Plus,
  ArrowUpRight,
  ArrowLeft,
  UserRound,
  Pencil,
  Archive,
  ShieldCheck,
} from "lucide-react";
import { useStudio } from "./studio-provider";
import { api, useApi, money, dateLabel, type Booking } from "./api";
import { Empty, State, StatusBadge } from "./shared";
import {
  Editor,
  MutationError,
  SectionHeading,
  refreshStudio,
  type Customer,
  type Values,
  type Field,
} from "./management-shared";

export function customerArray(
  data: Customer[] | { customers: Customer[] } | null,
) {
  return Array.isArray(data) ? data : data?.customers || [];
}
type CustomerDetail = Customer & {
  bookings: Booking[];
  history?: {
    id: string;
    action: string;
    createdAt: string;
    actorId?: string;
  }[];
  possibleDuplicates?: Customer[];
};
export function CustomerEditor({
  customer: initialCustomer,
  onClose,
  onSaved,
}: {
  customer?: Customer;
  onClose: () => void;
  onSaved?: (customer: Customer) => void;
}) {
  const { text } = useStudio();
  const [customer] = useState(() =>
    initialCustomer
      ? { ...initialCustomer, tags: [...initialCustomer.tags] }
      : undefined,
  );
  const initial: Values = {
    name: customer?.name || "",
    email: customer?.email || "",
    phone: customer?.phone || "",
    notes: customer?.notes || "",
    tags: customer?.tags.join(", ") || "",
  };
  const fields: Field[] = [
    {
      key: "name",
      label: text("Имя клиента", "Клиенттің аты"),
      required: true,
    },
    { key: "phone", label: text("Телефон", "Телефон") },
    {
      key: "email",
      label: text("Электронная почта", "Электрондық пошта"),
      type: "email",
    },
    { key: "tags", label: text("Теги через запятую", "Тегтер үтір арқылы") },
    {
      key: "notes",
      label: text("Внутренние заметки", "Ішкі жазбалар"),
      type: "textarea",
      wide: true,
      help: text(
        "Видны только сотрудникам. Не включайте секреты и избыточные личные сведения.",
        "Тек қызметкерлерге көрінеді. Құпиялар мен артық жеке ақпаратты қоспаңыз.",
      ),
    },
  ];
  return (
    <Editor
      title={
        customer
          ? text("Изменить карточку клиента", "Клиент карточкасын өзгерту")
          : text("Новый клиент", "Жаңа клиент")
      }
      description={text(
        "Карточка клиента не создаёт пароль или личный кабинет. Совпадение телефона или почты не объединяет заказы.",
        "Клиент карточкасы құпиясөз немесе жеке кабинет жасамайды. Телефон не пошта сәйкестігі тапсырыстарды біріктірмейді.",
      )}
      fields={fields}
      initial={initial}
      onClose={onClose}
      onSave={async (values) => {
        const result = await api<Customer>(
          customer
            ? `/api/studio/clients/${customer.id}`
            : "/api/studio/clients",
          {
            method: customer ? "PATCH" : "POST",
            body: JSON.stringify({
              ...values,
              email: values.email || null,
              phone: values.phone || null,
              tags: String(values.tags)
                .split(",")
                .map((value) => value.trim())
                .filter(Boolean),
              ...(customer ? { revision: customer.revision } : {}),
            }),
          },
        );
        refreshStudio();
        onSaved?.(result);
      }}
    />
  );
}
export function ClientsPage() {
  const { t, text } = useStudio();
  const [search, setSearch] = useState(""),
    [archived, setArchived] = useState(false),
    [create, setCreate] = useState(false);
  const { data, loading, error, refresh } = useApi<
    Customer[] | { customers: Customer[] }
  >(`/api/studio/clients?q=${encodeURIComponent(search)}`);
  const clients = customerArray(data).filter((customer) =>
    archived ? !!customer.archivedAt : !customer.archivedAt,
  );
  return (
    <>
      <SectionHeading
        title={text("Клиенты", "Клиенттер")}
        description={text(
          "Контакты, история заказов и рабочие заметки. Каждая карточка хранится отдельно от учётной записи для входа.",
          "Байланыстар, тапсырыс тарихы және жұмыс жазбалары. Әр карточка кіру аккаунтынан бөлек сақталады.",
        )}
        action={
          <button
            data-testid="client-add"
            className="button small"
            onClick={() => setCreate(true)}
          >
            <Plus size={15} />
            {text("Новый клиент", "Жаңа клиент")}
          </button>
        }
      />
      <div className="management-toolbar">
        <label className="field">
          {t.search}
          <input
            data-testid="client-search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={text(
              "Имя, телефон или почта",
              "Аты, телефон немесе пошта",
            )}
          />
        </label>
        <label className="check-label">
          <input
            type="checkbox"
            checked={archived}
            onChange={(e) => setArchived(e.target.checked)}
          />
          {text("Показать архив", "Архивті көрсету")}
        </label>
        <span className="list-count">
          {clients.length} {text("карточек", "карточка")}
        </span>
      </div>
      {loading || error ? (
        <State loading={loading} error={error} retry={refresh} />
      ) : clients.length ? (
        <div className="client-list">
          {clients.map((customer) => (
            <Link
              className="client-list-card"
              href={`/crm/clients/${customer.id}`}
              key={customer.id}
            >
              <div className="client-avatar">
                <UserRound size={22} />
              </div>
              <div className="client-main">
                <h2>{customer.name}</h2>
                <p>
                  {[customer.phone, customer.email]
                    .filter(Boolean)
                    .join(" · ") ||
                    text("Контакты не указаны", "Байланыстар көрсетілмеген")}
                </p>
                <div className="tag-list">
                  {customer.tags.map((tag) => (
                    <span className="tag" key={tag}>
                      {tag}
                    </span>
                  ))}
                </div>
              </div>
              <div className="client-stats">
                <strong>{customer.bookingCount}</strong>
                <span>{text("заказов", "тапсырыс")}</span>
                <small>
                  {money(customer.paidMinor)} {text("учтено", "тіркелген")}
                </small>
              </div>
              <ArrowUpRight size={18} />
            </Link>
          ))}
        </div>
      ) : (
        <Empty
          title={
            archived
              ? text("Архив пуст", "Архив бос")
              : text("Клиенты не найдены", "Клиенттер табылмады")
          }
          text={text(
            "Измените поиск или создайте карточку первого клиента.",
            "Іздеуді өзгертіңіз немесе алғашқы клиент карточкасын жасаңыз.",
          )}
          action={false}
        />
      )}{" "}
      {create && (
        <CustomerEditor onClose={() => setCreate(false)} onSaved={refresh} />
      )}
    </>
  );
}
export function ClientDetailPage({ id }: { id: string }) {
  const { t, text, locale, settings } = useStudio();
  const {
    data: customer,
    loading,
    error,
    refresh,
  } = useApi<CustomerDetail>(`/api/studio/clients/${id}`);
  const [editing, setEditing] = useState(false),
    [busy, setBusy] = useState(false),
    [mutationError, setMutationError] = useState<unknown>(null);
  if (loading || error)
    return <State loading={loading} error={error} retry={refresh} />;
  if (!customer) return null;
  const duplicates = customer.possibleDuplicates || [];
  return (
    <>
      <Link className="breadcrumb" href="/crm/clients" style={{ marginTop: 0 }}>
        <ArrowLeft size={14} />
        {text("Клиенты", "Клиенттер")}
      </Link>
      <div className="crm-heading" style={{ marginTop: 25 }}>
        <div>
          <p className="eyebrow">
            {text("Карточка клиента", "Клиент карточкасы")}
          </p>
          <h1>{customer.name}</h1>
          <p>
            {customer.userId
              ? text(
                  "Связан с учётной записью клиента",
                  "Клиент аккаунтымен байланыстырылған",
                )
              : text(
                  "Контактная карточка без доступа в кабинет",
                  "Кабинетке кірмейтін байланыс карточкасы",
                )}
          </p>
        </div>
        <div className="heading-actions">
          <button
            data-testid="client-edit"
            className="button secondary small"
            onClick={() => setEditing(true)}
          >
            <Pencil size={14} />
            {text("Изменить", "Өзгерту")}
          </button>
          {!customer.archivedAt && (
            <Link
              data-testid="client-book"
              className="button small"
              href={`/crm/bookings/new?customer=${customer.id}`}
            >
              <Plus size={14} />
              {text("Создать бронь", "Бронь жасау")}
            </Link>
          )}
        </div>
      </div>
      <MutationError error={mutationError} />
      {customer.archivedAt && (
        <div className="notice">
          {text(
            "Клиент в архиве. История сохранена, создание новых заказов недоступно до восстановления.",
            "Клиент архивте. Тарих сақталған, қалпына келтіргенге дейін жаңа тапсырыс жасалмайды.",
          )}
        </div>
      )}
      {duplicates.length > 0 && (
        <div className="notice">
          <strong>
            {text(
              "Возможные совпадения контактов",
              "Байланыстардың ықтимал сәйкестіктері",
            )}
          </strong>
          <p>
            {text(
              "Проверьте вручную. Карточки и история не объединены.",
              "Қолмен тексеріңіз. Карточкалар мен тарих біріктірілмеген.",
            )}
          </p>
          <div className="conflict-list">
            {duplicates.map((item) => (
              <Link href={`/crm/clients/${item.id}`} key={item.id}>
                {item.name}
                <ArrowUpRight size={14} />
              </Link>
            ))}
          </div>
        </div>
      )}
      <div className="client-detail-grid">
        <section className="management-section">
          <header>
            <UserRound size={21} />
            <div>
              <h2>{text("Контакты и заметки", "Байланыстар мен жазбалар")}</h2>
              <p>
                {text(
                  "Доступны сотрудникам студии",
                  "Студия қызметкерлеріне қолжетімді",
                )}
              </p>
            </div>
          </header>
          <dl className="review-grid">
            <div>
              <dt>{t.phone}</dt>
              <dd>{customer.phone || "—"}</dd>
            </div>
            <div>
              <dt>{t.email}</dt>
              <dd>{customer.email || "—"}</dd>
            </div>
            <div>
              <dt>{text("Теги", "Тегтер")}</dt>
              <dd>{customer.tags.join(", ") || "—"}</dd>
            </div>
          </dl>
          <div className="client-notes">
            <h3>{text("Внутренние заметки", "Ішкі жазбалар")}</h3>
            <p>
              {customer.notes || text("Заметок пока нет.", "Әзірге жазба жоқ.")}
            </p>
          </div>
          <button
            className="inline-button danger-text"
            disabled={busy}
            onClick={async () => {
              const archived = !customer.archivedAt;
              if (
                !window.confirm(
                  archived
                    ? text(
                        "Архивировать карточку? История заказов и платежей сохранится.",
                        "Карточка архивтелсін бе? Тапсырыс пен төлем тарихы сақталады.",
                      )
                    : text(
                        "Восстановить карточку клиента?",
                        "Клиент карточкасы қалпына келтірілсін бе?",
                      ),
                )
              )
                return;
              setBusy(true);
              setMutationError(null);
              try {
                await api(`/api/studio/clients/${customer.id}/archive`, {
                  method: "POST",
                  body: JSON.stringify({
                    revision: customer.revision,
                    archived,
                  }),
                });
                refreshStudio();
                refresh();
              } catch (reason) {
                setMutationError(reason);
              } finally {
                setBusy(false);
              }
            }}
          >
            {customer.archivedAt
              ? text("Восстановить клиента", "Клиентті қалпына келтіру")
              : text("Архивировать клиента", "Клиентті архивтеу")}
          </button>
        </section>
        <section className="management-section">
          <header>
            <ShieldCheck size={21} />
            <div>
              <h2>{text("История заказов", "Тапсырыс тарихы")}</h2>
              <p>
                {customer.bookingCount} {text("заказов", "тапсырыс")} ·{" "}
                {money(customer.paidMinor)}{" "}
                {text("учтено по операциям", "операциялар бойынша тіркелген")}
              </p>
            </div>
          </header>
          {customer.bookings?.length ? (
            <div className="management-record-list">
              {customer.bookings.map((booking) => (
                <article key={booking.id}>
                  <Link href={`/crm/bookings/${booking.id}`}>
                    <strong>
                      {booking.locationName} · {booking.number}
                    </strong>
                    <p>
                      {dateLabel(
                        booking.startAt,
                        locale,
                        settings?.timezone || "Asia/Almaty",
                      )}
                    </p>
                  </Link>
                  <StatusBadge status={booking.status} />
                </article>
              ))}
            </div>
          ) : (
            <p className="management-empty">
              {text("Заказов пока нет.", "Әзірге тапсырыс жоқ.")}
            </p>
          )}
          {customer.history?.length ? (
            <>
              <h3 className="section-subtitle">
                {text("Журнал изменений", "Өзгерістер журналы")}
              </h3>
              <div className="audit-list">
                {customer.history.map((event) => (
                  <div key={event.id}>
                    <span>
                      {event.action === "customer.created"
                        ? text(
                            "Карточка клиента создана",
                            "Клиент карточкасы жасалды",
                          )
                        : event.action === "customer.updated"
                          ? text(
                              "Данные клиента изменены",
                              "Клиент деректері өзгертілді",
                            )
                          : event.action === "customer.archived"
                            ? text(
                                "Карточка перемещена в архив",
                                "Карточка архивке жіберілді",
                              )
                            : event.action === "customer.restored"
                              ? text(
                                  "Карточка восстановлена",
                                  "Карточка қалпына келтірілді",
                                )
                              : text(
                                  "Карточка клиента изменена",
                                  "Клиент карточкасы өзгертілді",
                                )}
                    </span>
                    <time>
                      {dateLabel(
                        event.createdAt,
                        locale,
                        settings?.timezone || "Asia/Almaty",
                      )}
                    </time>
                  </div>
                ))}
              </div>
            </>
          ) : null}
        </section>
      </div>
      {editing && (
        <CustomerEditor
          customer={customer}
          onClose={() => setEditing(false)}
          onSaved={refresh}
        />
      )}
    </>
  );
}
