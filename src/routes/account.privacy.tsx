import { createFileRoute, Link } from "@tanstack/react-router";
import { ArrowLeft, Download, Eye, MapPin, MessageSquare, Sparkles, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { useMyAgeCategory } from "@/lib/youth-features";
import { isMinorCategory } from "@/lib/age-policy";
import { pageHead } from "@/lib/seo";
import { Switch } from "@/components/ui/switch";
import {
  SettingsGroup,
  SettingsLinkRow,
  SettingsStaticRow,
} from "@/components/settings/SettingsRow";
import {
  CONTACT_SCOPE_OPTIONS,
  LOCATION_PRECISION_OPTIONS,
  PROFILE_VISIBILITY_OPTIONS,
  useMyPrivacy,
  type ContactScope,
  type LocationPrecision,
  type PrivacyPreferences,
  type ProfileVisibility,
} from "@/lib/privacy";
import {
  AVATAR_VISIBILITY_OPTIONS,
  DEFAULT_AVATAR_VISIBILITY,
  useAvatarVisibility,
  type AvatarVisibility,
} from "@/lib/avatar-privacy";
import { DeleteAccountButton } from "@/routes/settings";

export const Route = createFileRoute("/account/privacy")({
  head: () =>
    pageHead({
      path: "/account/privacy",
      title: "Privacy — ballaCity",
      description:
        "Control who can see your ballaCity profile, how precisely your location is shared, who can message or invite you, and delete your account.",
      noindex: true,
    }),
  component: PrivacySettingsPage,
});

function OptionList<T extends string>({
  value,
  options,
  onChange,
  disabled,
  name,
}: {
  value: T;
  options: Array<{ value: T; label: string; description?: string }>;
  onChange: (next: T) => void;
  disabled?: boolean;
  name: string;
}) {
  return (
    <div className="space-y-1.5" role="radiogroup" aria-label={name}>
      {options.map((o) => {
        const active = o.value === value;
        return (
          <button
            key={o.value}
            type="button"
            role="radio"
            aria-checked={active}
            disabled={disabled}
            onClick={() => onChange(o.value)}
            className={`flex w-full items-start gap-3 rounded-xl border px-3 py-2.5 text-left transition ${
              active
                ? "border-primary bg-primary/10"
                : "border-border bg-surface hover:bg-surface-2"
            } disabled:opacity-60`}
          >
            <span
              className={`mt-0.5 h-4 w-4 shrink-0 rounded-full border-2 ${
                active ? "border-primary bg-primary" : "border-muted-foreground"
              }`}
              aria-hidden
            />
            <span className="min-w-0">
              <span className="block text-sm font-medium">{o.label}</span>
              {o.description && (
                <span className="mt-0.5 block text-xs text-muted-foreground">{o.description}</span>
              )}
            </span>
          </button>
        );
      })}
    </div>
  );
}

function PrivacySettingsPage() {
  const { prefs, isLoading, saving, update } = useMyPrivacy();
  const avatar = useAvatarVisibility();
  const { category } = useMyAgeCategory();
  const isMinor = isMinorCategory(category);

  const save = async (patch: Partial<PrivacyPreferences>) => {
    try {
      await update(patch);
      toast.success("Privacy settings saved");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Couldn't save privacy settings");
    }
  };

  return (
    <div className="min-h-dvh bg-background pb-24">
      <BackHeader title="Privacy" fallbackTo="/settings" />

      <main className="mx-auto max-w-xl pb-4">
        <p className="px-4 pt-4 text-xs text-muted-foreground">
          ballaCity never shares your live position or a street address. Availability locations are
          stored as an approximate area only.
        </p>

        {isMinor ? (
          <div className="mx-4 mt-3 rounded-xl border border-primary/40 bg-primary/10 p-3">
            <p className="text-xs font-medium">Extra protections are on for your account</p>
            <p className="mt-1 text-xs text-muted-foreground">
              Because you&apos;re under 18, your profile stays visible to members only, your
              location is never shared more precisely than your city, and your birthday and
              contact details are never public.
            </p>
          </div>
        ) : null}

        <SettingsGroup title="Profile visibility">
          <SettingsStaticRow icon={Eye} label="Who can see your profile" />
          <SettingsStaticRow>
            <OptionList
              name="Profile visibility"
              value={prefs.profile_visibility}
              options={PROFILE_VISIBILITY_OPTIONS}
              disabled={isLoading || saving}
              onChange={(v: ProfileVisibility) => save({ profile_visibility: v })}
            />
          </SettingsStaticRow>
          <SettingsStaticRow label="Profile photo">
            <div />
          </SettingsStaticRow>
          <SettingsStaticRow>
            <OptionList
              name="Photo visibility"
              value={avatar.value ?? DEFAULT_AVATAR_VISIBILITY}
              options={AVATAR_VISIBILITY_OPTIONS}
              disabled={avatar.saving}
              onChange={(v: AvatarVisibility) => {
                avatar
                  .update(v)
                  .then(() => toast.success("Photo visibility saved"))
                  .catch((e) =>
                    toast.error(e instanceof Error ? e.message : "Couldn't save visibility"),
                  );
              }}
            />
          </SettingsStaticRow>
          <SettingsStaticRow
            label="Show sports & skill levels"
            description="Hide the sports and levels shown on your public player card."
            trailing={
              <Switch
                checked={prefs.show_sports}
                disabled={isLoading || saving}
                onCheckedChange={(v) => save({ show_sports: v })}
                aria-label="Show sports and skill levels"
              />
            }
          />
          <SettingsStaticRow
            label="Show games played"
            description="Hide your game history and participation stats from other players."
            trailing={
              <Switch
                checked={prefs.show_games_played}
                disabled={isLoading || saving}
                onCheckedChange={(v) => save({ show_games_played: v })}
                aria-label="Show games played"
              />
            }
          />
          <SettingsStaticRow
            label="Show online status"
            description="Let other members see when you were last active. Turn this off and your activity stays private — you can still message and join games."
            trailing={
              <Switch
                checked={prefs.show_online_status}
                disabled={isLoading || saving}
                onCheckedChange={(v) => save({ show_online_status: v })}
                aria-label="Show online status"
              />
            }
          />
        </SettingsGroup>

        <SettingsGroup title="Location">
          <SettingsStaticRow icon={MapPin} label="How your location is shared" />
          <SettingsStaticRow>
            <OptionList
              name="Location precision"
              value={prefs.location_precision}
              options={LOCATION_PRECISION_OPTIONS}
              disabled={isLoading || saving}
              onChange={(v: LocationPrecision) => save({ location_precision: v })}
            />
          </SettingsStaticRow>
          <SettingsStaticRow>
            <p className="text-xs text-muted-foreground">
              Your device location is used on your device to find nearby games and is never stored
              as a live position. Changing this setting applies the next time you save an
              availability post.
            </p>
          </SettingsStaticRow>
        </SettingsGroup>

        <SettingsGroup title="Messages & invitations">
          <SettingsStaticRow icon={MessageSquare} label="Who can message you" />
          <SettingsStaticRow>
            <OptionList
              name="Who can message you"
              value={prefs.allow_messages}
              options={CONTACT_SCOPE_OPTIONS}
              disabled={isLoading || saving}
              onChange={(v: ContactScope) => save({ allow_messages: v })}
            />
          </SettingsStaticRow>
          <SettingsStaticRow label="Who can invite you to games">
            <div />
          </SettingsStaticRow>
          <SettingsStaticRow>
            <OptionList
              name="Who can invite you to games"
              value={prefs.allow_invites}
              options={CONTACT_SCOPE_OPTIONS}
              disabled={isLoading || saving}
              onChange={(v: ContactScope) => save({ allow_invites: v })}
            />
          </SettingsStaticRow>
        </SettingsGroup>

        <SettingsGroup title="Communications & AI">
          <SettingsStaticRow
            label="Marketing communications"
            description="Occasional product news and tips. Game and message alerts are unaffected."
            trailing={
              <Switch
                checked={prefs.marketing_emails}
                disabled={isLoading || saving}
                onCheckedChange={(v) => save({ marketing_emails: v })}
                aria-label="Marketing communications"
              />
            }
          />
          <SettingsStaticRow
            icon={Sparkles}
            label="AI video & highlight processing"
            description="Allow ballaCity to analyze your uploaded clips to generate titles, captions and coaching notes."
            trailing={
              <Switch
                checked={prefs.ai_processing}
                disabled={isLoading || saving}
                onCheckedChange={(v) => save({ ai_processing: v })}
                aria-label="AI video processing"
              />
            }
          />
          <SettingsStaticRow>
            <p className="text-xs text-muted-foreground">
              See exactly what AI does with your clips, what is kept, and delete AI results or
              videos in{" "}
              <Link to="/account/ai-privacy" className="font-semibold text-lime underline">
                AI &amp; Video Privacy
              </Link>
              .
            </p>
          </SettingsStaticRow>
        </SettingsGroup>

        <SettingsGroup title="Your data">
          <SettingsLinkRow
            icon={Download}
            label="Download my data"
            description="Get a copy of your profile, games, availability and activity, and see how long we keep each kind of data."
            to="/account/data"
          />
          <SettingsStaticRow>

            <div className="space-y-2 text-xs text-muted-foreground">
              <p>
                <span className="font-semibold text-foreground">Deleted:</span> your profile, photos,
                bio, birthday, availability, highlight reels, messages, comments, reactions,
                follows, and every sign-in method.
              </p>
              <p>
                <span className="font-semibold text-foreground">Anonymized:</span> content other
                people still depend on — such as games you hosted for others — is stripped of your
                name and photo.
              </p>
              <p>
                <span className="font-semibold text-foreground">Retained:</span> safety records
                (reports and blocks filed about your account) and required security logs.
              </p>
              <p className="text-[11px] uppercase tracking-wide">
                Legal review required — retention periods are placeholders.
              </p>
            </div>
          </SettingsStaticRow>
          <DeleteAccountButton />
          <SettingsStaticRow>
            <p className="flex items-center gap-2 text-xs text-muted-foreground">
              <Trash2 className="h-3.5 w-3.5" aria-hidden />
              Deleting your account is permanent and cannot be undone.
            </p>
          </SettingsStaticRow>
        </SettingsGroup>
      </main>
    </div>
  );
}
