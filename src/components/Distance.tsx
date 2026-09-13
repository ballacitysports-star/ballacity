import { useDistanceUnit } from "@/lib/user-prefs-store";
import { formatDistance, formatDistanceFromKm } from "@/lib/distance";

/**
 * Renders a distance in the viewer's unit (auto-detected from their region
 * unless they pinned mi/km in feed settings). Pass either `mi` or `km`.
 */
export function Distance({
  mi,
  km,
  decimals = 0,
}: {
  mi?: number | null;
  km?: number | null;
  decimals?: number;
}) {
  const unit = useDistanceUnit();
  const text =
    km != null ? formatDistanceFromKm(km, unit, decimals) : formatDistance(mi, unit, decimals);
  return <>{text}</>;
}
