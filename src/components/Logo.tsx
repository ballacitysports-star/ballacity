import { Link } from "@tanstack/react-router";
import mark from "@/assets/ballacity-mark.png.asset.json";
import lockup from "@/assets/ballacity-lockup.png.asset.json";

/**
 * Brand logo. `variant="lockup"` (default) shows the mark + wordmark artwork,
 * `variant="mark"` shows only the bc monogram (tight spaces, avatars, nav).
 */
export function Logo({
  size = 28,
  variant = "lockup",
  linkTo = "/",
}: {
  size?: number;
  variant?: "lockup" | "mark";
  linkTo?: string | null;
}) {
  const content =
    variant === "mark" ? (
      <img
        src={mark.url}
        alt="BallaCity"
        width={size}
        height={size}
        style={{ height: size, width: "auto" }}
        className="enter-pop object-contain"
      />
    ) : (
      <img
        src={lockup.url}
        alt="BallaCity"
        style={{ height: size, width: "auto" }}
        className="enter-pop object-contain"
      />
    );

  if (!linkTo) return <span className="inline-flex items-center">{content}</span>;

  return (
    <Link to={linkTo} className="inline-flex items-center">
      {content}
    </Link>
  );
}
