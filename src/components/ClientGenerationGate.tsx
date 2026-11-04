import { useEffect, useState, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import {
  CLIENT_GENERATION_RELOAD_KEY,
  CLIENT_GENERATION_SETTING_KEY,
  DEFAULT_CLIENT_GENERATION,
  isClientOutdated,
  mayAutoReload,
  parseClientGeneration,
} from "@/lib/client-generation";

function useClientGenerationConfig() {
  const q = useQuery({
    queryKey: ["client-generation-config"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("app_settings")
        .select("value")
        .eq("key", CLIENT_GENERATION_SETTING_KEY)
        .maybeSingle();
      if (error || !data) return DEFAULT_CLIENT_GENERATION;
      return parseClientGeneration((data as { value: unknown }).value);
    },
    staleTime: 5 * 60_000,
    refetchInterval: 15 * 60_000,
    refetchOnWindowFocus: true,
  });
  return q.data ?? DEFAULT_CLIENT_GENERATION;
}

function readLastReload(): number | null {
  try {
    const v = Number(sessionStorage.getItem(CLIENT_GENERATION_RELOAD_KEY) ?? "");
    return Number.isFinite(v) && v > 0 ? v : null;
  } catch {
    return null;
  }
}

/** Retires builds older than the server's minimum client generation (src/lib/client-generation.ts). */
export function ClientGenerationGate({ children }: { children: ReactNode }) {
  const config = useClientGenerationConfig();
  const outdated = isClientOutdated(config);
  const [reloading, setReloading] = useState(false);

  useEffect(() => {
    if (!outdated || !mayAutoReload(readLastReload(), Date.now())) return;
    try {
      sessionStorage.setItem(CLIENT_GENERATION_RELOAD_KEY, String(Date.now()));
    } catch {
      // Without storage there is no loop guard, so do not reload automatically: the panel below asks instead.
      return;
    }
    setReloading(true);
    window.location.reload();
  }, [outdated]);

  if (!outdated) return <>{children}</>;
  return (
    <div className="grid min-h-dvh place-items-center bg-background px-6">
      <div className="max-w-md text-center">
        <h1 className="text-2xl font-bold text-foreground">Update available</h1>
        <p className="mt-3 text-sm text-muted-foreground">
          {config.message ||
            "A newer version of BallaCity is ready. Refresh to keep using the app."}
        </p>
        <button
          type="button"
          className="mt-6 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground"
          disabled={reloading}
          onClick={() => {
            setReloading(true);
            window.location.reload();
          }}
        >
          {reloading ? "Refreshing…" : "Refresh"}
        </button>
      </div>
    </div>
  );
}
