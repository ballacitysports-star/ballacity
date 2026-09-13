import { useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  superadminImageStats,
  superadminListImages,
  superadminReviewImage,
} from "@/lib/superadmin-images.functions";
import {
  IMAGE_BUCKETS,
  IMAGE_BUCKET_KEYS,
  formatBytes,
  imageBucketLabel,
} from "@/lib/image-moderation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

const STATUSES = [
  { key: "pending", label: "Needs review" },
  { key: "quarantined", label: "Quarantined" },
  { key: "kept", label: "Approved" },
  { key: "removed", label: "Removed" },
  { key: "all", label: "All" },
] as const;

const PAGE_SIZE = 48;

type ImageRow = {
  bucket: string;
  path: string;
  url: string | null;
  size: number | null;
  mimetype: string | null;
  createdAt: string;
  status: string;
  reason: string | null;
  ownerId: string | null;
  owner: {
    display_name?: string | null;
    username?: string | null;
    suspended_at?: string | null;
  } | null;
};

export function ImagesTab() {
  const list = useServerFn(superadminListImages);
  const review = useServerFn(superadminReviewImage);
  const stats = useServerFn(superadminImageStats);
  const qc = useQueryClient();

  const [status, setStatus] = useState<string>("pending");
  const [buckets, setBuckets] = useState<string[]>([]);
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(0);
  const [target, setTarget] = useState<ImageRow | null>(null);
  const [reason, setReason] = useState("");
  const [suspendOwner, setSuspendOwner] = useState(false);

  const { data, isLoading } = useQuery({
    queryKey: ["sa-images", status, buckets, search, page],
    queryFn: () =>
      list({
        data: {
          status: status as any,
          buckets,
          search: search.trim() || undefined,
          limit: PAGE_SIZE,
          offset: page * PAGE_SIZE,
        },
      }),
  });

  const { data: counts } = useQuery({
    queryKey: ["sa-image-stats"],
    queryFn: () => stats({}),
  });

  const act = useMutation({
    mutationFn: (input: {
      bucket: string;
      path: string;
      action: "keep" | "quarantine" | "remove" | "reopen";
      reason?: string;
      suspendOwner?: boolean;
    }) => review({ data: input }),
    onSuccess: (res: any, input) => {
      toast.success(
        input.action === "quarantine"
          ? "Image quarantined — hidden across the app until approved"
          : input.action === "remove"
            ? `Image removed${res?.removedRefs ? ` · ${res.removedRefs} reference(s) cleared` : ""}`
            : input.action === "keep"
              ? "Image approved"
              : "Image reopened for review",
      );
      setTarget(null);
      setReason("");
      setSuspendOwner(false);
      qc.invalidateQueries({ queryKey: ["sa-images"] });
      qc.invalidateQueries({ queryKey: ["sa-image-stats"] });
    },
    onError: (e: any) => toast.error(e?.message ?? "Action failed"),
  });

  const images = (data?.images ?? []) as ImageRow[];
  const total = data?.total ?? 0;
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  function toggleBucket(key: string) {
    setPage(0);
    setBuckets((prev) => (prev.includes(key) ? prev.filter((b) => b !== key) : [...prev, key]));
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        {STATUSES.map((s) => (
          <Button
            key={s.key}
            size="sm"
            variant={status === s.key ? "default" : "outline"}
            onClick={() => {
              setStatus(s.key);
              setPage(0);
            }}
          >
            {s.label}
            {counts && s.key !== "all" ? (
              <span className="ml-1 opacity-70">{counts[s.key] ?? 0}</span>
            ) : null}
          </Button>
        ))}
        <Input
          value={search}
          onChange={(e) => {
            setSearch(e.target.value);
            setPage(0);
          }}
          placeholder="Search file path or user id…"
          className="h-9 w-full sm:w-64"
        />
      </div>

      <div className="flex flex-wrap gap-2">
        {IMAGE_BUCKET_KEYS.map((key) => (
          <button
            key={key}
            type="button"
            onClick={() => toggleBucket(key)}
            className={`rounded-full border px-3 py-1 text-xs transition-colors ${
              buckets.includes(key)
                ? "border-primary bg-primary text-primary-foreground"
                : "border-border bg-card text-muted-foreground hover:text-foreground"
            }`}
          >
            {IMAGE_BUCKETS[key].label}
          </button>
        ))}
      </div>

      <p className="text-xs text-muted-foreground">
        {isLoading ? "Loading uploads…" : `${total} image${total === 1 ? "" : "s"}`}
        {buckets.length === 0 ? " · all image buckets" : ""}
      </p>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
        {images.map((img) => (
          <div
            key={`${img.bucket}/${img.path}`}
            className="overflow-hidden rounded-lg border border-border bg-card"
          >
            <div className="aspect-square bg-muted">
              {img.url ? (
                <img
                  src={img.url}
                  alt={img.path}
                  loading="lazy"
                  className="h-full w-full object-cover"
                />
              ) : (
                <div className="flex h-full items-center justify-center text-xs text-muted-foreground">
                  No preview
                </div>
              )}
            </div>
            <div className="space-y-2 p-2">
              <div className="flex items-center justify-between gap-1">
                <Badge variant="secondary" className="truncate text-[10px]">
                  {imageBucketLabel(img.bucket)}
                </Badge>
                <Badge
                  variant={
                    img.status === "removed" || img.status === "quarantined"
                      ? "destructive"
                      : img.status === "kept"
                        ? "outline"
                        : "default"
                  }
                  className="text-[10px]"
                >
                  {img.status}
                </Badge>
              </div>
              <p className="truncate text-[11px] text-muted-foreground" title={img.path}>
                {img.path}
              </p>
              <p className="text-[11px] text-muted-foreground">
                {img.owner?.display_name ?? img.ownerId?.slice(0, 8) ?? "Unknown owner"} ·{" "}
                {formatBytes(img.size)} · {new Date(img.createdAt).toLocaleDateString()}
              </p>
              {img.reason ? (
                <p className="text-[11px] italic text-muted-foreground">“{img.reason}”</p>
              ) : null}
              <div className="flex flex-wrap gap-1">
                {img.status !== "removed" ? (
                  <>
                    <Button
                      size="sm"
                      variant="outline"
                      className="h-7 px-2 text-[11px]"
                      disabled={act.isPending}
                      onClick={() =>
                        act.mutate({ bucket: img.bucket, path: img.path, action: "keep" })
                      }
                    >
                      Approve
                    </Button>
                    {img.status !== "quarantined" ? (
                      <Button
                        size="sm"
                        variant="outline"
                        className="h-7 px-2 text-[11px]"
                        disabled={act.isPending}
                        onClick={() =>
                          act.mutate({ bucket: img.bucket, path: img.path, action: "quarantine" })
                        }
                      >
                        Quarantine
                      </Button>
                    ) : null}
                    <Button
                      size="sm"
                      variant="destructive"
                      className="h-7 px-2 text-[11px]"
                      onClick={() => {
                        setTarget(img);
                        setReason("");
                        setSuspendOwner(false);
                      }}
                    >
                      Remove
                    </Button>
                  </>
                ) : (
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-7 px-2 text-[11px]"
                    disabled={act.isPending}
                    onClick={() =>
                      act.mutate({ bucket: img.bucket, path: img.path, action: "reopen" })
                    }
                  >
                    Reopen
                  </Button>
                )}
              </div>
            </div>
          </div>
        ))}
      </div>

      {!isLoading && images.length === 0 ? (
        <p className="rounded-lg border border-dashed border-border p-6 text-center text-sm text-muted-foreground">
          Nothing to review here.
        </p>
      ) : null}

      {pages > 1 ? (
        <div className="flex items-center justify-between">
          <Button
            size="sm"
            variant="outline"
            disabled={page === 0}
            onClick={() => setPage((p) => Math.max(0, p - 1))}
          >
            Previous
          </Button>
          <span className="text-xs text-muted-foreground">
            Page {page + 1} of {pages}
          </span>
          <Button
            size="sm"
            variant="outline"
            disabled={page + 1 >= pages}
            onClick={() => setPage((p) => p + 1)}
          >
            Next
          </Button>
        </div>
      ) : null}

      <Dialog open={!!target} onOpenChange={(o) => !o && setTarget(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Remove this image?</DialogTitle>
            <DialogDescription>
              The file is deleted from storage and any profile, team, gym, or game still using it is
              cleared. This cannot be undone.
            </DialogDescription>
          </DialogHeader>
          {target?.url ? (
            <img
              src={target.url}
              alt={target.path}
              className="max-h-56 w-full rounded-md object-contain"
            />
          ) : null}
          <Textarea
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="Reason (abusive content, low quality, wrong image…)"
            rows={3}
          />
          <label className="flex items-center gap-2 text-sm">
            <Checkbox checked={suspendOwner} onCheckedChange={(v) => setSuspendOwner(v === true)} />
            Also suspend the uploader
          </label>
          <DialogFooter>
            <Button variant="outline" onClick={() => setTarget(null)}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              disabled={act.isPending || !target}
              onClick={() =>
                target &&
                act.mutate({
                  bucket: target.bucket,
                  path: target.path,
                  action: "remove",
                  reason: reason.trim() || undefined,
                  suspendOwner,
                })
              }
            >
              {act.isPending ? "Removing…" : "Remove image"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
