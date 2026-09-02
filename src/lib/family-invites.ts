import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import {
  createMinorInvite,
  listMyMinorInvites,
  revokeMinorInvite,
} from "@/lib/family-invites.functions";

/** Invitations this parent created (pending, redeemed, cancelled, expired). */
export function useMyMinorInvites(enabled = true) {
  const fn = useServerFn(listMyMinorInvites);
  return useQuery({
    queryKey: ["minor-invites"],
    queryFn: () => fn(),
    enabled,
    staleTime: 30_000,
  });
}

export function useCreateMinorInvite() {
  const fn = useServerFn(createMinorInvite);
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: { childName: string; relationship?: string }) => fn({ data: input }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["minor-invites"] });
    },
  });
}

export function useRevokeMinorInvite() {
  const fn = useServerFn(revokeMinorInvite);
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: { id: string }) => fn({ data: input }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["minor-invites"] });
    },
  });
}
