import { ShieldCheck, UserPlus } from "lucide-react";
import { useMyChildStatus, useMyChildren } from "@/lib/child-safety";
import { SettingsGroup, SettingsLinkRow } from "@/components/settings/SettingsRow";

/**
 * Entry point into the Parent Center from Settings. Adults always see it (they
 * may need to invite a minor), and anyone already linked to a child sees the
 * count so approval and controls are one tap away.
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
        label="Parent Center"
        description={
          children.length > 0
            ? `${children.length} linked child ${children.length === 1 ? "account" : "accounts"} — consent, messaging, videos and data requests`
            : "Approve a child's account, invite a minor, and manage their safety settings"
        }
      />
      {children.length === 0 ? (
        <SettingsLinkRow
          to="/parent"
          icon={UserPlus}
          label="Invite a child or teen"
          description="Create a one-time invite so they join linked to your account"
        />
      ) : null}
    </SettingsGroup>
  );
}
