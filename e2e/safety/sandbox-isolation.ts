/**
 * Owner-recorded isolation verification for each designated E2E sandbox.
 *
 * Being listed in NON_PRODUCTION_E2E_PROJECT_REFS (target-guard.ts) only designates a project. The suite
 * signs in as fixture accounts, seeds rows with the service-role key and deletes what it created, so a
 * designated project is accepted as a target only after the owner has also verified, in the Supabase
 * dashboard, that it is isolated from production. The checks are listed in docs/supabase-cli.md under
 * "E2E sandbox isolation". There is no other way to accept a remote target and no environment override.
 *
 * Add an entry only in a reviewed commit, made by or for the owner after the verification, with:
 *   verified_by: who verified it; verified_on: YYYY-MM-DD; evidence: where the written record lives.
 * Remove the entry (or the designation) to revoke it.
 */
export type SandboxIsolation = {
  readonly verified_by: string;
  readonly verified_on: string;
  readonly evidence: string;
};

/**
 * `qkukefvzwlyusvspablz` (Supabase project "ballacity-staging") is designated but NOT yet verified as
 * isolated, so E2E against it is refused until the owner records the verification here.
 */
export const VERIFIED_E2E_SANDBOX_ISOLATION: Readonly<Record<string, SandboxIsolation>> = {};
