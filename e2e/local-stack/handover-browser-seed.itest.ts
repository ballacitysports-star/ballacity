/**
 * Seeds the browser run of the handover (e2e/managed-handover-real-auth.spec.ts). A Playwright worker never holds the
 * service-role key (e2e/global-setup.ts removes it from the environment on purpose), so the accounts are made here, by a
 * process that is allowed one, and written to e2e/local-stack/.state/handover-browser.json (git-ignored, throwaway stack). The
 * spec reads that file once and deletes it: the link it holds is spent by the run.
 *
 *   npx vitest run -c vitest.realauth.config.ts e2e/local-stack/handover-browser-seed.itest.ts
 *   npx playwright test e2e/managed-handover-real-auth.spec.ts
 */
import { randomBytes } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { createSeed } from "./handover-seed";
import { requireLocalStack } from "./local-only";

const seed = createSeed(requireLocalStack(process.env));

describe("seed the browser run", () => {
  it("a managed adult, their guardian, and a pending handover whose link is in the state file", async () => {
    const s = await seed.seedManagedAdult();
    const token = randomBytes(32).toString("hex");
    await seed.startHandover(s, token);
    const file = fileURLToPath(new URL("./.state/handover-browser.json", import.meta.url));
    mkdirSync(fileURLToPath(new URL("./.state", import.meta.url)), { recursive: true });
    writeFileSync(
      file,
      JSON.stringify({
        token,
        childId: s.childId,
        childName: "Sam",
        adultEmail: s.adultEmail,
        guardianEmail: s.guardianEmail,
        guardianPassword: s.guardianPassword,
      }),
      { mode: 0o600 },
    );
    expect(token).toHaveLength(64);
  });
});
