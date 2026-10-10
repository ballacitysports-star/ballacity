import { ShieldCheck } from "lucide-react";
import { SettingsGroup, SettingsLinkRow } from "@/components/settings/SettingsRow";
import { useStaffAccess } from "@/hooks/use-staff-access";
import { STAFF_TIER_LABEL, showsStaffChrome, staffDashboards, staffTierOf } from "@/lib/staff";

/** Settings shortcuts to the staff dashboards. Admins and superadmins only. */
export function StaffSettingsSection() {
  const { access } = useStaffAccess();
  const tier = staffTierOf(access);
  if (!tier || !showsStaffChrome(access)) return null;

  return (
    <SettingsGroup title={`Staff · ${STAFF_TIER_LABEL[tier]}`}>
      {staffDashboards(access).map((d) => (
        <SettingsLinkRow
          key={d.tier}
          to={d.to}
          icon={ShieldCheck}
          label={d.label}
          description={d.description}
        />
      ))}
    </SettingsGroup>
  );
}
