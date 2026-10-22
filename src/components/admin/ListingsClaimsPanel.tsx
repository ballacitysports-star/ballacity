import { useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Building2, Loader2, Plus, Star, Users } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ConfirmAction } from "@/components/superadmin/ConfirmAction";
import { ORG_CATEGORIES } from "@/lib/org-listing";
import {
  CLAIM_RELATIONSHIP_LABEL,
  type ClaimRelationship,
  listingErrorMessage,
} from "@/lib/listings";
import {
  listUnclaimedListings,
  createUnclaimedListing,
  listPendingClaims,
  listFeaturableOrgs,
  reviewClaim,
  setOrgFeatured,
  type ListingSubjectType,
} from "@/lib/listings.functions";

/**
 * Unclaimed listings, ownership claims and featured gyms. Shared by
 * /admin/listings and the superadmin Listings tab; server functions enforce
 * the moderator/superadmin check.
 */
export function ListingsClaimsPanel() {
  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">
        List a team or gym that nobody has claimed yet, then review the claims that come in. An
        unclaimed listing has no owner and no roster until a claim is approved.
      </p>
      <Tabs defaultValue="queue">
        <TabsList className="w-full">
          <TabsTrigger value="queue" className="flex-1">
            Claims
          </TabsTrigger>
          <TabsTrigger value="create" className="flex-1">
            List a place
          </TabsTrigger>
          <TabsTrigger value="unclaimed" className="flex-1">
            Unclaimed
          </TabsTrigger>
          <TabsTrigger value="featured" className="flex-1">
            Featured
          </TabsTrigger>
        </TabsList>
        <TabsContent value="queue" className="mt-4">
          <ClaimsQueue />
        </TabsContent>
        <TabsContent value="create" className="mt-4">
          <CreateListing />
        </TabsContent>
        <TabsContent value="unclaimed" className="mt-4">
          <UnclaimedList />
        </TabsContent>
        <TabsContent value="featured" className="mt-4">
          <FeaturedGyms />
        </TabsContent>
      </Tabs>
    </div>
  );
}

