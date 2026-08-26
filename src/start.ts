import { createStart, createMiddleware } from "@tanstack/react-start";

import { renderErrorPage } from "./lib/error-page";
import { attachSupabaseAuth } from "@/integrations/supabase/auth-attacher";

const errorMiddleware = createMiddleware().server(async ({ next }) => {
  try {
    return await next();
  } catch (error) {
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
  const pathname = new URL(request.url).pathname;
  const serverFnBase = process.env["TSS_SERVER_FN_BASE"] || "/_serverFn";
  const normalizedBase = serverFnBase.endsWith("/") ? serverFnBase : `${serverFnBase}/`;

  if (pathname.startsWith(normalizedBase) && request.headers.get("x-tsr-serverfn") !== "true") {
    return Response.json({ error: "Server function requests must use the app RPC client." }, { status: 400 });
  }

  return await next();
});

export const startInstance = createStart(() => ({
  functionMiddleware: [attachSupabaseAuth],
  requestMiddleware: [serverFnDirectAccessMiddleware, errorMiddleware],
}));
