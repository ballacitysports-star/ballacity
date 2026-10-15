import { describe, expect, it, vi } from "vitest";

const logAdminAction = vi.fn(async () => ({ logged: true }));
vi.mock("@/lib/audit-log.server", () => ({ logAdminAction }));
vi.mock("@/integrations/supabase/client.server", () => ({ supabaseAdmin: {} }));

const { escalateImageForChildSafety } = await import("./moderation.server");

describe("escalateImageForChildSafety", () => {
  it("alerts every superadmin and writes an audit entry", async () => {
    const inserted: unknown[] = [];
    const admin = {
      from(table: string) {
        if (table === "user_roles") {
          return {
            select: () => ({
              eq: async () => ({ data: [{ user_id: "a1" }, { user_id: "a2" }] }),
            }),
          };
        }
        return {
          insert: async (rows: unknown) => {
            inserted.push({ table, rows });
          },
        };
      },
    };

    await escalateImageForChildSafety(admin, {
      bucket: "avatars",
      path: "u1/p.png",
      categories: ["csam"],
      source: "image_upload",
    });

    expect(inserted).toEqual([
      {
        table: "notifications",
        rows: [
          expect.objectContaining({ user_id: "a1", type: "safety_alert" }),
          expect.objectContaining({ user_id: "a2", type: "safety_alert" }),
        ],
      },
    ]);
    expect(logAdminAction).toHaveBeenCalledWith(
      admin,
      null,
      expect.objectContaining({
        action: "ai.content_quarantine",
        targetType: "image_upload",
        targetId: "avatars/u1/p.png",
      }),
    );
  });
});
