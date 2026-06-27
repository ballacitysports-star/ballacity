import { createFileRoute, Link } from "@tanstack/react-router";
import {
  ArrowLeft,
  Bell,
  ChevronRight,
  CreditCard,
  IdCard,
  LogOut,
  Lock,
  Moon,
  Shield,
  Sun,
  UserCog,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Switch } from "@/components/ui/switch";
import { useTheme } from "@/lib/theme";

export const Route = createFileRoute("/settings")({
  component: SettingsHubPage,
  head: () => ({
    meta: [
      { title: "Settings" },
      { name: "description", content: "Manage your account, notifications, and security settings." },
    ],
  }),
});

type Item = {
  to: string;
  label: string;
  description: string;
  icon: LucideIcon;
};

type Section = {
  title: string;
  items: Item[];
};

const SECTIONS: Section[] = [
  {
    title: "Account",
    items: [
      { to: "/profile/edit", label: "Edit profile", description: "Name, photo, bio, and links", icon: UserCog },
      { to: "/_tabs/profile", label: "My card", description: "View your public player card", icon: IdCard },
    ],
  },
  {
    title: "Preferences",
    items: [
      { to: "/account/notifications", label: "Notifications", description: "Messages, approvals, join requests", icon: Bell },
    ],
  },
  {
    title: "Security",
    items: [
      { to: "/account/security", label: "Password & sign-in", description: "Set or change your password", icon: Lock },
      { to: "/reset-password", label: "Reset password", description: "Send a reset link to your email", icon: Shield },
    ],
  },
  {
    title: "Billing",
    items: [
      { to: "/plans", label: "Subscription", description: "Plans and billing details", icon: CreditCard },
    ],
  },
];

function SettingsHubPage() {
  const [theme, setTheme] = useTheme();
  const isDark = theme === "dark";

  const handleSignOut = async () => {
    try {
      await supabase.auth.signOut();
      toast.success("Signed out");
      window.location.href = "/auth";
    } catch {
      toast.error("Couldn't sign out");
    }
  };


  return (
    <div className="min-h-screen bg-background pb-24">
      <header className="sticky top-0 z-10 flex items-center gap-3 border-b bg-background/95 px-4 py-3 backdrop-blur">
        <Link to="/_tabs/profile" className="rounded-md p-2 hover:bg-muted" aria-label="Back">
          <ArrowLeft className="h-5 w-5" />
        </Link>
        <h1 className="text-lg font-semibold">Settings</h1>
      </header>

      <main className="mx-auto max-w-xl px-4 py-4 space-y-6">
        <section>
          <h2 className="px-1 pb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Appearance
          </h2>
          <div className="flex items-center gap-3 rounded-xl border bg-card px-4 py-3">
            <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-muted">
              {isDark ? <Moon className="h-4 w-4" /> : <Sun className="h-4 w-4" />}
            </span>
            <span className="min-w-0 flex-1">
              <span className="block truncate text-sm font-medium">Dark mode</span>
              <span className="block truncate text-xs text-muted-foreground">
                {isDark ? "Using dark theme" : "Using light theme"}
              </span>
            </span>
            <Switch
              checked={isDark}
              onCheckedChange={(checked) => setTheme(checked ? "dark" : "light")}
              aria-label="Toggle dark mode"
            />
          </div>
        </section>

        {SECTIONS.map((section) => (
          <section key={section.title}>
            <h2 className="px-1 pb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              {section.title}
            </h2>
            <ul className="overflow-hidden rounded-xl border bg-card divide-y">
              {section.items.map((item) => {
                const Icon = item.icon;
                return (
                  <li key={item.to}>
                    <Link
                      to={item.to}
                      className="flex items-center gap-3 px-4 py-3 hover:bg-muted/50 active:bg-muted"
                    >
                      <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-muted">
                        <Icon className="h-4 w-4" />
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-medium">{item.label}</span>
                        <span className="block truncate text-xs text-muted-foreground">
                          {item.description}
                        </span>
                      </span>
                      <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
                    </Link>
                  </li>
                );
              })}
            </ul>
          </section>
        ))}

        <section>
          <button
            type="button"
            onClick={handleSignOut}
            className="flex w-full items-center justify-center gap-2 rounded-xl border bg-card px-4 py-3 text-sm font-medium text-destructive hover:bg-muted/50 active:bg-muted"
          >
            <LogOut className="h-4 w-4" />
            Sign out
          </button>
        </section>
      </main>
    </div>
  );
}
