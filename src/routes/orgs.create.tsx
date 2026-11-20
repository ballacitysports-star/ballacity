import { RequireAuth } from "@/components/RequireAuth";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { pageHead } from "@/lib/seo";
import { useState } from "react";
import { trackEvent } from "@/lib/analytics";
import { toast } from "sonner";
import { setActiveProfileByRef, myProfilesKey } from "@/lib/account-profiles";
import { useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { supabase } from "@/integrations/supabase/client";
import { useEffect } from "react";
import { createStandaloneOrg } from "@/lib/trainer-orgs.functions";
import { OrgForm, emptyOrgForm, type OrgFormValue } from "@/components/OrgForm";
import { websiteHref } from "@/lib/org-listing";
import { AccountTypeGate } from "@/components/AccountTypeGate";
import { loadDraft, useDraftPersistence } from "@/components/create/useDraftPersistence";
import { SaveStatus } from "@/components/SaveStatus";
import { FinishSetupNotice } from "@/components/FinishSetupNotice";
import { USER_ERROR_MESSAGES, errorText, userErrorMessage } from "@/lib/user-error";

/** requireAccountType's own sentence; shown as it is (WP 4.0). */
const NO_PROFILE_YET = "Your account has no profile yet. Please sign in again.";

/**
 * What the create form shows when createStandaloneOrg fails: the taken-handle sentence for trainer_orgs' unique
 * handle (the server rethrows the bare message, so the SQLSTATE is gone), our own sentence, else userErrorMessage.
 */
function createOrgErrorMessage(e: unknown): string {
  const text = errorText(e) ?? "";
  if (text === NO_PROFILE_YET) return text;
  if (/duplicate key value|violates unique constraint/i.test(text) && /handle/i.test(text)) {
    return USER_ERROR_MESSAGES.HANDLE_TAKEN;
  }
  return userErrorMessage(e, "Couldn't create your gym. Please try again.");
}

const DRAFT_KEY = "openrun:draft:create-org";

export const Route = createFileRoute("/orgs/create")({
  head: () =>
    pageHead({
      path: "/orgs/create",
      title: "Create a gym profile — BallaCity",
      description: "List your gym on BallaCity with hours, amenities, photos, and location.",
      noindex: true,
    }),
  ssr: false,
  validateSearch: (search: Record<string, unknown>): { finish?: number } => ({
    finish: search.finish ? 1 : undefined,
  }),
  component: () => (
    <RequireAuth>
      <AccountTypeGate requires="gym">
        <CreateOrg />
      </AccountTypeGate>
    </RequireAuth>
  ),
});

function CreateOrg() {
  const { finish } = Route.useSearch();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [userId, setUserId] = useState<string | null>(null);
  const [value, setValue] = useState<OrgFormValue>(() => ({
    ...emptyOrgForm(),
    ...(loadDraft<OrgFormValue>(DRAFT_KEY) ?? {}),
  }));
  const [submitting, setSubmitting] = useState(false);
  const create = useServerFn(createStandaloneOrg);
  const { clear: clearDraft, ...draftStatus } = useDraftPersistence(DRAFT_KEY, value);

  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => setUserId(data.user?.id ?? null));
  }, []);

  async function onSubmit() {
    setSubmitting(true);
    try {
      const id = await create({
        data: {
          name: value.name.trim(),
          handle: value.handle.trim().toLowerCase(),
          bio: value.bio.trim() || undefined,
          city: value.city.trim() || undefined,
          website: websiteHref(value.website) ?? (value.website.trim() || undefined),
          bookingUrl: websiteHref(value.bookingUrl) ?? (value.bookingUrl.trim() || undefined),
          address: value.address.trim() || undefined,
          placeId: value.placeId || undefined,
          geo: value.geo,
          avatarUrl: value.avatarUrl || undefined,
          coverUrl: value.coverUrl || undefined,
          phone: value.phone.trim() || undefined,
          email: value.email.trim() || undefined,
          orgType: value.orgType,
          category: value.category || undefined,
          amenities: value.amenities,
          photos: value.photos,
          hours: value.hours,
          timezone: value.timezone || undefined,
        },
      });

      await setActiveProfileByRef("gym", id).catch(() => {});
      // Drop cached profile lists so Settings / profile edit pick the new
      // active profile up on their next mount instead of the pre-create one.
      await qc.invalidateQueries({ queryKey: myProfilesKey(userId), refetchType: "all" });
      clearDraft();
      trackEvent("create_listing", {
        kind: value.orgType === "business" ? "business" : "facility",
      });
      toast.success("Gym created");
      navigate({ to: "/orgs/$orgId", params: { orgId: id } });
    } catch (e) {
      toast.error(createOrgErrorMessage(e));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="page-shell pt-4 pb-40 space-y-4">
      {finish ? <FinishSetupNotice kind="gym" /> : null}
      <header>
        <h1 className="page-title">Create gym.</h1>
        <p className="mt-1 page-subtitle">Set up a training organization or gym profile.</p>
        <SaveStatus {...draftStatus} savedLabel="Draft saved" className="mt-1" />
      </header>
      <OrgForm
        value={value}
        onChange={setValue}
        userId={userId}
        submitting={submitting}
        onSubmit={onSubmit}
        submitLabel="Create gym"
      />
    </div>
  );
}
