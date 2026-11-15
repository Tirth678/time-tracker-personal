import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { ApiError, createApi, type TrackerApi } from "../../lib/client/api";

/**
 * The API client against servers that misbehave: the real API never answers
 * like this, but proxies, captive portals and dropped connections do.
 */
type Handler = (req: IncomingMessage, res: ServerResponse) => void;

let server: Server;
let api: TrackerApi;
let handler: Handler;
let closedPort: number;

beforeAll(async () => {
  server = createServer((req, res) => handler(req, res));
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  api = createApi(`http://127.0.0.1:${(server.address() as AddressInfo).port}`);

  // A port nothing listens on: open one, note its number, close it again.
  const spare = createServer();
  await new Promise<void>((resolve) => spare.listen(0, "127.0.0.1", resolve));
  closedPort = (spare.address() as AddressInfo).port;
  await new Promise((resolve) => spare.close(resolve));
});

afterAll(async () => {
  server.closeAllConnections();
  await new Promise((resolve) => server.close(resolve));
});

function answer(status: number, body: string, type = "application/json"): Handler {
  return (_req, res) => {
    res.writeHead(status, { "Content-Type": type });
    res.end(body);
  };
}

const failure = (promise: Promise<unknown>) =>
  promise.then(
    () => {
      throw new Error("expected the call to fail");
    },
    (err: unknown) => {
      expect(err).toBeInstanceOf(ApiError);
      const { status, code, message } = err as ApiError;
      return { status, code, message };
    },
  );

describe("the API client", () => {
  it("sends JSON and returns the parsed answer", async () => {
    let seen: { method?: string; url?: string; type?: string; body: string } | undefined;
    handler = (req, res) => {
      let body = "";
      req.on("data", (chunk) => (body += chunk));
      req.on("end", () => {
        seen = { method: req.method, url: req.url, type: req.headers["content-type"], body };
        res.writeHead(201, { "Content-Type": "application/json" });
        res.end('{"saved":1,"duplicates":0,"rejected":[]}');
      });
    };

    expect(await api.saveSessions([])).toEqual({ saved: 1, duplicates: 0, rejected: [] });
    expect(seen).toEqual({ method: "POST", url: "/api/sessions", type: "application/json", body: '{"sessions":[]}' });
  });

  it("escapes what it puts into a URL", async () => {
    const urls: (string | undefined)[] = [];
    handler = (req, res) => {
      urls.push(req.url);
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end("{}");
    };

    await api.stats("2026-11-15T00:00:00.000+05:30");
    await api.sessions({ limit: 30, cursor: "a/b?c&d=e" });
    await api.sessions({ limit: 5 });
    expect(urls).toEqual([
      "/api/stats?todayStart=2026-11-15T00%3A00%3A00.000%2B05%3A30",
      "/api/sessions?limit=30&cursor=a%2Fb%3Fc%26d%3De",
      "/api/sessions?limit=5",
    ]);
  });

  it("accepts an answer without content", async () => {
    handler = (_req, res) => {
      res.writeHead(204);
      res.end();
    };
    await expect(api.deleteSession("7d0f2f3e-58a4-4f0e-9d0b-0a1b2c3d4e5f")).resolves.toBeNull();
  });

  it("passes on the error the API reports", async () => {
    handler = answer(404, '{"error":{"code":"not_found","message":"No session with that id exists."}}');
    expect(await failure(api.deleteSession("x"))).toEqual({
      status: 404,
      code: "not_found",
      message: "No session with that id exists.",
    });
  });

  it("copes with an error that is not in the API's format", async () => {
    handler = answer(500, '{"oops":true}');
    expect(await failure(api.stats("x"))).toEqual({ status: 500, code: "unknown_error", message: "Request failed (500)." });

    handler = answer(400, "null");
    expect(await failure(api.stats("x"))).toMatchObject({ status: 400, code: "unknown_error" });
  });

  it("reports a page that is not from the API as a bad response", async () => {
    handler = answer(502, "<html><body>Bad gateway</body></html>", "text/html");
    expect(await failure(api.stats("x"))).toMatchObject({ status: 502, code: "bad_response" });

    // A captive portal answers every request with its login page and a 200.
    handler = answer(200, "<html><body>Please sign in to the Wi-Fi</body></html>", "text/html");
    expect(await failure(api.sessions({ limit: 30 }))).toMatchObject({ status: 200, code: "bad_response" });

    handler = answer(200, "");
    expect(await failure(api.stats("x"))).toMatchObject({ status: 200, code: "bad_response" });
  });

  it("reports a connection that breaks off in the middle as a bad response", async () => {
    handler = (_req, res) => {
      res.writeHead(200, { "Content-Type": "application/json", "Content-Length": "500" });
      res.write('{"sessions":[');
      setTimeout(() => res.destroy(), 10);
    };
    expect(await failure(api.sessions({ limit: 30 }))).toMatchObject({ status: 200, code: "bad_response" });
  });

  it("reports a server that cannot be reached as a network error", async () => {
    const unreachable = createApi(`http://127.0.0.1:${closedPort}`);
    expect(await failure(unreachable.health())).toMatchObject({ status: 0, code: "network_error" });

    handler = (req) => req.socket.destroy();
    expect(await failure(api.saveSessions([]))).toMatchObject({ status: 0, code: "network_error" });
  });

  describe("health", () => {
    it("returns the status whether or not the database is up", async () => {
      handler = answer(200, '{"ok":true,"database":"connected"}');
      expect(await api.health()).toEqual({ ok: true, database: "connected" });

      handler = answer(200, '{"ok":true,"database":"not_configured"}');
      expect(await api.health()).toEqual({ ok: true, database: "not_configured" });

      handler = answer(503, '{"ok":false,"database":"unreachable","cause":"ECONNREFUSED"}');
      expect(await api.health()).toEqual({ ok: false, database: "unreachable", cause: "ECONNREFUSED" });
    });

    it("does not mistake another server's answer for a status", async () => {
      for (const body of ['{"status":"ok"}', "null", "[]", '"connected"', '{"database":"maybe"}']) {
        handler = answer(200, body);
        expect(await failure(api.health())).toMatchObject({ status: 200, code: "bad_response" });
      }
      handler = answer(404, "<html>Not found</html>", "text/html");
      expect(await failure(api.health())).toMatchObject({ status: 404, code: "bad_response" });
    });
  });
});
