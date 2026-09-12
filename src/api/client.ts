import Constants from 'expo-constants';

/**
 * Thin typed fetch wrapper for the .NET backend.
 *
 * Deliberately not a generated client: the generated *types* live in
 * `./types.ts` and are swapped wholesale each time the OpenAPI document
 * changes, while transport concerns -- base URL, auth header, timeout, error
 * shape -- stay here and survive regeneration.
 */

/**
 * Resolution order: an EAS/`.env` value, then `extra.apiUrl` from app.json,
 * then localhost for a simulator. Note that a physical device cannot reach
 * `localhost`; set EXPO_PUBLIC_API_URL to your machine's LAN address.
 */
export const API_BASE_URL =
  process.env.EXPO_PUBLIC_API_URL ??
  (Constants.expoConfig?.extra?.apiUrl as string | undefined) ??
  'http://localhost:5187';

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly body: unknown,
    message?: string,
  ) {
    super(message ?? `Request failed with ${status}`);
    this.name = 'ApiError';
  }

  /** 4xx other than 408/429 will not succeed on retry; the client checks this. */
  get isRetryable(): boolean {
    if (this.status === 408 || this.status === 429) return true;
    return this.status >= 500;
  }
}

let authTokenProvider: (() => string | null | Promise<string | null>) | null = null;

/** Wire this to your auth store once sign-in exists. */
export function setAuthTokenProvider(provider: () => string | null | Promise<string | null>): void {
  authTokenProvider = provider;
}

const DEFAULT_TIMEOUT_MS = 15_000;

export async function apiFetch<T>(
  path: string,
  init: RequestInit & { timeoutMs?: number } = {},
): Promise<T> {
  const { timeoutMs = DEFAULT_TIMEOUT_MS, ...requestInit } = init;

  // A hung request must not pin a sync worker open indefinitely on a flaky
  // mobile connection; RN's fetch has no built-in timeout.
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  const token = await authTokenProvider?.();

  try {
    const response = await fetch(`${API_BASE_URL}${path}`, {
      ...requestInit,
      signal: controller.signal,
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...requestInit.headers,
      },
    });

    if (!response.ok) {
      // Read the body before throwing: ASP.NET returns ProblemDetails, and
      // discarding it loses the only useful part of a 400.
      const body = await response.text();
      let parsed: unknown = body;
      try {
        parsed = JSON.parse(body);
      } catch {
        /* Not JSON; keep the raw text. */
      }
      throw new ApiError(response.status, parsed);
    }

    if (response.status === 204) return undefined as T;
    return (await response.json()) as T;
  } finally {
    clearTimeout(timeout);
  }
}

export const api = {
  get: <T>(path: string) => apiFetch<T>(path),
  post: <T>(path: string, body: unknown) =>
    apiFetch<T>(path, { method: 'POST', body: JSON.stringify(body) }),
  put: <T>(path: string, body: unknown) =>
    apiFetch<T>(path, { method: 'PUT', body: JSON.stringify(body) }),
  delete: <T>(path: string) => apiFetch<T>(path, { method: 'DELETE' }),
};
