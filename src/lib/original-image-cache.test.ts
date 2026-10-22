import { describe, expect, it } from "vitest";
import {
  MAX_ENTRIES,
  MAX_ORIGINAL_BYTES,
  MAX_TOTAL_BYTES,
  createOriginalCache,
  originalKey,
  type OriginalStore,
  type StoredOriginal,
} from "./original-image-cache";

function memoryStore(): OriginalStore & { items: Map<string, StoredOriginal> } {
  const items = new Map<string, StoredOriginal>();
  return {
    items,
    get: async (k) => items.get(k),
    put: async (i) => void items.set(i.key, i),
    delete: async (k) => void items.delete(k),
    all: async () => [...items.values()],
  };
}

const file = (name: string, bytes = 10, type = "image/jpeg") =>
  new File([new Uint8Array(bytes)], name, { type });

describe("originalKey", () => {
  it("is per user and per uploaded URL", () => {
    expect(originalKey("u1", "https://x/a.jpg")).not.toBe(originalKey("u2", "https://x/a.jpg"));
    expect(originalKey("u1", "https://x/a.jpg")).not.toBe(originalKey("u1", "https://x/b.jpg"));
  });
});

describe("createOriginalCache", () => {
  it("saves an original and gives it back as a file", async () => {
    const cache = createOriginalCache(memoryStore());
    expect(await cache.has("k")).toBe(false);
    expect(await cache.save("k", file("logo.png", 20, "image/png"))).toBe(true);
    expect(await cache.has("k")).toBe(true);
    const back = await cache.load("k");
    expect(back?.name).toBe("logo.png");
    expect(back?.type).toBe("image/png");
    expect(back?.size).toBe(20);
    expect(await cache.load("other")).toBeNull();
  });

  it("skips empty and oversized files instead of failing", async () => {
    const store = memoryStore();
    const cache = createOriginalCache(store);
    expect(await cache.save("a", file("empty.jpg", 0))).toBe(false);
    expect(await cache.save("b", file("huge.jpg", MAX_ORIGINAL_BYTES + 1))).toBe(false);
    expect(await cache.save("", file("x.jpg"))).toBe(false);
    expect(store.items.size).toBe(0);
  });

  it("keeps only the most recent entries", async () => {
    const store = memoryStore();
    let t = 0;
    const cache = createOriginalCache(store, () => ++t);
    for (let i = 0; i < MAX_ENTRIES + 5; i++) await cache.save(`k${i}`, file(`f${i}.jpg`));
    expect(store.items.size).toBe(MAX_ENTRIES);
    expect(store.items.has("k0")).toBe(false);
    expect(store.items.has(`k${MAX_ENTRIES + 4}`)).toBe(true);
  });

  it("keeps total size under the cap, dropping the oldest first", async () => {
    const store = memoryStore();
    let t = 0;
    const cache = createOriginalCache(store, () => ++t);
    const each = MAX_ORIGINAL_BYTES; // 4 of these exactly fill the cap
    expect(each * 4).toBe(MAX_TOTAL_BYTES);
    for (const k of ["a", "b", "c", "d", "e"]) await cache.save(k, file(`${k}.jpg`, each));
    expect([...store.items.keys()].sort()).toEqual(["b", "c", "d", "e"]);
  });

  it("reports failure, not an error, when the store breaks", async () => {
    const broken: OriginalStore = {
      get: async () => {
        throw new Error("blocked");
      },
      put: async () => {
        throw new Error("blocked");
      },
      delete: async () => {},
      all: async () => [],
    };
    const cache = createOriginalCache(broken);
    expect(await cache.save("k", file("a.jpg"))).toBe(false);
    expect(await cache.has("k")).toBe(false);
    expect(await cache.load("k")).toBeNull();
  });
});
