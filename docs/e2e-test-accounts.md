# E2E Test Accounts

Fixture accounts for multi-user notification & messaging flows.

## Credentials

Defined in `src/lib/test-fixtures.ts`:

| Key       | Email                       | Password                 | Role   |
| --------- | --------------------------- | ------------------------ | ------ |
| `host`    | e2e-host@lovable.test       | `E2E-host-pass-2026!`    | host   |
| `player`  | e2e-player@lovable.test     | `E2E-player-pass-2026!`  | player |
| `player2` | e2e-player2@lovable.test    | `E2E-player2-pass-2026!` | player |

## Seeding

The `seedTestAccounts` server function (`src/lib/seed-test-accounts.functions.ts`)
creates the auth users, enriches their profiles, and inserts one sample
player availability per player account. It is **admin-only** and **idempotent**
— re-running it resets passwords and refreshes the sample availability.

Trigger it from an admin session, e.g. via a temporary button or:

```ts
import { seedTestAccounts } from "@/lib/seed-test-accounts.functions";
await seedTestAccounts();
```

## Suggested flows

1. **Approval push** — sign in as `player`, request to join a host's game;
   sign in as `host`, approve; verify `player` receives in-app + push.
2. **Messaging** — open a thread from `host` → `player`, send a message,
   verify badge + toast on `player`.
3. **Join requests** — `player2` requests to join `host`'s game, `host`
   sees the request notification grouped under "Join requests".
