import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useAuth } from "@/hooks/use-auth";
import {
  getMyBirthdayLock,
  listBirthdayCorrections,
  requestBirthdayCorrection,
  reviewBirthdayCorrection,
} from "@/lib/birthday-lock.functions";

/** The signed-in member's locked date of birth + correction history. */
export function useMyBirthdayLock(enabled = true) {
  const fn = useServerFn(getMyBirthdayLock);
  const { session, loading } = useAuth();
  return useQuery({
    queryKey: ["birthday-lock"],
    queryFn: () => fn(),
    // Without a hydrated session the request has no bearer token and the
    // server function rejects it as unauthorized.
    enabled: enabled && !loading && Boolean(session),
    staleTime: 60_000,
  });
}


export function useRequestBirthdayCorrection() {
  const fn = useServerFn(requestBirthdayCorrection);
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: { requestedBirthday: string; reason: string; evidence?: string }) =>
      fn({ data: input }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["birthday-lock"] });
    },
  });
}

/** Support queue (admins only — the database enforces it). */
export function useBirthdayCorrectionQueue(status: "pending" | "all" = "pending") {
  const fn = useServerFn(listBirthdayCorrections);
  return useQuery({
    queryKey: ["birthday-corrections", status],
    queryFn: () => fn({ data: { status } }),
    staleTime: 30_000,
    retry: false,
  });
}

export function useReviewBirthdayCorrection() {
  const fn = useServerFn(reviewBirthdayCorrection);
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: { id: string; approve: boolean; notes?: string }) => fn({ data: input }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["birthday-corrections"] });
      void qc.invalidateQueries({ queryKey: ["birthday-lock"] });
    },
  });
}
