"use client";
import { PublicShell, State, ArrowLink, DemoNote } from "@/components/shared";
import { useStudio } from "@/components/studio-provider";
import { useApi, money, type Catalog } from "@/components/api";
export default function Team() {
  const { t, text } = useStudio();
  const { data, loading, error, refresh } = useApi<Catalog>("/api/catalog");
  return (
    <PublicShell>
      <div className="page-width">
        <section className="page-intro">
          <p className="eyebrow">PEOPLE BEHIND THE FRAME</p>
          <h1>
            {t.team}
            <span className="serif">.</span>
          </h1>
          <p>
            {text(
              "Ваша идея, наш опыт. Выберите специалиста — его свободное время проверим вместе с доступностью пространства. Профили демонстрационные.",
              "Сіздің идеяңыз, біздің тәжірибеміз. Маман таңдаңыз — оның бос уақытын кеңістікпен бірге тексереміз. Профильдер демонстрациялық.",
            )}
          </p>
        </section>
        {loading || error ? (
          <State loading={loading} error={error} retry={refresh} />
        ) : (
          <div className="team-grid">
            {data?.specialists.map((person, index) => (
              <article className="team-card" key={person.id}>
                <div className="team-avatar" aria-hidden="true">
                  {String(index + 1).padStart(2, "0")} /
                </div>
                <h3>{person.name}</h3>
                <p>{person.specialty}</p>
                <p>
                  {money(person.hourlyPriceMinor)} {t.perHour}
                </p>
                <ArrowLink href={`/booking?specialist=${person.id}`}>
                  {text("Собрать съёмку вместе", "Бірге түсірілім жоспарлау")}
                </ArrowLink>
              </article>
            ))}
          </div>
        )}
        <DemoNote />
        <div style={{ height: 50 }} />
      </div>
    </PublicShell>
  );
}
