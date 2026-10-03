import { useEffect, useState } from "react";
import { Link } from "@tanstack/react-router";
import { BellRing, CheckCircle2 } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { createNotification } from "@/lib/notifications";
import { UserAvatar } from "@/components/UserAvatar";
import { formatGameWhen } from "@/lib/format";

type Row = {
  gameId: string;
  title: string;
  date: string;
  price: number;
  players: { id: string; name: string; avatarUrl: string | null; status: "unpaid" | "pending" | "rejected" }[];
};

/** Host view: every player on the host's paid, active games who isn't verified paid yet. */
export function UnpaidPlayersPanel() {
  const [rows, setRows] = useState<Row[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    (async () => {
      const { data: u } = await supabase.auth.getUser();
      if (!u.user) return setRows([]);
      const me = u.user.id;
      const since = new Date(Date.now() - 14 * 864e5).toISOString().slice(0, 10);
      const { data: games } = await supabase
        .from("hosted_games")
        .select("id, title, date, price, cancelled_at")
        .eq("host_id", me)
        .gt("price", 0)
        .is("cancelled_at", null)
        .gte("date", since)
        .order("date", { ascending: true });
      const list = games ?? [];
      if (!list.length) return alive && setRows([]);
      const ids = list.map((g) => g.id);
      const [{ data: parts }, { data: subs }] = await Promise.all([
        supabase.from("game_participants").select("game_id, user_id").in("game_id", ids),
        supabase
          .from("payment_submissions")
          .select("game_id, player_id, status, submitted_at")
          .eq("host_id", me)
          .in("game_id", ids)
          .order("submitted_at", { ascending: false }),
      ]);
      const status = new Map<string, string>();
      for (const s of subs ?? []) {
        const k = `${s.game_id}:${s.player_id}`;
        if (!status.has(k)) status.set(k, s.status);
      }
      const owed = (parts ?? []).filter(
        (p) => p.user_id !== me && status.get(`${p.game_id}:${p.user_id}`) !== "verified",
      );
      const uids = [...new Set(owed.map((p) => p.user_id))];
      const { data: profs } = uids.length
        ? await supabase.from("profiles").select("id, display_name, username, avatar_url").in("id", uids)
        : { data: [] as any[] };
      const pm = new Map((profs ?? []).map((p: any) => [p.id, p]));
      const out: Row[] = list
        .map((g) => ({
          gameId: g.id,
          title: g.title,
          date: g.date,
          price: Number(g.price),
          players: owed
            .filter((p) => p.game_id === g.id)
            .map((p) => {
              const pr: any = pm.get(p.user_id);
              const st = status.get(`${g.id}:${p.user_id}`);
              return {
                id: p.user_id,
                name: pr?.display_name || (pr?.username ? `@${pr.username}` : "Player"),
                avatarUrl: pr?.avatar_url ?? null,
                status: (st === "pending" || st === "rejected" ? st : "unpaid") as Row["players"][number]["status"],
              };
            }),
        }))
        .filter((r) => r.players.length > 0);
      if (alive) setRows(out);
    })().catch(() => alive && setRows([]));
    return () => {
      alive = false;
    };
  }, []);

  const remind = async (r: Row, playerIds: string[]) => {
    setBusy(r.gameId + playerIds.join());
    try {
      await Promise.all(
        playerIds.map((id) =>
          createNotification({
            user_id: id,
            type: "payment_reminder",
            title: `Payment reminder · ${r.title}`.slice(0, 200),
            body: `Your $${r.price} fee for this game is still unpaid. Tap to pay the host.`,
            link: `/games/${r.gameId}/pay`,
          }),
        ),
      );
      toast.success(`Reminder sent to ${playerIds.length} player${playerIds.length === 1 ? "" : "s"}.`);
    } catch {
      toast.error("Couldn't send reminders.");
    } finally {
      setBusy(null);
    }
  };

  if (rows === null) return <div className="p-4 text-sm text-muted-foreground">Loading…</div>;
  if (rows.length === 0)
    return (
      <div className="rounded-2xl border border-border bg-surface p-6 text-center">
        <CheckCircle2 className="mx-auto mb-2 h-6 w-6 text-primary" />
        <div className="text-sm font-semibold">Everyone's paid up</div>
        <p className="text-xs text-muted-foreground">No unpaid players on your paid games.</p>
      </div>
    );

  const total = rows.reduce((n, r) => n + r.players.length * r.price, 0);
  return (
    <div className="space-y-3">
      <div className="rounded-2xl border border-border bg-surface p-3 text-sm">
        <span className="font-semibold">${total.toFixed(2)}</span>{" "}
        <span className="text-muted-foreground">
          outstanding across {rows.length} game{rows.length === 1 ? "" : "s"}
        </span>
      </div>
      {rows.map((r) => (
        <div key={r.gameId} className="rounded-2xl border border-border bg-surface p-3">
          <div className="mb-2 flex items-start justify-between gap-2">
            <Link to="/games/$gameId" params={{ gameId: r.gameId }} className="min-w-0">
              <div className="truncate text-sm font-semibold">{r.title}</div>
              <div className="text-xs text-muted-foreground">
                {formatGameWhen(r.date)} · ${r.price} each
              </div>
            </Link>
            <button
              disabled={!!busy}
              onClick={() => remind(r, r.players.filter((p) => p.status !== "pending").map((p) => p.id))}
              className="inline-flex shrink-0 items-center gap-1 rounded-full bg-primary px-3 py-1.5 text-xs font-semibold text-primary-foreground disabled:opacity-50"
            >
              <BellRing className="h-3.5 w-3.5" /> Remind all
            </button>
          </div>
          <ul className="divide-y divide-border">
            {r.players.map((p) => (
              <li key={p.id} className="flex items-center gap-2 py-2">
                <UserAvatar name={p.name} avatarUrl={p.avatarUrl} size="sm" />
                <span className="min-w-0 flex-1 truncate text-sm">{p.name}</span>
                {p.status === "pending" ? (
                  <Link to="/payments" search={{ tab: "verify" } as any} className="text-xs font-semibold text-primary">
                    Proof to review
                  </Link>
                ) : (
                  <>
                    <span className="text-xs text-muted-foreground">
                      {p.status === "rejected" ? "Proof rejected" : "Unpaid"}
                    </span>
                    <button
                      disabled={!!busy}
                      onClick={() => remind(r, [p.id])}
                      className="rounded-full border border-border px-2.5 py-1 text-xs font-medium disabled:opacity-50"
                    >
                      Remind
                    </button>
                  </>
                )}
              </li>
            ))}
          </ul>
        </div>
      ))}
    </div>
  );
}
