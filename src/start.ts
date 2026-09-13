import { createStart, createMiddleware } from "@tanstack/react-start";

import { renderErrorPage } from "./lib/error-page";
import { isRequestAbort } from "./lib/request-abort";
import { attachSupabaseAuth } from "@/integrations/supabase/auth-attacher";

// Platform email routes authenticate themselves (signed webhook / API key) and
// must never pass through app-level guards or error wrapping.
const isPlatformPath = (request: Request) => new URL(request.url).pathname.startsWith("/lovable/");

const errorMiddleware = createMiddleware().server(async ({ request, next }) => {
  if (isPlatformPath(request)) return await next();
  try {
    return await next();
  } catch (error) {
    if (request.signal.aborted || isRequestAbort(error)) {
      return new Response(null, { status: 499 });
    }
    if (error != null && typeof error === "object" && "statusCode" in error) {
      throw error;
    }
    console.error(error);
    return new Response(renderErrorPage(), {
      status: 500,
      headers: { "content-type": "text/html; charset=utf-8" },
    });
  }
});

const serverFnDirectAccessMiddleware = createMiddleware().server(async ({ request, next }) => {
  if (isPlatformPath(request)) return await next();
  const pathname = new URL(request.url).pathname;
  const serverFnBase = process.env["TSS_SERVER_FN_BASE"] || "/_serverFn";
  const normalizedBase = serverFnBase.endsWith("/") ? serverFnBase : `${serverFnBase}/`;

  if (pathname.startsWith(normalizedBase) && request.headers.get("x-tsr-serverfn") !== "true") {
    return Response.json(
      { error: "Server function requests must use the app RPC client." },
      { status: 400 },
    );
  }

  return await next();
});

export const startInstance = createStart(() => ({
  functionMiddleware: [attachSupabaseAuth],
  requestMiddleware: [serverFnDirectAccessMiddleware, errorMiddleware],
}));
