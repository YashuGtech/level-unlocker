/**
 * External backend HTTP client.
 *
 * Targets the configurable VITE_API_URL endpoint. All errors surface as a
 * toast popup so the user is never silently stuck. Use apiGet / apiPost
 * for any call to the external backend; do NOT bypass this wrapper or
 * the error UX will regress.
 */
import { toast } from "sonner";

export const API_URL =
  (import.meta.env.VITE_API_URL as string | undefined)?.replace(/\/$/, "") ||
  "https://oxford-pleased-pulse-because.trycloudflare.com/api";

export class ApiError extends Error {
  status: number;
  body: unknown;
  constructor(message: string, status: number, body: unknown) {
    super(message);
    this.status = status;
    this.body = body;
  }
}

async function request<T>(
  path: string,
  init: RequestInit & { silent?: boolean } = {},
): Promise<T> {
  const url = path.startsWith("http") ? path : `${API_URL}${path.startsWith("/") ? path : `/${path}`}`;
  const { silent, ...rest } = init;
  try {
    const res = await fetch(url, {
      ...rest,
      headers: {
        Accept: "application/json",
        ...(rest.body && !(rest.body instanceof FormData)
          ? { "Content-Type": "application/json" }
          : {}),
        ...(rest.headers ?? {}),
      },
    });
    const text = await res.text();
    let body: unknown = null;
    try {
      body = text ? JSON.parse(text) : null;
    } catch {
      body = text;
    }
    if (!res.ok) {
      const message =
        (body && typeof body === "object" && "message" in body && typeof (body as { message: unknown }).message === "string"
          ? (body as { message: string }).message
          : null) ||
        (typeof body === "string" && body) ||
        `Request failed (${res.status})`;
      throw new ApiError(message, res.status, body);
    }
    return body as T;
  } catch (err) {
    const message =
      err instanceof ApiError
        ? err.message
        : err instanceof TypeError
          ? "Cannot reach backend. Check your connection."
          : err instanceof Error
            ? err.message
            : "Unknown backend error";
    if (!silent) toast.error(message);
    throw err instanceof Error ? err : new Error(message);
  }
}

export const apiGet = <T>(path: string, init?: RequestInit & { silent?: boolean }) =>
  request<T>(path, { ...init, method: "GET" });

export const apiPost = <T>(
  path: string,
  body?: unknown,
  init?: RequestInit & { silent?: boolean },
) =>
  request<T>(path, {
    ...init,
    method: "POST",
    body: body instanceof FormData ? body : body ? JSON.stringify(body) : undefined,
  });
