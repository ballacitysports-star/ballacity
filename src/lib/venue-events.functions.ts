import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { venueEventErrorMessage } from "@/lib/venue-events";

const Payload = z
  .object({
    kind: z.enum(["clinic", "camp", "tournament", "open_gym"]),
    title: z.string().trim().min(1).max(200),
    body: z.string().trim().max(5000).optional(),
    starts_at: z.string().datetime(),
    ends_at: z.string().datetime().optional(),
    min_age: z.number().int().min(4).max(99),
    max_age: z.number().int().min(4).max(99),
    price_cents: z.number().int().min(0).max(10_000_000).optional(),
    capacity: z.number().int().min(1).max(10_000).optional(),
    location: z
      .object({ formatted_address: z.string().trim().min(1).max(300) })
      .strict()
      .optional(),
  })
  .strict();

const CreateVenueEventInput = z.object({ orgId: z.string().uuid(), event: Payload }).strict();

/**
 * Creates a venue event. The title and description are screened before anything is stored
 * (blocked text never reaches the database); the event is created as the member through
 * create_facility_event (the database checks venue staff, an adult host, a venue that is not
 * hidden, the kind and the age range, and stores it pending); then the screen's outcome is
 * recorded with the service role: approved events are listed, held ones wait for a superadmin.
 */
export const createVenueEvent = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => CreateVenueEventInput.parse(input))
  .handler(async ({ data, context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const mod = await import("@/lib/post-moderation.server");
    const screen = await mod.screenPostText(supabaseAdmin, {
      userId: context.userId,
      table: "events",
      context: mod.VENUE_EVENT_CONTEXT,
      fields: { title: data.event.title, body: data.event.body },
    });
    if (screen === "block") throw new Error(mod.POST_BLOCKED_MESSAGE);

    const { data: id, error } = await context.supabase.rpc(
      "create_facility_event" as never,
      {
        _org: data.orgId,
        _e: data.event,
      } as never,
    );
    if (error) throw new Error(venueEventErrorMessage(error.message));
    const eventId = String(id);
    const status = await mod.settlePostModeration(supabaseAdmin, "events", eventId, screen);
    return { id: eventId, held: status !== "approved" };
  });
