/**
 * Every key this app writes to browser storage, and what may be kept in it (G5).
 *
 * Why: a browser store is not an access-controlled system. Anything written there can be read by the next person on a shared
 * device, outlives a sign-out, and is not covered by the database rules that protect the same information. Precise youth-game
 * locations, other people's identities and account data therefore never go into a general-purpose store; the few stores that hold
 * per-person data hold only what the signed-in person may see, are purged on sign-out, user switch and (for the sensitive ones)
 * application update, and are listed here. A test fails when the code writes a key that is not listed, so a new store has to be
 * classified and reviewed before it ships.
 *
 * Classes:
 *   device           harmless device preference or UI state (theme, view, dismissals, scroll). Never purged by a reset.
 *   per-user         data about or for the signed-in person. Purged on sign-out and on a switch of identity.
 *   own-draft        something the signed-in person is typing (a form draft), keyed by user where it matters. Kept across sign-out.
 *   legacy           a key an older build used. Deleted on the first load of a build that does not use it.
 *   retained-record  deliberately left alone (see the note).
 * `sensitive` marks the per-user stores that can hold game locations, identities or the person's own position: those are also
 * purged when CLIENT_CACHE_EPOCH changes (application update).
 */
export type StorageClass = "device" | "per-user" | "own-draft" | "legacy" | "retained-record";

export type StorageEntry = {
  key: string;
  /** The key is a prefix (a suffix such as a user id or a game id follows). */
  prefix?: boolean;
  cls: StorageClass;
  sensitive?: boolean;
  note?: string;
};

/** Bump when a build stops using a sensitive store or must make every device forget one. */
export const CLIENT_CACHE_EPOCH = 3;
export const CLIENT_CACHE_EPOCH_KEY = "ballacity.clientCacheEpoch";

/** IndexedDB databases the app owns. Anything else opening IndexedDB must be added here (a test checks). */
export const INDEXED_DB_DATABASES = [
  {
    name: "ballacity-originals",
    sensitive: true,
    note: "Original photos kept for retry; may carry camera metadata.",
  },
] as const;

export const CLIENT_STORAGE_MANIFEST: readonly StorageEntry[] = [
  // ---- device
  { key: "openrun:theme", cls: "device" },
  { key: "openrun:theme-change", cls: "device", note: "event name" },
  { key: "openrun:prefs-updated", cls: "device", note: "event name" },
  { key: "openrun:trainers-view", cls: "device" },
  { key: "openrun:trainers-density", cls: "device" },
  { key: "openrun:teams-view", cls: "device" },
  { key: "openrun:teams-density", cls: "device" },
  { key: "openrun:players-view", cls: "device" },
  { key: "openrun:players-density", cls: "device" },
  { key: "openrun:play-view", cls: "device" },
  { key: "openrun:loc-prompt-hidden", cls: "device" },
  { key: "openrun:boot-retry-at", cls: "device" },
  { key: "openrun:last-visited", cls: "device" },
  { key: "ballacity:pwa-dismissed-at", cls: "device" },
  { key: "openrun:debug-mode", cls: "device" },
  { key: "openrun:404-log", cls: "device" },
  { key: "openrun:scroll:", prefix: true, cls: "device" },
  { key: "openrun.default_radius_km", cls: "device" },
  { key: "openrun.pushFailDismissed.v1", cls: "device" },
  { key: "openrun.pushPromptDismissed.v1", cls: "device" },
  { key: "openrun.feedPrefs.v1", cls: "device" },
  { key: "openrun.legacyHostMigration.v1", cls: "device", note: "migration flag" },
  { key: "debug_authgate", cls: "device" },
  { key: "reel-style-prefs.v1", cls: "device" },
  { key: "loc-denial-telemetry/v1", cls: "device" },
  // ---- per-user
  {
    key: "openrun.joinedGameIds.v1",
    cls: "per-user",
    sensitive: true,
    note: "ids of games the person joined",
  },
  {
    key: "openrun.hostedGames.v3",
    cls: "per-user",
    sensitive: true,
    note: "coarse locations only; exact venues live in memory; read through hosted_games_public, so no masked host id (SEC-5)",
  },
  {
    key: "ballacity.avatarCache.v2",
    cls: "per-user",
    sensitive: true,
    note: "names and photos the viewer may see",
  },

  {
    key: "openrun.userLoc.v1",
    cls: "per-user",
    sensitive: true,
    note: "the person's own position",
  },
  {
    key: "openrun.home_coords",
    cls: "per-user",
    sensitive: true,
    note: "the person's own position",
  },
  { key: "openrun.notifPrefs.v3", cls: "per-user", note: "mirrors notification_preferences" },
  { key: "openrun.playersFilters.v1", cls: "per-user" },
  { key: "openrun:players-search", cls: "per-user" },
  { key: "openrun:trainers-search-v2", cls: "per-user" },
  { key: "openrun:teams-search", cls: "per-user" },
  { key: "openrun:sport-choice.", prefix: true, cls: "per-user" },
  { key: "openrun:sport-context", cls: "per-user" },
  { key: "openrun:pending-dob", cls: "per-user" },
  { key: "openrun:pending-legal-consent", cls: "per-user" },
  { key: "ballacity.pending_guardian", cls: "per-user" },
  { key: "openrun.pending_account_type", cls: "per-user" },
  { key: "openrun:oauth-next", cls: "per-user" },
  { key: "openrun:oauth-provider", cls: "per-user" },
  // ---- own-draft
  {
    key: "ballacity.create_draft.v1",
    prefix: true,
    cls: "own-draft",
    note: "the host's own game form; keyed by user",
  },
  {
    key: "openrun.profile.v2.",
    prefix: true,
    cls: "own-draft",
    note: "the person's own profile overrides, keyed by user id; not a cache of anyone else",
  },
  { key: "openrun:draft:create-org", cls: "own-draft" },
  { key: "openrun.trainer-wizard.draft.v1", cls: "own-draft" },
  // ---- legacy
  {
    key: "openrun.hostedGames.v2",
    cls: "legacy",
    sensitive: true,
    note: "held every host account id read straight from hosted_games; removed by SEC-5",
  },
  {
    key: "openrun.hostedGames.v1",
    cls: "legacy",
    sensitive: true,
    note: "held exact venues of every game; removed by the youth-location release",
  },
  {
    key: "ballacity.avatarCache.v1",
    cls: "legacy",
    sensitive: true,
    note: "held names of non-adults",
  },
  { key: "openrun.notifPrefs.v2", cls: "legacy" },
  // ---- retained
  {
    key: "openrun.blockedUsers.v1",
    cls: "retained-record",
    note: "only record on the device of who a host once blocked; see per-user-state",
  },
  {
    key: "openrun:guardian-session",
    cls: "retained-record",
    note: "parked guardian session, managed by managed-session",
  },
];

