// Client-side fetch helpers. All routes answer with { error } on failure.

export class ApiError extends Error {
  constructor(
    message: string,
    public readonly status: number
  ) {
    super(message);
  }
}

export async function apiFetch<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, init);
  if (response.status === 401) {
    window.location.href = "/login";
    throw new ApiError("Nicht angemeldet.", 401);
  }
  const data = await response.json().catch(() => null);
  if (!response.ok) {
    throw new ApiError(data?.error ?? "Unbekannter Fehler.", response.status);
  }
  return data as T;
}

export async function apiJson<T>(
  url: string,
  method: string,
  body?: unknown
): Promise<T> {
  return apiFetch<T>(url, {
    method,
    headers: body === undefined ? undefined : { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}
