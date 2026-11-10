import { useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { Trash2 } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { signOut, useAuth } from "@/hooks/use-auth";
import { deleteMyAccount } from "@/lib/account.functions";
import { isManagedUser } from "@/lib/managed-children";
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

/**
 * Permanently delete the signed-in account, after typing DELETE. Shown on Settings and on
 * Account privacy. Lives outside the routes so the router can still split the Settings
 * page into its own chunk: a route file that exports anything besides `Route` stays in
 * the entry bundle every page downloads.
 */
export function DeleteAccountButton() {
  const navigate = useNavigate();
  const del = useServerFn(deleteMyAccount);
  const { user } = useAuth();
  const [open, setOpen] = useState(false);
  const [confirm, setConfirm] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);

  // A managed child's profile is deleted by their guardian from the Parent
  // Center (the server refuses it from here too). Covers every place this
  // button is rendered.
  if (isManagedUser(user)) return null;

  const primaryProvider = (user?.app_metadata as { provider?: string } | undefined)?.provider;
  const hasPassword = primaryProvider
    ? primaryProvider === "email"
    : !!user?.identities?.some((i) => i.provider === "email");
  const email = user?.email ?? "";
  const confirmOk = confirm.trim().toUpperCase() === "DELETE";
  const passwordOk = !hasPassword || !!password;
  const canDelete = confirmOk && passwordOk && !busy;
  const blockerHint = !confirmOk
    ? 'Type "DELETE" to confirm'
    : !passwordOk
      ? "Enter your password to confirm"
      : "";

  const onDelete = async () => {
    setBusy(true);
    try {
      if (hasPassword) {
        if (!password) throw new Error("Please enter your password to confirm.");
        const { error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) throw new Error("Incorrect password. Please try again.");
      }
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
    <AlertDialog
      open={open}
      onOpenChange={(v) => {
        setOpen(v);
        if (!v) {
          setConfirm("");
          setPassword("");
        }
      }}
    >
      <AlertDialogTrigger asChild>
        <button
          type="button"
          className="flex w-full items-center gap-4 px-4 py-3.5 text-left transition-colors hover:bg-surface active:bg-surface-2"
        >
          <Trash2 className="h-5 w-5 shrink-0 text-destructive" aria-hidden />
          <span className="flex-1 text-sm text-destructive">Delete account</span>
        </button>
      </AlertDialogTrigger>

      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Delete your account?</AlertDialogTitle>
          <AlertDialogDescription>
            This action is permanent and cannot be undone. The following data will be permanently
            removed:
          </AlertDialogDescription>
        </AlertDialogHeader>
        <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-3">
          <ul className="space-y-1.5 text-sm text-foreground">
            <li className="flex gap-2">
              <span aria-hidden>•</span>
              <span>Your profile, avatar, cover photo, and bio</span>
            </li>
            <li className="flex gap-2">
              <span aria-hidden>•</span>
              <span>Teams, trainer profiles, and gym pages you own</span>
            </li>
            <li className="flex gap-2">
              <span aria-hidden>•</span>
              <span>Games you've hosted and your participation history</span>
            </li>
            <li className="flex gap-2">
              <span aria-hidden>•</span>
              <span>Messages, comments, posts, and reactions</span>
            </li>
            <li className="flex gap-2">
              <span aria-hidden>•</span>
              <span>Followers, following, blocks, and reports</span>
            </li>
            <li className="flex gap-2">
              <span aria-hidden>•</span>
              <span>Ratings, reviews, and training session requests</span>
            </li>
            <li className="flex gap-2">
              <span aria-hidden>•</span>
              <span>Availability, preferences, and saved locations</span>
            </li>
            <li className="flex gap-2">
              <span aria-hidden>•</span>
              <span>Login credentials and all connected sign-in methods</span>
            </li>
          </ul>
        </div>
        {hasPassword ? (
          <div className="space-y-2">
            <label className="text-xs text-muted-foreground">
              Re-enter your password for{" "}
              <span className="font-semibold text-foreground">{email}</span>
            </label>
            <Input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Your password"
              autoComplete="current-password"
            />
          </div>
        ) : (
          <p className="text-xs text-muted-foreground">
            Signed in via a social provider. Type DELETE below to confirm.
          </p>
        )}
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
            disabled={!canDelete}
            onClick={(e) => {
              e.preventDefault();
              onDelete();
            }}
            className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
          >
            {busy ? "Deleting…" : "Permanently delete account"}
          </AlertDialogAction>
        </AlertDialogFooter>
        {blockerHint ? (
          <p className="mt-2 text-right text-xs text-muted-foreground">{blockerHint}</p>
        ) : null}
      </AlertDialogContent>
    </AlertDialog>
  );
}
