"use client";
import Link from "next/link";
import {
  ArrowUpRight,
  ArrowDown,
  Aperture,
  Sun,
  MoveUpRight,
} from "lucide-react";
import { useStudio } from "@/components/studio-provider";
import { useApi, type Catalog } from "@/components/api";
import {
  PublicShell,
  ArrowLink,
  LocationCard,
  State,
  DemoNote,
} from "@/components/shared";
export default function Home() {
  const { t, text } = useStudio();
  const { data, loading, error, refresh } = useApi<Catalog>("/api/catalog");
  return (
    <PublicShell>
      <section className="hero page-width">
        <div className="hero-copy">
          <p className="eyebrow">
            <span className="status-dot" />
            {t.city} / PHOTO & CONTENT SPACE
          </p>
          <h1>
            {t.heroA}
            <br />
            <span className="serif">{t.heroB}</span>
          </h1>
          <div className="hero-bottom">
            <p>{t.heroText}</p>
            <Link className="button" href="/locations">
              {t.choose}
              <ArrowUpRight size={19} />
            </Link>
          </div>
        </div>
        <div className="hero-image">
          <img
            src="/images/daylight.svg"
            alt={t.illustration}
            fetchPriority="high"
          />
          <div className="hero-image-label">
            <span>01 / DAYLIGHT</span>
            <span>
              <Sun size={14} />
              {text(
                "Мягкий свет. Чистые формы.",
                "Жұмсақ жарық. Таза пішіндер.",
              )}
            </span>
          </div>
          <span className="hero-image-mark">
            FRAME
            <br />
            <small>YOUR NEXT IDEA</small>
          </span>
        </div>
        <div className="hero-caption">
          <span>{t.illustration}</span>
          <a href="#spaces">
            {text("Исследовать пространство", "Кеңістікті зерттеу")}
            <ArrowDown size={14} />
          </a>
        </div>
      </section>
      <section id="spaces" className="section page-width">
        <div className="section-heading">
          <div>
            <p className="eyebrow">01 / {t.locations}</p>
            <h2>{t.spaces}</h2>
            <p>{t.spacesText}</p>
          </div>
          <ArrowLink href="/locations">{t.allSpaces}</ArrowLink>
        </div>
        {loading || error ? (
          <State loading={loading} error={error} retry={refresh} />
        ) : (
          <div className="locations-grid home-grid">
            {data?.locations.slice(0, 3).map((location, index) => (
              <LocationCard
                key={location.id}
                location={location}
                index={index}
              />
            ))}
          </div>
        )}
        <DemoNote />
      </section>
      <section className="format-section">
        <div className="page-width">
          <p className="eyebrow">
            02 / {text("Как вам удобно", "Сізге ыңғайлы")}
          </p>
          <h2>{t.format}</h2>
          <div className="format-grid">
            <article>
              <Aperture size={32} strokeWidth={1} />
              <h3>{t.ownTitle}</h3>
              <p>{t.ownText}</p>
              <ArrowLink href="/booking">{t.book}</ArrowLink>
            </article>
            <article>
              <MoveUpRight size={32} strokeWidth={1} />
              <h3>{t.studioTitle}</h3>
              <p>{t.studioText}</p>
              <ArrowLink href="/team">
                {text("Познакомиться с командой", "Командамен танысу")}
              </ArrowLink>
            </article>
          </div>
        </div>
      </section>
      <section className="section page-width">
        <div className="section-heading">
          <div>
            <p className="eyebrow">03 / {text("Всё просто", "Бәрі оңай")}</p>
            <h2>{t.how}</h2>
          </div>
        </div>
        <div className="steps-grid">
          {[
            [t.step1, t.step1Text],
            [t.step2, t.step2Text],
            [t.step3, t.step3Text],
          ].map(([title, description], i) => (
            <article key={title}>
              <span>0{i + 1}</span>
              <h3>{title}</h3>
              <p>{description}</p>
            </article>
          ))}
        </div>
      </section>
      <section className="bottom-cta page-width">
        <p className="eyebrow">MAKE ROOM FOR YOUR IDEAS</p>
        <h2>{text("Что создадим сегодня?", "Бүгін не жасаймыз?")}</h2>
        <Link className="button" href="/booking">
          {t.book}
          <ArrowUpRight size={18} />
        </Link>
      </section>
    </PublicShell>
  );
}
