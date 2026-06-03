import { useSyncExternalStore } from "react";

const joined = new Set<string>();
const listeners = new Set<() => void>();
let version = 0;

function emit() {
  version++;
  listeners.forEach((l) => l());
}

function subscribe(cb: () => void) {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

export function joinGame(id: string) {
  joined.add(id);
  emit();
}

export function leaveGame(id: string) {
  joined.delete(id);
  emit();
}

export function isJoined(id: string): boolean {
  return joined.has(id);
}

export function useIsJoined(id: string): boolean {
  useSyncExternalStore(subscribe, () => version, () => version);
  return joined.has(id);
}
