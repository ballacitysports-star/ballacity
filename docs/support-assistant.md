# BallaCity Help (support drawer and assistant)

A help drawer opened from a floating button (signed-in members, bottom-left above
the tab bar) and from a card at the top of `/contact` (everyone). It is a bottom
drawer on phones and a side panel on desktop.

Two layers, so help always works:

1. **Quick answers.** Written topics from `src/lib/support/knowledge.ts`, shown
   with no AI call. Used by signed-out visitors, under-18 accounts, members who
   turned AI off, and whenever AI is out of quota or down.
2. **Assistant.** A chat for signed-in adults, powered by the existing AI layer
   as the `support_assistant` feature (`src/lib/support/assistant.server.ts`).

## What it knows

Only `knowledge.ts`. Every statement there describes what the product does today
and is tied to the code or policy page it came from by `knowledge.test.ts`
(links must be real routes, payment copy must match the fee code, no
compliance claims, nothing about unreleased features). **When a screen or policy
changes, change `knowledge.ts` in the same pull request.**

Deliberately not in it:

- **"Zero cuts and no card checkout."** The accurate statement is: game fees go
  from player to host (Venmo, Zelle, Cash App, PayPal or cash, plus a PayPal
  button where the host connected PayPal); BallaCity takes no cut and never
  holds money. This matches the Payment Policy, the Trust Center and `fees.ts`.
- **Device pairing codes.** The database tables exist
  (`drizzle/migrations/0002_managed_device_pairing.sql`) but nothing in the app
  uses them yet. Add a topic when the Parent Center ships it.
- **"COPPA compliant".** `child-policy.ts` and `age-policy.ts` refuse to claim
  this until counsel reviews the consent method. The assistant is told never to
  say it, and the reply filter rejects it.

## Guardrails, in the order they apply

1. **No tools, no data.** The model sees the written library, the member's own
   role flags (player, parent, coach, host, account type) and the conversation.
   It cannot read another member, a minor's profile, a payment, a report or a
   message, because none of that is ever put in front of it. A prompt is not an
   authorization boundary, so none of the safety rests on one.
2. **Fixed replies before any model call** (`triage.ts`): emergencies, child
   safety concerns, account suspensions and appeals, requests for someone's
   private details, and attempts to change the rules or get around moderation.
   Reviewed wording, no quota used, cannot be prompted around.
3. **The model's reply must be JSON.** Links are picked from an allowlist of real
   pages; anything else is dropped.
4. **Reply checks** (`sanitizeAnswer`): web addresses, other people's email
   addresses, phone numbers, legal or compliance claims, claims of having taken
   an action ("I've refunded you"), and leaked instructions all fail the reply.
5. **Platform text moderation** on what the member would read, failing closed.
6. **Fixed fallback** whenever 4 or 5 fails: "email support@ballacity.app".

Disputes, refunds, safety reports, billing problems and bugs also offer a
drafted email (`draftTicket`). It opens in the member's own mail app, is never
sent or stored by BallaCity, and asks for no card numbers, passwords or codes.

## Who can use it, and what it costs

- **Signed-in adults only** (age cohort `adult`), through the shared gate: feature
  flag, global kill switch, member AI consent, plan quota. Under-18 accounts and
  signed-out visitors get the written answers. Widening cohorts is a safety
  decision; the AI Controls panel does not edit them, by design.
- Limits per day / month by plan: free 20 / 200, premium 40 / 400, team and gym
  60 / 600 (everyone resolves to gym while the platform is in free mode).
  Editable in SuperAdmin, AI Controls ("Support assistant").
- Message length 600 characters; at most six earlier turns are sent.
- Nothing from the conversation is stored. The AI layer records the usual token
  and cost event, and the safety scan records a verdict without the text. The
  chat is held in memory only and is discarded when the signed-in member changes.

## Turning it off

SuperAdmin → AI Controls → switch off "Support assistant" (or use the global
kill switch). The drawer keeps working with the written answers.
