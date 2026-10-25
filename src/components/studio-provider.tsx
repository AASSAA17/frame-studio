"use client";
import {
  createContext,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";
import { copy, type Locale } from "@/lib/i18n";

type StudioContext = {
  locale: Locale;
  setLocale: (v: Locale) => void;
  t: typeof copy.ru;
  text: (ru: string, kk: string) => string;
};
const Context = createContext<StudioContext | null>(null);
export function StudioProvider({ children }: { children: ReactNode }) {
  const [locale, setLocaleState] = useState<Locale>("ru");
  useEffect(() => {
    const saved = localStorage.getItem("frame-language");
    if (saved === "kk") setLocaleState("kk");
  }, []);
  const setLocale = (value: Locale) => {
    setLocaleState(value);
    localStorage.setItem("frame-language", value);
  };
  useEffect(() => {
    document.documentElement.lang = locale;
  }, [locale]);
  return (
    <Context.Provider
      value={{
        locale,
        setLocale,
        t: copy[locale],
        text: (ru, kk) => (locale === "ru" ? ru : kk),
      }}
    >
      {children}
    </Context.Provider>
  );
}
export function useStudio() {
  const context = useContext(Context);
  if (!context) throw new Error("StudioProvider missing");
  return context;
}
