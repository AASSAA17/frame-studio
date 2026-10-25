"use client";
import { useState } from "react";
import {
  PublicShell,
  LocationCard,
  State,
  DemoNote,
  Empty,
} from "@/components/shared";
import { useStudio } from "@/components/studio-provider";
import { useApi, type Catalog } from "@/components/api";
export default function Locations() {
  const { t, text } = useStudio();
  const { data, loading, error, refresh } = useApi<Catalog>("/api/catalog");
  const [search, setSearch] = useState(""),
    [guests, setGuests] = useState(""),
    [price, setPrice] = useState(""),
    [tag, setTag] = useState("");
  const locations =
    data?.locations.filter(
      (l) =>
        (!search ||
          `${l.name} ${l.description}`
            .toLowerCase()
            .includes(search.toLowerCase())) &&
        (!guests || l.capacity >= Number(guests)) &&
        (!price || l.hourlyPriceMinor <= Number(price) * 100) &&
        (!tag || l.tags?.includes(tag)),
    ) || [];
  return (
    <PublicShell>
      <div className="page-width">
        <section className="page-intro">
          <p className="eyebrow">THE SPACES / 01—05</p>
          <h1>
            {t.locations}
            <span className="serif">.</span>
          </h1>
          <p>
            {text(
              "Разный свет, фактура и настроение. Выберите пространство под вашу идею — доступность проверим при выборе времени.",
              "Әртүрлі жарық, фактура және көңіл күй. Идеяңызға сай кеңістікті таңдаңыз — уақыт таңдағанда қолжетімділікті тексереміз.",
            )}
          </p>
        </section>
        <div className="filter-bar">
          <label>
            {t.search}
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={text("Название локации", "Локация атауы")}
            />
          </label>
          <label>
            {text("Формат контента", "Контент форматы")}
            <select value={tag} onChange={(e) => setTag(e.target.value)}>
              <option value="">
                {text("Все форматы", "Барлық форматтар")}
              </option>
              {Array.from(
                new Set(data?.locations.flatMap((l) => l.tags) || []),
              ).map((v) => (
                <option key={v}>{v}</option>
              ))}
            </select>
          </label>
          <label>
            {t.guests}
            <select value={guests} onChange={(e) => setGuests(e.target.value)}>
              <option value="">
                {text("Любое количество", "Кез келген сан")}
              </option>
              <option value="3">3+</option>
              <option value="5">5+</option>
              <option value="10">10+</option>
            </select>
          </label>
          <label>
            {text("Бюджет в час", "Сағатына бюджет")}
            <select value={price} onChange={(e) => setPrice(e.target.value)}>
              <option value="">
                {text("Любой бюджет", "Кез келген бюджет")}
              </option>
              <option value="10000">≤ 10 000 ₸</option>
              <option value="15000">≤ 15 000 ₸</option>
              <option value="20000">≤ 20 000 ₸</option>
            </select>
          </label>
        </div>
        <section className="catalog-section">
          {loading || error ? (
            <State loading={loading} error={error} retry={refresh} />
          ) : locations.length ? (
            <div className="locations-grid">
              {locations.map((location, index) => (
                <LocationCard
                  key={location.id}
                  location={location}
                  index={index}
                />
              ))}
            </div>
          ) : (
            <Empty
              title={text("Локации не найдены", "Локациялар табылмады")}
              text={text(
                "Попробуйте изменить фильтры.",
                "Сүзгілерді өзгертіп көріңіз.",
              )}
              action={false}
            />
          )}
          <DemoNote />
        </section>
      </div>
    </PublicShell>
  );
}
