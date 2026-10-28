"use client";
import { useEffect, useState, useCallback, useRef } from "react";
export type StudioLocation = {
  id: string;
  slug: string;
  name: string;
  description: string;
  descriptionKk?: string;
  image: string;
  area: number;
  capacity: number;
  hourlyPriceMinor: number;
  roomId: string;
  tags: string[];
  versionName: string;
  currentVersion?: {
    id: string;
    name: string;
    image: string;
    validFrom: string;
    validUntil: string | null;
  } | null;
  futureVersions?: {
    id: string;
    name: string;
    image: string;
    validFrom: string;
    validUntil: string | null;
  }[];
};
export type Catalog = {
  locations: StudioLocation[];
  specialists: {
    id: string;
    name: string;
    specialty: string;
    hourlyPriceMinor: number;
  }[];
  services: { id: string; name: string; priceMinor: number }[];
  equipment: {
    id: string;
    name: string;
    priceMinor: number;
    quantity: number;
  }[];
  settings: {
    name: string;
    city: string;
    currency: string;
    timezone: string;
    depositPercent: number;
    holdMinutes: number;
    openHour: number;
    closeHour: number;
    stepMinutes: number;
    minimumMinutes?: number;
    rulesText: string;
    rulesVersion: string;
    contacts?: {
      address?: string;
      email?: string;
      phone?: string;
      instagram?: string;
      website?: string;
    };
    bufferBeforeMinutes?: number;
    bufferAfterMinutes?: number;
    reminderHours?: number[];
  };
};
export type Booking = {
  id: string;
  number: string;
  userId: string;
  name: string;
  locationId?: string;
  locationName: string;
  versionName: string;
  startAt: string;
  endAt: string;
  status: string;
  expiresAt: string | null;
  totalMinor: number;
  depositMinor: number;
  paidMinor: number;
  balanceMinor: number;
  paymentStatus: string;
  items: {
    label: string;
    quantity: number;
    unitPriceMinor: number;
    totalMinor: number;
  }[];
  comment?: string;
  rulesText?: string;
  rulesVersion?: string;
  payments?: {
    id: string;
    kind: string;
    amountMinor: number;
    currency: string;
    method: string;
    createdAt: string;
    comment?: string;
  }[];
  specialistName?: string | null;
};
export type User = { id: string; name: string; email: string; role: string };
export class ApiError extends Error {
  constructor(
    message: string,
    public status: number,
    public code?: string,
    public details?: unknown,
  ) {
    super(message);
    this.name = "ApiError";
  }
}
export async function api<T>(url: string, options?: RequestInit): Promise<T> {
  const response = await fetch(url, {
    ...options,
    headers: { "Content-Type": "application/json", ...options?.headers },
  });
  const data = await response
    .json()
    .catch(() => ({ error: "Ответ сервера недоступен" }));
  if (!response.ok)
    throw new ApiError(
      data.error || "Не удалось выполнить действие",
      response.status,
      data.code,
      data.details,
    );
  return data as T;
}
export function useApi<T>(url: string | null) {
  const loadedUrl = useRef<string | null>(null);
  const [data, setData] = useState<T | null>(null),
    [error, setError] = useState(""),
    [loading, setLoading] = useState(!!url),
    [revision, setRevision] = useState(0);
  const refresh = useCallback(() => setRevision((v) => v + 1), []);
  useEffect(() => {
    if (!url) return;
    window.addEventListener("studio-updated", refresh);
    return () => window.removeEventListener("studio-updated", refresh);
  }, [url, refresh]);
  useEffect(() => {
    if (!url) {
      loadedUrl.current = null;
      setData(null);
      setError("");
      setLoading(false);
      return;
    }
    const controller = new AbortController();
    // Background refresh must not unmount dirty management forms or erase success feedback.
    setLoading(loadedUrl.current !== url);
    setError("");
    api<T>(url, { signal: controller.signal })
      .then((value) => {
        if (!controller.signal.aborted) {
          loadedUrl.current = url;
          setData(value);
        }
      })
      .catch((e) => {
        if (e.name !== "AbortError") setError(e.message);
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [url, revision]);
  return {
    data,
    error,
    loading: !!url && (loading || loadedUrl.current !== url),
    refresh,
  };
}
export function money(value: number) {
  return (
    new Intl.NumberFormat("ru-KZ", { maximumFractionDigits: 2 }).format(
      (value || 0) / 100,
    ) + " ₸"
  );
}
export function dateLabel(
  date: string,
  locale = "ru",
  timeZone = "Asia/Almaty",
) {
  return new Intl.DateTimeFormat(locale === "kk" ? "kk-KZ" : "ru-KZ", {
    day: "numeric",
    month: "long",
    hour: "2-digit",
    minute: "2-digit",
    timeZone,
  }).format(new Date(date));
}
export function localDate(timeZone = "Asia/Almaty") {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}
export function bookingArray(
  value: Booking[] | { bookings: Booking[] } | null,
) {
  return Array.isArray(value) ? value : value?.bookings || [];
}