function ClaimsQueue() {
  const qc = useQueryClient();
  const list = useServerFn(listPendingClaims);
  const review = useServerFn(reviewClaim);
  const [confirm, setConfirm] = useState<{
    claimId: string;
    action: "approve" | "deny" | "request_info";
    who: string;
    what: string;
  } | null>(null);

  const { data: claims, isLoading } = useQuery({
    queryKey: ["listing-claims-queue"],
    queryFn: () => list({}),
  });

  const act = useMutation({
    mutationFn: (v: {
      claimId: string;
      action: "approve" | "deny" | "request_info";
      reason: string;
    }) => review({ data: { claimId: v.claimId, action: v.action, reason: v.reason || undefined } }),
    onSuccess: (_r, v) => {
      toast.success(
        v.action === "request_info" ? "Question sent to the claimant" : "Claim reviewed",
      );
      setConfirm(null);
      qc.invalidateQueries({ queryKey: ["listing-claims-queue"] });
      qc.invalidateQueries({ queryKey: ["unclaimed-listings"] });
    },
    onError: (e) => toast.error(listingErrorMessage(e)),
  });

  if (isLoading) return <Loading />;
  if (!claims?.length)
    return <Empty>No claims waiting. Claims filed on unclaimed listings show up here.</Empty>;

  return (
    <div className="space-y-3">
      {claims.map((c) => (
        <Card key={c.id}>
          <CardContent className="space-y-3 p-4">
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  {c.subjectType === "gym" ? (
                    <Building2 className="h-4 w-4 shrink-0 text-muted-foreground" />
                  ) : (
                    <Users className="h-4 w-4 shrink-0 text-muted-foreground" />
                  )}
                  <span className="truncate font-semibold">{c.subjectName}</span>
                </div>
                <p className="mt-1 text-sm text-muted-foreground">
                  {c.claimantName} wants to manage this {c.subjectType}
                </p>
                <div className="mt-1 flex flex-wrap gap-1">
                  <Badge variant="outline">
                    {c.relationship
                      ? (CLAIM_RELATIONSHIP_LABEL[c.relationship as ClaimRelationship] ??
                        c.relationship)
                      : "Connection not stated"}
                  </Badge>
                  <Badge variant={c.attestedAt ? "outline" : "destructive"}>
                    {c.attestedAt ? "Attested accurate" : "No attestation"}
                  </Badge>
                  {c.status === "needs_info" && (
                    <Badge variant="secondary">Waiting on the claimant</Badge>
                  )}
                  {c.competingClaims > 0 && (
                    <Badge variant="destructive">
                      {c.competingClaims} competing claim{c.competingClaims > 1 ? "s" : ""}
                    </Badge>
                  )}
                </div>
              </div>
              <Badge variant="secondary" className="shrink-0">
                {new Date(c.createdAt).toLocaleDateString()}
              </Badge>
            </div>

            {c.message && (
              <p className="whitespace-pre-wrap rounded-md bg-muted p-3 text-sm">{c.message}</p>
            )}
            {c.infoRequest && (
              <p className="rounded-md border p-3 text-sm">
                <span className="font-medium">Asked: </span>
                {c.infoRequest}
              </p>
            )}
            {c.competingClaims > 0 && (
              <p className="text-xs text-muted-foreground">
                Compare the evidence before approving: approving one claim declines the others. The
                first claim filed is not automatically the right one.
              </p>
            )}
            {c.evidenceUrl && (
              <p className="truncate text-sm">
                Evidence:{" "}
                <a
                  href={c.evidenceUrl}
                  target="_blank"
                  rel="noreferrer noopener"
                  className="underline underline-offset-2"
                >
                  {c.evidenceUrl}
                </a>
              </p>
            )}

            <div className="flex flex-wrap gap-2">
              <Button
                size="sm"
                disabled={c.status !== "pending"}
                onClick={() =>
                  setConfirm({
                    claimId: c.id,
                    action: "approve",
                    who: c.claimantName,
                    what: c.subjectName,
                  })
                }
              >
                Approve
              </Button>
              <Button
                size="sm"
                variant="outline"
                onClick={() =>
                  setConfirm({
                    claimId: c.id,
                    action: "deny",
                    who: c.claimantName,
                    what: c.subjectName,
                  })
                }
              >
                Deny
              </Button>
              {c.status === "pending" && (
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() =>
                    setConfirm({
                      claimId: c.id,
                      action: "request_info",
                      who: c.claimantName,
                      what: c.subjectName,
                    })
                  }
                >
                  Request info
                </Button>
              )}
            </div>
          </CardContent>
        </Card>
      ))}

      <ConfirmAction
        open={!!confirm}
        onOpenChange={(o) => !o && setConfirm(null)}
        title={
          confirm?.action === "approve"
            ? `Hand ${confirm?.what} to ${confirm?.who}?`
            : confirm?.action === "request_info"
              ? `Ask ${confirm?.who} for more information`
              : `Deny ${confirm?.who}'s claim?`
        }
        description={
          confirm?.action === "approve"
            ? "They become the owner and can manage the roster, which lets them message and see media from any under-16 member. Any other pending claim on this listing is denied."
            : confirm?.action === "request_info"
              ? "Your note is sent to the claimant as written. Ask for public proof only — never passwords, login codes or private documents."
              : "They keep no access. They can file a new claim later."
        }
        confirmWord={confirm?.action === "approve" ? "APPROVE" : undefined}
        confirmLabel={
          confirm?.action === "approve"
            ? "Approve claim"
            : confirm?.action === "request_info"
              ? "Send question"
              : "Deny claim"
        }
        pending={act.isPending}
        onConfirm={(reason) =>
          confirm && act.mutate({ claimId: confirm.claimId, action: confirm.action, reason })
        }
      />
    </div>
  );
}

