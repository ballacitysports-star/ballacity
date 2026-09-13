import "./lib/error-capture";

import { consumeLastCapturedError } from "./lib/error-capture";
import { renderErrorPage } from "./lib/error-page";

type ServerEntry = {
  fetch: (request: Request, env: unknown, ctx: unknown) => Promise<Response> | Response;
};

let serverEntryPromise: Promise<ServerEntry> | undefined;

async function getServerEntry(): Promise<ServerEntry> {
  if (!serverEntryPromise) {
    serverEntryPromise = import("@tanstack/react-start/server-entry").then(
      (m) => (m as { default?: ServerEntry }).default ?? (m as unknown as ServerEntry),
    );
  }
  return serverEntryPromise;
}

function isAbortError(error: unknown): boolean {
  let current: unknown = error;
  for (let depth = 0; current && depth < 5; depth += 1) {
    const candidate = current as { name?: unknown; cause?: unknown };
    if (candidate.name === "AbortError") return true;
    current = candidate.cause;
  }
  return false;
}

function brandedErrorResponse(): Response {

  return new Response(renderErrorPage(), {
    status: 500,
    headers: { "content-type": "text/html; charset=utf-8" },
  });
}

function isCatastrophicSsrErrorBody(body: string, responseStatus: number): boolean {
  let payload: unknown;
  try {
    payload = JSON.parse(body);
  } catch {
    return false;
  }

  if (!payload || Array.isArray(payload) || typeof payload !== "object") {
    return false;
  }

  const fields = payload as Record<string, unknown>;
  const expectedKeys = new Set(["message", "status", "unhandled"]);
  if (!Object.keys(fields).every((key) => expectedKeys.has(key))) {
    return false;
  }

  return (
    fields.unhandled === true &&
    fields.message === "HTTPError" &&
    (fields.status === undefined || fields.status === responseStatus)
  );
}

// h3 swallows in-handler throws into a normal 500 Response with body
// {"unhandled":true,"message":"HTTPError"} — try/catch alone never fires for those.
async function normalizeCatastrophicSsrResponse(response: Response): Promise<Response> {
  if (response.status < 500) return response;
  const contentType = response.headers.get("content-type") ?? "";
  if (!contentType.includes("application/json")) return response;

  const body = await response.clone().text();
  if (!isCatastrophicSsrErrorBody(body, response.status)) {
    return response;
  }

  const captured = consumeLastCapturedError();
  if (isAbortError(captured)) {
    // The visitor left before the page finished rendering; nothing is broken.
    return new Response(null, { status: 499 });
  }

  console.error(captured ?? new Error(`h3 swallowed SSR error: ${body}`));
  return brandedErrorResponse();

}

export default {
  async fetch(request: Request, env: unknown, ctx: unknown) {
    try {
      const handler = await getServerEntry();
      const response = await handler.fetch(request, env, ctx);
      // When the visitor navigates away or reloads mid-render, the runtime
      // aborts the request signal and the render fails with an AbortError.
      // That is not a site error: reporting it as one replaces the page the
      // browser is already leaving with an error screen.
      if (request.signal.aborted) return response;
      return await normalizeCatastrophicSsrResponse(response);
    } catch (error) {
      if (request.signal.aborted || isAbortError(error)) {
        return new Response(null, { status: 499 });
      }
      console.error(error);
      return brandedErrorResponse();
    }
  },
};

