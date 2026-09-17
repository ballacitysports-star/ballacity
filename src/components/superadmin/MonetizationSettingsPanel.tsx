import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { AlertTriangle, Lock, RotateCcw, ShieldCheck } from "lucide-react";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { ConfirmAction } from "@/components/superadmin/ConfirmAction";
import { superadminListSettings, superadminSetSetting } from "@/lib/superadmin.functions";
import {
  DEFAULT_MONETIZATION_CONFIG,
  FEATURE_ACCESS_MODES,
  MONETIZATION_AI_TIERS,
  formatPriceCents,
  parseMonetizationOverrides,
  resolveMonetizationConfig,
  type FeatureAccessMode,
  type MonetizationAiTier,
  type MonetizationOverrides,
} from "@/lib/monetization/config";
import { FEATURE_REGISTRY, isConfigurable } from "@/lib/monetization/features";

export const MONETIZATION_SETTING_KEY = "monetization";

/**
 * Monetization & Feature Access.
 *
 * Free Mode is the master switch: while it is on, ballaCity is free for
 * everyone and every feature priced as Premium is served as Free. Nothing is
 * deleted — products, prices, Stripe wiring and the billing webhook all stay
 * live — so the paid product can be brought back without a rebuild.
 *
 * Free Mode governs PAYMENT only. Age, guardian, consent, moderation and
 * suspension restrictions are evaluated first and are never affected by
 * anything on this screen.
 *
 * Everything here edits the RAW `app_settings.monetization` override blob, not
 * the resolved config. Writing the resolved config back would freeze today's
 * built-in defaults as permanent overrides, so a later change to the shipped
 * defaults would never reach anyone. Empty means "use the defaults".
 */