function CreateListing() {
  const qc = useQueryClient();
  const create = useServerFn(createUnclaimedListing);
  const [subjectType, setSubjectType] = useState<ListingSubjectType>("gym");
  const [form, setForm] = useState({
    name: "",
    handle: "",
    city: "",
    kind: "team" as "team" | "coach",
    category: "Gym",
    address: "",
    website: "",
  });
  const set = (k: keyof typeof form, v: string) => setForm((f) => ({ ...f, [k]: v }));

  const submit = useMutation({
    mutationFn: () =>
      create({
        data: {
          subjectType,
          name: form.name,
          handle: form.handle,
          city: form.city || undefined,
          ...(subjectType === "team"
            ? { kind: form.kind }
            : {
                category: form.category || undefined,
                address: form.address || undefined,
                website: form.website || undefined,
              }),
        },
      }),
    onSuccess: () => {
      toast.success("Listing created. It is live and unclaimed.");
      setForm({
        name: "",
        handle: "",
        city: "",
        kind: "team",
        category: "Gym",
        address: "",
        website: "",
      });
      qc.invalidateQueries({ queryKey: ["unclaimed-listings"] });
    },
    onError: (e) => toast.error(listingErrorMessage(e)),
  });

  const valid = form.name.trim().length >= 2 && form.handle.trim().length >= 2;

  return (
    <Card>
      <CardContent className="space-y-4 p-4">
        <div className="space-y-2">
          <Label>What are you listing?</Label>
          <Select
            value={subjectType}
            onValueChange={(v) => setSubjectType(v as ListingSubjectType)}
          >
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="gym">Gym or venue</SelectItem>
              <SelectItem value="team">Team or coach</SelectItem>
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-2">
          <Label htmlFor="listing-name">Name</Label>
          <Input
            id="listing-name"
            value={form.name}
            onChange={(e) => set("name", e.target.value)}
            placeholder={subjectType === "gym" ? "Eastside Courts" : "Rec League Ballers"}
          />
        </div>

        <div className="space-y-2">
          <Label htmlFor="listing-handle">Handle</Label>
          <Input
            id="listing-handle"
            value={form.handle}
            onChange={(e) => set("handle", e.target.value)}
            placeholder="@eastside"
          />
        </div>

        <div className="space-y-2">
          <Label htmlFor="listing-city">City</Label>
          <Input
            id="listing-city"
            value={form.city}
            onChange={(e) => set("city", e.target.value)}
            placeholder="Austin"
          />
        </div>

        {subjectType === "team" ? (
          <div className="space-y-2">
            <Label>Kind</Label>
            <Select value={form.kind} onValueChange={(v) => set("kind", v)}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="team">Team</SelectItem>
                <SelectItem value="coach">Coach / trainer</SelectItem>
              </SelectContent>
            </Select>
          </div>
        ) : (
          <>
            <div className="space-y-2">
              <Label>Category</Label>
              <Select value={form.category} onValueChange={(v) => set("category", v)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {ORG_CATEGORIES.map((c) => (
                    <SelectItem key={c} value={c}>
                      {c}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="listing-address">Address</Label>
              <Textarea
                id="listing-address"
                rows={2}
                value={form.address}
                onChange={(e) => set("address", e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="listing-website">Website</Label>
              <Input
                id="listing-website"
                value={form.website}
                onChange={(e) => set("website", e.target.value)}
                placeholder="https://"
              />
            </div>
          </>
        )}

        <Button
          className="w-full"
          disabled={!valid || submit.isPending}
          onClick={() => submit.mutate()}
        >
          {submit.isPending ? (
            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
          ) : (
            <Plus className="mr-2 h-4 w-4" />
          )}
          Create unclaimed listing
        </Button>
        <p className="text-xs text-muted-foreground">
          You are not made the owner. The listing stays ownerless until someone claims it and a
          moderator approves.
        </p>
      </CardContent>
    </Card>
  );
}

function UnclaimedList() {
  const list = useServerFn(listUnclaimedListings);
  const [search, setSearch] = useState("");
  const { data, isLoading } = useQuery({
    queryKey: ["unclaimed-listings", search],
    queryFn: () => list({ data: { search: search || undefined } }),
  });

  return (
    <div className="space-y-3">
      <Input
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        placeholder="Search name, handle or city"
      />
      {isLoading ? (
        <Loading />
      ) : !data?.length ? (
        <Empty>Nothing unclaimed yet.</Empty>
      ) : (
        data.map((l) => (
          <Card key={`${l.subjectType}:${l.id}`}>
            <CardContent className="flex flex-wrap items-center justify-between gap-2 p-4">
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  {l.subjectType === "gym" ? (
                    <Building2 className="h-4 w-4 shrink-0 text-muted-foreground" />
                  ) : (
                    <Users className="h-4 w-4 shrink-0 text-muted-foreground" />
                  )}
                  <span className="truncate font-semibold">{l.name}</span>
                </div>
                <p className="mt-1 truncate text-sm text-muted-foreground">
                  {[l.handle, l.city].filter(Boolean).join(" · ") || "No details yet"}
                </p>
              </div>
              {l.pendingClaims > 0 && (
                <Badge className="shrink-0">
                  {l.pendingClaims} claim{l.pendingClaims === 1 ? "" : "s"}
                </Badge>
              )}
            </CardContent>
          </Card>
        ))
      )}
    </div>
  );
}

function FeaturedGyms() {
  const qc = useQueryClient();
  const list = useServerFn(listFeaturableOrgs);
  const setFeatured = useServerFn(setOrgFeatured);
  const [search, setSearch] = useState("");
  const { data, isLoading } = useQuery({
    queryKey: ["featurable-orgs", search],
    queryFn: () => list({ data: { search: search || undefined } }),
  });
  const toggle = useMutation({
    mutationFn: (v: { orgId: string; featured: boolean }) => setFeatured({ data: v }),
    onSuccess: (_r, v) => {
      toast.success(v.featured ? "Featured" : "Removed from featured");
      qc.invalidateQueries({ queryKey: ["featurable-orgs"] });
      qc.invalidateQueries({ queryKey: ["orgs-index"] });
    },
    onError: (e) => toast.error(listingErrorMessage(e)),
  });

  return (
    <div className="space-y-3">
      <p className="text-sm text-muted-foreground">
        Featured gyms show first in the gyms directory with a Featured badge.{" "}
        {data ? `${data.featuredCount} of ${data.max} featured.` : null}
      </p>
      <Input
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        placeholder="Search name, handle or city"
      />
      {isLoading ? (
        <Loading />
      ) : !data?.orgs.length ? (
        <Empty>No gyms found.</Empty>
      ) : (
        data.orgs.map((o) => {
          const on = !!o.featuredAt;
          return (
            <Card key={o.id}>
              <CardContent className="flex flex-wrap items-center justify-between gap-2 p-4">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <Building2 className="h-4 w-4 shrink-0 text-muted-foreground" />
                    <span className="truncate font-semibold">{o.name}</span>
                    {on && <Badge className="shrink-0">Featured</Badge>}
                  </div>
                  <p className="mt-1 truncate text-sm text-muted-foreground">
                    {[`@${o.handle}`, o.city].filter(Boolean).join(" · ")}
                  </p>
                </div>
                <Button
                  size="sm"
                  variant={on ? "secondary" : "default"}
                  disabled={toggle.isPending}
                  onClick={() => toggle.mutate({ orgId: o.id, featured: !on })}
                >
                  <Star className="mr-1 h-3.5 w-3.5" /> {on ? "Unfeature" : "Feature"}
                </Button>
              </CardContent>
            </Card>
          );
        })
      )}
    </div>
  );
}

function Loading() {
  return (
    <div className="flex items-center gap-2 p-6 text-sm text-muted-foreground">
      <Loader2 className="h-4 w-4 animate-spin" /> Loading…
    </div>
  );
}

function Empty({ children }: { children: React.ReactNode }) {
  return <p className="p-6 text-center text-sm text-muted-foreground">{children}</p>;
}
