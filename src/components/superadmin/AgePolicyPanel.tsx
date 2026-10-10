import { useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { ShieldAlert } from "lucide-react";
import { Switch } from "@/components/ui/switch";
import { superadminSetSetting } from "@/lib/superadmin.functions";
import { useAgePolicy } from "@/lib/youth-features";
import {
  CHILD_POLICY_DISCLAIMER,
  MODELED_CONSENT_JURISDICTION,
  COHORT_META,
  DEFAULT_AGE_POLICY,
  JURISDICTIONS,
  type AgePolicyConfig,
  type Jurisdiction,
} from "@/lib/child-policy";
import { LEGAL_REVIEW_REQUIRED } from "@/lib/age-policy";

type BoolKey = {
  [K in keyof AgePolicyConfig]: AgePolicyConfig[K] extends boolean ? K : never;
}[keyof AgePolicyConfig];
type NumKey = {
  [K in keyof AgePolicyConfig]: AgePolicyConfig[K] extends number ? K : never;
}[keyof AgePolicyConfig];

const BOOL_META: Record<BoolKey, { label: string; description: string }> = {
  childAdultDmRequiresGuardianLink: {
    label: "Adults need a guardian link to DM a child",
    description: "Blocks unknown adults from messaging under-13 members.",
  },
  teenAdultDmRequiresSharedContext: {
    label: "Adults need shared context to DM a teen",
    description: "An adult must share a game or existing chat with the teen.",
  },
  childPublicMedia: {
    label: "Children may publish media",
    description: "Off keeps under-13 highlight reels out of public feeds.",
  },
  childSocialDiscovery: {
    label: "Children appear in discovery",
    description: "Off removes under-13 members from nearby players and search.",
  },
  childAiAnalysisRequiresParent: {
    label: "AI video analysis needs parent approval",
    description: "Reel Coach stays off for children until a parent opts in.",
  },
  childPreciseLocationEverPublic: {
    label: "Children may share precise location",
    description: "Off forces city-level location for under-13 members.",
  },
  ageAssuranceRequired: {
    label: "Require age assurance at signup",
    description: "Adds an extra age-confirmation step for every new account.",
  },
  biometricAgeEstimationEnabled: {
    label: "Biometric age estimation",
    description: "Facial age estimation. Off pending legal and product review.",
  },
};

const NUM_META: Record<NumKey, { label: string; hint: string; min: number; max: number }> = {
  childMaxAge: { label: "Child cohort max age", hint: "Under-13 band", min: 1, max: 17 },
  teenMidMaxAge: { label: "Younger-teen max age", hint: "13–15 band", min: 2, max: 17 },
  adultAge: { label: "Adult age", hint: "18+ in most jurisdictions", min: 13, max: 21 },
  parentalConsentMaxAge: {
    label: "Parental consent required through age",
    hint: `Currently modeled on ${MODELED_CONSENT_JURISDICTION.replace(/_/g, " ")} (verifiable consent under 16). Federal COPPA alone would be 12.`,
    min: 0,
    max: 17,
  },
  consentReverificationDays: {
    label: "Consent re-verification (days)",
    hint: "0 = consent never expires",
    min: 0,
    max: 1095,
  },
};

const SETTING_KEY = "age_policy";

/** Serialize to the snake_case shape `parseAgePolicy()` and the SQL helpers read. */
function toRow(c: AgePolicyConfig) {
  return {
    child_max_age: c.childMaxAge,
    teen_mid_max_age: c.teenMidMaxAge,
    adult_age: c.adultAge,
    parental_consent_max_age: c.parentalConsentMaxAge,
    jurisdiction_default: c.jurisdiction,
    child_adult_dm_requires_guardian_link: c.childAdultDmRequiresGuardianLink,
    teen_adult_dm_requires_shared_context: c.teenAdultDmRequiresSharedContext,
    child_public_media: c.childPublicMedia,
    child_social_discovery: c.childSocialDiscovery,
    child_ai_analysis_requires_parent: c.childAiAnalysisRequiresParent,
    child_precise_location_ever_public: c.childPreciseLocationEverPublic,
    age_assurance_required: c.ageAssuranceRequired,
    biometric_age_estimation_enabled: c.biometricAgeEstimationEnabled,
    consent_reverification_days: c.consentReverificationDays,
    notification_curfew_enabled: c.notificationCurfew !== null,
    notification_curfew_start_hour: c.notificationCurfew?.startHour ?? 0,
    notification_curfew_end_hour: c.notificationCurfew?.endHour ?? 6,
  };
}

/**
 * Age-policy administration. Every cohort is supported; these switches tune
 * the protections rather than turning youth support on or off. Superadmin
 * permission is enforced by the server function and by RLS on `app_settings`.
 */
export function AgePolicyPanel() {
  const { policy, loading, refetch } = useAgePolicy();
  const setSetting = useServerFn(superadminSetSetting);
  const [local, setLocal] = useState<AgePolicyConfig>(policy);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!loading) setLocal(policy);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loading, JSON.stringify(policy)]);

  const persist = async (next: AgePolicyConfig, label: string) => {
    const prev = local;
    setLocal(next);
    setSaving(true);
    try {
      await setSetting({
        data: {
          key: SETTING_KEY,
          value: toRow(next),
          description: `${LEGAL_REVIEW_REQUIRED} — age cohorts, parental consent and minor-safety policy.`,
          isPublic: true,
        },
      });
      toast.success(`${label} saved`);
      void refetch();
    } catch (e) {
      setLocal(prev);
      toast.error(e instanceof Error ? e.message : "Could not save setting");
    } finally {
      setSaving(false);
    }
  };

  const reset = () => void persist({ ...DEFAULT_AGE_POLICY }, "Recommended defaults");

  return (
    <div className="space-y-4">
      <div className="rounded-xl border border-destructive/40 bg-destructive/10 p-4 space-y-2">
        <div className="flex items-center gap-2">
          <ShieldAlert className="h-4 w-4 text-destructive" />
          <span className="text-sm font-semibold">{LEGAL_REVIEW_REQUIRED}</span>
        </div>
        <p className="text-xs text-muted-foreground">{CHILD_POLICY_DISCLAIMER}</p>
        <p className="text-xs text-muted-foreground">
          Members of every age are supported. Accounts at or under the consent age stay
          feature-locked until a parent or guardian approves them — these settings tune the cohorts
          and protections, and the database enforces the same values.
        </p>
      </div>

      <div className="rounded-xl border bg-card p-4">
        <div className="text-sm font-semibold">Cohorts</div>
        <p className="mt-0.5 text-xs text-muted-foreground">
          {Object.values(COHORT_META)
            .map((m) => m.short)
            .join(" · ")}
        </p>
        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          {(Object.keys(NUM_META) as NumKey[]).map((key) => {
            const meta = NUM_META[key];
            return (
              <label key={key} className="block">
                <span className="text-xs font-medium">{meta.label}</span>
                <input
                  type="number"
                  min={meta.min}
                  max={meta.max}
                  value={local[key]}
                  disabled={loading || saving}
                  onChange={(e) => setLocal({ ...local, [key]: Number(e.target.value) })}
                  onBlur={() => void persist(local, meta.label)}
                  className="mt-1 w-full rounded-lg border bg-background px-3 py-2 text-sm"
                />
                <span className="text-[11px] text-muted-foreground">{meta.hint}</span>
              </label>
            );
          })}
          <label className="block">
            <span className="text-xs font-medium">Default jurisdiction</span>
            <select
              value={local.jurisdiction}
              disabled={loading || saving}
              onChange={(e) =>
                void persist(
                  { ...local, jurisdiction: e.target.value as Jurisdiction },
                  "Default jurisdiction",
                )
              }
              className="mt-1 w-full rounded-lg border bg-background px-3 py-2 text-sm"
            >
              {JURISDICTIONS.map((j) => (
                <option key={j} value={j}>
                  {j.replace(/_/g, " ")}
                </option>
              ))}
            </select>
            <span className="text-[11px] text-muted-foreground">
              Georgia adds stricter teen protections.
            </span>
          </label>
        </div>
      </div>

      <div className="rounded-xl border bg-card p-4">
        <div className="text-sm font-semibold">Overnight notification curfew (minors)</div>
        <p className="mt-0.5 text-xs text-muted-foreground">
          {LEGAL_REVIEW_REQUIRED} — the default window models NY&rsquo;s SAFE for Kids Act
          (12am&ndash;6am recipient local time), the more protective of the windows we know about;
          Connecticut&rsquo;s is 9pm&ndash;8am. Held pushes are queued and delivered when the window
          ends; the in-app alert always appears immediately.
        </p>
        <div className="mt-3 flex items-center justify-between gap-3">
          <span className="text-sm">Curfew enabled</span>
          <Switch
            checked={local.notificationCurfew !== null}
            disabled={loading || saving}
            aria-label="Overnight notification curfew"
            onCheckedChange={(v) =>
              void persist(
                {
                  ...local,
                  notificationCurfew: v ? { startHour: 0, endHour: 6 } : null,
                },
                "Notification curfew",
              )
            }
          />
        </div>
        {local.notificationCurfew ? (
          <div className="mt-3 grid gap-3 sm:grid-cols-2">
            {(["startHour", "endHour"] as const).map((k) => (
              <label key={k} className="block">
                <span className="text-xs font-medium">
                  {k === "startHour" ? "Quiet hours start (local hour)" : "Quiet hours end"}
                </span>
                <input
                  type="number"
                  min={0}
                  max={23}
                  value={local.notificationCurfew?.[k] ?? 0}
                  disabled={loading || saving}
                  onChange={(e) =>
                    setLocal({
                      ...local,
                      notificationCurfew: {
                        startHour: local.notificationCurfew?.startHour ?? 0,
                        endHour: local.notificationCurfew?.endHour ?? 6,
                        [k]: Number(e.target.value),
                      },
                    })
                  }
                  onBlur={() => void persist(local, "Notification curfew")}
                  className="mt-1 w-full rounded-lg border bg-background px-3 py-2 text-sm"
                />
              </label>
            ))}
          </div>
        ) : null}
      </div>

      <div className="rounded-xl border bg-card divide-y">
        {(Object.keys(BOOL_META) as BoolKey[]).map((key) => {
          const meta = BOOL_META[key];
          return (
            <div key={key} className="flex items-start justify-between gap-3 p-4">
              <div className="min-w-0">
                <div className="text-sm font-medium">{meta.label}</div>
                <p className="mt-0.5 text-xs text-muted-foreground">{meta.description}</p>
              </div>
              <Switch
                checked={local[key]}
                disabled={loading || saving}
                onCheckedChange={(v) => void persist({ ...local, [key]: v }, meta.label)}
                aria-label={meta.label}
              />
            </div>
          );
        })}
      </div>

      <button
        type="button"
        onClick={reset}
        disabled={loading || saving}
        className="rounded-full border px-4 py-2 text-xs font-semibold disabled:opacity-50"
      >
        Restore recommended defaults
      </button>
    </div>
  );
}
