import { useSyncExternalStore } from "react";
import { ORGS, type Org } from "./sample-data";

const myOrgIds = new Set<string>();
const listeners = new Set<() => void>();
let version = 0;

function emit() {
  version++;
  listeners.forEach((l) => l());
}

export function addOrg(org: Org) {
  ORGS.unshift(org);
  myOrgIds.add(org.id);
  emit();
}

export function updateOrg(
  id: string,
  patch: Partial<Omit<Org, "id" | "kind" | "upcoming" | "posts">>,
) {
  const idx = ORGS.findIndex((o) => o.id === id);
  if (idx === -1) return;
  ORGS[idx] = { ...ORGS[idx], ...patch };
  emit();
}

export function deleteOrg(id: string) {
  const idx = ORGS.findIndex((o) => o.id === id);
  if (idx === -1) return;
  ORGS.splice(idx, 1);
  myOrgIds.delete(id);
  emit();
}

export function getOrgById(id: string): Org | undefined {
  return ORGS.find((o) => o.id === id);
}

export function isMyOrg(id: string): boolean {
  return myOrgIds.has(id);
}

export function getMyOrgs(): Org[] {
  return ORGS.filter((o) => myOrgIds.has(o.id));
}

function subscribe(cb: () => void) {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

export function useMyOrgs(): Org[] {
  useSyncExternalStore(
    subscribe,
    () => version,
    () => version,
  );
  return getMyOrgs();
}

export function useAllOrgs(): Org[] {
  useSyncExternalStore(
    subscribe,
    () => version,
    () => version,
  );
  return ORGS;
}
