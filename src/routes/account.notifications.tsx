import { createFileRoute, Link } from "@tanstack/react-router";
import { pageHead } from "@/lib/seo";
import { ArrowLeft, Bell, BellOff, Check } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import {
  CATEGORY_META,
  DEFAULT_NOTIF_PREFS,
  getNotifPrefs,
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
      title: "Notification settings — OpenRun",
      description:
      "Choose which OpenRun notifications you get by push, email, and in-app.",
      noindex: true,
    }),
  component: NotificationSettingsPage,
});

const ORDER: NotifCategory[] = ["messages", "approvals", "joinRequests", "follows", "general"];

function NotificationSettingsPage() {
  const [userId, setUserId] = useState<string | null>(null);
  useEffect(() => {
    void supabase.auth.getUser().then(({ data }) => setUserId(data.user?.id ?? null));
  }, []);
  useHydrateNotifPrefs(userId);
  const prefs = useNotifPrefs();
  const [saved, setSaved] = useState(false);

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
    setSaved(true);
    setTimeout(() => setSaved(false), 1500);
  };

  const enableAll = () => {
    (Object.keys(prefs) as NotifCategory[]).forEach((c) => {
      setNotifPref(c, "inApp", true);
      setNotifPref(c, "push", true);
    });
    toast.success("All notifications enabled");
  };
  const muteAll = () => {
    (Object.keys(prefs) as NotifCategory[]).forEach((c) => {
      setNotifPref(c, "inApp", false);
      setNotifPref(c, "push", false);
    });
    toast.success("All notifications muted");
  };
  const reset = () => {
    (Object.keys(DEFAULT_NOTIF_PREFS) as NotifCategory[]).forEach((c) => {
      setNotifPref(c, "inApp", DEFAULT_NOTIF_PREFS[c].inApp);
      setNotifPref(c, "push", DEFAULT_NOTIF_PREFS[c].push);
    });
    toast.success("Defaults restored");
  };

  return (
    <div className="mx-auto max-w-2xl px-4 pb-24 pt-6">
      <div className="flex items-center gap-3 mb-6">
        <Link
          to="/profile/edit"
          className="grid h-10 w-10 place-items-center rounded-full border border-border bg-surface"
        >
          <ArrowLeft className="h-4 w-4" />
        </Link>
        <div className="flex-1">
          <h1 className="font-display text-2xl font-bold">Notifications</h1>
          <p className="text-xs text-muted-foreground">
            Choose what you want to be alerted about, and where.
          </p>
        </div>
        {saved && (
          <span className="inline-flex items-center gap-1 rounded-full bg-lime/15 px-2.5 py-1 text-[11px] font-bold text-lime">
            <Check className="h-3 w-3" /> Saved
          </span>
        )}
      </div>

      <div className="flex gap-2 mb-4">
        <button
          onClick={enableAll}
          className="inline-flex items-center gap-1.5 rounded-full bg-lime px-3 py-1.5 text-xs font-bold text-primary-foreground"
        >
          <Bell className="h-3.5 w-3.5" /> Enable all
        </button>
        <button
          onClick={muteAll}
          className="inline-flex items-center gap-1.5 rounded-full border border-border bg-surface px-3 py-1.5 text-xs font-bold"
        >
          <BellOff className="h-3.5 w-3.5" /> Mute all
        </button>
        <button onClick={reset} className="ml-auto text-xs font-bold text-coral">
          Reset defaults
        </button>
      </div>

      <div className="space-y-3">
        {ORDER.map((cat) => (
          <CategoryCard key={cat} cat={cat} prefs={prefs} onToggle={onToggle} />
        ))}
      </div>

      <p className="mt-6 text-[11px] text-muted-foreground">
        Push alerts are delivered to this device when the app is in the background or closed. In-app
        alerts show on the Alerts tab and as toasts.
      </p>
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
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="font-semibold text-sm">{meta.label}</div>
          <div className="text-xs text-muted-foreground mt-0.5">{meta.description}</div>
        </div>
      </div>
      <div className="mt-3 grid grid-cols-2 gap-2">
        <ToggleBtn label="In-app" on={row.inApp} onChange={(v) => onToggle(cat, "inApp", v)} />
        <ToggleBtn label="Push" on={row.push} onChange={(v) => onToggle(cat, "push", v)} />
      </div>
    </div>
  );
}

function ToggleBtn({
  label,
  on,
  onChange,
}: {
  label: string;
  on: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <button
      onClick={() => onChange(!on)}
      className={`flex items-center justify-between rounded-xl border px-3 py-2.5 text-xs font-semibold transition-colors ${on ? "border-lime bg-lime/10 text-foreground" : "border-border bg-background text-muted-foreground"}`}
    >
      <span>{label}</span>
      <span
        className={`relative h-5 w-9 rounded-full transition-colors ${on ? "bg-lime" : "bg-border"}`}
      >
        <span
          className={`absolute top-0.5 h-4 w-4 rounded-full bg-white shadow transition-all ${on ? "left-[18px]" : "left-0.5"}`}
        />
      </span>
    </button>
  );
}

// Ensure getNotifPrefs is referenced to keep type import happy in some bundlers.
void getNotifPrefs;
