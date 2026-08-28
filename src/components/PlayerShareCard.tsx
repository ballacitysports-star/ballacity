import { ProfileShareCard, type ProfileShareData } from "@/components/ProfileShareCard";

export type PlayerShareData = Omit<ProfileShareData, "kind" | "path"> & {
  userId: string;
};

/**
 * Player-flavoured wrapper around the shared {@link ProfileShareCard}.
 */
export function PlayerShareCard({
  open,
  onOpenChange,
  data,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  data: PlayerShareData;
}) {
  const { userId, ...rest } = data;
  return (
    <ProfileShareCard
      open={open}
      onOpenChange={onOpenChange}
      data={{ ...rest, kind: "player", path: `/players/${userId}` }}
    />
  );
}
