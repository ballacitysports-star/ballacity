import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { Sparkles, Undo2 } from "lucide-react";
import { heldNotice } from "@/lib/post-moderation";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { PrimaryCTA } from "@/components/PrimaryCTA";
import { LocationAutocomplete } from "@/components/LocationAutocomplete";

import { createTeamPost, suggestTeamPostDraft } from "@/lib/team-posts.functions";
import type { PostKind } from "@/lib/sample-data";
import { POST_KIND_META } from "@/lib/sample-data";

const KINDS: PostKind[] = ["announcement", "tryout", "pickup", "clinic", "recap"];

export function CreatePostSheet({
  teamId,
  open,
  onOpenChange,
}: {
  teamId: string;
  open: boolean;
  onOpenChange: (v: boolean) => void;
}) {
  const [kind, setKind] = useState<PostKind>("announcement");
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [eventDate, setEventDate] = useState("");
  const [location, setLocation] = useState("");
  const [locationGeo, setLocationGeo] = useState<{
    placeId: string;
    lat: number;
    lng: number;
    formattedAddress: string | null;
  } | null>(null);
  const [price, setPrice] = useState("");
  const [spotsMax, setSpotsMax] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [drafting, setDrafting] = useState(false);
  /** What the member had before the AI draft, so one tap puts it back. */
  const [beforeDraft, setBeforeDraft] = useState<{ title: string; body: string } | null>(null);

  const qc = useQueryClient();
  const createFn = useServerFn(createTeamPost);
  const draftFn = useServerFn(suggestTeamPostDraft);

  const draftWithAi = async () => {
    setDrafting(true);
    try {
      const draft = await draftFn({ data: { kind, notes: body, title: title || null } });
      setBeforeDraft({ title, body });
      setTitle(draft.title);
      setBody(draft.body);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Couldn't draft that right now");
    } finally {
      setDrafting(false);
    }
  };
  const mutation = useMutation({
    mutationFn: createFn,
    onSuccess: (result) => {
      qc.invalidateQueries({ queryKey: ["team-posts", teamId] });
      const held = heldNotice(result);
      if (held) toast.message(held);
      else toast.success("Post published");
      setTitle("");
      setBody("");
      setEventDate("");
      setLocation("");
      setLocationGeo(null);
      setPrice("");
      setSpotsMax("");
      setErr(null);
      setBeforeDraft(null);
      onOpenChange(false);
    },
    onError: (e: any) => {
      const msg = e?.message ?? "Failed to post.";
      setErr(msg);
      toast.error(msg);
    },
  });

  const isEvent = kind === "tryout" || kind === "pickup" || kind === "clinic";

  const onSubmit = () => {
    if (!title.trim()) {
      setErr("Add a title.");
      return;
    }
    mutation.mutate({
      data: {
        teamId,
        kind,
        title: title.trim(),
        body: body.trim(),
        eventDate: isEvent && eventDate ? new Date(eventDate).toISOString() : null,
        location: isEvent && location.trim() ? location.trim() : null,
        placeId: isEvent ? (locationGeo?.placeId ?? null) : null,
        formattedAddress: isEvent ? (locationGeo?.formattedAddress ?? null) : null,
        lat: isEvent ? (locationGeo?.lat ?? null) : null,
        lng: isEvent ? (locationGeo?.lng ?? null) : null,
        price: isEvent && price !== "" ? Number(price) : null,
        spotsMax: isEvent && spotsMax !== "" ? Number(spotsMax) : null,
      },
    });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>New post</DialogTitle>
          <DialogDescription>Share news, a tryout, pickup, clinic, or recap.</DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <div>
            <label className="text-xs font-semibold text-muted-foreground">Kind</label>
            <div className="mt-1.5 flex flex-wrap gap-1.5">
              {KINDS.map((k) => (
                <button
                  key={k}
                  type="button"
                  onClick={() => setKind(k)}
                  className={`rounded-full border px-3 py-1.5 text-xs font-semibold transition-all ${
                    kind === k
                      ? "border-lime bg-lime text-primary-foreground"
                      : "border-border bg-surface text-muted-foreground"
                  }`}
                >
                  {POST_KIND_META[k].emoji} {POST_KIND_META[k].label}
                </button>
              ))}
            </div>
          </div>

          <div>
            <label className="text-xs font-semibold text-muted-foreground">Title</label>
            <input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="What's the headline?"
              className="mt-1.5 w-full rounded-2xl border border-border bg-surface px-3 py-2.5 text-sm"
              maxLength={200}
            />
          </div>

          <div>
            <label className="text-xs font-semibold text-muted-foreground">Details</label>
            <textarea
              value={body}
              onChange={(e) => setBody(e.target.value)}
              rows={4}
              placeholder="Add context, requirements, or a call to action."
              className="mt-1.5 w-full rounded-2xl border border-border bg-surface px-3 py-2.5 text-sm"
              maxLength={4000}
            />
            <div className="mt-1.5 flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={draftWithAi}
                disabled={drafting || body.trim().length < 10}
                className="inline-flex items-center gap-1 rounded-full border border-lime/40 px-3 py-1.5 text-xs font-bold text-lime disabled:opacity-40"
              >
                <Sparkles className="h-3 w-3" /> {drafting ? "Drafting…" : "Draft with AI"}
              </button>
              {beforeDraft && (
                <button
                  type="button"
                  onClick={() => {
                    setTitle(beforeDraft.title);
                    setBody(beforeDraft.body);
                    setBeforeDraft(null);
                  }}
                  className="inline-flex items-center gap-1 rounded-full border border-border px-3 py-1.5 text-xs font-semibold text-muted-foreground"
                >
                  <Undo2 className="h-3 w-3" /> Undo
                </button>
              )}
            </div>
            <p className="mt-1 text-[10px] text-muted-foreground">
              Jot rough notes above and AI writes the title and details from them. It only uses what
              you wrote — check dates, prices and places before you publish.
            </p>
          </div>

          {isEvent && (
            <div className="grid grid-cols-2 gap-2">
              <div className="col-span-2">
                <label className="text-xs font-semibold text-muted-foreground">Date & time</label>
                <input
                  type="datetime-local"
                  value={eventDate}
                  onChange={(e) => setEventDate(e.target.value)}
                  className="mt-1.5 w-full rounded-2xl border border-border bg-surface px-3 py-2.5 text-sm"
                />
              </div>
              <div className="col-span-2">
                <label className="text-xs font-semibold text-muted-foreground">Location</label>
                <div className="mt-1.5">
                  <LocationAutocomplete
                    value={location}
                    onChange={(v) => {
                      setLocation(v);
                      setLocationGeo(null);
                    }}
                    placeholder="Venue or address"
                    onPick={(full, placeId, geo) => {
                      setLocation(full);
                      setLocationGeo(
                        geo
                          ? {
                              placeId,
                              lat: geo.lat,
                              lng: geo.lng,
                              formattedAddress: geo.formattedAddress ?? full,
                            }
                          : null,
                      );
                    }}
                  />
                </div>
              </div>
              <div>
                <label className="text-xs font-semibold text-muted-foreground">Price ($)</label>
                <input
                  type="number"
                  inputMode="numeric"
                  min={0}
                  value={price}
                  onChange={(e) => setPrice(e.target.value)}
                  placeholder="0"
                  className="mt-1.5 w-full rounded-2xl border border-border bg-surface px-3 py-2.5 text-sm"
                />
              </div>
              <div>
                <label className="text-xs font-semibold text-muted-foreground">Spots</label>
                <input
                  type="number"
                  inputMode="numeric"
                  min={1}
                  value={spotsMax}
                  onChange={(e) => setSpotsMax(e.target.value)}
                  placeholder="e.g. 10"
                  className="mt-1.5 w-full rounded-2xl border border-border bg-surface px-3 py-2.5 text-sm"
                />
              </div>
            </div>
          )}

          {err && (
            <div className="rounded-xl border border-coral/40 bg-coral/10 px-3 py-2 text-xs text-coral">
              {err}
            </div>
          )}

          <PrimaryCTA onClick={onSubmit} loading={mutation.isPending}>
            Publish post
          </PrimaryCTA>
        </div>
      </DialogContent>
    </Dialog>
  );
}
