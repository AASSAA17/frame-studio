"use client";
import { useState, type FormEvent } from "react";
import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { authClient } from "@/lib/auth-client";
import { PublicShell } from "@/components/shared";
import { useStudio } from "@/components/studio-provider";
export default function Login() {
  const { t, text } = useStudio();
  const [mode, setMode] = useState<"login" | "signup" | "reset">("login"),
    [email, setEmail] = useState(""),
    [password, setPassword] = useState(""),
    [name, setName] = useState(""),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [notice, setNotice] = useState("");
  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const target = new URLSearchParams(window.location.search).get("next");
      const next =
        target?.startsWith("/") && !target.startsWith("//")
          ? target
          : "/account";
      if (mode === "login") {
        const result = await authClient.signIn.email({
          email,
          password,
          callbackURL: next,
        });
        if (result.error) throw new Error(result.error.message || t.error);
        window.location.assign(next);
      } else if (mode === "signup") {
        const result = await authClient.signUp.email({
          email,
          password,
          name,
          callbackURL: next,
        });
        if (result.error) throw new Error(result.error.message || t.error);
        setNotice(
          text(
            "Проверьте почту и подтвердите адрес по ссылке. В локальном режиме письмо доступно в Mailpit.",
            "Поштаңызды тексеріп, сілтеме арқылы мекенжайды растаңыз. Жергілікті режимде хат Mailpit ішінде қолжетімді.",
          ),
        );
      } else {
        const result = await authClient.requestPasswordReset({
          email,
          redirectTo: "/reset-password",
        });
        if (result.error) throw new Error(result.error.message || t.error);
        setNotice(
          text(
            "Если аккаунт существует, письмо для восстановления будет отправлено настроенным почтовым сервисом.",
            "Егер аккаунт бар болса, қалпына келтіру хаты бапталған пошта қызметі арқылы жіберіледі.",
          ),
        );
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : t.error);
    } finally {
      setBusy(false);
    }
  }
  return (
    <PublicShell>
      <section className="form-page">
        <p className="eyebrow">YOUR PERSONAL SPACE</p>
        <h1>
          {mode === "reset"
            ? text("Восстановить доступ", "Қолжетімділікті қалпына келтіру")
            : t.account}
        </h1>
        <p>
          {text(
            "Бронирования, детали съёмок и платежи — в одном месте.",
            "Броньдар, түсірілім мәліметтері және төлемдер — бір жерде.",
          )}
        </p>
        <div className="form-tabs">
          <button
            className={mode === "login" ? "active" : ""}
            onClick={() => {
              setMode("login");
              setError("");
              setNotice("");
            }}
          >
            {t.signIn}
          </button>
          <button
            className={mode === "signup" ? "active" : ""}
            onClick={() => {
              setMode("signup");
              setError("");
              setNotice("");
            }}
          >
            {text("Создать аккаунт", "Аккаунт жасау")}
          </button>
        </div>
        <form className="form-stack" onSubmit={submit}>
          {mode === "signup" && (
            <label className="field">
              {t.name}
              <input
                autoComplete="name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                required
                maxLength={100}
              />
            </label>
          )}
          <label className="field">
            {t.email}
            <input
              type="email"
              autoComplete="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              maxLength={254}
            />
          </label>
          {mode !== "reset" && (
            <label className="field">
              {t.password}
              <input
                type="password"
                autoComplete={
                  mode === "signup" ? "new-password" : "current-password"
                }
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                minLength={12}
              />
              {mode === "signup" && (
                <small>
                  {text("Не менее 12 символов.", "Кемінде 12 таңба.")}
                </small>
              )}
            </label>
          )}
          {error && (
            <div className="notice error" role="alert">
              {error}
            </div>
          )}
          {notice && (
            <div className="notice" role="status">
              {notice}
            </div>
          )}
          <button className="button full" disabled={busy}>
            {busy
              ? text("Подождите…", "Күтіңіз…")
              : mode === "signup"
                ? text("Зарегистрироваться", "Тіркелу")
                : mode === "reset"
                  ? text("Отправить ссылку", "Сілтеме жіберу")
                  : t.signIn}
            <ArrowRight size={17} />
          </button>
          {mode === "login" && (
            <button
              type="button"
              className="inline-button"
              onClick={() => {
                setMode("reset");
                setError("");
                setNotice("");
              }}
            >
              {text("Забыли пароль?", "Құпиясөзді ұмыттыңыз ба?")}
            </button>
          )}
        </form>
        <p className="auth-footnote">
          {text(
            "Адрес почты необходимо подтвердить. Телефон сам по себе не предоставляет доступ к заказам.",
            "Пошта мекенжайын растау қажет. Телефон нөмірі тапсырыстарға кіруге жеткіліксіз.",
          )}{" "}
          <Link className="inline-button" href="/privacy">
            {t.privacy}
          </Link>
        </p>
      </section>
    </PublicShell>
  );
}
