"use client";
import { use } from "react";
import Link from "next/link";
import { ArrowLeft, ArrowUpRight, Maximize2, Users, Sun } from "lucide-react";
import { PublicShell, State, DemoNote } from "@/components/shared";
import { useStudio } from "@/components/studio-provider";
import { useApi, money, type Catalog } from "@/components/api";
export default function Location({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = use(params);
  const { t, text } = useStudio();
  const { data, loading, error, refresh } = useApi<Catalog>("/api/catalog");
  const location = data?.locations.find((l) => l.slug === slug);
  return (
    <PublicShell>
      <div className="page-width">
        <Link href="/locations" className="breadcrumb">
          <ArrowLeft size={14} />
          {t.locations}
        </Link>
        {loading || error ? (
          <State loading={loading} error={error} retry={refresh} />
        ) : !location ? (
          <State error={text("Локация не найдена", "Локация табылмады")} />
        ) : (
          <>
            <div className="detail-top">
              <div>
                <p className="eyebrow">FRAME / {t.city}</p>
                <h1>
                  {location.name}
                  <span className="serif">.</span>
                </h1>
                <p>{location.versionName}</p>
              </div>
              <div className="detail-price">
                <strong>{money(location.hourlyPriceMinor)}</strong>
                <small> {t.perHour}</small>
                <DemoNote />
              </div>
            </div>
            <img
              className="detail-image"
              src={location.image}
              alt={`${location.name} — ${t.illustration}`}
            />
            <div className="hero-caption">
              <span>{t.illustration}</span>
            </div>
            <div className="detail-grid">
              <div>
                <h2>
                  {text("Пространство с характером", "Өз мінезі бар кеңістік")}
                </h2>
                <p>{location.description}</p>
                <div className="feature-list">
                  <span>
                    <Maximize2 size={17} />
                    {location.area} {t.meters}
                  </span>
                  <span>
                    <Users size={17} />
                    {location.capacity} {t.people}
                  </span>
                  <span>
                    <Sun size={17} />
                    {text("Свет для ваших идей", "Идеяларыңызға жарық")}
                  </span>
                </div>
                <div className="tag-list">
                  {location.tags?.map((tag) => (
                    <span className="tag" key={tag}>
                      {tag}
                    </span>
                  ))}
                </div>
                <h2 style={{ marginTop: 40 }}>
                  {text(
                    "Учтём всё до съёмки",
                    "Түсірілімге дейін бәрін ескереміз",
                  )}
                </h2>
                <p>
                  {text(
                    "Выберите дату, длительность и дополнительные услуги. Итоговая стоимость и оформление на выбранную дату появятся перед подтверждением заказа. Если локации используют один зал, одновременная аренда будет недоступна.",
                    "Күнді, ұзақтықты және қосымша қызметтерді таңдаңыз. Жалпы құн мен сол күнгі безендіру тапсырыс расталғанға дейін көрсетіледі. Бір залдағы локациялар бір уақытта жалға берілмейді.",
                  )}
                </p>
              </div>
              <aside className="detail-aside">
                <p className="eyebrow">YOUR NEXT FRAME</p>
                <h3>
                  {text("Оставьте место для идеи", "Идеяға орын қалдырыңыз")}
                </h3>
                <p>
                  {text(
                    "Свободное время, команда и оборудование — в одном бронировании.",
                    "Бос уақыт, команда және жабдық — бір броньда.",
                  )}
                </p>
                <Link
                  className="button"
                  href={`/booking?location=${location.id}`}
                >
                  {text("Выбрать дату", "Күнді таңдау")}
                  <ArrowUpRight size={18} />
                </Link>
                <p className="summary-note">
                  {text(
                    "Предоплата 30% — демонстрационное условие. Реальные платежи не подключены.",
                    "30% алдын ала төлем — демо шарт. Нақты төлемдер қосылмаған.",
                  )}
                </p>
              </aside>
            </div>
          </>
        )}
      </div>
    </PublicShell>
  );
}
