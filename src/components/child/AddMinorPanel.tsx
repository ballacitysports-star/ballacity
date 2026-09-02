import * as React from "react";
import { toast } from "sonner";
import { Copy, UserPlus } from "lucide-react";
import { useCreateMinorInvite, useMyMinorInvites, useRevokeMinorInvite } from "@/lib/family-invites";
import { Button } from "@/components/ui/button";

const RELATIONSHIPS = ["parent", "guardian", "grandparent", "other adult"];

/**
 * Parent-first flow: an adult invites a minor to their family. The link is
 * single-use and expires in 14 days; the child accepts it after signing in and
 * entering their date of birth, which links the guardian and (under 13)
 * records approved consent.
 */
export function AddMinorPanel() {
  const invites = useMyMinorInvites();
  const create = useCreateMinorInvite();
  const revoke = useRevokeMinorInvite();
  const [name, setName] = React.useState("");
  const [relationship, setRelationship] = React.useState("parent");
  const [link, setLink] = React.useState<string | null>(null);

  const submit = async () => {
    try {
      const res = await create.mutateAsync({ childName: name.trim(), relationship });
      const url = `${window.location.origin}${res.path}`;
      setLink(url);
      setName("");
      toast.success("Invitation created. Share the link with your minor.");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not create that invitation.");
    }
  };

  const copy = async (url: string) => {
    try {
      await navigator.clipboard.writeText(url);
      toast.success("Link copied.");
    } catch {
      toast.error("Copy failed — select the link and copy it manually.");
    }
  };

  const open = (invites.data ?? []).filter((i) => i.status === "pending");
  const history = (invites.data ?? []).filter((i) => i.status !== "pending");

  return (
    <section className="mt-5 rounded-2xl border border-border bg-surface p-4">
      <div className="flex items-center gap-2">
        <UserPlus className="h-4 w-4 text-muted-foreground" />
        <h2 className="font-display text-sm font-bold">Add a minor to your family</h2>
      </div>
      <p className="mt-1 text-xs leading-snug text-muted-foreground">
        Create an invitation, then share the link with your minor. They sign in, enter their date of
        birth, and accepting connects them to you. Links work once and expire after 14 days.
      </p>

      <div className="mt-3 space-y-2">
        <label className="block text-[11px] font-semibold text-muted-foreground">
          Minor's first name
          <input
            value={name}
            maxLength={60}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. Jordan"
            className="mt-1 w-full rounded-2xl border border-border bg-background px-3 py-2 text-sm outline-none focus:border-lime"
          />
        </label>
        <label className="block text-[11px] font-semibold text-muted-foreground">
          Your relationship
          <select
            value={relationship}
            onChange={(e) => setRelationship(e.target.value)}
            className="mt-1 w-full rounded-2xl border border-border bg-background px-3 py-2 text-sm outline-none focus:border-lime"
          >
            {RELATIONSHIPS.map((r) => (
              <option key={r} value={r}>
                {r}
              </option>
            ))}
          </select>
        </label>
        <Button
          type="button"
          disabled={create.isPending || name.trim().length === 0}
          onClick={() => void submit()}
          className="w-full"
        >
          {create.isPending ? "Creating…" : "Create invitation link"}
        </Button>
      </div>

      {link ? (
        <div className="mt-3 rounded-xl border border-lime/40 bg-lime/10 p-3">
          <div className="text-[11px] font-semibold">Share this link — shown once</div>
          <div className="mt-1 break-all text-[11px]">{link}</div>
          <button
            type="button"
            onClick={() => void copy(link)}
            className="mt-2 inline-flex items-center gap-1.5 rounded-full border border-border bg-surface px-3 py-1.5 text-xs font-bold"
          >
            <Copy className="h-3.5 w-3.5" /> Copy link
          </button>
        </div>
      ) : null}

      {open.length > 0 ? (
        <ul className="mt-3 space-y-2">
          {open.map((i) => (
            <li
              key={i.id}
              className="flex items-center justify-between gap-2 rounded-xl border border-border bg-background p-3"
            >
              <div className="min-w-0">
                <div className="truncate text-sm font-semibold">{i.childName}</div>
                <div className="text-[11px] text-muted-foreground">
                  Waiting · expires {new Date(i.expiresAt).toLocaleDateString()}
                </div>
              </div>
              <button
                type="button"
                disabled={revoke.isPending}
                onClick={() => {
                  void revoke
                    .mutateAsync({ id: i.id })
                    .then(() => toast.success("Invitation cancelled."))
                    .catch((e) =>
                      toast.error(e instanceof Error ? e.message : "Could not cancel that."),
                    );
                }}
                className="shrink-0 rounded-full border border-border px-3 py-1.5 text-xs font-bold disabled:opacity-60"
              >
                Cancel
              </button>
            </li>
          ))}
        </ul>
      ) : null}

      {history.length > 0 ? (
        <div className="mt-3 text-[11px] text-muted-foreground">
          {history.slice(0, 5).map((i) => (
            <div key={i.id}>
              {i.childName} — {i.status}
            </div>
          ))}
        </div>
      ) : null}
    </section>
  );
}
