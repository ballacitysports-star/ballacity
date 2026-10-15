/**
 * Teams and trainers keep either short initials/emoji or an uploaded logo URL
 * in the same `avatar` field. Renders the logo as an image when it is a URL,
 * otherwise the text — so a logo URL is never printed as text.
 */
export const isImageUrl = (v: string | null | undefined): v is string =>
  /^(https?:|data:|blob:)/.test(v ?? "");

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
