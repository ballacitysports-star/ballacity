import { ShieldCheck, UserPlus } from "lucide-react";
import { useMyChildStatus, useMyChildren } from "@/lib/child-safety";
import { SettingsGroup, SettingsLinkRow } from "@/components/settings/SettingsRow";

/**
 * Entry point into the Guardian Dashboard from Settings. Adults always see it
 * (they may need to invite a player), and anyone already linked to a player sees
 * the count so approval and controls are one tap away.
 */
export function ParentCenterSection() {
  const { status, isLoading } = useMyChildStatus();
  const { children } = useMyChildren();
  if (isLoading || !status) return null;
  const isAdult = status.cohort === "adult";
  if (!isAdult && children.length === 0) return null;

  return (
    <SettingsGroup title="Family">
      <SettingsLinkRow
        to="/parent"
        icon={ShieldCheck}
        label="Guardian Dashboard"
        description={
          children.length > 0
            ? `${children.length} linked ${children.length === 1 ? "player" : "players"} — consent, messaging, videos and data requests`
            : "Approve a player, add a player, and manage their safety settings"
        }
      />
      {children.length === 0 ? (
        <SettingsLinkRow
          to="/parent"
          icon={UserPlus}
          label="Add a Player"
          description="Create a one-time invite so they join linked to your account"
        />
      ) : null}
    </SettingsGroup>
  );
}
