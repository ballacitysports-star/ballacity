/**
 * Private share links for a family post (a parent's clip of their under-13 child).
 *
 * A link opens that one clip for whoever receives it: no sign-in, no child name, no
 * profile. It expires and can be revoked. The secret is shown once, when it is made,
 * because only a hash of it is stored. Shown only while the sharing switch is on.
 */

import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Check, Copy, Link2, Loader2 } from "lucide-react";
import { toast } from "sonner";
import {
  createFamilyPostLink,
  getFamilyShareEnabled,
  listFamilyPostLinks,
  revokeFamilyPostLink,
} from "@/lib/family-share.functions";
import { SHARE_LINK_DEFAULT_DAYS, shareLinkStatus, shareUrl } from "@/lib/family-share";

export function FamilyShareLinks({ reelId }: { reelId: string }) {
  const qc = useQueryClient();
  const enabledFn = useServerFn(getFamilyShareEnabled);
  const listFn = useServerFn(listFamilyPostLinks);
  const createFn = useServerFn(createFamilyPostLink);
  const revokeFn = useServerFn(revokeFamilyPostLink);

  const { data: enabled } = useQuery({
    queryKey: ["family-share-enabled"],
    queryFn: () => enabledFn(),
    staleTime: 60_000,
  });
  const { data: links = [] } = useQuery({
    queryKey: ["family-share-links", reelId],
    queryFn: () => listFn({ data: { reelId } }),
    enabled: enabled?.enabled === true,
  });

  const [busy, setBusy] = useState<"create" | string | null>(null);
  const [fresh, setFresh] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  if (!enabled?.enabled) return null;

  async function copy(url: string) {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
      toast.success("Link copied");
    } catch {
      toast.error("Couldn't copy. Select the link and copy it by hand.");
    }
  }

  async function create() {
    setBusy("create");
    try {
      const res = await createFn({ data: { reelId, days: SHARE_LINK_DEFAULT_DAYS } });
      const url = shareUrl(window.location.origin, res.token);
      setFresh(url);
      void copy(url);
      await qc.invalidateQueries({ queryKey: ["family-share-links", reelId] });
    } catch (e: any) {
      toast.error(e?.message ?? "Could not create the link");
    } finally {
      setBusy(null);
    }
  }

  async function revoke(id: string) {
    setBusy(id);
    try {
      await revokeFn({ data: { linkId: id } });
      toast.success("Link turned off");
      setFresh(null);
      await qc.invalidateQueries({ queryKey: ["family-share-links", reelId] });
    } catch (e: any) {
      toast.error(e?.message ?? "Could not turn off the link");
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="mt-3 rounded-xl border border-border bg-background/60 p-3">
      <p className="inline-flex items-center gap-1.5 section-eyebrow text-lime">
        <Link2 className="h-3.5 w-3.5" /> Share privately
      </p>
      <p className="mt-1 text-[11px] text-muted-foreground">
        Make a link to this one clip for a coach or relative. They can watch without signing in; it
        shows only the video and your caption, never your child&apos;s name. Links last{" "}
        {SHARE_LINK_DEFAULT_DAYS} days and you can turn them off any time. Anyone who has the link
        can open it, so only send it to people you trust.
      </p>

      <button
        type="button"
        onClick={create}
        disabled={busy !== null}
        className="mt-2 inline-flex items-center gap-1.5 rounded-full bg-lime px-3 py-1.5 text-[11px] font-bold text-primary-foreground disabled:opacity-60"
      >
        {busy === "create" ? (
          <Loader2 className="h-3 w-3 animate-spin" />
        ) : (
          <Link2 className="h-3 w-3" />
        )}
        Create a link
      </button>

      {fresh && (
        <div className="mt-2 rounded-lg border border-lime/40 bg-lime/5 p-2">
          <p className="text-[10px] font-semibold text-lime">
            Copy it now. For your child&apos;s safety this is the only time it is shown.
          </p>
          <div className="mt-1 flex items-center gap-2">
            <input
              readOnly
              value={fresh}
              onFocus={(e) => e.currentTarget.select()}
              className="min-w-0 flex-1 rounded-md border border-border bg-background px-2 py-1 text-[11px]"
              aria-label="Private share link"
            />
            <button
              type="button"
              onClick={() => copy(fresh)}
              className="inline-flex items-center gap-1 rounded-md border border-border px-2 py-1 text-[11px] font-semibold"
            >
              {copied ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
              Copy
            </button>
          </div>
        </div>
      )}

      {links.length > 0 && (
        <ul className="mt-2 space-y-1">
          {links.map((l) => {
            const status = shareLinkStatus({ expires_at: l.expiresAt, revoked_at: l.revokedAt });
            return (
              <li
                key={l.id}
                className="flex items-center justify-between gap-2 text-[11px] text-muted-foreground"
              >
                <span>
                  {status === "active"
                    ? `Active until ${new Date(l.expiresAt).toLocaleDateString()}`
                    : status === "expired"
                      ? "Expired"
                      : "Turned off"}{" "}
                  · {l.viewCount} view{l.viewCount === 1 ? "" : "s"}
                </span>
                {status === "active" && (
                  <button
                    type="button"
                    onClick={() => revoke(l.id)}
                    disabled={busy !== null}
                    className="rounded-full border border-border px-2 py-0.5 text-[10px] font-semibold hover:text-destructive disabled:opacity-50"
                  >
                    {busy === l.id ? "Turning off…" : "Turn off"}
                  </button>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
