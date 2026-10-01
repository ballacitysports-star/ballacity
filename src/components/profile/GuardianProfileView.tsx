import { useState } from "react";
import { Link, useNavigate } from "@tanstack/react-router";
import { HERO_IMAGE } from "@/lib/sample-data";
import { ProfileChannelHeader, channelPillClass } from "@/components/profile/ProfileChannelHeader";
import { ProfileAboutSheet, AboutBlock } from "@/components/profile/ProfileAboutSheet";
import { ACCOUNT_TYPE_META } from "@/lib/account-type";
import type { AccountProfile } from "@/lib/account-profiles";
import { useFamilyRoster } from "@/lib/family-roster";
import { FamilyRoster } from "@/components/child/FamilyRoster";
import { useMyEmergencyContact } from "@/lib/guardian-emergency-contact";
import { telHref } from "@/lib/org-listing";

/**
 * The Profile tab rendered for the guardian ("parent") active profile.
 *
 * A guardian's own account has no games, roster, or reviews of its own — the
 * identity (name, avatar) is the guardian's, already on `profile` itself
 * (unlike team/trainer/gym, a parent profile has no linked team/org to query),
 * and the content is the family they manage, reusing the same roster the
 * Parent Center shows rather than a second data source for the same thing.
 */
export function GuardianProfileView({ profile }: { profile: AccountProfile }) {
  const navigate = useNavigate();
  const { needsAction, approved, all, isLoading } = useFamilyRoster();
  const emergencyContact = useMyEmergencyContact();
  const [aboutOpen, setAboutOpen] = useState(false);
  const meta = ACCOUNT_TYPE_META.parent;
  const childCount = all.length;

  return (
    <>
      <ProfileChannelHeader
        bannerUrl={HERO_IMAGE}
        avatarUrl={profile.avatarUrl}
        avatarFallback={profile.avatarFallback}
        name={profile.name}
        nameBadge={
          <span className="inline-flex items-center gap-1 rounded-full bg-lime/15 px-2 py-0.5 text-[10px] font-bold text-lime">
            {meta.label}
          </span>
        }
        meta={[
          `${childCount} ${childCount === 1 ? "child" : "children"}`,
          needsAction.length > 0
            ? `${needsAction.length} need${needsAction.length === 1 ? "s" : ""} your approval`
            : null,
        ]}
        onOpenAbout={() => setAboutOpen(true)}
        actions={
          <Link to="/parent" className={channelPillClass("primary")}>
            Open Parent Center
          </Link>
        }
      />

      <ProfileAboutSheet open={aboutOpen} onOpenChange={setAboutOpen}>
        <AboutBlock label="Emergency contact">
          {emergencyContact.loading ? (
            <p className="text-sm text-muted-foreground">Loading…</p>
          ) : emergencyContact.value.name || emergencyContact.value.phone ? (
            <ul className="space-y-1 text-sm">
              <li className="font-medium">{emergencyContact.value.name || "—"}</li>
              {emergencyContact.value.phone && (
                <li>
                  {telHref(emergencyContact.value.phone) ? (
                    <a
                      href={telHref(emergencyContact.value.phone)!}
                      className="text-foreground underline-offset-2 hover:underline"
                    >
                      {emergencyContact.value.phone}
                    </a>
                  ) : (
                    emergencyContact.value.phone
                  )}
                </li>
              )}
              {emergencyContact.value.relationship && (
                <li className="text-muted-foreground">{emergencyContact.value.relationship}</li>
              )}
            </ul>
          ) : (
            <p className="text-sm text-muted-foreground">
              Not added yet.{" "}
              <Link
                to="/profile/edit"
                className="font-medium text-foreground underline-offset-2 hover:underline"
              >
                Add one
              </Link>
              . Visible only to you.
            </p>
          )}
        </AboutBlock>
      </ProfileAboutSheet>

      <div className="mt-5 px-4">
        {isLoading ? (
          <div className="py-10 text-center text-sm text-muted-foreground">
            Loading your family…
          </div>
        ) : childCount === 0 ? (
          <div className="rounded-2xl border border-border bg-surface p-5 text-center text-sm text-muted-foreground">
            You haven't added a child yet.{" "}
            <Link
              to="/players/add"
              search={{ from: "parent" }}
              className="font-medium text-foreground underline-offset-2 hover:underline"
            >
              Add your child
            </Link>
            .
          </div>
        ) : (
          <FamilyRoster
            needsAction={needsAction}
            approved={approved}
            selected={null}
            onSelect={() => navigate({ to: "/parent" })}
          />
        )}
      </div>
    </>
  );
}
