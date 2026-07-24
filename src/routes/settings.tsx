import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery, useQueryClient, useMutation } from "@tanstack/react-query";
import {
  ArrowLeft,
  Bell,
  Building2,
  ChevronRight,
  CreditCard,
  IdCard,
  LogOut,
  Lock,
  Monitor,
  Moon,
  Pencil,
  Shield,
  Sun,
  Trash2,
  UserCog,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Switch } from "@/components/ui/switch";
import { useTheme } from "@/lib/theme";
import { listMyOrgs, deleteTrainerOrg } from "@/lib/trainer-orgs.functions";
import { deleteMyAccount } from "@/lib/account.functions";
import { useServerFn } from "@tanstack/react-start";
import { useAuth } from "@/hooks/use-auth";
import { useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { Input } from "@/components/ui/input";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";

export const Route = createFileRoute("/settings")({
  component: SettingsHubPage,
  head: () => ({
    meta: [
      { title: "Settings" },
      {
        name: "description",
        content: "Manage your account, notifications, and security settings.",
      },
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
      {
        to: "/profile/edit",
        label: "Edit profile",
        description: "Name, photo, bio, and links",
        icon: UserCog,
      },
      {
        to: "/_tabs/profile",
        label: "My card",
        description: "View your public player card",
        icon: IdCard,
      },
    ],
  },
  {
    title: "Preferences",
    items: [
      {
        to: "/account/notifications",
        label: "Notifications",
        description: "Messages, approvals, join requests",
        icon: Bell,
      },
    ],
  },
  {
    title: "Security",
    items: [
      {
        to: "/account/security",
        label: "Password & sign-in",
        description: "Set or change your password",
        icon: Lock,
      },
      {
        to: "/reset-password",
        label: "Reset password",
        description: "Send a reset link to your email",
        icon: Shield,
      },
    ],
  },
  {
    title: "Billing",
    items: [
      {
        to: "/plans",
        label: "Subscription",
        description: "Plans and billing details",
        icon: CreditCard,
      },
    ],
  },
];

function SettingsHubPage() {
  const [theme, setTheme, , resolved] = useTheme();

  const handleSignOut = async () => {
    try {
      await supabase.auth.signOut();
      toast.success("Signed out");
      window.location.href = "/auth";
    } catch {
      toast.error("Couldn't sign out");
    }
  };

  const themeOptions: Array<{ value: "light" | "dark" | "system"; label: string; Icon: typeof Sun }> = [
    { value: "light", label: "Light", Icon: Sun },
    { value: "dark", label: "Dark", Icon: Moon },
    { value: "system", label: "System", Icon: Monitor },
  ];

  return (
    <div className="min-h-screen bg-background pb-24">
      <header className="sticky top-0 z-10 flex items-center gap-3 border-b bg-background/95 px-4 py-3 backdrop-blur">
        <Link to="/profile" className="rounded-md p-2 hover:bg-muted" aria-label="Back">
          <ArrowLeft className="h-5 w-5" />
        </Link>
        <h1 className="text-lg font-semibold">Settings</h1>
      </header>

      <main className="mx-auto max-w-xl px-4 py-4 space-y-6">
        <section>
          <h2 className="px-1 pb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Appearance
          </h2>
          <div className="rounded-xl border bg-card p-3 space-y-3">
            <div className="grid grid-cols-3 gap-2" role="radiogroup" aria-label="Theme">
              {themeOptions.map(({ value, label, Icon }) => {
                const active = theme === value;
                return (
                  <button
                    key={value}
                    type="button"
                    role="radio"
                    aria-checked={active}
                    onClick={() => setTheme(value)}
                    className={`flex flex-col items-center gap-1.5 rounded-lg border px-2 py-3 text-xs font-medium transition ${
                      active
                        ? "border-primary bg-primary/10 text-foreground"
                        : "border-border bg-muted/40 text-muted-foreground hover:text-foreground hover:bg-muted"
                    }`}
                  >
                    <Icon className="h-4 w-4" />
                    {label}
                  </button>
                );
              })}
            </div>
            <p className="px-1 text-xs text-muted-foreground">
              {theme === "system"
                ? `Following your device (currently ${resolved})`
                : `Using ${theme} theme`}
            </p>
          </div>
        </section>

        <MyOrgsSection />

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

        <section className="space-y-2">
          <button
            type="button"
            onClick={handleSignOut}
            className="flex w-full items-center justify-center gap-2 rounded-xl border bg-card px-4 py-3 text-sm font-medium text-destructive hover:bg-muted/50 active:bg-muted"
          >
            <LogOut className="h-4 w-4" />
            Sign out
          </button>
          <DeleteAccountButton />
        </section>

      </main>
    </div>
  );
}

function MyOrgsSection() {
  const qc = useQueryClient();
  const { user } = useAuth();
  const { data: orgs } = useQuery({
    queryKey: ["my-orgs", user?.id ?? "anon"],
    queryFn: () => listMyOrgs(),
    enabled: !!user,
  });

  const del = useMutation({
    mutationFn: (id: string) => deleteTrainerOrg({ data: { id } }),
    onSuccess: () => {
      toast.success("Organization deleted");
      qc.invalidateQueries({ queryKey: ["my-orgs"] });
      qc.invalidateQueries({ queryKey: ["trainer-org-memberships"] });
      qc.invalidateQueries({ queryKey: ["trainer-org"] });
      qc.invalidateQueries({ queryKey: ["orgs-index"] });
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Failed to delete"),
  });

  if (!orgs || orgs.length === 0) return null;

  return (
    <section>
      <h2 className="px-1 pb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        My organizations
      </h2>
      <ul className="overflow-hidden rounded-xl border bg-card divide-y">
        {orgs.map((o) => (
          <li key={o.id} className="flex items-center gap-3 px-4 py-3">
            <span className="grid h-9 w-9 shrink-0 place-items-center overflow-hidden rounded-lg bg-muted">
              {o.avatar ? (
                <img src={o.avatar} alt="" className="h-full w-full object-cover" />
              ) : (
                <Building2 className="h-4 w-4" />
              )}
            </span>
            <span className="min-w-0 flex-1">
              <span className="block truncate text-sm font-medium">{o.name}</span>
              <span className="block truncate text-xs text-muted-foreground">@{o.handle}</span>
            </span>
            <Link
              to="/orgs/$orgId/edit"
              params={{ orgId: o.id }}
              aria-label={`Edit ${o.name}`}
              className="rounded-md p-2 text-muted-foreground hover:bg-muted hover:text-foreground"
            >
              <Pencil className="h-4 w-4" />
            </Link>
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <button
                  type="button"
                  aria-label={`Delete ${o.name}`}
                  className="rounded-md p-2 text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>Delete {o.name}?</AlertDialogTitle>
                  <AlertDialogDescription>
                    This permanently removes the organization and its memberships. This action
                    cannot be undone.
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>Cancel</AlertDialogCancel>
                  <AlertDialogAction
                    disabled={del.isPending}
                    onClick={() => del.mutate(o.id)}
                    className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                  >
                    {del.isPending ? "Deleting…" : "Delete"}
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          </li>
        ))}
      </ul>
    </section>
  );
}

function DeleteAccountButton() {
  const navigate = useNavigate();
  const del = useServerFn(deleteMyAccount);
  const [open, setOpen] = useState(false);
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);

  const onDelete = async () => {
    setBusy(true);
    try {
      await del();
      await supabase.auth.signOut();
      toast.success("Your account has been deleted.");
      navigate({ to: "/" });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to delete account");
      setBusy(false);
    }
  };

  return (
    <AlertDialog open={open} onOpenChange={(v) => { setOpen(v); if (!v) setConfirm(""); }}>
      <AlertDialogTrigger asChild>
        <button
          type="button"
          className="flex w-full items-center justify-center gap-2 rounded-xl border border-destructive/40 bg-card px-4 py-3 text-sm font-medium text-destructive hover:bg-destructive/10"
        >
          <Trash2 className="h-4 w-4" />
          Delete account
        </button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Delete your account?</AlertDialogTitle>
          <AlertDialogDescription>
            This permanently deletes your account and all associated data — profile, teams,
            trainer/gym pages, games, messages, and follows. This action cannot be undone.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <div className="space-y-2">
          <label className="text-xs text-muted-foreground">
            Type <span className="font-semibold text-foreground">DELETE</span> to confirm
          </label>
          <Input
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
            placeholder="DELETE"
            autoComplete="off"
          />
        </div>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={busy}>Cancel</AlertDialogCancel>
          <AlertDialogAction
            disabled={busy || confirm !== "DELETE"}
            onClick={(e) => { e.preventDefault(); onDelete(); }}
            className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
          >
            {busy ? "Deleting…" : "Delete account"}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

