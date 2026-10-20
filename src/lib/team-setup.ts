export type TeamSetupStepId = "logo" | "cover" | "bio" | "game" | "invite";

export type TeamSetupStep = { id: TeamSetupStepId; label: string; done: boolean };

/**
 * What a new team still has to do before its page feels alive. Pure, so the
 * rules are testable on their own.
 */
export function teamSetupSteps(input: {
  hasLogo: boolean;
  hasCover: boolean;
  bio: string | null | undefined;
  gameCount: number;
  /** Members other than the owner, plus pending invitations. */
  invitedCount: number;
}): TeamSetupStep[] {
  return [
    { id: "logo", label: "Add your logo", done: input.hasLogo },
    { id: "cover", label: "Choose a cover", done: input.hasCover },
    { id: "bio", label: "Write a short bio", done: (input.bio ?? "").trim().length > 10 },
    { id: "game", label: "Host your first game", done: input.gameCount > 0 },
    { id: "invite", label: "Invite players", done: input.invitedCount > 0 },
  ];
}
