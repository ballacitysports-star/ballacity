/**
 * Plain words for a refused direct add to an organization (`org_members`).
 *
 * The database lets an administrator add only a person of declared adult age
 * (migration 20261111120000); anyone else joins by asking from the
 * organization's page, and an administrator approves the request. The message
 * does not say why the add was refused, so it tells the administrator nothing
 * about the person's age.
 */
export function orgMemberAddErrorMessage(message: string): string {
  if (/row-level security/i.test(message)) {
    return "This person can't be added directly. Ask them to request to join from the gym's page, then approve their request here.";
  }
  return message;
}
