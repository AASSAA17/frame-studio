"use client";
import { useState } from "react";
import { DateTime } from "luxon";
import {
  Plus,
  Pencil,
  CalendarDays,
  Layers3,
  Users,
  Box,
  ArrowLeft,
  Wrench,
} from "lucide-react";
import { useStudio } from "./studio-provider";
import { State, Empty } from "./shared";
import { money, dateLabel } from "./api";
import {
  ArchiveButton,
  Editor,
  MutationError,
  ReadOnlyNote,
  SectionHeading,
  manage,
  useManagement,
  type Room,
  type Location,
  type Specialist,
  type Equipment,
  type Service,
  type StudioData,
  type Decor,
  type Unit,
  type Field,
  type Values,
} from "./management-shared";
import { ScheduleManager } from "./schedule-management";

type Entity = "room" | "location" | "specialist" | "equipment" | "service";
type Item = Room | Location | Specialist | Equipment | Service;
const arrayKey = {
  room: "rooms",
  location: "locations",
  specialist: "specialists",
  equipment: "equipment",
  service: "services",
} as const;
export function CatalogManagementPage({ entity }: { entity: Entity }) {
  const { t, text } = useStudio();
  const studio = useManagement();
  const [search, setSearch] = useState(""),
    [showArchive, setShowArchive] = useState(false),
    [editing, setEditing] = useState<Item | "new" | null>(null),
    [scheduleId, setScheduleId] = useState<string | null>(null),
    [decorLocation, setDecorLocation] = useState<string | null>(null),
    [unitEditing, setUnitEditing] = useState<Unit | null>(null);
  const resource = studio.data?.resources.find(
    (item) => item.id === scheduleId,
  );
  const selectedLocation = studio.data?.locations.find(
    (item) => item.id === decorLocation,
  );
  const labels = {
    room: [
      text("Физические залы", "Физикалық залдар"),
      text(
        "Несколько локаций могут использовать один зал. Его график и закрытия действуют на все связанные локации.",
        "Бір залды бірнеше локация пайдалана алады. Оның кестесі мен жабылуы барлық байланысты локацияларға қолданылады.",
      ),
    ],
    location: [
      t.locations,
      text(
        "Публикация, цены и версии оформления. История уже созданных заказов сохраняется.",
        "Жариялау, бағалар және безендіру нұсқалары. Бұрын құрылған тапсырыстар тарихы сақталады.",
      ),
    ],
    specialist: [
      t.team,
      text(
        "Специалисты, стоимость работы и доступность. Личные кабинеты связываются отдельно администратором системы.",
        "Мамандар, жұмыс құны және қолжетімділік. Жеке кабинеттерді жүйе әкімшісі бөлек байланыстырады.",
      ),
    ],
    equipment: [
      text("Оборудование", "Жабдық"),
      text(
        "Количество единиц, обслуживание и занятость. Нерабочие единицы недоступны для новых бронирований.",
        "Бірлік саны, қызмет көрсету және бос емес уақыт. Жарамсыз бірліктер жаңа броньдарға ұсынылмайды.",
      ),
    ],
    service: [
      t.services,
      text(
        "Дополнительные услуги и их стоимость в новых заказах.",
        "Қосымша қызметтер және жаңа тапсырыстардағы олардың құны.",
      ),
    ],
  };
  if (studio.loading || studio.error)
    return (
      <State
        loading={studio.loading}
        error={studio.error}
        retry={studio.refresh}
      />
    );
  if (!studio.data) return null;
  const data = studio.data;
  const items = (data[arrayKey[entity]] as Item[]).filter(
    (item) =>
      (showArchive ? !!item.archivedAt : !item.archivedAt) &&
      item.name.toLowerCase().includes(search.toLowerCase()),
  );
  if (resource)
    return (
      <ScheduleManager
        resource={resource}
        timezone={data.settings.timezone}
        onBack={() => setScheduleId(null)}
        onRefresh={studio.refresh}
      />
    );
  if (selectedLocation)
    return (
      <DecorManager
        location={selectedLocation}
        data={data}
        owner={studio.owner}
        onBack={() => setDecorLocation(null)}
        onRefresh={studio.refresh}
      />
    );
  return (
    <>
      <SectionHeading
        title={labels[entity][0]}
        description={labels[entity][1]}
        action={
          studio.owner ? (
            <button
              data-testid="manage-add"
              className="button small"
              onClick={() => setEditing("new")}
            >
              <Plus size={15} />
              {text("Добавить", "Қосу")}
            </button>
          ) : undefined
        }
      />
      {!studio.owner && <ReadOnlyNote />}
      <div className="management-toolbar">
        <label className="field">
          {t.search}
          <input
            placeholder={text("По названию", "Атауы бойынша")}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </label>
        <label className="check-label">
          <input
            type="checkbox"
            checked={showArchive}
            onChange={(e) => setShowArchive(e.target.checked)}
          />
          {text("Показать архив", "Архивті көрсету")}
        </label>
        <span className="list-count">
          {items.length} {text("записей", "жазба")}
        </span>
      </div>
      {items.length ? (
        <div
          className={`management-grid ${entity === "location" ? "location-management-grid" : ""}`}
        >
          {items.map((item) => {
            const itemResource =
              "resourceId" in item
                ? data.resources.find(
                    (resource) => resource.id === item.resourceId,
                  )
                : undefined;
            const locationItem =
              entity === "location" ? (item as Location) : null;
            const equipmentItem =
              entity === "equipment" ? (item as Equipment) : null;
            return (
              <article
                className={`management-card ${item.archivedAt ? "archived-card" : ""}`}
                key={item.id}
              >
                {locationItem && (
                  <img
                    className="management-card-image"
                    src={locationItem.image}
                    alt={locationItem.name}
                  />
                )}
                <div className="management-card-body">
                  <div className="management-card-top">
                    <h2>{item.name}</h2>
                    {"published" in item && (
                      <span
                        className={`status-badge ${!item.published ? "status-draft" : ""}`}
                      >
                        {item.published
                          ? text("Опубликовано", "Жарияланған")
                          : text("Черновик", "Жоба")}
                      </span>
                    )}
                  </div>
                  {entity === "room" && (
                    <>
                      <p>
                        <Users size={14} />
                        {(item as Room).capacity} {t.people}
                      </p>
                      <p>
                        {text("Локации", "Локациялар")}:{" "}
                        {data.locations
                          .filter(
                            (location) =>
                              location.roomId === item.id &&
                              !location.archivedAt,
                          )
                          .map((location) => location.name)
                          .join(", ") || text("Пока нет", "Әзірге жоқ")}
                      </p>
                    </>
                  )}
                  {locationItem && (
                    <>
                      <p>
                        {data.rooms.find(
                          (room) => room.id === locationItem.roomId,
                        )?.name || locationItem.roomId}{" "}
                        · {locationItem.area} {t.meters} ·{" "}
                        {locationItem.capacity} {t.people}
                      </p>
                      <strong className="management-price">
                        {money(locationItem.hourlyPriceMinor)}{" "}
                        <small>{t.perHour}</small>
                      </strong>
                    </>
                  )}
                  {entity === "specialist" && (
                    <>
                      <p>{(item as Specialist).specialty}</p>
                      <strong className="management-price">
                        {money((item as Specialist).hourlyPriceMinor)}{" "}
                        <small>{t.perHour}</small>
                      </strong>
                    </>
                  )}
                  {equipmentItem && (
                    <>
                      <p>
                        {text("Работает", "Жарамды")}:{" "}
                        {equipmentItem.availableQuantity} /{" "}
                        {equipmentItem.quantity}
                      </p>
                      <strong className="management-price">
                        {money(equipmentItem.priceMinor)}
                      </strong>
                    </>
                  )}
                  {entity === "service" && (
                    <>
                      <p>{(item as Service).description}</p>
                      <strong className="management-price">
                        {money((item as Service).priceMinor)}
                      </strong>
                      <p>
                        {(item as Service).production
                          ? text(
                              "Создаёт контент-проект",
                              "Контент жобасын жасайды",
                            )
                          : text("Дополнение к аренде", "Жалдауға қосымша")}
                      </p>
                    </>
                  )}
                  <div className="management-card-actions">
                    {studio.owner && !item.archivedAt && (
                      <button
                        data-testid={`edit-${entity}-${item.id}`}
                        className="button secondary small"
                        onClick={() => setEditing(item)}
                      >
                        <Pencil size={13} />
                        {text("Изменить", "Өзгерту")}
                      </button>
                    )}
                    {itemResource && !item.archivedAt && (
                      <button
                        data-testid={`schedule-resource-${itemResource.id}`}
                        className="button secondary small"
                        onClick={() => setScheduleId(itemResource.id)}
                      >
                        <CalendarDays size={14} />
                        {text("Расписание", "Кесте")}
                      </button>
                    )}
                    {locationItem && !item.archivedAt && (
                      <button
                        data-testid={`decor-location-${item.id}`}
                        className="button secondary small"
                        onClick={() => setDecorLocation(item.id)}
                      >
                        <Layers3 size={14} />
                        {text("Оформления", "Безендірулер")}
                      </button>
                    )}
                  </div>
                  {equipmentItem && itemResource && !item.archivedAt && (
                    <div className="equipment-units">
                      <h3>{text("Состояние единиц", "Бірліктер күйі")}</h3>
                      {itemResource.units
                        .filter((unit) => !unit.retiredAt)
                        .map((unit) => (
                          <div className="equipment-unit" key={unit.id}>
                            <div>
                              <span
                                className={`unit-dot ${unit.active ? "active" : ""}`}
                              />
                              <span>
                                #{unit.serial} ·{" "}
                                {unit.active
                                  ? text("Работает", "Жарамды")
                                  : text("На обслуживании", "Қызмет көрсетуде")}
                              </span>
                              {unit.maintenanceNote && (
                                <small>{unit.maintenanceNote}</small>
                              )}
                            </div>
                            <button
                              data-testid={`edit-unit-${unit.id}`}
                              className="icon-button"
                              aria-label={text(
                                `Состояние единицы ${unit.serial}`,
                                `${unit.serial} бірлігінің күйі`,
                              )}
                              onClick={() => setUnitEditing(unit)}
                            >
                              <Wrench size={14} />
                            </button>
                          </div>
                        ))}
                    </div>
                  )}
                  {studio.owner && (
                    <div className="card-archive">
                      <ArchiveButton
                        entity={entity}
                        item={item}
                        onDone={studio.refresh}
                      />
                    </div>
                  )}
                </div>
              </article>
            );
          })}
        </div>
      ) : (
        <Empty
          title={
            showArchive
              ? text("Архив пуст", "Архив бос")
              : text("Записи не найдены", "Жазбалар табылмады")
          }
          text={text(
            "Измените поиск или добавьте первую запись.",
            "Іздеуді өзгертіңіз немесе алғашқы жазбаны қосыңыз.",
          )}
          action={false}
        />
      )}{" "}
      {editing && (
        <CatalogEditor
          entity={entity}
          item={editing === "new" ? null : editing}
          data={data}
          onClose={() => setEditing(null)}
          onRefresh={studio.refresh}
        />
      )}{" "}
      {unitEditing && (
        <Editor
          title={text(
            `Единица #${unitEditing.serial}`,
            `Бірлік #${unitEditing.serial}`,
          )}
          description={text(
            "Отключение исключит единицу из доступного оборудования. Существующие бронирования проверяются на конфликт.",
            "Өшіру бірлікті қолжетімді жабдықтан алып тастайды. Бар броньдармен қақтығыс тексеріледі.",
          )}
          initial={{
            active: unitEditing.active,
            maintenanceNote: unitEditing.maintenanceNote || "",
          }}
          fields={[
            {
              key: "active",
              label: text(
                "Исправна и доступна для аренды",
                "Жарамды және жалдауға қолжетімді",
              ),
              type: "checkbox",
              wide: true,
            },
            {
              key: "maintenanceNote",
              label: text(
                "Причина / заметка об обслуживании",
                "Себебі / қызмет көрсету жазбасы",
              ),
              type: "textarea",
              wide: true,
            },
          ]}
          onClose={() => setUnitEditing(null)}
          onReload={studio.refresh}
          onSave={async (values) => {
            if (
              !values.active &&
              !window.confirm(
                text(
                  "Убрать эту единицу из доступного оборудования?",
                  "Бұл бірлік қолжетімді жабдықтан алынсын ба?",
                ),
              )
            )
              throw new Error(
                text("Изменение не подтверждено.", "Өзгеріс расталмады."),
              );
            await manage({
              entity: "unit",
              operation: "update",
              id: unitEditing.id,
              revision: unitEditing.revision,
              ...values,
            });
            studio.refresh();
          }}
        />
      )}
    </>
  );
}
function CatalogEditor({
  entity,
  item,
  data,
  onClose,
  onRefresh,
}: {
  entity: Entity;
  item: Item | null;
  data: StudioData;
  onClose: () => void;
  onRefresh: () => void;
}) {
  const { text } = useStudio();
  let fields: Field[] = [
      { key: "name", label: text("Название", "Атауы"), required: true },
    ],
    initial: Values = { name: item?.name || "" };
  const published: Field = {
    key: "published",
    label: text("Опубликовать на сайте", "Сайтта жариялау"),
    type: "checkbox",
    wide: true,
  };
  const priceField = (hourly = false): Field => ({
    key: hourly ? "hourlyPriceMinor" : "priceMinor",
    label: hourly
      ? text("Цена за час, ₸", "Сағат бағасы, ₸")
      : text("Стоимость, ₸", "Құны, ₸"),
    type: "number",
    min: 0,
    max: 10000000,
    step: 0.01,
    required: true,
    help: text(
      "Введите сумму в тенге. Заказ хранит цену на момент оформления.",
      "Соманы теңгемен енгізіңіз. Тапсырыс рәсімдеу кезіндегі бағаны сақтайды.",
    ),
  });
  if (entity === "room") {
    initial = { ...initial, capacity: (item as Room)?.capacity || 10 };
    fields.push({
      key: "capacity",
      label: text("Вместимость, человек", "Сыйымдылық, адам"),
      type: "number",
      min: 1,
      max: 500,
      required: true,
    });
  }
  if (entity === "location") {
    const value = item as Location | null;
    initial = {
      ...initial,
      slug: value?.slug || "",
      description: value?.description || "",
      descriptionKk: value?.descriptionKk || "",
      image: value?.image || "/images/daylight.svg",
      area: value?.area || 50,
      capacity: value?.capacity || 10,
      hourlyPriceMinor: (value?.hourlyPriceMinor || 0) / 100,
      tags: value?.tags.join(", ") || "",
      published: value?.published ?? false,
      roomId:
        value?.roomId || data.rooms.find((room) => !room.archivedAt)?.id || "",
    };
    fields.push(
      {
        key: "slug",
        label: text(
          "Адрес страницы (латиницей)",
          "Бет мекенжайы (латын әріптері)",
        ),
        required: true,
        help: "daylight-studio",
      },
      {
        key: "roomId",
        label: text("Физический зал", "Физикалық зал"),
        type: "select",
        required: true,
        options: [
          { value: "", label: text("Выберите зал", "Залды таңдаңыз") },
          ...data.rooms
            .filter((room) => !room.archivedAt || room.id === value?.roomId)
            .map((room) => ({ value: room.id, label: room.name })),
        ],
      },
      {
        key: "area",
        label: text("Площадь, м²", "Ауданы, м²"),
        type: "number",
        min: 1,
        max: 10000,
        required: true,
      },
      {
        key: "capacity",
        label: text("Вместимость, человек", "Сыйымдылық, адам"),
        type: "number",
        min: 1,
        max: 500,
        required: true,
      },
      priceField(true),
      {
        key: "image",
        label: text(
          "Изображение: /images/… или https://",
          "Сурет: /images/… немесе https://",
        ),
        required: true,
        wide: true,
      },
      {
        key: "tags",
        label: text("Форматы через запятую", "Форматтар үтір арқылы"),
        wide: true,
      },
      {
        key: "description",
        label: text("Описание на русском", "Орысша сипаттама"),
        type: "textarea",
        required: true,
        wide: true,
      },
      {
        key: "descriptionKk",
        label: text("Описание на казахском", "Қазақша сипаттама"),
        type: "textarea",
        wide: true,
      },
      published,
    );
  }
  if (entity === "specialist") {
    const value = item as Specialist | null;
    initial = {
      ...initial,
      specialty: value?.specialty || "",
      hourlyPriceMinor: (value?.hourlyPriceMinor || 0) / 100,
      published: value?.published ?? false,
    };
    fields.push(
      {
        key: "specialty",
        label: text("Направление работы", "Жұмыс бағыты"),
        required: true,
      },
      priceField(true),
      published,
    );
  }
  if (entity === "equipment") {
    const value = item as Equipment | null;
    initial = {
      ...initial,
      priceMinor: (value?.priceMinor || 0) / 100,
      quantity: value?.quantity || 1,
      published: value?.published ?? false,
    };
    fields.push(
      priceField(),
      {
        key: "quantity",
        label: text("Количество единиц", "Бірлік саны"),
        type: "number",
        min: 1,
        max: 100,
        required: true,
        help: text(
          "Уменьшение количества проверяется по занятости единиц. История сохраняется.",
          "Санды азайтқанда бірліктердің бос еместігі тексеріледі. Тарих сақталады.",
        ),
      },
      published,
    );
  }
  if (entity === "service") {
    const value = item as Service | null;
    initial = {
      ...initial,
      description: value?.description || "",
      priceMinor: (value?.priceMinor || 0) / 100,
      production: value?.production ?? false,
      published: value?.published ?? false,
    };
    fields.push(
      priceField(),
      {
        key: "description",
        label: text("Описание", "Сипаттама"),
        type: "textarea",
        wide: true,
        required: true,
      },
      {
        key: "production",
        label: text(
          "Услуга включает производство контента",
          "Қызмет контент өндіруді қамтиды",
        ),
        type: "checkbox",
        wide: true,
      },
      published,
    );
  }
  return (
    <Editor
      title={
        item
          ? text(`Изменить: ${item.name}`, `Өзгерту: ${item.name}`)
          : text("Новая запись", "Жаңа жазба")
      }
      initial={initial}
      fields={fields}
      onClose={onClose}
      onReload={onRefresh}
      onSave={async (values) => {
        const input: Record<string, unknown> = { ...values };
        if ("hourlyPriceMinor" in input)
          input.hourlyPriceMinor = Math.round(
            Number(input.hourlyPriceMinor) * 100,
          );
        if ("priceMinor" in input)
          input.priceMinor = Math.round(Number(input.priceMinor) * 100);
        if ("tags" in input)
          input.tags = String(input.tags)
            .split(",")
            .map((value) => value.trim())
            .filter(Boolean);
        await manage({
          entity,
          operation: item ? "update" : "create",
          ...(item ? { id: item.id, revision: item.revision } : {}),
          ...input,
        });
        onRefresh();
      }}
    />
  );
}
function DecorManager({
  location,
  data,
  owner,
  onBack,
  onRefresh,
}: {
  location: Location;
  data: StudioData;
  owner: boolean;
  onBack: () => void;
  onRefresh: () => void;
}) {
  const { text, t, locale } = useStudio();
  const [editing, setEditing] = useState<Decor | "new" | null>(null);
  const versions = data.decorVersions
    .filter((version) => version.locationId === location.id)
    .sort((a, b) => +new Date(b.validFrom) - +new Date(a.validFrom));
  const timezone = data.settings.timezone;
  const item = editing && editing !== "new" ? editing : null;
  const initial: Values = {
    name: item?.name || "",
    image: item?.image || location.image,
    validFrom: item
      ? DateTime.fromISO(item.validFrom)
          .setZone(timezone)
          .toFormat("yyyy-MM-dd'T'HH:mm")
      : DateTime.now()
          .setZone(timezone)
          .plus({ days: 1 })
          .startOf("day")
          .toFormat("yyyy-MM-dd'T'HH:mm"),
    validUntil: item?.validUntil
      ? DateTime.fromISO(item.validUntil)
          .setZone(timezone)
          .toFormat("yyyy-MM-dd'T'HH:mm")
      : "",
    published: item?.published ?? false,
  };
  return (
    <>
      <button className="inline-button" onClick={onBack}>
        <ArrowLeft size={14} style={{ display: "inline", marginRight: 8 }} />
        {text("К локациям", "Локацияларға")}
      </button>
      <div style={{ marginTop: 24 }}>
        <SectionHeading
          title={`${location.name} / ${text("Оформления", "Безендірулер")}`}
          description={text(
            `Периоды задаются в ${timezone}. Заказы сохраняют выбранную версию; будущие оформления публикуются отдельно.`,
            `Кезеңдер ${timezone} бойынша беріледі. Тапсырыстар таңдалған нұсқаны сақтайды; болашақ безендірулер бөлек жарияланады.`,
          )}
          action={
            owner ? (
              <button
                data-testid="decor-add"
                className="button small"
                onClick={() => setEditing("new")}
              >
                <Plus size={15} />
                {text("Новое оформление", "Жаңа безендіру")}
              </button>
            ) : undefined
          }
        />
      </div>
      <div className="notice" style={{ marginBottom: 24 }}>
        {text(
          "Периоды опубликованных версий не должны пересекаться. Сначала ограничьте конец текущей версии, затем добавьте следующую. Если изменение затрагивает существующие заказы, сервер покажет конфликт.",
          "Жарияланған нұсқалардың кезеңдері қиылыспауы тиіс. Алдымен ағымдағы нұсқаның соңын шектеп, содан кейін келесісін қосыңыз. Өзгеріс бар тапсырыстарға әсер етсе, сервер қақтығысты көрсетеді.",
        )}
      </div>
      {versions.length ? (
        <div className="management-grid location-management-grid">
          {versions.map((version) => {
            const now = Date.now();
            const state = !version.published
              ? text("Черновик", "Жоба")
              : +new Date(version.validFrom) > now
                ? text("Будущее оформление", "Болашақ безендіру")
                : !version.validUntil || +new Date(version.validUntil) > now
                  ? text("Действует сейчас", "Қазір қолданылады")
                  : text("Архив периода", "Кезең архиві");
            return (
              <article className="management-card" key={version.id}>
                <img
                  className="management-card-image"
                  src={version.image}
                  alt={version.name}
                />
                <div className="management-card-body">
                  <div className="management-card-top">
                    <h2>{version.name}</h2>
                    <span className="status-badge">{state}</span>
                  </div>
                  <p>{dateLabel(version.validFrom, locale, timezone)}</p>
                  <p>
                    →{" "}
                    {version.validUntil
                      ? dateLabel(version.validUntil, locale, timezone)
                      : text("Без даты окончания", "Аяқталу күні жоқ")}
                  </p>
                  {owner && (
                    <div className="management-card-actions">
                      <button
                        data-testid={`edit-decor-${version.id}`}
                        className="button secondary small"
                        onClick={() => setEditing(version)}
                      >
                        <Pencil size={13} />
                        {text("Изменить", "Өзгерту")}
                      </button>
                    </div>
                  )}
                </div>
              </article>
            );
          })}
        </div>
      ) : (
        <Empty
          title={text("Оформлений пока нет", "Әзірге безендіру жоқ")}
          action={false}
        />
      )}{" "}
      {editing && (
        <Editor
          title={
            item
              ? text("Изменить оформление", "Безендіруді өзгерту")
              : text("Новое оформление", "Жаңа безендіру")
          }
          description={`${location.name} · ${timezone}`}
          initial={initial}
          fields={[
            {
              key: "name",
              label: text("Название оформления", "Безендіру атауы"),
              required: true,
            },
            {
              key: "image",
              label: text("Изображение", "Сурет"),
              required: true,
            },
            {
              key: "validFrom",
              label: text("Действует с", "Басталу уақыты"),
              type: "datetime-local",
              required: true,
            },
            {
              key: "validUntil",
              label: text(
                "Действует до (не включая)",
                "Аяқталу уақыты (қоспай)",
              ),
              type: "datetime-local",
            },
            {
              key: "published",
              label: text("Опубликовать", "Жариялау"),
              type: "checkbox",
              wide: true,
            },
          ]}
          onClose={() => setEditing(null)}
          onReload={onRefresh}
          onSave={async (values) => {
            await manage({
              entity: "decor",
              operation: item ? "update" : "create",
              ...(item ? { id: item.id, revision: item.revision } : {}),
              locationId: location.id,
              name: values.name,
              image: values.image,
              published: values.published,
              validFrom: DateTime.fromISO(String(values.validFrom), {
                zone: timezone,
              })
                .toUTC()
                .toISO(),
              validUntil: values.validUntil
                ? DateTime.fromISO(String(values.validUntil), {
                    zone: timezone,
                  })
                    .toUTC()
                    .toISO()
                : null,
            });
            onRefresh();
          }}
        />
      )}
    </>
  );
}
