import { beforeEach, describe, expect, it, vi } from "vitest";

const rpc = vi.fn();
vi.mock("@/integrations/supabase/client.server", () => ({ supabaseAdmin: { rpc } }));

import { authorizeWorker, workerSecretFrom } from "./worker-auth.server";

const req = (headers: Record<string, string> = {}) =>
  new Request("https://x.test/api", { method: "POST", headers });

describe("workerSecretFrom", () => {
  it("reads x-worker-secret, then a bearer token, else empty", () => {
    expect(workerSecretFrom(req({ "x-worker-secret": "a" }))).toBe("a");
    expect(workerSecretFrom(req({ authorization: "Bearer b" }))).toBe("b");
    expect(workerSecretFrom(req())).toBe("");
  });
});

describe("authorizeWorker", () => {
  beforeEach(() => {
    rpc.mockReset();
    delete process.env.REELS_WORKER_SECRET;
  });

  it("rejects a request with no secret without touching the database", async () => {
    expect(await authorizeWorker(req())).toBe("unauthorized");
    expect(rpc).not.toHaveBeenCalled();
  });

  it("accepts the environment secret", async () => {
    process.env.REELS_WORKER_SECRET = "env-secret";
    expect(await authorizeWorker(req({ "x-worker-secret": "env-secret" }))).toBe("ok");
    expect(rpc).not.toHaveBeenCalled();
  });

  it("accepts a secret the database confirms from Vault", async () => {
    rpc.mockResolvedValue({ data: true, error: null });
    expect(await authorizeWorker(req({ "x-worker-secret": "vault-secret" }))).toBe("ok");
    expect(rpc).toHaveBeenCalledWith("check_worker_secret", { _provided: "vault-secret" });
  });

  it("rejects when the database says no, errors, or throws", async () => {
    rpc.mockResolvedValueOnce({ data: false, error: null });
    expect(await authorizeWorker(req({ "x-worker-secret": "bad" }))).toBe("unauthorized");
    rpc.mockResolvedValueOnce({ data: null, error: { message: "boom" } });
    expect(await authorizeWorker(req({ "x-worker-secret": "bad" }))).toBe("unauthorized");
    rpc.mockRejectedValueOnce(new Error("down"));
    expect(await authorizeWorker(req({ "x-worker-secret": "bad" }))).toBe("unauthorized");
  });
});
