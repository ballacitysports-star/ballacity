import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { toast } from "sonner";
import { useServerFn } from "@tanstack/react-start";
import { supabase } from "@/integrations/supabase/client";
import { useEffect } from "react";
import { createStandaloneOrg } from "@/lib/trainer-orgs.functions";
import { OrgForm, emptyOrgForm, type OrgFormValue } from "@/components/OrgForm";

export const Route = createFileRoute("/orgs/create")({
  ssr: false,
  head: () => ({
    meta: [{ title: "Create gym — OpenRun" }],
  }),
  component: CreateOrg,
});

function CreateOrg() {
  const navigate = useNavigate();
  const [userId, setUserId] = useState<string | null>(null);
  const [value, setValue] = useState<OrgFormValue>(emptyOrgForm());
  const [submitting, setSubmitting] = useState(false);
  const create = useServerFn(createStandaloneOrg);

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
          website: value.website.trim() || undefined,
          address: value.address.trim() || undefined,
          placeId: value.placeId || undefined,
          geo: value.geo,
          avatarUrl: value.avatarUrl || undefined,
          coverUrl: value.coverUrl || undefined,
        },
      });
      toast.success("Gym created");
      navigate({ to: "/orgs/$orgId", params: { orgId: id } });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to create");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="mx-auto w-full max-w-md sm:max-w-2xl p-4 pb-40 space-y-4">
      <header>
        <h1 className="font-display text-3xl font-bold">Create gym.</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Set up a training organization or gym profile.
        </p>
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
