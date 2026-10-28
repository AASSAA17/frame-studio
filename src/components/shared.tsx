"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  ArrowUpRight,
  ArrowRight,
  Menu,
  X,
  LoaderCircle,
  AlertCircle,
  Camera,
  UserRound,
} from "lucide-react";
import { useState } from "react";
import { useStudio } from "./studio-provider";
import { money, useApi, type User, type StudioLocation } from "./api";

export function Brand() {
  const { settings } = useStudio();
  const name = settings?.name || "FRAME STUDIO";
  return (
    <Link
      className={`wordmark ${name !== "FRAME STUDIO" ? "custom-wordmark" : ""}`}
      href="/"
      aria-label={name}
    >
      {name === "FRAME STUDIO" ? (
        <>
          FRAME<span>STUDIO</span>
        </>
      ) : (
        name
      )}
    </Link>
  );
}

export function Header() {
  const { t, locale, setLocale } = useStudio();
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const { data } = useApi<{ user: User | null }>("/api/session");
  return (
    <>
      <a className="skip-link" href="#main">
        {locale === "ru" ? "Перейти к содержимому" : "Мазмұнға өту"}
      </a>
      <header className="site-header">
        <Brand />
        <nav
          className="desktop-nav"
          aria-label={locale === "ru" ? "Главное меню" : "Басты мәзір"}
        >
          {[
            ["/locations", t.locations],
            ["/services", t.services],
            ["/team", t.team],
            ["/faq", t.faq],
          ].map(([href, label]) => (
            <Link
              key={href}
              href={href}
              aria-current={pathname === href ? "page" : undefined}
            >
              {label}
            </Link>
          ))}
        </nav>
        <div className="header-actions">
          <div className="language-switch" aria-label="Language">
            <button
              aria-pressed={locale === "ru"}
              onClick={() => setLocale("ru")}
            >
              RU
            </button>
            <span>/</span>
            <button
              aria-pressed={locale === "kk"}
              onClick={() => setLocale("kk")}
            >
              KZ
            </button>
          </div>
          <Link
            className="account-icon"
            href={data?.user ? "/account" : "/login"}
            aria-label={t.account}
          >
            <UserRound size={20} />
          </Link>
          <Link className="button small desktop-book" href="/booking">
            {t.book}
            <ArrowUpRight size={16} />
          </Link>
          <button
            className="icon-button mobile-menu-button"
            aria-label={open ? "Закрыть меню" : "Открыть меню"}
            aria-expanded={open}
            onClick={() => setOpen(!open)}
          >
            {open ? <X /> : <Menu />}
          </button>
        </div>
      </header>
      {open && (
        <nav className="mobile-nav">
          {[
            ["/locations", t.locations],
            ["/services", t.services],
            ["/team", t.team],
            ["/faq", t.faq],
            ["/booking", t.book],
            ["/account", t.account],
          ].map(([href, label]) => (
            <Link key={href} href={href} onClick={() => setOpen(false)}>
              {label}
              <ArrowUpRight size={18} />
            </Link>
          ))}
        </nav>
      )}
    </>
  );
}
export function Footer() {
  const { t, settings } = useStudio();
  return (
    <footer className="site-footer">
      <div className="footer-main">
        <Brand />
        <p>{t.footer}</p>
        <div className="footer-links">
          <Link href="/locations">{t.locations}</Link>
          <Link href="/contacts">{t.contacts}</Link>
          <Link href="/faq">{t.faq}</Link>
          <Link href="/crm">CRM</Link>
        </div>
      </div>
      <div className="footer-bottom">
        <span>
          © {new Date().getFullYear()} {settings?.name || "FRAME STUDIO"} ·{" "}
          {t.city}
        </span>
        <span>{t.demo}</span>
        <div>
          <Link href="/rules">{t.rules}</Link>
          <Link href="/privacy">{t.privacy}</Link>
        </div>
      </div>
    </footer>
  );
}
export function PublicShell({ children }: { children: React.ReactNode }) {
  return (
    <>
      <Header />
      <main id="main">{children}</main>
      <Footer />
    </>
  );
}
export function ArrowLink({
  href,
  children,
}: {
  href: string;
  children: React.ReactNode;
}) {
  return (
    <Link className="text-link" href={href}>
      {children}
      <ArrowUpRight size={18} />
    </Link>
  );
}
export function State({
  loading,
  error,
  retry,
}: {
  loading?: boolean;
  error?: string;
  retry?: () => void;
}) {
  const { t } = useStudio();
  return (
    <div
      className={error ? "state-panel error-panel" : "state-panel"}
      role={error ? "alert" : "status"}
    >
      {loading ? (
        <LoaderCircle className="spin" size={26} />
      ) : (
        <AlertCircle size={26} />
      )}
      <p>{loading ? t.loading : error}</p>
      {error && retry && (
        <button className="button secondary small" onClick={retry}>
          {t.retry}
        </button>
      )}
    </div>
  );
}
export function Empty({
  title,
  text,
  action = true,
}: {
  title: string;
  text?: string;
  action?: boolean;
}) {
  const { t } = useStudio();
  return (
    <div className="empty-state">
      <Camera strokeWidth={1} size={40} />
      <h3>{title}</h3>
      {text && <p>{text}</p>}
      {action && (
        <Link className="button" href="/locations">
          {t.choose}
          <ArrowRight size={16} />
        </Link>
      )}
    </div>
  );
}
export function LocationCard({
  location,
  index = 0,
}: {
  location: StudioLocation;
  index?: number;
}) {
  const { t } = useStudio();
  return (
    <article className="location-card">
      <Link className="location-image" href={`/locations/${location.slug}`}>
        <img
          src={
            location.currentVersion?.image ||
            location.image ||
            `/images/${location.slug}.svg`
          }
          alt={`${location.name} — ${t.illustration}`}
          loading="lazy"
        />
        <span className="image-index">
          {String(index + 1).padStart(2, "0")}
        </span>
        <span className="image-arrow">
          <ArrowUpRight size={22} />
        </span>
      </Link>
      <div className="location-card-heading">
        <h3>
          <Link href={`/locations/${location.slug}`}>{location.name}</Link>
        </h3>
        <span>
          {money(location.hourlyPriceMinor)} <small>{t.perHour}</small>
        </span>
      </div>
      <p className="location-meta">
        {location.area} {t.meters}
        <span>·</span>
        {location.capacity} {t.people}
        <span>·</span>
        {location.tags?.slice(0, 2).join(" / ")}
      </p>
    </article>
  );
}
export function StatusBadge({ status }: { status: string }) {
  const { t } = useStudio();
  return (
    <span className={`status-badge status-${status}`}>
      {(t as Record<string, string>)[status] || status}
    </span>
  );
}
export function DemoNote() {
  const { t } = useStudio();
  return (
    <p className="demo-note">
      <span className="status-dot" />
      {t.demo}
    </p>
  );
}
