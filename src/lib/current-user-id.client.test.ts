import { createClient } from "@supabase/supabase-js";
import { afterEach, describe, expect, it, vi } from "vitest";

/**
 * getCurrentUserId against a real supabase-js client with a recording fetch: which auth calls
 * it makes for a fresh, an expired and a missing stored session. Nothing leaves the process.
 */

const URL_BASE = "http://supabase.test";
const STORAGE_KEY = "sb-test-auth-token";
const calls: string[] = [];
const store = new Map<string, string>();

const storage = {
  getItem: (k: string) => store.get(k) ?? null,
  setItem: (k: string, v: string) => void store.set(k, v),
  removeItem: (k: string) => void store.delete(k),
};

const refreshed = { id: "user-refreshed" };
let refreshStatus = 200;

const fakeFetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
  const url = new URL(typeof input === "string" ? input : input.toString());
  calls.push(`${init?.method ?? "GET"} ${url.pathname}${url.search}`);
  if (url.pathname === "/auth/v1/token" && refreshStatus === 200) {
    const now = Math.floor(Date.now() / 1000);
    return new Response(
      JSON.stringify({
        access_token: "fresh-token",
        refresh_token: "fresh-refresh",
        token_type: "bearer",
        expires_in: 3600,
        expires_at: now + 3600,
        user: { id: refreshed.id, aud: "authenticated", role: "authenticated" },
      }),
      { status: 200, headers: { "content-type": "application/json" } },
    );
  }
  if (url.pathname === "/auth/v1/token") {
    return new Response(
      JSON.stringify({ code: "refresh_token_not_found", message: "Invalid Refresh Token" }),
      { status: 400, headers: { "content-type": "application/json" } },
    );
  }
  return new Response(JSON.stringify({ message: "unexpected" }), { status: 500 });
});

const client = createClient(URL_BASE, "anon-key", {
  auth: {
    storage,
    storageKey: STORAGE_KEY,
    persistSession: true,
    autoRefreshToken: false,
    detectSessionInUrl: false,
  },
  global: { fetch: fakeFetch as unknown as typeof fetch },
});

vi.mock("@/integrations/supabase/client", () => ({
  get supabase() {
    return client;
  },
}));

const { getCurrentUserId } = await import("./current-user-id");

function storeSession(id: string, expiresInSec: number) {
  const now = Math.floor(Date.now() / 1000);
  store.set(
    STORAGE_KEY,
    JSON.stringify({
      access_token: "stored-token",
      refresh_token: "stored-refresh",
      token_type: "bearer",
      expires_in: expiresInSec,
      expires_at: now + expiresInSec,
      user: { id, aud: "authenticated", role: "authenticated" },
    }),
  );
}

describe("getCurrentUserId with supabase-js", () => {
  afterEach(() => {
    store.clear();
    calls.length = 0;
    refreshStatus = 200;
  });

  it("answers a fresh session from storage with no network call", async () => {
    storeSession("user-1", 3600);
    await expect(getCurrentUserId()).resolves.toBe("user-1");
    expect(calls).toEqual([]);
  });

  it("refreshes an expired session first and returns the refreshed user's id, never calling /user", async () => {
    storeSession("user-1", -60);
    await expect(getCurrentUserId()).resolves.toBe(refreshed.id);
    expect(calls).toEqual(["POST /auth/v1/token?grant_type=refresh_token"]);
  });

  it("returns null when the expired session's refresh is refused", async () => {
    storeSession("user-1", -60);
    refreshStatus = 400;
    await expect(getCurrentUserId()).resolves.toBeNull();
    expect(calls.every((c) => !c.includes("/auth/v1/user"))).toBe(true);
  });

  it("returns null with no stored session, and makes no call", async () => {
    await expect(getCurrentUserId()).resolves.toBeNull();
    expect(calls).toEqual([]);
  });
});
