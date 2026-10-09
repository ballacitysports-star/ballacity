import { createFileRoute, Link } from "@tanstack/react-router";
import { BackHeader } from "@/components/layout/BackHeader";
import { pageHead } from "@/lib/seo";
import { Bell, BellOff, Check, Lock } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Switch } from "@/components/ui/switch";
import { supabase } from "@/integrations/supabase/client";
import {
  CATEGORY_META,
  DEFAULT_NOTIF_PREFS,
  NOTIF_CATEGORIES,
  isLockedChannel,
  setNotifPref,
  useHydrateNotifPrefs,
  useNotifPrefs,
  type NotifCategory,
  type NotifChannel,
  type NotifPrefs,
} from "@/lib/notification-prefs";

export const Route = createFileRoute("/account/notifications")({
  head: () =>
    pageHead({
      path: "/account/notifications",
      title: "Notification settings — BallaCity",
      description: "Choose which BallaCity notifications you get in-app and as push alerts.",
      noindex: true,
    }),
  component: NotificationSettingsPage,
});

const SECTIONS: Array<{ title: string; note?: string; categories: NotifCategory[] }> = [
  {
    title: "Games",
    categories: ["gameReminders", "gameUpdates", "nearbyGames"],
  },
  {
    title: "People",
    categories: ["messages", "invitations", "social"],
  },
  {
    title: "Payments",
    note: "BallaCity never moves money for you — these alerts are about payments you or a host mark as sent or confirmed.",
    categories: ["payments"],
  },
  {
    title: "Safety & security",
    categories: ["safety"],
  },
  {
    title: "Other",
    categories: ["general"],
  },
  {
    title: "Marketing",
    note: "Kept completely separate from game, message, payment, and safety alerts.",
    categories: ["marketing"],
  },
];

function NotificationSettingsPage() {
  const [userId, setUserId] = useState<string | null>(null);
  useEffect(() => {
    void supabase.auth.getUser().then(({ data }) => setUserId(data.user?.id ?? null));
  }, []);
  useHydrateNotifPrefs(userId);
  const prefs = useNotifPrefs();
  const [saved, setSaved] = useState(false);

  const flash = () => {
    setSaved(true);
    setTimeout(() => setSaved(false), 1500);
  };

  const onToggle = async (cat: NotifCategory, ch: NotifChannel, val: boolean) => {
    if (ch === "push" && val && typeof window !== "undefined" && "Notification" in window) {
      try {
        if (Notification.permission === "default") {
          const res = await Notification.requestPermission();
          if (res !== "granted") {
            toast.error("Enable notifications in your browser settings to receive push alerts.");
          }
        } else if (Notification.permission === "denied") {
          toast.error("Notifications are blocked. Enable them in your browser settings.");
        }
      } catch {
        /* ignore */
      }
    }
    setNotifPref(cat, ch, val);
    flash();
  };

  const setAll = (value: boolean, skipMarketing: boolean) => {
    NOTIF_CATEGORIES.forEach((c) => {
      if (skipMarketing && c === "marketing") return;
      setNotifPref(c, "inApp", value);
      setNotifPref(c, "push", value);
    });
    flash();
  };

  const enableAll = () => {
    // Marketing is never switched on for you — that would be a dark pattern.
    setAll(true, true);
    toast.success("All product notifications enabled");
  };
  const muteAll = () => {
    setAll(false, false);
    toast.success("Notifications muted, except in-app safety alerts");
  };
  const reset = () => {
    NOTIF_CATEGORIES.forEach((c) => {
      setNotifPref(c, "inApp", DEFAULT_NOTIF_PREFS[c].inApp);
      setNotifPref(c, "push", DEFAULT_NOTIF_PREFS[c].push);
    });
    flash();
    toast.success("Defaults restored");
  };

  return (
    <div className="min-h-dvh bg-background pb-24">
      <BackHeader
        title="Notifications"
        fallbackTo="/settings"
        actions={
          saved ? (
            <span className="mr-1 inline-flex items-center gap-1 rounded-full bg-lime/15 px-2.5 py-1 text-[11px] font-bold text-lime">
              <Check className="h-3 w-3" /> Saved
            </span>
          ) : null
        }
      />

      <main className="page-shell-narrow">
        <p className="pt-4 text-xs text-muted-foreground">
          Every switch below turns notifications <span className="font-semibold">on</span>. In-app
          alerts appear on your Alerts tab; push alerts go to this device even when BallaCity is
          closed. Changes save as soon as you flip a switch.
        </p>

        <div className="mt-4 flex flex-wrap gap-2">
          <button
            onClick={enableAll}
            className="inline-flex items-center gap-1.5 rounded-full bg-lime px-3 py-1.5 text-xs font-bold text-primary-foreground"
          >
            <Bell className="h-3.5 w-3.5" /> Turn on product alerts
          </button>
          <button
            onClick={muteAll}
            className="inline-flex items-center gap-1.5 rounded-full border border-border bg-surface px-3 py-1.5 text-xs font-bold"
          >
            <BellOff className="h-3.5 w-3.5" /> Mute everything else
          </button>
          <button onClick={reset} className="ml-auto text-xs font-bold text-coral">
            Reset defaults
          </button>
        </div>

        <div className="mt-4 space-y-5">
          {SECTIONS.map((section) => (
            <section key={section.title}>
              <h2 className="px-1 pb-2 micro-label text-muted-foreground">
                {section.title}
              </h2>
              <div className="space-y-3">
                {section.categories.map((cat) => (
                  <CategoryCard key={cat} cat={cat} prefs={prefs} onToggle={onToggle} />
                ))}
              </div>
              {section.note && (
                <p className="px-1 pt-2 text-[11px] text-muted-foreground">{section.note}</p>
              )}
            </section>
          ))}
        </div>
      </main>
    </div>
  );
}

