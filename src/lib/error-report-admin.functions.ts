import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { groupErrorRows, type ErrorRow } from "@/lib/error-report";

/** P0-8: superadmins see recent errors, grouped. Read with the service role after the superadmin check. */
export const superadminListErrors = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { days?: number } | undefined) =>
    z.object({ days: z.number().int().min(1).max(30).default(7) }).parse(d ?? {}),
  )
  .handler(async ({ context, data }) => {
    const { assertSuperadmin, getAdmin } = await import("@/lib/superadmin.server");
    await assertSuperadmin(context);
    // app_error_events is newer than the generated types; read it through a narrow typed view.
    const admin = (await getAdmin()) as unknown as {
      from: (t: "app_error_events") => {
        select: (c: string) => {
          gte: (
            col: string,
            v: string,
          ) => {
            order: (
              col: string,
              o: { ascending: boolean },
            ) => {
              limit: (n: number) => PromiseLike<{
                data: ErrorRow[] | null;
                error: { message: string } | null;
              }>;
            };
          };
        };
      };
    };
    const since = new Date(Date.now() - data.days * 86_400_000).toISOString();
    const { data: rows, error } = await admin
      .from("app_error_events")
      .select("fingerprint, message, route, source, kind, created_at, signed_in")
      .gte("created_at", since)
      .order("created_at", { ascending: false })
      .limit(2000);
    if (error) throw new Error(error.message);
    const list = rows ?? [];
    return { total: list.length, capped: list.length === 2000, groups: groupErrorRows(list) };
  });
