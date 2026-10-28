"use client";
import { useEffect, useState } from "react";
import {
  Save,
  Settings2,
  Building2,
  Clock3,
  CreditCard,
  ShieldCheck,
  Mail,
} from "lucide-react";
import { useStudio } from "@/components/studio-provider";
import { State } from "@/components/shared";
import {
  Fields,
  MutationError,
  ReadOnlyNote,
  SectionHeading,
  manage,
  useManagement,
  useDirtyGuard,
  type Field,
  type Settings,
  type Values,
} from "./management-shared";

function settingsValues(settings: Settings): Values {
  return {
    name: settings.name,
    city: settings.city,
    timezone: settings.timezone,
    depositPercent: settings.depositPercent,
    holdMinutes: settings.holdMinutes,
    openHour: settings.openHour,
    closeHour: settings.closeHour,
    stepMinutes: settings.stepMinutes,
    minimumMinutes: settings.minimumMinutes,
    bufferBeforeMinutes: settings.bufferBeforeMinutes,
    bufferAfterMinutes: settings.bufferAfterMinutes,
    reminderHours: settings.reminderHours.join(", "),
    rulesText: settings.rulesText,
    rulesVersion: settings.rulesVersion,
    address: settings.contacts?.address || "",
    email: settings.contacts?.email || "",
    phone: settings.contacts?.phone || "",
    instagram: settings.contacts?.instagram || "",
    website: settings.contacts?.website || "",
  };
}
export function StudioSettingsPage() {
  const studio = useManagement();
  const { text } = useStudio();
  return (
    <>
      <SectionHeading
        title={text("Настройки студии", "Студия параметрлері")}
        description={text(
          "Контакты, время работы и условия бронирования. Сохранённые значения используются на сайте и при новых заказах.",
          "Байланыстар, жұмыс уақыты және брондау шарттары. Сақталған мәндер сайтта және жаңа тапсырыстарда қолданылады.",
        )}
      />
      {studio.loading || studio.error ? (
        <State
          loading={studio.loading}
          error={studio.error}
          retry={studio.refresh}
        />
      ) : (
        studio.data && (
          <>
            {!studio.owner && <ReadOnlyNote />}
            <SettingsForm
              settings={studio.data.settings}
              owner={studio.owner}
              paymentMode={studio.data.paymentMode}
              refresh={studio.refresh}
            />
          </>
        )
      )}
    </>
  );
}
function SettingsForm({
  settings,
  owner,
  paymentMode,
  refresh,
}: {
  settings: Settings;
  owner: boolean;
  paymentMode: string;
  refresh: () => void;
}) {
  const { t, text } = useStudio();
  const [values, setValues] = useState(() => settingsValues(settings)),
    [baseline, setBaseline] = useState(() => settingsValues(settings)),
    [revision, setRevision] = useState(settings.revision),
    [busy, setBusy] = useState(false),
    [error, setError] = useState<unknown>(null),
    [notice, setNotice] = useState("");
  const dirty = JSON.stringify(values) !== JSON.stringify(baseline);
  const mayLeave = useDirtyGuard(dirty);
  useEffect(() => {
    if (!dirty && settings.revision !== revision) {
      const next = settingsValues(settings);
      setValues(next);
      setBaseline(next);
      setRevision(settings.revision);
    }
  }, [settings, dirty, revision]);
  const groups: {
    icon: typeof Save;
    title: string;
    description: string;
    fields: Field[];
  }[] = [
    {
      icon: Building2,
      title: text("Студия и контакты", "Студия және байланыстар"),
      description: text(
        "Название и контакты появятся в шапке, подвале и на странице контактов.",
        "Атау мен байланыстар сайттың жоғарғы, төменгі бөліктерінде және байланыс бетінде көрінеді.",
      ),
      fields: [
        {
          key: "name",
          label: text("Название студии", "Студия атауы"),
          required: true,
        },
        { key: "city", label: text("Город", "Қала"), required: true },
        { key: "address", label: text("Адрес", "Мекенжай"), wide: true },
        { key: "phone", label: text("Телефон", "Телефон") },
        {
          key: "email",
          label: text("Почта для связи", "Байланыс поштасы"),
          type: "email",
        },
        {
          key: "instagram",
          label: "Instagram",
          type: "url",
          help: "https://…",
        },
        {
          key: "website",
          label: text("Сайт / ссылка", "Сайт / сілтеме"),
          type: "url",
          help: "https://…",
        },
      ],
    },
    {
      icon: Clock3,
      title: text("Время и бронирование", "Уақыт және брондау"),
      description: text(
        "Часовой пояс применяется ко всем рабочим дням. Графики отдельных ресурсов настраиваются в залах, команде и оборудовании.",
        "Уақыт белдеуі барлық жұмыс күндеріне қолданылады. Жеке ресурс кестелері залдарда, командада және жабдықта бапталады.",
      ),
      fields: [
        {
          key: "timezone",
          label: text("Часовой пояс IANA", "IANA уақыт белдеуі"),
          required: true,
          help: text(
            "Например, Asia/Almaty. Изменение не перемещает уже созданные съёмки.",
            "Мысалы, Asia/Almaty. Өзгеріс бұрын құрылған түсірілім уақытын ауыстырмайды.",
          ),
        },
        {
          key: "holdMinutes",
          label: text(
            "Удержание до оплаты, минут",
            "Төлемге дейін сақтау, минут",
          ),
          type: "number",
          min: 1,
          max: 60,
          required: true,
        },
        {
          key: "openHour",
          label: text("Начало рабочего дня, час", "Жұмыс күнінің басы, сағат"),
          type: "number",
          min: 0,
          max: 23,
          required: true,
        },
        {
          key: "closeHour",
          label: text("Конец рабочего дня, час", "Жұмыс күнінің соңы, сағат"),
          type: "number",
          min: 0,
          max: 24,
          required: true,
        },
        {
          key: "stepMinutes",
          label: text("Шаг записи, минут", "Жазылу қадамы, минут"),
          type: "number",
          min: 5,
          max: 120,
          required: true,
        },
        {
          key: "minimumMinutes",
          label: text("Минимальная аренда, минут", "Ең қысқа жалдау, минут"),
          type: "number",
          min: 5,
          max: 720,
          required: true,
        },
        {
          key: "bufferBeforeMinutes",
          label: text(
            "Подготовка до съёмки, минут",
            "Түсірілімге дейін дайындық, минут",
          ),
          type: "number",
          min: 0,
          max: 180,
          required: true,
        },
        {
          key: "bufferAfterMinutes",
          label: text(
            "Уборка после съёмки, минут",
            "Түсірілімнен кейін жинау, минут",
          ),
          type: "number",
          min: 0,
          max: 180,
          required: true,
        },
      ],
    },
    {
      icon: CreditCard,
      title: text("Предоплата и напоминания", "Алдын ала төлем және еске салу"),
      description: text(
        "Валюта — KZT. Финансовые значения существующих заказов сохраняются.",
        "Валюта — KZT. Бұрынғы тапсырыстардың қаржылық мәндері сақталады.",
      ),
      fields: [
        {
          key: "depositPercent",
          label: text("Предоплата, %", "Алдын ала төлем, %"),
          type: "number",
          min: 1,
          max: 100,
          required: true,
        },
        {
          key: "reminderHours",
          label: text("Напоминания за N часов", "N сағат бұрын еске салу"),
          help: text(
            "Через запятую, например 24, 2. Для будущих подтверждений и переносов.",
            "Үтірмен, мысалы 24, 2. Алдағы растаулар мен ауыстырулар үшін.",
          ),
        },
      ],
    },
    {
      icon: ShieldCheck,
      title: text("Правила аренды", "Жалдау ережелері"),
      description: text(
        "Обновите версию при изменении текста. Клиент видит условия до оформления; заказ хранит принятую версию.",
        "Мәтін өзгергенде нұсқаны жаңартыңыз. Клиент шарттарды рәсімдеуге дейін көреді; тапсырыс қабылданған нұсқаны сақтайды.",
      ),
      fields: [
        {
          key: "rulesVersion",
          label: text("Версия правил", "Ереже нұсқасы"),
          required: true,
        },
        {
          key: "rulesText",
          label: text("Текст правил", "Ереже мәтіні"),
          type: "textarea",
          required: true,
          wide: true,
        },
      ],
    },
  ];
  return (
    <form
      onSubmit={async (event) => {
        event.preventDefault();
        setError(null);
        setNotice("");
        setBusy(true);
        try {
          const {
            address,
            email,
            phone,
            instagram,
            website,
            reminderHours,
            ...rest
          } = values;
          await manage({
            entity: "settings",
            operation: "update",
            revision,
            ...rest,
            currency: "KZT",
            reminderHours: String(reminderHours).trim()
              ? String(reminderHours)
                  .split(",")
                  .map((value) => Number(value.trim()))
              : [],
            contacts: { address, email, phone, instagram, website },
          });
          setBaseline({ ...values });
          setNotice(
            text(
              "Настройки сохранены. Сайт использует новые значения.",
              "Параметрлер сақталды. Сайт жаңа мәндерді қолданады.",
            ),
          );
          refresh();
        } catch (reason) {
          setError(reason);
        } finally {
          setBusy(false);
        }
      }}
    >
      <div className="settings-status">
        <span className="status-badge">
          {paymentMode === "test"
            ? text("Тестовая оплата", "Сынақ төлемі")
            : text("Ручной учёт платежей", "Төлемдерді қолмен тіркеу")}
        </span>
        <span>
          {text("Версия изменений", "Өзгерістер нұсқасы")}: {revision}
        </span>
      </div>
      {groups.map((group) => (
        <section className="management-section" key={group.title}>
          <header>
            <group.icon size={21} />
            <div>
              <h2>{group.title}</h2>
              <p>{group.description}</p>
            </div>
          </header>
          <Fields
            fields={group.fields}
            values={values}
            setValues={(value) => {
              setValues(value);
              setNotice("");
            }}
            disabled={!owner || busy}
          />
        </section>
      ))}
      <MutationError
        error={error}
        onReload={() => {
          if (mayLeave()) {
            setValues(settingsValues(settings));
            setBaseline(settingsValues(settings));
            setRevision(settings.revision);
            setError(null);
            refresh();
          }
        }}
      />
      {notice && (
        <div className="notice" role="status">
          {notice}
        </div>
      )}
      {owner && (
        <div className="save-bar">
          <span className={dirty ? "dirty-indicator" : ""}>
            {dirty
              ? text(
                  "Есть несохранённые изменения",
                  "Сақталмаған өзгерістер бар",
                )
              : text("Все изменения сохранены", "Барлық өзгерістер сақталды")}
          </span>
          <button
            data-testid="settings-save"
            className="button"
            disabled={busy || !dirty}
          >
            <Save size={16} />
            {busy
              ? text("Сохраняем…", "Сақталуда…")
              : text("Сохранить настройки", "Параметрлерді сақтау")}
          </button>
        </div>
      )}
    </form>
  );
}