function CategoryCard({
  cat,
  prefs,
  onToggle,
}: {
  cat: NotifCategory;
  prefs: NotifPrefs;
  onToggle: (cat: NotifCategory, ch: NotifChannel, val: boolean) => void;
}) {
  const meta = CATEGORY_META[cat];
  const row = prefs[cat];
  return (
    <div className="rounded-2xl border border-border bg-surface p-4">
      <div className="min-w-0">
        <div className="text-sm font-semibold">{meta.label}</div>
        <div className="mt-0.5 text-xs text-muted-foreground">{meta.description}</div>
      </div>
      <div className="mt-3 space-y-2">
        <ChannelRow
          label="In-app alerts"
          checked={row.inApp}
          locked={isLockedChannel(cat, "inApp")}
          ariaLabel={`${meta.label} in-app`}
          onChange={(v) => onToggle(cat, "inApp", v)}
        />
        <ChannelRow
          label="Push alerts"
          checked={row.push}
          locked={isLockedChannel(cat, "push")}
          ariaLabel={`${meta.label} push`}
          onChange={(v) => onToggle(cat, "push", v)}
        />
      </div>
      {meta.lockedNote && (
        <p className="mt-3 flex items-start gap-1.5 rounded-xl bg-background/60 p-2.5 text-[11px] text-muted-foreground">
          <Lock className="mt-0.5 h-3 w-3 shrink-0" aria-hidden />
          {meta.lockedNote}
        </p>
      )}
    </div>
  );
}

function ChannelRow({
  label,
  checked,
  locked,
  ariaLabel,
  onChange,
}: {
  label: string;
  checked: boolean;
  locked?: boolean;
  ariaLabel: string;
  onChange: (v: boolean) => void;
}) {
  return (
    <div className="flex min-h-11 items-center justify-between gap-3 rounded-xl bg-background px-3 py-2">
      <span className="text-xs font-semibold">
        {label}
        {locked && (
          <span className="ml-1.5 text-[11px] font-normal text-muted-foreground">Always on</span>
        )}
      </span>
      <Switch
        checked={checked}
        disabled={locked}
        onCheckedChange={onChange}
        aria-label={ariaLabel}
      />
    </div>
  );
}
