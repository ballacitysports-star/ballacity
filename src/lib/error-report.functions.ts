import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import {
  MESSAGE_MAX,
  ROUTE_MAX,
  fingerprintOf,
  scrubMessage,
  scrubRoute,
} from "@/lib/error-report";

const Input = z
  .object({
    kind: z.enum(["boundary", "window", "rejection"]),
    message: z.string().min(1).max(4000),
    route: z.string().max(2000).nullable(),
    release: z.string().max(64).nullable().optional(),
    signedIn: z.boolean(),
  })
  .strict();

/**
 * P0-8: the browser reports an error. Open to signed-out visitors too (errors happen before
 * sign-in). The server scrubs again, whatever the browser sent, and caps the rate; the row
 * holds no user id, IP or full URL.
 */
export const reportClientError = createServerFn({ method: "POST" })
  .inputValidator((input) => Input.parse(input))
  .handler(async ({ data }) => {
    const { saveErrorReport } = await import("@/lib/error-report.server");
    const message = scrubMessage(data.message).slice(0, MESSAGE_MAX);
    const route = scrubRoute(data.route)?.slice(0, ROUTE_MAX) ?? null;
    const saved = await saveErrorReport({
      source: "client",
      kind: data.kind,
      message,
      route,
      fingerprint: fingerprintOf(message, route),
      release: data.release ?? null,
      signedIn: data.signedIn,
    });
    return { saved };
  });
