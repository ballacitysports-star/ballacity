// Classification of OAuth helper failure messages.
//
// iPhone Safari freezes the opener tab the moment the user switches to the
// provider tab, so the sign-in helper's popup-closed watcher rejects with
// "Sign in was cancelled" while the sign-in is still running. That signal is
// NOT proof of failure, so it gets its own bucket: the sign-in screen waits
// for a session instead of showing an error.

export type OAuthOutcome = "inconclusive" | "popup_blocked" | "failure";

export function classifyOAuthFailure(raw: string): OAuthOutcome {
  const msg = raw ?? "";
  if (/cancel|closed|dismiss|abort|timed?\s?out/i.test(msg)) return "inconclusive";
  if (/popup|blocked|window|opener/i.test(msg)) return "popup_blocked";
  return "failure";
}
