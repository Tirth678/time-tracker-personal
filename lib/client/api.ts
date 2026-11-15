import type {
  ApiErrorBody,
  HealthStatus,
  SaveSessionsResult,
  SessionPage,
  StudySession,
  StudyStats,
} from "../types";

/**
 * A failed API call. `code` is the API's error code, or one of:
 * `network_error` (no response arrived: offline, timeout, server down) and
 * `bad_response` (something answered, but not with the API's JSON).
 */
export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

/** Everything the app asks of the server. */
export interface TrackerApi {
  health(): Promise<HealthStatus>;
  stats(todayStart: string): Promise<StudyStats>;
  sessions(options: { limit: number; cursor?: string }): Promise<SessionPage>;
  saveSessions(sessions: StudySession[]): Promise<SaveSessionsResult>;
  deleteSession(id: string): Promise<void>;
}

const TIMEOUT_MS = 20_000;

/**
 * Creates the API client. In the browser the base is empty: requests use
 * relative URLs, because the API is served by the same deployment as the page.
 */
export function createApi(baseUrl = ""): TrackerApi {
  async function send(path: string, init?: RequestInit): Promise<{ status: number; body: unknown }> {
    let response: Response;
    try {
      response = await fetch(baseUrl + path, {
        ...init,
        cache: "no-store",
        headers: init?.body ? { "Content-Type": "application/json" } : undefined,
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
    } catch {
      throw new ApiError(0, "network_error", "The server could not be reached.");
    }

    try {
      // Always read to the end, even when nothing is expected (204): a response
      // that is dropped unread shows up in the browser as a cancelled request.
      const text = await response.text();
      return { status: response.status, body: response.status === 204 ? null : JSON.parse(text) };
    } catch {
      // An HTML error page from a proxy, a connection dropped mid-body, …
      throw new ApiError(response.status, "bad_response", "The server sent an unreadable response.");
    }
  }

  async function request<T>(path: string, init?: RequestInit): Promise<T> {
    const { status, body } = await send(path, init);
    if (status >= 200 && status < 300) return body as T;

    const error = (body as Partial<ApiErrorBody> | null)?.error;
    throw new ApiError(status, error?.code ?? "unknown_error", error?.message ?? `Request failed (${status}).`);
  }

  return {
    async health() {
      // The health check answers with the same body shape for 200 and 503.
      const { status, body } = await send("/api/health");
      const database = (body as Partial<HealthStatus> | null)?.database;
      if (database !== "connected" && database !== "not_configured" && database !== "unreachable") {
        throw new ApiError(status, "bad_response", "The server sent an unreadable response.");
      }
      return body as HealthStatus;
    },

    stats: (todayStart) => request(`/api/stats?todayStart=${encodeURIComponent(todayStart)}`),

    sessions: ({ limit, cursor }) =>
      request(`/api/sessions?limit=${limit}${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`),

    saveSessions: (sessions) => request("/api/sessions", { method: "POST", body: JSON.stringify({ sessions }) }),

    deleteSession: (id) => request(`/api/sessions/${encodeURIComponent(id)}`, { method: "DELETE" }),
  };
}
