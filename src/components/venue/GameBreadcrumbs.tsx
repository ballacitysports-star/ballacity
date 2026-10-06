import { Link } from "@tanstack/react-router";
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "@/components/ui/breadcrumb";
import { useFacilityName } from "@/components/venue/VenueBadge";

/**
 * `Gyms > Apex Basketball Hub > Sunday run` trail for a game hosted at a
 * registered facility, so the way back to the gym (and the gym directory) is
 * one tap. Renders nothing for games without a public facility.
 */
export function GameBreadcrumbs({
  orgId,
  gameTitle,
}: {
  orgId: string | null | undefined;
  gameTitle: string;
}) {
  const q = useFacilityName(orgId);
  const org = q.data;
  if (!orgId || !org) return null;
  return (
    <Breadcrumb aria-label="Breadcrumb" className="page-shell mt-3">
      <BreadcrumbList className="text-xs">
        <BreadcrumbItem>
          <BreadcrumbLink asChild>
            <Link to="/orgs">Gyms</Link>
          </BreadcrumbLink>
        </BreadcrumbItem>
        <BreadcrumbSeparator />
        <BreadcrumbItem className="min-w-0">
          <BreadcrumbLink asChild>
            <Link
              to="/orgs/$orgId"
              params={{ orgId: org.id }}
              aria-label={`View ${org.name} profile and weekly schedule`}
              className="max-w-[40vw] truncate"
            >
              {org.name}
            </Link>
          </BreadcrumbLink>
        </BreadcrumbItem>
        <BreadcrumbSeparator />
        <BreadcrumbItem className="min-w-0">
          <BreadcrumbPage className="max-w-[40vw] truncate">{gameTitle}</BreadcrumbPage>
        </BreadcrumbItem>
      </BreadcrumbList>
    </Breadcrumb>
  );
}
