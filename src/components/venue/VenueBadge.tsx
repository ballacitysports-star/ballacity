import { useNavigate } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { Building2, ShieldCheck } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";

/**
 * Display name of the registered facility a game is hosted at. Public data
 * (anyone can browse gyms); hidden facilities simply come back empty. One
 * cached lookup per facility, so a feed full of games at the same gym asks
 * once.
 */
export function useFacilityName(orgId: string | null | undefined) {
  return useQuery({
    queryKey: ["facility-badge", orgId],
    enabled: !!orgId,
    staleTime: 5 * 60_000,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("trainer_orgs")
        .select("id,name,verified")
        .eq("id", orgId!)
        .maybeSingle();
      if (error) throw new Error(error.message);
      return data ? { id: data.id, name: data.name, verified: !!data.verified } : null;
    },
  });
}

/**
 * "🏢 Apex Basketball Hub" chip for games hosted at a registered facility.
 * Tapping opens the gym's profile (photos, hours). It renders inside cards
 * that are themselves links, so it navigates programmatically instead of
 * nesting an anchor.
 */
export function VenueBadge({
  orgId,
  className = "",
}: {
  orgId: string | null | undefined;
  className?: string;
}) {
  const navigate = useNavigate();
  const q = useFacilityName(orgId);
  const org = q.data;
  if (!orgId || !org) return null;
  return (
    <button
      type="button"
      onClick={(e) => {
        e.preventDefault();
        e.stopPropagation();
        navigate({ to: "/orgs/$orgId", params: { orgId: org.id } });
      }}
      aria-label={`Hosted at ${org.name} — view facility`}
      className={`inline-flex max-w-full items-center gap-1 rounded-full border border-lime/30 bg-lime/10 px-2 py-0.5 text-[11px] font-semibold text-lime hover:bg-lime/20 ${className}`}
    >
      <Building2 className="h-3 w-3 shrink-0" />
      <span className="truncate">{org.name}</span>
      {org.verified && <ShieldCheck className="h-3 w-3 shrink-0" aria-label="Verified" />}
    </button>
  );
}
