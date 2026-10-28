import { describe, expect, it } from "vitest";
import { clearCreateDraft, loadCreateDraft, saveCreateDraft } from "./create-draft";

const memory = () => {
  const m = new Map<string, string>();
  return {
    getItem: (k: string) => m.get(k) ?? null,
    setItem: (k: string, v: string) => void m.set(k, v),
    removeItem: (k: string) => void m.delete(k),
    size: () => m.size,
  };
};

describe("create draft", () => {
  it("round-trips what was typed, per user", () => {
    const s = memory();
    saveCreateDraft(s, "u1", { title: "Friday run", paid: true, feeText: "15", priv: true });
    expect(loadCreateDraft(s, "u1")).toMatchObject({
      title: "Friday run",
      paid: true,
      feeText: "15",
      priv: true,
    });
    expect(loadCreateDraft(s, "u2")).toBeNull();
  });

  it("does not keep an empty form, and removes a draft that was emptied", () => {
    const s = memory();
    saveCreateDraft(s, "u1", { title: "x" });
    saveCreateDraft(s, "u1", { title: "  ", description: "" });
    expect(s.size()).toBe(0);
  });

  it("drops a draft older than a week", () => {
    const s = memory();
    saveCreateDraft(s, "u1", { title: "Old" });
    const later = Date.now() + 8 * 24 * 60 * 60 * 1000;
    expect(loadCreateDraft(s, "u1", later)).toBeNull();
    expect(s.size()).toBe(0);
  });

  it("ignores fields of the wrong type and survives corrupt storage", () => {
    const s = memory();
    s.setItem(
      "ballacity.create_draft.v1:u1",
      JSON.stringify({ savedAt: Date.now(), draft: { title: "ok", paid: "yes", minAge: "7" } }),
    );
    const d = loadCreateDraft(s, "u1")!;
    expect(d.title).toBe("ok");
    expect(d.paid).toBeUndefined();
    expect(d.minAge).toBeUndefined();
    s.setItem("ballacity.create_draft.v1:u1", "{not json");
    expect(loadCreateDraft(s, "u1")).toBeNull();
  });

  it("clear removes it", () => {
    const s = memory();
    saveCreateDraft(s, "u1", { title: "Run" });
    clearCreateDraft(s, "u1");
    expect(loadCreateDraft(s, "u1")).toBeNull();
  });
});
