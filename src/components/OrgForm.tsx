import { useState } from "react";
import { toast } from "sonner";
import { LocationAutocomplete } from "@/components/LocationAutocomplete";
import { VenueMapPreview } from "@/components/VenueMapPreview";
import { ImageUploader } from "@/components/ImageUploader";

export type OrgFormValue = {
  name: string;
  handle: string;
  city: string;
  bio: string;
  website: string;
  address: string;
  placeId: string;
  geo: { lat: number; lng: number } | null;
  avatarUrl: string;
  coverUrl: string;
};

export function emptyOrgForm(): OrgFormValue {
  return {
    name: "",
    handle: "",
    city: "",
    bio: "",
    website: "",
    address: "",
    placeId: "",
    geo: null,
    avatarUrl: "",
    coverUrl: "",
  };
}

const HANDLE_RE = /^[a-z0-9_-]{3,40}$/;

export function validateOrgForm(v: OrgFormValue): string | null {
  if (v.name.trim().length < 2) return "Name is too short.";
  if (!HANDLE_RE.test(v.handle.trim().toLowerCase()))
    return "Handle must be 3–40 chars: a–z, 0–9, - or _.";
  if (v.website && !/^https?:\/\//i.test(v.website)) return "Website must start with http(s)://";
  return null;
}

export function OrgForm({
  value,
  onChange,
  userId,
  submitting,
  onSubmit,
  onDelete,
  submitLabel,
}: {
  value: OrgFormValue;
  onChange: (v: OrgFormValue) => void;
  userId: string | null | undefined;
  submitting: boolean;
  onSubmit: () => void;
  onDelete?: () => void;
  submitLabel: string;
}) {
  const [touched, setTouched] = useState(false);
  const err = touched ? validateOrgForm(value) : null;

  function patch(p: Partial<OrgFormValue>) {
    onChange({ ...value, ...p });
  }

  return (
    <div className="space-y-5">
      <section className="rounded-2xl border border-border bg-surface p-4 space-y-3">
        <h2 className="text-xs uppercase tracking-wider font-bold text-muted-foreground">
          Identity
        </h2>
        <label className="block space-y-1">
          <span className="text-xs font-semibold text-muted-foreground">Name</span>
          <input
            value={value.name}
            onChange={(e) => patch({ name: e.target.value })}
            placeholder="Peak Performance Gym"
            className="w-full rounded-xl border border-border bg-background px-3 py-2 text-sm outline-none focus:border-lime/60"
          />
        </label>
        <label className="block space-y-1">
          <span className="text-xs font-semibold text-muted-foreground">Handle</span>
          <div className="flex items-center gap-1 rounded-xl border border-border bg-background px-3">
            <span className="text-sm text-muted-foreground">@</span>
            <input
              value={value.handle}
              onChange={(e) =>
                patch({ handle: e.target.value.toLowerCase().replace(/[^a-z0-9_-]/g, "") })
              }
              placeholder="peakgym"
              className="flex-1 bg-transparent py-2 text-sm outline-none"
            />
          </div>
        </label>
        <label className="block space-y-1">
          <span className="text-xs font-semibold text-muted-foreground">Bio</span>
          <textarea
            value={value.bio}
            onChange={(e) => patch({ bio: e.target.value })}
            rows={3}
            placeholder="A short description of the gym or organization."
            className="w-full rounded-xl border border-border bg-background px-3 py-2 text-sm outline-none focus:border-lime/60"
          />
        </label>
        <label className="block space-y-1">
          <span className="text-xs font-semibold text-muted-foreground">Website</span>
          <input
            value={value.website}
            onChange={(e) => patch({ website: e.target.value })}
            placeholder="https://example.com"
            className="w-full rounded-xl border border-border bg-background px-3 py-2 text-sm outline-none focus:border-lime/60"
          />
        </label>
      </section>

      <section className="rounded-2xl border border-border bg-surface p-4 space-y-3">
        <h2 className="text-xs uppercase tracking-wider font-bold text-muted-foreground">
          Location
        </h2>
        <label className="block space-y-1">
          <span className="text-xs font-semibold text-muted-foreground">City</span>
          <LocationAutocomplete
            value={value.city}
            onChange={(v) => patch({ city: v })}
            mode="city"
            placeholder="City, region"
          />
        </label>
        <label className="block space-y-1">
          <span className="text-xs font-semibold text-muted-foreground">Address</span>
          <LocationAutocomplete
            value={value.address}
            onChange={(v) => patch({ address: v })}
            onPick={(full, placeId, geo) =>
              patch({
                address: full,
                placeId,
                geo: geo ? { lat: geo.lat, lng: geo.lng } : null,
              })
            }
            placeholder="Street address"
          />
        </label>
        {value.geo && value.address && (
          <div className="overflow-hidden rounded-xl border border-border">
            <VenueMapPreview
              address={value.address}
              lat={value.geo.lat}
              lng={value.geo.lng}
              placeId={value.placeId || undefined}
            />
          </div>
        )}
      </section>

      <section className="rounded-2xl border border-border bg-surface p-4 space-y-4">
        <h2 className="text-xs uppercase tracking-wider font-bold text-muted-foreground">
          Branding
        </h2>
        <div>
          <div className="text-xs font-semibold text-muted-foreground mb-2">Logo / Avatar</div>
          <ImageUploader
            kind="avatar"
            bucket="org-avatars"
            pathPrefix={userId}
            value={value.avatarUrl}
            onChange={(url) => patch({ avatarUrl: url })}
            onClear={() => patch({ avatarUrl: "" })}
          />
        </div>
        <div>
          <div className="text-xs font-semibold text-muted-foreground mb-2">Cover image</div>
          <ImageUploader
            kind="cover"
            bucket="org-covers"
            pathPrefix={userId}
            value={value.coverUrl}
            onChange={(url) => patch({ coverUrl: url })}
            onClear={() => patch({ coverUrl: "" })}
          />
        </div>
      </section>

      {err && (
        <div className="rounded-xl border border-coral/40 bg-coral/10 px-3 py-2 text-xs text-coral">
          {err}
        </div>
      )}

      <div className="flex items-center gap-2">
        <button
          type="button"
          disabled={submitting}
          onClick={() => {
            setTouched(true);
            const e = validateOrgForm(value);
            if (e) {
              toast.error(e);
              return;
            }
            onSubmit();
          }}
          className="flex-1 rounded-full bg-lime-gradient px-4 py-3 text-sm font-bold text-primary-foreground glow-lime disabled:opacity-60"
        >
          {submitting ? "Saving…" : submitLabel}
        </button>
        {onDelete && (
          <button
            type="button"
            onClick={onDelete}
            className="rounded-full border border-coral/40 bg-coral/10 px-4 py-3 text-xs font-bold text-coral"
          >
            Delete
          </button>
        )}
      </div>
    </div>
  );
}
