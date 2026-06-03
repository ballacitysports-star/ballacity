import { useEffect, useState, useSyncExternalStore } from "react";

const joined = new Set<string>();
const listeners = new Set<() => void>();
const STORAGE_KEY = "openrun.joinedGameIds.v1";
let version = 0;
let loaded = false;

const EMPTY_JOINED_IDS: string[] = [];

function loadJoinedGames() {
  if (loaded || typeof window === "undefined") return false;
  loaded = true;

  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    const ids = raw ? JSON.parse(raw) : [];
    if (Array.isArray(ids)) {
      joined.clear();
      ids.forEach((id) => {
        if (typeof id === "string") joined.add(id);
      });
    }
  } catch {
    joined.clear();
  }

  return true;
}

function saveJoinedGames() {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(Array.from(joined)));
}

function emit() {
  version++;
  listeners.forEach((l) => l());
}

function subscribe(cb: () => void) {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

export function joinGame(id: string) {
  loadJoinedGames();
  joined.add(id);
  saveJoinedGames();
  emit();
}

export function leaveGame(id: string) {
  loadJoinedGames();
  joined.delete(id);
  saveJoinedGames();
  emit();
}

export function isJoined(id: string): boolean {
  loadJoinedGames();
  return joined.has(id);
}

export function useIsJoined(id: string): boolean {
  const [ready, setReady] = useState(loaded);
  useSyncExternalStore(subscribe, () => version, () => 0);

  useEffect(() => {
    const didLoad = loadJoinedGames();
    setReady(true);
    if (didLoad) emit();
  }, []);

  return ready ? joined.has(id) : false;
}

export function useJoinedGameIds(): string[] {
  const [ready, setReady] = useState(loaded);
  useSyncExternalStore(subscribe, () => version, () => 0);

  useEffect(() => {
    const didLoad = loadJoinedGames();
    setReady(true);
    if (didLoad) emit();
  }, []);

  return ready ? Array.from(joined) : EMPTY_JOINED_IDS;
}
