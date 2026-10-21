import { isImageUrl } from "@/lib/team-avatar";

export { isImageUrl };

/**
 * Renders a team's or trainer's mark from the single display value cards use:
 * the logo as an image when it is a URL, otherwise the text — so a logo URL is
 * never printed as text.
 */
export function OrgAvatarMark({
  avatar,
  fallback,
}: {
  avatar: string | null | undefined;
  /** Shown when `avatar` is empty or is a URL that can't be used as text. */
  fallback: string;
}) {
  if (isImageUrl(avatar)) {
    return <img src={avatar} alt="" className="h-full w-full object-cover" />;
  }
  return <>{avatar || fallback}</>;
}
