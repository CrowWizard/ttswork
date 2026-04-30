"use client";

export type AdminCredentials = {
  username: string;
  password: string;
};

export type AdminPagination = {
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
};

export class AdminApiError extends Error {
  status: number;
  code: "auth_required" | "request_failed";
  requestId?: string;

  constructor(message: string, status: number, code: "auth_required" | "request_failed", requestId?: string) {
    super(message);
    this.name = "AdminApiError";
    this.status = status;
    this.code = code;
    this.requestId = requestId;
  }
}

type AdminFetchOptions = {
  method?: "GET" | "POST";
  query?: Record<string, string | number | boolean | null | undefined>;
  body?: unknown;
  credentials?: AdminCredentials | null;
  signal?: AbortSignal;
};

const ADMIN_CREDENTIALS_STORAGE_KEY = "voice-mvp.admin.basic-auth";
export const ADMIN_AUTH_REQUIRED_EVENT = "voice-mvp.admin.auth-required";
export const ADMIN_AUTH_UPDATED_EVENT = "voice-mvp.admin.auth-updated";

type ErrorPayload = {
  error?: string;
  requestId?: string;
};

function isBrowser() {
  return typeof window !== "undefined";
}

function encodeAuthorization(credentials: AdminCredentials) {
  return `Basic ${window.btoa(`${credentials.username}:${credentials.password}`)}`;
}

function notifyWindow(eventName: string) {
  if (!isBrowser()) {
    return;
  }

  window.dispatchEvent(new CustomEvent(eventName));
}

function trimOrUndefined(value: string | null) {
  if (!value) {
    return undefined;
  }

  const normalized = value.trim();
  return normalized || undefined;
}

function parsePositiveInt(value: string | null, fallback: number) {
  const parsed = Number.parseInt(value ?? "", 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

async function parseResponsePayload(response: Response) {
  const contentType = response.headers.get("content-type") ?? "";

  if (contentType.includes("application/json")) {
    return response.json().catch(() => null);
  }

  const text = await response.text().catch(() => "");
  return text ? { error: text } : null;
}

export function getStoredAdminCredentials(): AdminCredentials | null {
  if (!isBrowser()) {
    return null;
  }

  const raw = window.sessionStorage.getItem(ADMIN_CREDENTIALS_STORAGE_KEY);

  if (!raw) {
    return null;
  }

  try {
    const parsed = JSON.parse(raw) as Partial<AdminCredentials>;

    if (!parsed.username || !parsed.password) {
      return null;
    }

    return {
      username: parsed.username,
      password: parsed.password,
    };
  } catch {
    return null;
  }
}

export function saveAdminCredentials(credentials: AdminCredentials) {
  if (!isBrowser()) {
    return;
  }

  window.sessionStorage.setItem(ADMIN_CREDENTIALS_STORAGE_KEY, JSON.stringify(credentials));
  notifyWindow(ADMIN_AUTH_UPDATED_EVENT);
}

export function clearAdminCredentials() {
  if (!isBrowser()) {
    return;
  }

  window.sessionStorage.removeItem(ADMIN_CREDENTIALS_STORAGE_KEY);
  notifyWindow(ADMIN_AUTH_UPDATED_EVENT);
}

export function buildAdminQuery(query?: Record<string, string | number | boolean | null | undefined>) {
  if (!query) {
    return "";
  }

  const searchParams = new URLSearchParams();

  for (const [key, value] of Object.entries(query)) {
    if (value === undefined || value === null || value === "") {
      continue;
    }

    searchParams.set(key, String(value));
  }

  const serialized = searchParams.toString();
  return serialized ? `?${serialized}` : "";
}

export async function adminFetchJson<T>(path: string, options: AdminFetchOptions = {}) {
  const credentials = options.credentials ?? getStoredAdminCredentials();
  const headers = new Headers();

  if (options.body !== undefined) {
    headers.set("Content-Type", "application/json");
  }

  if (credentials && isBrowser()) {
    headers.set("Authorization", encodeAuthorization(credentials));
  }

  const response = await fetch(`${path}${buildAdminQuery(options.query)}`, {
    method: options.method ?? "GET",
    headers,
    body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
    signal: options.signal,
    cache: "no-store",
  });
  const payload = (await parseResponsePayload(response)) as ErrorPayload | T | null;

  if (response.status === 401) {
    notifyWindow(ADMIN_AUTH_REQUIRED_EVENT);
    throw new AdminApiError(
      (payload as ErrorPayload | null)?.error ?? "当前后台需要先通过管理员认证。",
      401,
      "auth_required",
      (payload as ErrorPayload | null)?.requestId,
    );
  }

  if (!response.ok) {
    throw new AdminApiError(
      (payload as ErrorPayload | null)?.error ?? "后台请求失败。",
      response.status,
      "request_failed",
      (payload as ErrorPayload | null)?.requestId,
    );
  }

  return payload as T;
}

export async function verifyAdminCredentials(credentials: AdminCredentials) {
  await adminFetchJson<{ metrics: Record<string, number> }>("/api/admin/analytics/overview", {
    credentials,
  });
}

export function formatAdminNumber(value: number | null | undefined) {
  return new Intl.NumberFormat("zh-CN").format(value ?? 0);
}

export function formatAdminDateTime(value: string | Date | null | undefined) {
  if (!value) {
    return "-";
  }

  return new Intl.DateTimeFormat("zh-CN", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}

export function formatAdminDate(value: string | Date | null | undefined) {
  if (!value) {
    return "-";
  }

  return new Intl.DateTimeFormat("zh-CN", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(value));
}

export function toDateInputValue(value: Date) {
  return value.toISOString().slice(0, 10);
}

export function toApiStartAt(value?: string) {
  return value ? `${value}T00:00:00.000Z` : undefined;
}

export function toApiEndAt(value?: string) {
  return value ? `${value}T23:59:59.999Z` : undefined;
}

export function buildPresetRange(preset: "7d" | "30d" | "custom") {
  const end = new Date();

  if (preset === "custom") {
    return {
      startDate: undefined,
      endDate: undefined,
    };
  }

  const days = preset === "7d" ? 6 : 29;
  const start = new Date(end);
  start.setUTCDate(start.getUTCDate() - days);

  return {
    startDate: toDateInputValue(start),
    endDate: toDateInputValue(end),
  };
}

export function readStringParam(value: string | null) {
  return trimOrUndefined(value) ?? "";
}

export function readOptionalStringParam(value: string | null) {
  return trimOrUndefined(value);
}

export function readPageParam(value: string | null) {
  return parsePositiveInt(value, 1);
}

export function readPageSizeParam(value: string | null, fallback = 20) {
  return parsePositiveInt(value, fallback);
}
