import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { AlertTriangle, RotateCcw } from "lucide-react";
import { Switch } from "@/components/ui/switch";
import { superadminListSettings, superadminSetSetting } from "@/lib/superadmin.functions";
import {
  DEFAULT_MONETIZATION_CONFIG,
  MONETIZATION_AI_TIERS,
  formatPriceCents,
  parseMonetizationOverrides,
  resolveMonetizationConfig,
  type MonetizationAiTier,
  type MonetizationOverrides,
} from "@/lib/monetization/config";

const SETTING_KEY = "monetization";

/**
 * Runtime monetization controls.
 *
 * The master switch turns ballaCity free for everyone. Nothing is deleted when
 * it is on — products, prices, Stripe wiring and the billing webhook all stay
 * live — so flipping it back restores the paid product in one step.
 *
 * Everything here edits the RAW `app_settings.monetization` override blob, not
 * the resolved config. Writing the resolved config back would silently freeze
 * today's built-in defaults as permanent overrides, so a later change to the
 * shipped defaults would never reach anyone. Empty means "use the defaults".
 *
 * The whole row is read-modify-written, because `OpsTab` edits the same row as
 * raw JSON and a Postgres trigger reads `ballacityProcessedPaymentsEnabled`
 * out of it.
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
    (s: { key: string }) => s.key === SETTING_KEY,
  ) as { value: unknown } | undefined;

  const [local, setLocal] = useState<MonetizationOverrides>({});
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!settings.isLoading) setLocal(parseMonetizationOverrides(row?.value));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [settings.isLoading, JSON.stringify(row?.value)]);

  // What the app will actually use once these overrides are applied.
  const effective = resolveMonetizationConfig(local);
  const access = effective.access;
  const freeMode = !access.billingEnabled;
  const busy = settings.isLoading || saving;

  const persist = async (next: MonetizationOverrides, label: string) => {
    const prev = local;
    setLocal(next);
    setSaving(true);
    try {
      await setSetting({
        data: {
          key: SETTING_KEY,
          // Preserve any key this panel does not manage (an OpsTab hand-edit,
          // a future field) rather than replacing the blob wholesale.
          value: { ...(row?.value && typeof row.value === "object" ? row.value : {}), ...next },
          description:
            "Monetization overrides: access switches, plan display prices, trial days, platform/processing fees. Empty means use built-in defaults.",
          isPublic: true,
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

  const setAccess = (patch: Partial<typeof access>, label: string) =>
    void persist({ ...local, access: { ...(local.access ?? {}), ...patch } }, label);

  const setNum = (group: "prices" | "trials", priceId: string, value: number, label: string) => {
    const map = { ...(local[group] ?? {}) };
    if (Number.isFinite(value) && value >= 0) map[priceId] = Math.round(value);
    void persist({ ...local, [group]: map }, label);
  };

  return (
    <div className="space-y-4">
      {/* ---------------- master switch ---------------- */}
      <div
        className={`rounded-xl border p-4 ${
          freeMode ? "border-lime/50 bg-lime/5" : "border-border bg-card"
        }`}
      >
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="text-sm font-semibold">ballaCity is free for everyone</div>
            <p className="mt-0.5 text-xs text-muted-foreground">
              Turns off every paywall, checkout, upgrade prompt and premium lock across the app, and
              grants every member every entitlement. Nothing is deleted: plans, prices, Stripe and
              the billing webhook all stay wired up, so switching this back restores the paid
              product exactly as it was.
            </p>
          </div>
          <Switch
            checked={freeMode}
            disabled={busy}
            aria-label="Make ballaCity free for everyone"
            onCheckedChange={(v) =>
              setAccess({ billingEnabled: !v }, v ? "Free mode" : "Billing enabled")
            }
          />
        </div>
        <p className="mt-2 text-xs text-muted-foreground">
          Currently:{" "}
          <span className={`font-semibold ${freeMode ? "text-lime" : "text-foreground"}`}>
            {freeMode ? "free for everyone — nothing is being sold" : "billing is live"}
          </span>
        </p>
      </div>

      {/* ---------------- what free mode grants ---------------- */}
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
              AI still has daily/monthly caps — a cost ceiling, not a paywall. Tune the numbers
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

      {/* ---------------- per-surface switches ---------------- */}
      <div className="rounded-xl border bg-card p-4">
        <div className="text-sm font-semibold">Paid surfaces</div>
        <p className="mt-0.5 text-xs text-muted-foreground">
          {freeMode
            ? "Held off while ballaCity is free. These are what comes back when billing is switched on."
            : "Individually switchable while billing is live."}
        </p>
        <div className="mt-3 space-y-3">
          {(
            [
              ["subscriptionsEnabled", "Subscriptions", "Sell plans on /plans"],
              ["merchShopEnabled", "Merch shop", "Make /shop reachable and listed in the sitemap"],
              [
                "upgradePromptsEnabled",
                "Upgrade prompts",
                "Show upsell CTAs, past-due banners and paywall copy",
              ],
            ] as const
          ).map(([key, label, hint]) => (
            <div key={key} className="flex items-center justify-between gap-3">
              <div className="min-w-0">
                <div className="text-sm">{label}</div>
                <div className="text-xs text-muted-foreground">{hint}</div>
              </div>
              <Switch
                checked={access[key]}
                disabled={busy || freeMode}
                aria-label={label}
                onCheckedChange={(v) => setAccess({ [key]: v }, label)}
              />
            </div>
          ))}
        </div>
      </div>

      {/* ---------------- prices & trials ---------------- */}
      <div className="rounded-xl border bg-card p-4">
        <div className="text-sm font-semibold">Plan prices &amp; trials</div>
        <p className="mt-0.5 text-xs text-muted-foreground">
          Display prices in cents. These drive what the app shows — the real charge is whatever the
          Stripe price says, so change both together.
        </p>
        <div className="mt-3 space-y-3">
          {effective.products.map((p) => (
            <div key={p.priceId} className="rounded-lg border border-border p-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="text-sm font-medium">
                  {p.name}{" "}
                  <span className="text-xs text-muted-foreground">
                    {p.status === "reserved" ? "· not sold" : `· ${formatPriceCents(p.priceCents)}`}
                  </span>
                </span>
              </div>
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

      {/* ---------------- fees & allowance ---------------- */}
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
              Ignored while free mode is on — reels are unlimited.
            </span>
          </label>
        </div>
      </div>

      {/* ---------------- processed payments ---------------- */}
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
        Reset clears every override, returning to the shipped config (free for everyone,{" "}
        {formatPriceCents(DEFAULT_MONETIZATION_CONFIG.products[0].priceCents)} ballaCity+ once
        billing is back on). Changes reach members within about five minutes, or immediately on a
        hard reload.
      </p>
    </div>
  );
}
