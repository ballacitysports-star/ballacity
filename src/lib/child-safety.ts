import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useAuth } from "@/hooks/use-auth";
import {
  DEFAULT_AGE_POLICY,
  can,
  isConsentBlocked,
  policyState,
  type ChildPolicyState,
  type FeatureDecision,
  type FeatureKey,
} from "@/lib/child-policy";
import {
  createParentRequest,
  getChildConsentTrail,
  getChildFootprint,
  getMyChildStatus,
  listFamilyActivity,
  listMyAgeChangeEvents,
  listMyChildren,
  listMyParentRequests,
  requestParentalConsent,
  revokeChildConsent,
  revokeGuardianLink,
  updateChildControls,
  type AgeChangeEvent,
  type ChildStatus,
  type ConsentTrailEntry,
  type FamilyActivityEntry,
  type GuardianChild,
  type ParentRequestRow,
} from "@/lib/child-safety.functions";

/** The signed-in member's cohort, consent state and guardian controls. */
export function useMyChildStatus() {
  const { user } = useAuth();
  const fetch = useServerFn(getMyChildStatus);
  const query = useQuery({
    queryKey: ["child-status", user?.id ?? "anon"],
    queryFn: () => fetch() as Promise<ChildStatus>,
    enabled: !!user,
    staleTime: 60_000,
    // While a guardian request is outstanding the child is staring at the
    // waiting screen; poll so approval unlocks the app without a reload.
    refetchInterval: (q) => {
      const data = q.state.data as ChildStatus | undefined;
      return data?.consent?.status === "pending" ? 15_000 : false;
    },
  });
  const status = query.data ?? null;
  const subject = status
    ? {
        cohort: status.cohort,
        consent: status.consent,
        ageReviewRequired: status.ageReviewRequired,
        controls: status.controls,
      }
    : null;
  const policy = status?.policy ?? DEFAULT_AGE_POLICY;
  return {
    ...query,
    status,
    policy,
    state: (subject ? policyState(subject, policy) : "AGE_UNKNOWN") as ChildPolicyState,
    consentBlocked: subject ? isConsentBlocked(subject, policy) : false,
    /** Ask the policy engine whether a feature is available to this member. */
    can: (feature: FeatureKey): FeatureDecision =>
      subject ? can(feature, subject, policy) : { allowed: true, level: "allowed", reason: null },
  };
}

export function useRequestParentalConsent() {
  const qc = useQueryClient();
  const run = useServerFn(requestParentalConsent);
  return useMutation({
    mutationFn: (input: {
      parentEmail: string;
      parentName?: string;
      relationship?: "parent" | "guardian" | "other";
      jurisdiction?: "US_FEDERAL" | "GEORGIA" | "OTHER_STATE" | "DEFAULT";
      versions?: { privacy?: string; terms?: string; child_policy?: string };
    }) => run({ data: input }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["child-status"] }),
  });
}

export function useMyChildren() {
  const { user } = useAuth();
  const fetch = useServerFn(listMyChildren);
  const query = useQuery({
    queryKey: ["guardian-children", user?.id ?? "anon"],
    queryFn: () => fetch() as Promise<GuardianChild[]>,
    enabled: !!user,
    staleTime: 30_000,
  });
  return { ...query, children: query.data ?? [] };
}

export function useUpdateChildControls() {
  const qc = useQueryClient();
  const run = useServerFn(updateChildControls);
  return useMutation({
    mutationFn: (input: { childUserId: string; controls: Record<string, string | boolean> }) =>
      run({ data: input as never }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["guardian-children"] });
      qc.invalidateQueries({ queryKey: ["child-status"] });
    },
  });
}

export function useRevokeChildConsent() {
  const qc = useQueryClient();
  const run = useServerFn(revokeChildConsent);
  return useMutation({
    mutationFn: (input: { childUserId: string; reason?: string }) => run({ data: input }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["guardian-children"] });
      qc.invalidateQueries({ queryKey: ["child-status"] });
    },
  });
}

export function useParentRequests() {
  const { user } = useAuth();
  const fetch = useServerFn(listMyParentRequests);
  const create = useServerFn(createParentRequest);
  const qc = useQueryClient();
  const query = useQuery({
    queryKey: ["parent-requests", user?.id ?? "anon"],
    queryFn: () => fetch() as Promise<ParentRequestRow[]>,
    enabled: !!user,
    staleTime: 30_000,
  });
  const submit = useMutation({
    mutationFn: (input: {
      childUserId: string;
      kind: "access" | "correction" | "deletion" | "revoke_consent";
      details?: string;
    }) => create({ data: input }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["parent-requests"] }),
  });
  return { ...query, requests: query.data ?? [], submit };
}

export function useChildFootprint(childUserId: string | null) {
  const fetch = useServerFn(getChildFootprint);
  return useQuery({
    queryKey: ["child-footprint", childUserId],
    queryFn: () => fetch({ data: { childUserId: childUserId! } }),
    enabled: !!childUserId,
    staleTime: 60_000,
  });
}

/** Why a date-of-birth change was applied or held for safety review. */
export function useMyAgeChangeEvents() {
  const { user } = useAuth();
  const fetch = useServerFn(listMyAgeChangeEvents);
  const query = useQuery({
    queryKey: ["age-change-events", user?.id ?? "anon"],
    queryFn: () => fetch() as Promise<AgeChangeEvent[]>,
    enabled: !!user,
    staleTime: 60_000,
  });
  return { ...query, events: query.data ?? [] };
}

/** Consent audit trail for one linked child (guardian only). */
export function useChildConsentTrail(childUserId: string | null) {
  const fetch = useServerFn(getChildConsentTrail);
  const query = useQuery({
    queryKey: ["child-consent-trail", childUserId],
    queryFn: () => fetch({ data: { childUserId: childUserId! } }) as Promise<ConsentTrailEntry[]>,
    enabled: !!childUserId,
    staleTime: 30_000,
  });
  return { ...query, entries: query.data ?? [] };
}

/** Guardian ends their link to one minor; consent is withdrawn with it. */
export function useRevokeGuardianLink() {
  const qc = useQueryClient();
  const run = useServerFn(revokeGuardianLink);
  return useMutation({
    mutationFn: (input: { childUserId: string; reason?: string }) => run({ data: input }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["guardian-children"] });
      qc.invalidateQueries({ queryKey: ["child-status"] });
      qc.invalidateQueries({ queryKey: ["family-activity"] });
    },
  });
}

/** Append-only family activity trail for one linked minor. */
export function useFamilyActivity(childUserId: string | null) {
  const fetch = useServerFn(listFamilyActivity);
  const query = useQuery({
    queryKey: ["family-activity", childUserId],
    queryFn: () => fetch({ data: { childUserId: childUserId! } }) as Promise<FamilyActivityEntry[]>,
    enabled: !!childUserId,
    staleTime: 30_000,
  });
  return { ...query, entries: query.data ?? [] };
}
