"use client";
import { PublicShell, State, ArrowLink, DemoNote } from "@/components/shared";
import { useStudio } from "@/components/studio-provider";
import { useApi, money, type Catalog } from "@/components/api";
export default function Services() {
  const { t, text } = useStudio();
  const { data, loading, error, refresh } = useApi<Catalog>("/api/catalog");
  return (
    <PublicShell>
      <div className="page-width">
        <section className="page-intro">
          <p className="eyebrow">MORE THAN A SPACE</p>
          <h1>
            {t.services}
            <span className="serif">.</span>
          </h1>
          <p>
            {text(
              "Добавьте к пространству то, что нужно вашей съёмке. Все выбранные услуги войдут в подробный расчёт заказа.",
              "Кеңістікке түсірілімге қажетті қызметтерді қосыңыз. Барлық таңдалған қызметтер тапсырыс есебіне кіреді.",
            )}
          </p>
        </section>
        {loading || error ? (
          <State loading={loading} error={error} retry={refresh} />
        ) : (
          <>
            <div className="service-list">
              {data?.services.map((service) => (
                <article className="service-card" key={service.id}>
                  <h3>{service.name}</h3>
                  <p>
                    {text(
                      "Дополнительная услуга студии. Добавляется при бронировании.",
                      "Студияның қосымша қызметі. Брондау кезінде қосылады.",
                    )}
                  </p>
                  <strong>{money(service.priceMinor)}</strong>
                  <ArrowLink href="/booking">
                    {text("Добавить к съёмке", "Түсірілімге қосу")}
                  </ArrowLink>
                </article>
              ))}
            </div>
            <h2 style={{ fontSize: 30, marginBottom: 25 }}>
              {text("Оборудование", "Жабдық")}
            </h2>
            <div className="service-list">
              {data?.equipment.map((item) => (
                <article className="service-card" key={item.id}>
                  <h3>{item.name}</h3>
                  <p>
                    {text(
                      "Количество ограничено. Проверяем наличие на выбранное время.",
                      "Саны шектеулі. Таңдалған уақытқа қолжетімділігін тексереміз.",
                    )}
                  </p>
                  <strong>{money(item.priceMinor)}</strong>
                  <ArrowLink href="/booking">{t.book}</ArrowLink>
                </article>
              ))}
            </div>
            <DemoNote />
            <div style={{ height: 55 }} />
          </>
        )}
      </div>
    </PublicShell>
  );
}
