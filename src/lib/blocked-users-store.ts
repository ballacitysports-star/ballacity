import { useSyncExternalStore } from "react";

// Per-host block list. Keyed by host user id. Stored locally on the host's
// device — this is a lightweight moderation tool, not a server-enforced ban.
// Blocked users are prevented from joining/requesting on the host's games
// from any client that reads this list.

const STORAGE_KEY = "openrun.blockedUsers.v1";

type BlockMap = Record<string, string[]>; // hostId -> blockedUserIds

const listeners = new Set<() => void>();
let cache: BlockMap = {};
let loaded = false;
let snapshot = "{}";

function load() {
  if (loaded || typeof window === "undefined") return;
  loaded = true;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    const parsed = raw ? JSON.parse(raw) : {};
    if (parsed && typeof parsed === "object") cache = parsed as BlockMap;
  } catch {
    cache = {};
  }
  snapshot = JSON.stringify(cache);
}

function persist() {
  snapshot = JSON.stringify(cache);
  if (typeof window !== "undefined") {
    try {
      window.localStorage.setItem(STORAGE_KEY, snapshot);
    } catch {
      /* ignore */
    }
  }
  listeners.forEach((l) => l());
}

function subscribe(cb: () => void) {
  load();
  listeners.add(cb);
  return () => listeners.delete(cb);
}

function getSnapshot() {
  load();
  return snapshot;
}

function getServerSnapshot() {
  return "{}";
}

export function getBlockedUsers(hostId: string | null | undefined): string[] {
  load();
  if (!hostId) return [];
  return cache[hostId] ?? [];
}

export function isUserBlocked(
  hostId: string | null | undefined,
  userId: string | null | undefined,
): boolean {
  if (!hostId || !userId) return false;
  return getBlockedUsers(hostId).includes(userId);
}

export function blockUser(hostId: string, userId: string) {
  if (!hostId || !userId || hostId === userId) return;
  load();
  const cur = cache[hostId] ?? [];
  if (cur.includes(userId)) return;
  cache = { ...cache, [hostId]: [...cur, userId] };
  persist();
}

export function unblockUser(hostId: string, userId: string) {
  load();
  const cur = cache[hostId];
  if (!cur || !cur.includes(userId)) return;
  const next = cur.filter((id) => id !== userId);
  cache = { ...cache, [hostId]: next };
  persist();
}

export function useBlockedUsers(hostId: string | null | undefined): string[] {
  const snap = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
  if (!hostId) return [];
  try {
    const parsed = JSON.parse(snap) as BlockMap;
    return parsed[hostId] ?? [];
  } catch {
    return [];
  }
}
