// @vitest-environment jsdom
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import {
  CLIENT_CACHE_EPOCH,
  CLIENT_CACHE_EPOCH_KEY,
  CLIENT_STORAGE_MANIFEST,
  classifyStorageKey,
  purgeClientState,
  runClientCacheEpoch,
} from "./client-storage-manifest";

const SRC = join(process.cwd(), "src") + "/";
function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.(ts|tsx)$/.test(name) && !/\.test\.tsx?$/.test(name)) out.push(p);
  }
  return out;
}

describe("the storage manifest covers every key the code writes", () => {
  it("lists each openrun/ballacity storage key literal found in the source", () => {
    const unlisted: string[] = [];
    for (const file of walk(SRC)) {
      if (file.endsWith("client-storage-manifest.ts")) continue;
      const text = readFileSync(file, "utf8");
      for (const m of text.matchAll(/["'`]((?:openrun|ballacity)[.:][A-Za-z0-9_.:/-]*)["'`]/g)) {
        const key = m[1];
        if (/^ballacity\.(com|lovable\.app)/.test(key)) continue; // a domain
        if (!classifyStorageKey(key)) unlisted.push(`${key} (${file.replace(SRC, "src/")})`);
      }
    }
    expect(
      unlisted,
      "classify these in src/lib/client-storage-manifest.ts before shipping a new store",
    ).toEqual([]);
  });

  it("is the only place that may open IndexedDB besides the original-photo cache", () => {
    const users = walk(SRC)
      .filter((f) => /indexedDB\.open\(/.test(readFileSync(f, "utf8")))
      .map((f) => f.replace(SRC, "src/"));
    expect(users).toEqual(["src/lib/original-image-cache.ts"]);
  });

  it("never classifies a game-location or identity store as a device preference", () => {
    for (const e of CLIENT_STORAGE_MANIFEST) {
      if (/hostedGames|avatarCache|joinedGameIds|userLoc|home_coords/.test(e.key)) {
        expect(e.cls, e.key).not.toBe("device");
      }
    }
  });
});

describe("purging", () => {
  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
  });
  const seed = () => {
    localStorage.setItem("openrun.hostedGames.v1", "legacy exact venues");
    localStorage.setItem("openrun.hostedGames.v2", "coarse");
    localStorage.setItem("ballacity.avatarCache.v1", "old names");
    localStorage.setItem("ballacity.avatarCache.v2", "names");
    localStorage.setItem("openrun.userLoc.v1", "pos");
    localStorage.setItem("openrun:players-search", "q");
    localStorage.setItem("openrun:theme", "dark");
    localStorage.setItem("ballacity.create_draft.v1:u1", "draft");
    localStorage.setItem("openrun.blockedUsers.v1", "blocks");
    sessionStorage.setItem("openrun.userLoc.v1", "pos");
  };

  it("an identity change removes every per-user store and legacy key, and nothing a person is typing or a device preference", async () => {
    seed();
    await purgeClientState("identity-change");
    for (const k of [
      "openrun.hostedGames.v1",
      "openrun.hostedGames.v2",
      "ballacity.avatarCache.v1",
      "ballacity.avatarCache.v2",
      "openrun.userLoc.v1",
      "openrun:players-search",
    ]) {
      expect(localStorage.getItem(k), k).toBeNull();
    }
    expect(sessionStorage.getItem("openrun.userLoc.v1")).toBeNull();
    expect(localStorage.getItem("openrun:theme")).toBe("dark");
    expect(localStorage.getItem("ballacity.create_draft.v1:u1")).toBe("draft");
    expect(localStorage.getItem("openrun.blockedUsers.v1")).toBe("blocks"); // deliberately retained
  });

  it("an application update removes legacy keys and the sensitive stores only", async () => {
    seed();
    await purgeClientState("epoch");
    expect(localStorage.getItem("openrun.hostedGames.v1")).toBeNull();
    expect(localStorage.getItem("openrun.hostedGames.v2")).toBeNull();
    expect(localStorage.getItem("ballacity.avatarCache.v2")).toBeNull();
    expect(localStorage.getItem("openrun.userLoc.v1")).toBeNull();
    expect(localStorage.getItem("openrun:players-search")).toBe("q"); // not sensitive
    expect(localStorage.getItem("openrun:theme")).toBe("dark");
  });

  it("runs once per epoch", async () => {
    seed();
    expect(await runClientCacheEpoch()).toBe(true);
    expect(localStorage.getItem(CLIENT_CACHE_EPOCH_KEY)).toBe(String(CLIENT_CACHE_EPOCH));
    expect(localStorage.getItem("openrun.hostedGames.v1")).toBeNull();
    localStorage.setItem("openrun.hostedGames.v2", "later");
    expect(await runClientCacheEpoch()).toBe(false);
    expect(localStorage.getItem("openrun.hostedGames.v2")).toBe("later");
  });

  it("deletes the original-photo database on both paths", async () => {
    const deleted: string[] = [];
    const original = globalThis.indexedDB;
    (globalThis as { indexedDB: unknown }).indexedDB = {
      deleteDatabase: (name: string) => {
        deleted.push(name);
        const req: { onsuccess?: () => void } = {};
        queueMicrotask(() => req.onsuccess?.());
        return req;
      },
    };
    try {
      await purgeClientState("identity-change");
      await purgeClientState("epoch");
    } finally {
      (globalThis as { indexedDB: unknown }).indexedDB = original;
    }
    expect(deleted).toEqual(["ballacity-originals", "ballacity-originals"]);
  });
});
