import * as React from "react";
import { CalendarIcon } from "lucide-react";
import { ImageUploader } from "@/components/ImageUploader";
import { LocationAutocomplete } from "@/components/LocationAutocomplete";
import {
  Field,
  Input,
  birthdayToDisplay,
  formatBirthdayInput,
  parseBirthdayInput,
} from "@/components/profile/ProfileFormPrimitives";
import { birthdayConsentNotice } from "@/lib/age-policy";
import { checkChildUsername, cohortFromBirthday } from "@/lib/child-policy";

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
  birthdayLocked = false,
}: {
  userId?: string;
  value: ProfileBasicsValue;
  onChange: (patch: Partial<ProfileBasicsValue>) => void;
  birthdayError?: string | null;
  /** True once a date of birth is on file: it can only change via a support-reviewed correction. */
  birthdayLocked?: boolean;
}) {
  // Minor-safety checks derived from the entered birthday, so onboarding and
  // Edit profile enforce identical rules (the database re-checks on write).
  const cohort = cohortFromBirthday(value.birthday);
  const usernameCheck = checkChildUsername(value.username, { cohort, fullName: value.name });
  const consentNotice = birthdayConsentNotice(value.birthday);

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
        {usernameCheck.message ? (
          <div
            className={`mt-1 text-[11px] ${usernameCheck.ok ? "text-muted-foreground" : "text-destructive"}`}
          >
            {usernameCheck.message}
          </div>
        ) : null}
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
        {birthdayLocked ? (
          <div className="rounded-2xl border border-border bg-background px-3 py-2 text-sm">
            {birthdayToDisplay(value.birthday) || "Not set"}
            <div className="mt-1 text-[11px] leading-snug text-muted-foreground">
              Locked after signup because it sets your age group. Ask us to correct it from Settings.
            </div>
          </div>
        ) : (
          <BirthdayInput
            value={value.birthday}
            onChange={(v) => onChange({ birthday: v })}
            error={birthdayError}
          />
        )}
        {consentNotice ? (
          <div className="mt-2 rounded-xl border border-lime/40 bg-lime/10 p-2 text-[11px] leading-snug">
            {consentNotice}
          </div>
        ) : null}
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

/**
 * Birthday entry that supports typing the date by hand (MM/DD/YYYY or
 * YYYY-MM-DD) while keeping the native calendar picker available.
 */
function BirthdayInput({
  value,
  onChange,
  error,
}: {
  value: string;
  onChange: (iso: string) => void;
  error?: string | null;
}) {
  const [text, setText] = React.useState(() => birthdayToDisplay(value));
  const dateRef = React.useRef<HTMLInputElement>(null);
  const today = new Date().toISOString().slice(0, 10);

  // Keep the visible text in sync when the value changes from outside (picker, prefill).
  React.useEffect(() => {
    const parsed = parseBirthdayInput(text);
    if (parsed.iso !== value) setText(birthdayToDisplay(value));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);

  return (
    <>
      <div className="relative">
        <input
          type="text"
          inputMode="numeric"
          autoComplete="bday"
          maxLength={10}
          placeholder="MM/DD/YYYY"
          value={text}
          aria-label="Birthday"
          aria-invalid={error ? true : undefined}
          onChange={(e) => {
            const next = formatBirthdayInput(e.target.value);
            setText(next);
            const parsed = parseBirthdayInput(next);
            if (parsed.complete) onChange(parsed.iso ?? "");
          }}
          onBlur={() => {
            const parsed = parseBirthdayInput(text);
            onChange(parsed.complete ? (parsed.iso ?? "") : text);
          }}
          className={`w-full rounded-2xl border bg-surface px-3 py-2 pr-11 text-sm outline-none focus:border-lime ${
            error ? "border-destructive" : "border-border"
          }`}
        />
        <button
          type="button"
          aria-label="Open calendar"
          onClick={(e) => {
            e.preventDefault();
            const el = dateRef.current;
            if (!el) return;
            if (typeof el.showPicker === "function") el.showPicker();
            else el.click();
          }}
          className="absolute right-1 top-1/2 -translate-y-1/2 rounded-full p-2 text-muted-foreground hover:text-foreground"
        >
          <CalendarIcon className="h-4 w-4" />
        </button>
        <input
          ref={dateRef}
          type="date"
          tabIndex={-1}
          aria-hidden="true"
          value={/^\d{4}-\d{2}-\d{2}$/.test(value) ? value : ""}
          max={today}
          onChange={(e) => {
            onChange(e.target.value);
            setText(birthdayToDisplay(e.target.value));
          }}
          className="pointer-events-none absolute right-3 bottom-1 h-0 w-0 opacity-0"
        />
      </div>
      {error && <p className="mt-1 text-xs text-destructive">{error}</p>}
    </>
  );
}
