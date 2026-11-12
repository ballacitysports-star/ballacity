import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { SERVER_ERROR_KINDS, groupErrorRows, type ErrorRow } from "@/lib/error-report";

/** Rows are kept 30 days, so no window is longer than that. */
const MAX_HOURS = 30 * 24;
const ROW_CAP = 2000;

/**
 * The window is in whole hours, from the last hour (the first hour after a publish) to 30 days.
 * `days` is what tabs opened before this change still send; `hours` wins when both are present.
 * `serverOnly` keeps the server's own reports: pages that failed to render and server functions
 * that failed (kinds ssr and server_fn).
 */
const ListErrorsInput = z.object({
  hours: z.number().int().min(1).max(MAX_HOURS).optional(),
  days: z.number().int().min(1).max(30).optional(),
  serverOnly: z.boolean().default(false),
});

type ErrorQuery = PromiseLike<{ data: ErrorRow[] | null; error: { message: string } | null }> & {
  gte: (col: string, v: string) => ErrorQuery;
  in: (col: string, v: readonly string[]) => ErrorQuery;
  order: (col: string, o: { ascending: boolean }) => ErrorQuery;
  limit: (n: number) => ErrorQuery;
};

/** P0-8: superadmins see recent errors, grouped. Read with the service role after the superadmin check. */
export const superadminListErrors = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { hours?: number; days?: number; serverOnly?: boolean } | undefined) => {
    const input = ListErrorsInput.parse(d ?? {});
    return { hours: input.hours ?? (input.days ?? 7) * 24, serverOnly: input.serverOnly };
  })
  .handler(async ({ context, data }) => {
    const { assertSuperadmin, getAdmin } = await import("@/lib/superadmin.server");
    await assertSuperadmin(context);
    // app_error_events is newer than the generated types; read it through a narrow typed view.
    const admin = (await getAdmin()) as unknown as {
      from: (t: "app_error_events") => { select: (c: string) => ErrorQuery };
    };
    const since = new Date(Date.now() - data.hours * 3_600_000).toISOString();
    let query = admin
      .from("app_error_events")
      .select("fingerprint, message, route, source, kind, created_at, signed_in")
      .gte("created_at", since);
    if (data.serverOnly) query = query.in("kind", SERVER_ERROR_KINDS);
    const { data: rows, error } = await query
      .order("created_at", { ascending: false })
      .limit(ROW_CAP);
    if (error) throw new Error(error.message);
    const list = rows ?? [];
    return { total: list.length, capped: list.length === ROW_CAP, groups: groupErrorRows(list) };
  });
