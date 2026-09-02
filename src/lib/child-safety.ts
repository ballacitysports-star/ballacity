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
  getChildFootprint,
  getMyChildStatus,
  listMyChildren,
  listMyParentRequests,
  requestParentalConsent,
  revokeChildConsent,
  updateChildControls,
  type ChildStatus,
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
      subject
        ? can(feature, subject, policy)
        : { allowed: true, level: "allowed", reason: null },
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
    mutationFn: (input: {
      childUserId: string;
      controls: Record<string, string | boolean>;
    }) => run({ data: input as never }),
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
