import type { ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link, useRouterState } from "@tanstack/react-router";
import { supabase } from "@/integrations/supabase/client";
import { useStaffAccess } from "@/hooks/use-staff-access";
import {
  DEFAULT_MAINTENANCE,
  MAINTENANCE_SETTING_KEY,
  parseMaintenance,
  shouldBlockForMaintenance,
} from "@/lib/maintenance";

export function useMaintenanceConfig() {
  const q = useQuery({
    queryKey: ["maintenance-config"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("app_settings")
        .select("value")
        .eq("key", MAINTENANCE_SETTING_KEY)
        .maybeSingle();
      if (error || !data) return DEFAULT_MAINTENANCE;
      return parseMaintenance((data as { value: unknown }).value);
    },
    staleTime: 60_000,
  });
  return q.data ?? DEFAULT_MAINTENANCE;
}

export function MaintenanceGate({ children }: { children: ReactNode }) {
  const config = useMaintenanceConfig();
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const { access, loading } = useStaffAccess();
  const isStaff = access.isSuperadmin || access.isAdmin || access.isModerator;
  if (!config.enabled || loading || !shouldBlockForMaintenance(config, pathname, isStaff)) {
    return <>{children}</>;
  }
  return (
    <div className="grid min-h-dvh place-items-center bg-background px-6">
      <div className="max-w-md text-center">
        <p className="text-4xl">🛠️</p>
        <h1 className="mt-4 text-2xl font-bold text-foreground">We'll be right back</h1>
        <p className="mt-3 text-sm text-muted-foreground">
          {config.message ||
            "BallaCity is getting some upgrades. Games, messages and profiles will be back shortly."}
        </p>
        <div className="mt-6 flex justify-center gap-4 text-sm">
          <Link to="/" className="font-medium text-primary underline">
            Home
          </Link>
          <Link to="/auth" className="font-medium text-primary underline">
            Staff sign in
          </Link>
        </div>
      </div>
    </div>
  );
}
