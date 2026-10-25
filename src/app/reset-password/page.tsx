"use client";
import { useState, type FormEvent } from "react";
import Link from "next/link";
import { authClient } from "@/lib/auth-client";
import { PublicShell } from "@/components/shared";
import { useStudio } from "@/components/studio-provider";
export default function ResetPassword() {
  const { t, text } = useStudio();
  const [password, setPassword] = useState(""),
    [busy, setBusy] = useState(false),
    [message, setMessage] = useState(""),
    [error, setError] = useState("");
  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    const token = new URLSearchParams(window.location.search).get("token");
    if (!token) {
      setError(
        text(
          "Ссылка недействительна. Запросите восстановление ещё раз.",
          "Сілтеме жарамсыз. Қалпына келтіруді қайта сұраңыз.",
        ),
      );
      setBusy(false);
      return;
    }
    try {
      const result = await authClient.resetPassword({
        newPassword: password,
        token,
      });
      if (result.error) throw new Error(result.error.message || t.error);
      setMessage(
        text(
          "Пароль изменён. Теперь можно войти.",
          "Құпиясөз өзгертілді. Енді кіре аласыз.",
        ),
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : t.error);
    } finally {
      setBusy(false);
    }
  }
  return (
    <PublicShell>
      <section className="form-page">
        <h1>{text("Новый пароль", "Жаңа құпиясөз")}</h1>
        <form className="form-stack" onSubmit={submit}>
          <label className="field">
            {t.password}
            <input
              type="password"
              autoComplete="new-password"
              minLength={12}
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </label>
          {error && (
            <div className="notice error" role="alert">
              {error}
            </div>
          )}
          {message ? (
            <div className="notice">
              {message}{" "}
              <Link href="/login" className="text-link">
                {t.signIn}
              </Link>
            </div>
          ) : (
            <button className="button" disabled={busy}>
              {t.save}
            </button>
          )}
        </form>
      </section>
    </PublicShell>
  );
}
