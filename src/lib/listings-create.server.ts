/**
 * Creates an unclaimed team, trainer or gym listing through the moderator-only
 * database functions. Shared by the "create unclaimed listing" admin form and
 * by approving a discovered candidate, so both produce identical rows.
 *
 * Must be called with the moderator's own client, not the admin one: the
 * functions read auth.uid() to authorise and to stamp who listed it.
 */

import { z } from "zod";

export const UNCLAIMED_LISTING_INPUT = z.object({
  subjectType: z.enum(["team", "gym"]),
  name: z.string().trim().min(2).max(120),
  handle: z.string().trim().min(2).max(60),
  city: z.string().trim().max(120).optional(),
  kind: z.enum(["team", "coach"]).optional(),
  sports: z.array(z.string().trim().max(40)).max(10).optional(),
  category: z.string().trim().max(60).optional(),
  address: z.string().trim().max(240).optional(),
  website: z.string().trim().max(240).optional(),
});
export type UnclaimedListingInput = z.infer<typeof UNCLAIMED_LISTING_INPUT>;

type Rpc = (
  name: string,
  args: Record<string, unknown>,
) => Promise<{ data: unknown; error: { message: string } | null }>;

export async function createUnclaimedListingRecord(
  supabase: unknown,
  data: UnclaimedListingInput,
): Promise<{ id: string; subjectType: "team" | "gym" }> {
  // The listing RPCs are newer than the generated types, so reach them untyped.
  const client = supabase as { rpc: Rpc };
  const rpc: Rpc = client.rpc.bind(client);

  if (data.subjectType === "team") {
    const slug =
      data.handle
        .replace(/^@/, "")
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/(^-|-$)/g, "") || crypto.randomUUID();
    const { data: out, error } = await rpc("create_unclaimed_team", {
      _id: slug,
      _kind: data.kind ?? "team",
      _name: data.name,
      _handle: data.handle,
      _city: data.city ?? "",
      _sports: data.sports ?? [],
    });
    if (error) throw new Error(error.message);
    return { id: String(out), subjectType: "team" };
  }

  const { data: out, error } = await rpc("create_unclaimed_gym", {
    _name: data.name,
    _handle: data.handle,
    _city: data.city ?? null,
    _category: data.category ?? null,
    _address: data.address ?? null,
    _website: data.website ?? null,
  });
  if (error) throw new Error(error.message);
  return { id: String(out), subjectType: "gym" };
}