const matches = (e: StorageEntry, k: string) => (e.prefix ? k.startsWith(e.key) : k === e.key);

export function classifyStorageKey(key: string): StorageEntry | undefined {
  return CLIENT_STORAGE_MANIFEST.find((e) => matches(e, key));
}

export type PurgeScope = "identity-change" | "epoch";

/** Which classes a purge removes. An identity change removes every per-user store; an update removes the sensitive ones. */
function shouldRemove(e: StorageEntry | undefined, scope: PurgeScope): boolean {
  if (!e) return false;
  if (e.cls === "legacy") return true;
  if (e.cls !== "per-user") return false;
  return scope === "identity-change" ? true : !!e.sensitive;
}

function removeMatching(store: Storage, scope: PurgeScope): void {
  const keys: string[] = [];
  for (let i = 0; i < store.length; i++) {
    const k = store.key(i);
    if (k) keys.push(k);
  }
  for (const k of keys) {
    if (shouldRemove(classifyStorageKey(k), scope)) {
      try {
        store.removeItem(k);
      } catch {
        /* ignore */
      }
    }
  }
  // Exact keys that may not be enumerable in a test double.
  for (const e of CLIENT_STORAGE_MANIFEST) {
    if (!e.prefix && shouldRemove(e, scope)) {
      try {
        store.removeItem(e.key);
      } catch {
        /* ignore */
      }
    }
  }
}

/**
 * Forget what must not outlive its moment: per-user stores (or only the sensitive ones on an update), legacy keys, and the
 * sensitive IndexedDB databases. Safe to call anywhere; does nothing without a browser.
 */
export async function purgeClientState(scope: PurgeScope): Promise<void> {
  if (typeof window === "undefined") return;
  for (const getStore of [() => window.localStorage, () => window.sessionStorage]) {
    try {
      removeMatching(getStore(), scope);
    } catch {
      /* storage unavailable */
    }
  }
  if (typeof indexedDB !== "undefined") {
    await Promise.all(
      INDEXED_DB_DATABASES.filter((d) => d.sensitive).map(
        (d) =>
          new Promise<void>((resolve) => {
            try {
              const req = indexedDB.deleteDatabase(d.name);
              req.onsuccess = req.onerror = req.onblocked = () => resolve();
            } catch {
              resolve();
            }
          }),
      ),
    );
  }
  try {
    const { forgetOriginalImageCache } = await import("@/lib/original-image-cache");
    forgetOriginalImageCache();
  } catch {
    /* ignore */
  }
}

/**
 * On application start: if this build's CLIENT_CACHE_EPOCH differs from the one stored on the device, purge the sensitive
 * stores (and every legacy key) once, then record the epoch. Returns whether a purge ran.
 */
export async function runClientCacheEpoch(): Promise<boolean> {
  if (typeof window === "undefined") return false;
  let stored: string | null = null;
  try {
    stored = window.localStorage.getItem(CLIENT_CACHE_EPOCH_KEY);
  } catch {
    return false;
  }
  if (stored === String(CLIENT_CACHE_EPOCH)) return false;
  await purgeClientState("epoch");
  try {
    window.localStorage.setItem(CLIENT_CACHE_EPOCH_KEY, String(CLIENT_CACHE_EPOCH));
  } catch {
    /* ignore */
  }
  return true;
}