export function MonetizationSettingsPanel() {
  const qc = useQueryClient();
  const loadSettings = useServerFn(superadminListSettings);
  const setSetting = useServerFn(superadminSetSetting);

  const settings = useQuery({
    queryKey: ["superadmin-settings"],
    queryFn: () => loadSettings({}),
  });

  const row = (settings.data?.settings ?? []).find(
    (s: { key: string }) => s.key === MONETIZATION_SETTING_KEY,
  ) as { value: unknown } | undefined;

  const [local, setLocal] = useState<MonetizationOverrides>({});
  const [saving, setSaving] = useState(false);
  const [confirmMonetize, setConfirmMonetize] = useState(false);

  useEffect(() => {
    if (!settings.isLoading) setLocal(parseMonetizationOverrides(row?.value));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [settings.isLoading, JSON.stringify(row?.value)]);

  const effective = resolveMonetizationConfig(local);
  const access = effective.access;
  const freeMode = access.platformFreeMode;
  const busy = settings.isLoading || saving;

  const premiumFeatures = FEATURE_REGISTRY.filter(
    (f) => isConfigurable(f) && (access.featureAccess?.[f.key] ?? "free") === "premium",
  );

  const persist = async (next: MonetizationOverrides, label: string, reason?: string) => {
    const prev = local;
    setLocal(next);
    setSaving(true);
    try {
      await setSetting({
        data: {
          key: MONETIZATION_SETTING_KEY,
          // Preserve any key this panel does not manage rather than replacing
          // the blob wholesale — OpsTab can hand-edit the same row.
          value: { ...(row?.value && typeof row.value === "object" ? row.value : {}), ...next },
          description:
            "Monetization: free mode, global controls, per-feature access, prices, trials and fees. Empty means use built-in defaults.",
          isPublic: true,
          ...(reason ? { reason } : {}),
        },
      });
      toast.success(`${label} saved`);
      void qc.invalidateQueries({ queryKey: ["superadmin-settings"] });
      void qc.invalidateQueries({ queryKey: ["monetization-config"] });
    } catch (e) {
      setLocal(prev);
      toast.error(e instanceof Error ? e.message : "Could not save setting");
    } finally {
      setSaving(false);
    }
  };

  const setAccess = (patch: Partial<typeof access>, label: string, reason?: string) =>
    void persist({ ...local, access: { ...(local.access ?? {}), ...patch } }, label, reason);

  const setFeatureMode = (key: string, mode: FeatureAccessMode, label: string) =>
    void persist(
      {
        ...local,
        access: {
          ...(local.access ?? {}),
          featureAccess: { ...(access.featureAccess ?? {}), [key]: mode },
        },
      },
      label,
    );

  const setNum = (group: "prices" | "trials", priceId: string, value: number, label: string) => {
    const map = { ...(local[group] ?? {}) };
    if (Number.isFinite(value) && value >= 0) map[priceId] = Math.round(value);
    void persist({ ...local, [group]: map }, label);
  };

  const GLOBAL_CONTROLS = [
    ["subscriptionsEnabled", "Subscriptions", "Sell plans on /plans"],
    ["paymentsEnabled", "Payments", "Payment infrastructure is live"],
    [
      "premiumFeaturesEnabled",
      "Premium features",
      "Enforce the per-feature Premium settings below",
    ],
    ["checkoutEnabled", "Checkout", "Allow checkout sessions to be created"],
    ["merchShopEnabled", "Merch shop", "Make /shop reachable and listed in the sitemap"],
    [
      "upgradePromptsEnabled",
      "Upgrade prompts",
      "Show upsell CTAs, past-due banners and paywall copy",
    ],
  ] as const;

  return (
    <div className="space-y-4">
      {/* ------------------------------ status ------------------------------ */}
      <div
        className={`rounded-xl border p-4 ${
          freeMode ? "border-lime/50 bg-lime/5" : "border-amber-400/50 bg-amber-50/5"
        }`}
      >
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="text-sm font-semibold">Monetization status</div>
            <p className="mt-0.5 text-xs text-muted-foreground">
              {freeMode
                ? "ballaCity is free for everyone. Every feature priced as Premium is being served as Free."
                : "Free mode is off. Each surface below decides what is actually enforced."}
            </p>
          </div>
          <Badge variant={freeMode ? "secondary" : "destructive"}>
            {freeMode ? "FREE" : "MONETIZING"}
          </Badge>
        </div>

        <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-1 text-xs sm:grid-cols-3">
          <StatusLine label="Platform Free Mode" on={freeMode} />
          {GLOBAL_CONTROLS.map(([key, label]) => (
            <StatusLine key={key} label={label} on={access[key]} muted={freeMode} />
          ))}
        </dl>
      </div>

      {/* --------------------------- master switch -------------------------- */}
      <div className="rounded-xl border bg-card p-4">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="text-sm font-semibold">Platform Free Mode</div>
            <p className="mt-0.5 text-xs text-muted-foreground">
              Turns off every paywall, checkout, upgrade prompt and premium lock, and grants every
              member every entitlement. Nothing is deleted — plans, prices, Stripe and the billing
              webhook all stay wired up.
            </p>
            <p className="mt-1.5 flex items-start gap-1.5 text-xs text-muted-foreground">
              <ShieldCheck className="mt-0.5 h-3.5 w-3.5 shrink-0 text-lime" />
              Payment only. Age, guardian, consent, moderation and suspension rules are checked
              first and are never affected by anything on this screen.
            </p>
          </div>
          <Switch
            checked={freeMode}
            disabled={busy}
            aria-label="Platform Free Mode"
            onCheckedChange={(v) => {
              // Only the direction that can start charging asks for confirmation;
              // switching free mode ON only ever grants access.
              if (v) setAccess({ platformFreeMode: true }, "Free mode");
              else setConfirmMonetize(true);
            }}
          />
        </div>
      </div>

      {/* --------------------------- global controls ------------------------ */}
      <div className="rounded-xl border bg-card p-4">
        <div className="text-sm font-semibold">Global controls</div>
        <p className="mt-0.5 text-xs text-muted-foreground">
          {freeMode
            ? "Overridden while Free Mode is on. Set them up here, then switch Free Mode off when you are ready."
            : "Each surface is enabled independently."}
        </p>
        <div className="mt-3 space-y-3">
          {GLOBAL_CONTROLS.map(([key, label, hint]) => (
            <div key={key} className="flex items-center justify-between gap-3">
              <div className="min-w-0">
                <div className="text-sm">{label}</div>
                <div className="text-xs text-muted-foreground">{hint}</div>
              </div>
              <Switch
                checked={access[key]}
                disabled={busy}
                aria-label={label}
                onCheckedChange={(v) => setAccess({ [key]: v }, label)}
              />
            </div>
          ))}
        </div>
      </div>

      {/* --------------------------- feature access ------------------------- */}
      <div className="rounded-xl border bg-card p-4">
        <div className="text-sm font-semibold">Feature access</div>
        <p className="mt-0.5 text-xs text-muted-foreground">
          Every feature here is real and wired up. Features the plans advertise but that were never
          built are deliberately absent — see docs/monetization-free-mode.md.
        </p>
        <div className="mt-3 space-y-2">
          {FEATURE_REGISTRY.map((f) => {
            const mode: FeatureAccessMode = access.featureAccess?.[f.key] ?? "free";
            const locked = !isConfigurable(f);
            return (
              <div
                key={f.key}
                className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-border p-3"
              >
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-1.5 text-sm font-medium">
                    {locked ? <Lock className="h-3.5 w-3.5 text-muted-foreground" /> : null}
                    {f.label}
                    {f.tier === "safety" ? (
                      <Badge variant="outline" className="text-[10px]">
                        safety
                      </Badge>
                    ) : null}
                  </div>
                  <div className="text-xs text-muted-foreground">{f.description}</div>
                  {locked ? (
                    <div className="mt-0.5 text-[11px] text-muted-foreground">
                      {f.tier === "safety"
                        ? "Safety scanning is never priced or switched off."
                        : "Free forever — this capability is not priceable."}
                    </div>
                  ) : mode === "premium" && freeMode ? (
                    <div className="mt-0.5 text-[11px] text-lime">
                      Overridden by Free Mode — served as Free today.
                    </div>
                  ) : null}
                </div>
                {locked ? (
                  <Badge variant="secondary">Free</Badge>
                ) : (
                  <select
                    value={mode}
                    disabled={busy}
                    aria-label={`${f.label} access`}
                    onChange={(e) =>
                      setFeatureMode(f.key, e.target.value as FeatureAccessMode, f.label)
                    }
                    className="rounded-lg border bg-background px-3 py-1.5 text-sm capitalize"
                  >
                    {FEATURE_ACCESS_MODES.map((m) => (
                      <option key={m} value={m}>
                        {m}
                      </option>
                    ))}
                  </select>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* ----------------------------- while free --------------------------- */}
      <div className="rounded-xl border bg-card p-4">
        <div className="text-sm font-semibold">While free</div>
        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          <label className="block">
            <span className="text-xs font-medium">AI limit tier for everyone</span>
            <select
              value={access.freeModeAiTier}
              disabled={busy}
              onChange={(e) =>
                setAccess({ freeModeAiTier: e.target.value as MonetizationAiTier }, "AI tier")
              }
              className="mt-1 w-full rounded-lg border bg-background px-3 py-2 text-sm"
            >
              {MONETIZATION_AI_TIERS.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </select>
            <span className="text-[11px] text-muted-foreground">
              AI still has daily and monthly caps — a cost ceiling, not a paywall. Tune the numbers
              under the <code>ai_limits</code> setting.
            </span>
          </label>
          <label className="block">
            <span className="text-xs font-medium">Notice shown in place of paywalls</span>
            <input
              type="text"
              maxLength={300}
              value={access.freeModeNotice}
              disabled={busy}
              onChange={(e) =>
                setLocal({
                  ...local,
                  access: { ...(local.access ?? {}), freeModeNotice: e.target.value },
                })
              }
              onBlur={() => void persist(local, "Free-mode notice")}
              className="mt-1 w-full rounded-lg border bg-background px-3 py-2 text-sm"
            />
          </label>
        </div>
      </div>

      {/* ------------------------- prices & trials -------------------------- */}
      <div className="rounded-xl border bg-card p-4">
        <div className="text-sm font-semibold">Plan prices &amp; trials</div>
        <p className="mt-0.5 text-xs text-muted-foreground">
          Display prices in cents. The real charge is whatever the Stripe price says, so change both
          together.
        </p>
        <div className="mt-3 space-y-3">
          {effective.products.map((p) => (
            <div key={p.priceId} className="rounded-lg border border-border p-3">
              <span className="text-sm font-medium">
                {p.name}{" "}
                <span className="text-xs text-muted-foreground">
                  {p.status === "reserved" ? "· not sold" : `· ${formatPriceCents(p.priceCents)}`}
                </span>
              </span>
              <div className="mt-2 grid gap-2 sm:grid-cols-2">
                <label className="block">
                  <span className="text-[11px] text-muted-foreground">Price (cents)</span>
                  <input
                    type="number"
                    min={0}
                    defaultValue={p.priceCents}
                    disabled={busy}
                    onBlur={(e) =>
                      setNum("prices", p.priceId, Number(e.target.value), `${p.name} price`)
                    }
                    className="mt-1 w-full rounded-lg border bg-background px-3 py-2 text-sm"
                  />
                </label>
                <label className="block">
                  <span className="text-[11px] text-muted-foreground">Trial (days)</span>
                  <input
                    type="number"
                    min={0}
                    defaultValue={p.trialDays}
                    disabled={busy}
                    onBlur={(e) =>
                      setNum("trials", p.priceId, Number(e.target.value), `${p.name} trial`)
                    }
                    className="mt-1 w-full rounded-lg border bg-background px-3 py-2 text-sm"
                  />
                </label>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* ------------------------ fees & allowances ------------------------- */}
      <div className="rounded-xl border bg-card p-4">
        <div className="text-sm font-semibold">Fees &amp; allowances</div>
        <p className="mt-0.5 text-xs text-muted-foreground">
          Fees apply only to payments ballaCity processes itself. Host-to-player game fees always
          carry a zero platform fee and are unaffected by anything here.
        </p>
        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          {(
            [
              ["platformFeeBps", "Platform fee (bps)"],
              ["processingFeeBps", "Processing fee (bps)"],
              ["processingFeeFixedCents", "Processing fixed (cents)"],
              ["minPlatformFeeCents", "Min platform fee (cents)"],
              ["maxPlatformFeeCents", "Max platform fee (cents)"],
            ] as const
          ).map(([key, label]) => (
            <label key={key} className="block">
              <span className="text-xs font-medium">{label}</span>
              <input
                type="number"
                min={0}
                defaultValue={effective.fees[key]}
                disabled={busy}
                onBlur={(e) => {
                  const v = Number(e.target.value);
                  if (!Number.isFinite(v) || v < 0) return;
                  void persist(
                    { ...local, fees: { ...(local.fees ?? {}), [key]: Math.round(v) } },
                    label,
                  );
                }}
                className="mt-1 w-full rounded-lg border bg-background px-3 py-2 text-sm"
              />
            </label>
          ))}
          <label className="block">
            <span className="text-xs font-medium">Free AI reels (before ballaCity+)</span>
            <input
              type="number"
              min={0}
              defaultValue={effective.freeReelAllowance}
              disabled={busy}
              onBlur={(e) => {
                const v = Number(e.target.value);
                if (!Number.isFinite(v) || v < 0) return;
                void persist({ ...local, freeReelAllowance: Math.round(v) }, "Free reel allowance");
              }}
              className="mt-1 w-full rounded-lg border bg-background px-3 py-2 text-sm"
            />
            <span className="text-[11px] text-muted-foreground">
              Ignored while Free Mode is on. Note the allowance is display-only today —{" "}
              <code>used_free</code> is never written, so it stops nobody.
            </span>
          </label>
        </div>
      </div>

      {/* ------------------------ processed payments ------------------------ */}
      <div className="rounded-xl border border-amber-400/40 bg-amber-50/5 p-4">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex items-center gap-2 text-sm font-semibold">
              <AlertTriangle className="h-4 w-4 text-amber-400" />
              ballaCity-processed game payments
            </div>
            <p className="mt-0.5 text-xs text-muted-foreground">
              Only switch this on once a processor is genuinely wired up — never present a payment
              path that does not exist. A database trigger reads this exact flag and rejects any
              game set to <code>ballacity_processed</code> while it is off.
            </p>
          </div>
          <Switch
            checked={effective.ballacityProcessedPaymentsEnabled}
            disabled={busy}
            aria-label="ballaCity-processed game payments"
            onCheckedChange={(v) =>
              void persist({ ...local, ballacityProcessedPaymentsEnabled: v }, "Processed payments")
            }
          />
        </div>
      </div>

      <button
        onClick={() => void persist({}, "Built-in defaults")}
        disabled={busy}
        className="inline-flex items-center gap-2 rounded-lg border border-border px-3 py-2 text-xs font-semibold hover:border-lime/40 disabled:opacity-50"
      >
        <RotateCcw className="h-3.5 w-3.5" />
        Reset all to built-in defaults
      </button>
      <p className="text-[11px] text-muted-foreground">
        Reset clears every override, returning to the shipped config: free for everyone, every paid
        surface off. Changes reach members within about five minutes, or immediately on a hard
        reload.
      </p>

      <ConfirmAction
        open={confirmMonetize}
        onOpenChange={setConfirmMonetize}
        title="Turn off Free Mode"
        description={
          "Enabling monetization may introduce subscription requirements for features configured as Premium." +
          (premiumFeatures.length
            ? ` Currently set to Premium: ${premiumFeatures.map((f) => f.label).join(", ")}.`
            : " No feature is currently set to Premium, so nothing becomes paid until you change one.")
        }
        confirmWord="MONETIZE"
        confirmLabel="Turn off Free Mode"
        pending={saving}
        onConfirm={(reason) => {
          setConfirmMonetize(false);
          setAccess({ platformFreeMode: false }, "Free mode off", reason);
        }}
      />
    </div>
  );
}

function StatusLine({ label, on, muted }: { label: string; on: boolean; muted?: boolean }) {
  return (
    <div className="flex items-center justify-between gap-2">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className={`font-semibold ${muted ? "text-muted-foreground" : on ? "text-lime" : ""}`}>
        {on ? "ON" : "OFF"}
      </dd>
    </div>
  );
}
