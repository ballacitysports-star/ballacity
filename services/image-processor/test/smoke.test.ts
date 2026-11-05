import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, it } from "vitest";
import { DEFAULT_CONFIG, createImageProcessor } from "../src/server";
import { formatSmoke, runSmoke, SmokeRefused, smokeConfigProblems } from "../scripts/smoke";

/** The staging smoke script, run against the real service in process (loopback, real sharp). */
const SECRET = "s".repeat(48);
const servers: Server[] = [];
afterEach(async () => {
  await Promise.all(servers.splice(0).map((s) => new Promise((r) => s.close(r))));
});
async function start(over: Partial<Parameters<typeof createImageProcessor>[0]> = {}) {
  const server = createImageProcessor({
    ...DEFAULT_CONFIG,
    secret: SECRET,
    bodyTimeoutMs: 400,
    ...over,
  });
  servers.push(server);
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  return `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
}

describe("image processor staging smoke script", () => {
  it("passes every check against a correctly configured service", async () => {
    const url = await start();
    const results = await runSmoke({ url, secret: SECRET, bodyTimeoutMs: 400 });
    expect(results.filter((r) => !r.ok)).toEqual([]);
    expect(results).toHaveLength(12);
    expect(formatSmoke(results)).not.toContain(SECRET);
  }, 60_000);

  it("fails the signed checks when the secret does not match (a misconfigured deploy)", async () => {
    const url = await start({ secret: "t".repeat(48) });
    const results = await runSmoke({ url, secret: SECRET, bodyTimeoutMs: 400 });
    const failed = results.filter((r) => !r.ok).map((r) => r.id);
    expect(failed).toEqual(
      expect.arrayContaining([
        "signed request served while unsigned connections hang",
        "phone JPEG re-encoded without metadata",
        "stalled signed body cut off at the deadline",
      ]),
    );
  }, 60_000);

  it("refuses an unsafe target before any request", async () => {
    expect(
      smokeConfigProblems({ url: "http://image-processor.example.com", secret: SECRET }).join(),
    ).toMatch(/https/);
    expect(smokeConfigProblems({ url: "https://p.example.com", secret: "short" }).join()).toMatch(
      /at least 32 bytes/,
    );
    await expect(runSmoke({ url: "http://p.example.com", secret: "short" })).rejects.toBeInstanceOf(
      SmokeRefused,
    );
  });
});
