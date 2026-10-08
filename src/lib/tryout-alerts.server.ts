/**
 * In-app alerts for tryout/camp sign-ups. Best-effort: never blocks the RSVP.
 * Runs after the RSVP RPC succeeded (which already enforced permissions).
 */
function minutesPhrase(m: number): string {
  if (m < 60) return `${m} min`;
  if (m % 60 === 0) return `${m / 60} hour${m === 60 ? "" : "s"}`;
  return `${Math.floor(m / 60)}h ${m % 60}m`;
}

export async function notifyTryoutSignup(opts: {
  postId: string;
  actorId: string;
  attendeeId: string;
  action: "registered" | "cancelled";
  /** Set when the cancellation fell inside the team's cutoff. */
  late?: { minutesBefore: number; cutoffMin: number } | null;
}) {
  try {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: post } = await supabaseAdmin
      .from("team_posts")
      .select("title, kind, team_id, event_date")
      .eq("id", opts.postId)
      .maybeSingle();
    if (!post) return;
    const p = post as { title: string; kind: string; team_id: string; event_date: string | null };
    const label = p.kind === "clinic" ? "camp" : "tryout";
    const link = `/tryouts/${opts.postId}`;
    const ids = Array.from(new Set([opts.actorId, opts.attendeeId]));
    const { data: profs } = await supabaseAdmin.from("profiles").select("id, display_name").in("id", ids);
    const name = (id: string) =>
      ((profs ?? []) as any[]).find((x) => x.id === id)?.display_name || "A player";
    const attendee = name(opts.attendeeId);
    const onBehalf = opts.actorId !== opts.attendeeId;
    const rows: Record<string, unknown>[] = [];

    // Confirmation to whoever signed up (guardian or player).
    rows.push({
      user_id: opts.actorId,
      type: "tryout_rsvp",
      title:
        opts.action === "registered"
          ? `You're signed up — ${p.title}`
          : `Registration cancelled — ${p.title}`,
      body:
        opts.action === "registered"
          ? `${onBehalf ? `${attendee} is` : "You're"} registered for this ${label}. The team has your application; watch for updates here.`
          : `${onBehalf ? `${attendee}'s` : "Your"} spot was released.`,
      link,
    });

    // Alert team staff (excluding the actor).
    const { data: staff } = await supabaseAdmin
      .from("team_members")
      .select("user_id, role")
      .eq("team_id", p.team_id)
      .in("role", ["owner", "manager", "coach"]);
    for (const s of (staff ?? []) as any[]) {
      if (s.user_id === opts.actorId) continue;
      rows.push({
        user_id: s.user_id,
        type: "tryout_rsvp",
        title:
          opts.action === "registered"
            ? `New ${label} applicant — ${p.title}`
            : opts.late
              ? `Late ${label} cancellation — ${p.title}`
              : `${label[0].toUpperCase()}${label.slice(1)} cancellation — ${p.title}`,
        body:
          opts.action === "registered"
            ? `${attendee} signed up${onBehalf ? " (registered by a parent/guardian)" : ""}.`
            : opts.late
              ? `${attendee} cancelled ${minutesPhrase(opts.late.minutesBefore)} before start (your cutoff is ${minutesPhrase(opts.late.cutoffMin)}).`
              : `${attendee} cancelled their spot.`,
        link: `/teams/${p.team_id}/tryouts`,
      });
    }
    await supabaseAdmin.from("notifications").insert(rows as never);
  } catch (e) {
    console.error("notifyTryoutSignup", e);
  }
}
