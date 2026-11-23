import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/**
 * docs/paid-path-gates.md section 6 (c): the pages show the payment terms through pay-entry-gate.ts's payTermsView, take
 * them from nowhere else, fail closed and never touch the handles' path. These read the route sources: the pages are too
 * large to render here (the e2e spec pay-terms-before-approval.spec.ts drives them against the real database).
 */
const pay = readFileSync("src/routes/games.$gameId.pay.tsx", "utf8");
const game = readFileSync("src/routes/games.$gameId.index.tsx", "utf8");
const payments = readFileSync("src/lib/payments.ts", "utf8");

describe("pay page", () => {
  it("reads the terms only for a viewer who cannot read the settings row, and never as a Retry", () => {
    expect(pay).toContain("getGamePaymentTerms(gameId)");
    // Skipped when the settings row came back; a failed or slow read is no terms, not a thrown error, and it is not
    // awaited: the page does not wait on it.
    expect(pay).toMatch(
      /if \(!s && !cancelled\) \{\s*withTimeout\(getGamePaymentTerms\(gameId\), "getGamePaymentTerms", 4000\)/,
    );
    expect(pay).toMatch(/\.catch\(\(\) => \{\}\);/);
    expect(pay).not.toMatch(/await[^;]*getGamePaymentTerms/);
    expect(pay).not.toMatch(/Promise\.all\(\[[^\]]*getGamePaymentTerms/);
  });

  it("shows them only through payTermsView, with the row's own values first and the game's price last", () => {
    expect(pay).toContain("payTermsView({");
    expect(pay).toContain("settingsReadable: !!settings");
    expect(pay).toContain("entry: entryView.kind");
    expect(pay).toContain(
      "const payFee = settings?.entry_fee ?? termsView?.entryFee ?? game.price;",
    );
    expect(pay).toContain(
      "const payDeadline = settings?.payment_deadline ?? termsView?.deadline ?? null;",
    );
  });

  it("uses one fee everywhere the page names an amount (no second source)", () => {
    expect(pay).not.toMatch(/settings\?\.entry_fee \?\? game\.price/);
  });

  it("keeps the host's free-text instructions behind the settings row", () => {
    expect(pay).toContain("extraInstructions={settings?.payment_instructions ?? null}");
    expect(pay).not.toMatch(
      /terms[A-Za-z]*\??\.(payment_instructions|instructions|username|label)/,
    );
  });

  it("does not fetch the host's methods any earlier than before", () => {
    expect(pay).toContain("payMethodsHeldForApproval({");
    expect(pay).toContain("listPaymentMethodsForHost(nextSetup.hostId, gameId)");
  });
});

describe("game page", () => {
  it("passes the terms through payTermsView to the policy block, the payment card and the fee", () => {
    expect(game).toContain("useGamePaymentTerms(gameId, settings, {");
    expect(game).toContain("enabled: !!user && user.id !== game?.hostUserId,");
    expect(game).toContain("userId: user?.id,");
    expect(game).toContain(
      "payTermsView({ terms: paymentTerms, settingsReadable: !!settings, isHost })",
    );
    expect(game).toContain("paymentTerms: termsView,");
    expect(game).toContain(
      "<GamePolicySummary policy={viewerPolicy} defaultOpen paymentTerms={termsView} />",
    );
    expect(game).toContain("paymentTerms={termsView}");
    expect(game).toContain("Number(settings?.entry_fee ?? termsView?.entryFee ?? game.price)");
  });
});

describe("the app's read of the terms", () => {
  it("calls only the terms function and keeps no handle field", () => {
    expect(payments).toContain('supabase.rpc("get_game_payment_terms", { _game_id: gameId })');
    const start = payments.indexOf("export type GamePaymentTerms = {");
    const type = payments.slice(start, payments.indexOf("};", start));
    expect(type).not.toMatch(/username|payment_url|contact|instructions|label|handle/);
  });
});
