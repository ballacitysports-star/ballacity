import { userErrorMessage } from "@/lib/user-error";

/**
 * Plain words for a refused direct add to an organization (`org_members`).
 *
 * The database lets an administrator add only a person of declared adult age
 * (migration 20261111120000); anyone else joins by asking from the
 * organization's page, and an administrator approves the request. The message
 * does not say why the add was refused, so it tells the administrator nothing
 * about the person's age.
 */
/** The sentence a refused direct add reads as; addOrgMemberDirect throws it as is. */
export const ORG_MEMBER_DIRECT_ADD_REFUSED =
  "This person can't be added directly. Ask them to request to join from the gym's page, then approve their request here.";

export function orgMemberAddErrorMessage(message: string): string {
  if (/row-level security/i.test(message)) return ORG_MEMBER_DIRECT_ADD_REFUSED;
  // Any other refusal: the catalog or generic sentence, never the raw database text (WP 4.0).
  return userErrorMessage(message, "Couldn't add this member. Please try again.");
}
