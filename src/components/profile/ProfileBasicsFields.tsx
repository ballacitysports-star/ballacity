import { ImageUploader } from "@/components/ImageUploader";
import { LocationAutocomplete } from "@/components/LocationAutocomplete";
import { Field, Input } from "@/components/profile/ProfileFormPrimitives";

export type ProfileBasicsValue = {
  name: string;
  username: string;
  avatar: string;
  avatarUrl?: string;
  coverUrl?: string;
  city: string;
  bio: string;
  birthday: string;
  graduatingClass: string;
};

/**
 * The canonical "Basics" fields. Rendered by both the Edit profile screen and
 * onboarding so the two can never drift.
 */
export function ProfileBasicsFields({
  userId,
  value,
  onChange,
  birthdayError,
}: {
  userId?: string;
  value: ProfileBasicsValue;
  onChange: (patch: Partial<ProfileBasicsValue>) => void;
  birthdayError?: string | null;
}) {
  return (
    <>
      <Field label="Cover photo">
        <ImageUploader
          kind="cover"
          bucket="covers"
          pathPrefix={userId}
          value={value.coverUrl ?? ""}
          onChange={(url) => onChange({ coverUrl: url })}
          onClear={() => onChange({ coverUrl: undefined })}
        />
      </Field>
      <Field label="Photo">
        <ImageUploader
          kind="avatar"
          bucket="avatars"
          pathPrefix={userId}
          value={value.avatarUrl ?? ""}
          onChange={(url) => onChange({ avatarUrl: url })}
          onClear={() => onChange({ avatarUrl: undefined })}
        />
      </Field>
      <Field label="Display name">
        <Input value={value.name} onChange={(v) => onChange({ name: v })} maxLength={60} />
      </Field>
      <Field label="Username">
        <Input
          value={value.username}
          onChange={(v) => onChange({ username: v })}
          maxLength={30}
          placeholder="@you"
        />
      </Field>
      <Field label="Avatar initials (fallback)">
        <Input value={value.avatar} onChange={(v) => onChange({ avatar: v })} maxLength={3} />
      </Field>
      <Field label="City">
        <LocationAutocomplete
          value={value.city}
          onChange={(v) => onChange({ city: v })}
          placeholder="Your city"
          mode="city"
        />
      </Field>
      <Field label="Bio">
        <textarea
          value={value.bio}
          onChange={(e) => onChange({ bio: e.target.value })}
          maxLength={280}
          rows={3}
          className="w-full rounded-2xl border border-border bg-surface px-3 py-2 text-sm outline-none focus:border-lime"
        />
        <div className="mt-1 text-right text-[10px] text-muted-foreground">
          {value.bio.length}/280
        </div>
      </Field>
      <Field label="Birthday">
        <input
          type="date"
          value={value.birthday}
          onChange={(e) => onChange({ birthday: e.target.value })}
          max={new Date().toISOString().slice(0, 10)}
          aria-invalid={birthdayError ? true : undefined}
          className={`w-full rounded-2xl border bg-surface px-3 py-2 text-sm outline-none focus:border-lime ${
            birthdayError ? "border-destructive" : "border-border"
          }`}
        />
        {birthdayError && <p className="mt-1 text-xs text-destructive">{birthdayError}</p>}
      </Field>
      <Field label="Graduating class">
        <Input
          value={value.graduatingClass}
          onChange={(v) => onChange({ graduatingClass: v.replace(/[^0-9]/g, "").slice(0, 4) })}
          placeholder={`e.g. ${new Date().getFullYear() + 4}`}
          maxLength={4}
        />
      </Field>
    </>
  );
}
