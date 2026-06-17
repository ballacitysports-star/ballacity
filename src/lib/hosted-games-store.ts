import { useSyncExternalStore } from "react";
import type { Game, Sport } from "@/lib/sample-data";
import { imageFor, ME } from "@/lib/sample-data";

const STORAGE_KEY = "openrun.hostedGames.v1";
const listeners = new Set<() => void>();
let cache: Game[] = [];
let loaded = false;
const EMPTY = "[]";

function load() {
  if (loaded || typeof window === "undefined") return;
  loaded = true;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    const arr = raw ? JSON.parse(raw) : [];
    if (Array.isArray(arr)) cache = arr;
  } catch {
    cache = [];
  }
}

function save() {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(cache));
}

function emit() {
  listeners.forEach((l) => l());
}

function subscribe(cb: () => void) {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

function getSnapshot() {
  load();
  return cache.length === 0 ? EMPTY : JSON.stringify(cache);
}

export type HostedGameInput = {
  sport: Sport;
  title: string;
  date: string; // ISO
  location: string;
  skill: Game["skill"];
  maxPlayers: number;
  price: number;
  indoor: boolean;
  isPrivate: boolean;
  description: string;
  host?: { name: string; username: string; avatar: string; rating?: number };
  hostUserId?: string;
};

export function addHostedGame(input: HostedGameInput): Game {
  load();
  const id = `host-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
  const host = input.host
    ? { name: input.host.name, username: input.host.username, avatar: input.host.avatar, rating: input.host.rating ?? 5 }
    : { name: ME.name, username: ME.username, avatar: ME.avatar, rating: ME.stats.sportsmanship };
  const game: Game = {
    id,
    sport: input.sport,
    title: input.title || `${input.sport} pickup`,
    host,

    date: input.date,
    duration: "90 min",
    location: input.location || "TBD",
    neighborhood: "",
    distanceMi: 0,
    lat: 50,
    lng: 50,
    maxPlayers: input.maxPlayers,
    joined: 0,
    skill: input.skill,
    price: input.price,
    indoor: input.indoor,
    isPrivate: input.isPrivate,
    image: imageFor(input.sport),
    description: input.description || "",
    equipment: [],
  };
  cache = [game, ...cache];
  save();
  emit();
  return game;
}

export function getHostedGame(id: string): Game | undefined {
  load();
  return cache.find((g) => g.id === id);
}

export function useHostedGames(): Game[] {
  const snap = useSyncExternalStore(subscribe, getSnapshot, () => EMPTY);
  return snap === EMPTY ? [] : (JSON.parse(snap) as Game[]);
}
