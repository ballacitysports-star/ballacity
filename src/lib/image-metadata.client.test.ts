/**
 * G3 on the paths without a server step, and on pictures stored inline in a row: the gallery's data URL upload, team
 * covers, payment proofs, and staff avatars (stripped in the browser and again in createTeam/updateTeam). Storage is
 * faked; each test checks the bytes that would have left the device or reached the row.
 */
import sharp from "sharp";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { METADATA_IMAGE_REFUSAL } from "./image-upload-errors";

const enc = new TextEncoder();
const latin1 = (b: Uint8Array) => new TextDecoder("latin1").decode(b);
const cat = (...p: Uint8Array[]) => {
  const o = new Uint8Array(p.reduce((n, x) => n + x.length, 0));
  let k = 0;
  for (const x of p) {
    o.set(x, k);
    k += x.length;
  }
  return o;
};
const u8 = (b: Buffer) => new Uint8Array(b.buffer, b.byteOffset, b.byteLength);
const SECRET = "GPS 33.7488,-84.3877 PhoneCo";
const exifApp1 = () => {
  const payload = cat(enc.encode("Exif\0\0MM\0*\0\0\0\x08\0\0\0\0\0\0"), enc.encode(SECRET));
  return cat(
    Uint8Array.from([0xff, 0xe1, (payload.length + 2) >> 8, (payload.length + 2) & 255]),
    payload,
  );
};
const b64 = (b: Uint8Array) => Buffer.from(b).toString("base64");
const unb64 = (s: string) => new Uint8Array(Buffer.from(s, "base64"));

const h = vi.hoisted(() => ({
  uploads: [] as { bucket: string; path: string; body: Blob; options: Record<string, unknown> }[],
  sent: [] as { body: Blob; headers: Record<string, string> }[],
  inserted: [] as Record<string, unknown>[],
  updated: [] as Record<string, unknown>[],
}));

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    auth: {
      getUser: async () => ({ data: { user: { id: "user-1" } }, error: null }),
      getSession: async () => ({ data: { session: { user: { id: "user-1" } } }, error: null }),
    },
    storage: {
      from: (bucket: string) => ({
        upload: async (path: string, body: Blob, options: Record<string, unknown>) => {
          h.uploads.push({ bucket, path, body, options });
          return { data: { path }, error: null };
        },
        createSignedUploadUrl: async (path: string) => ({
          data: { signedUrl: `https://storage.test/${bucket}/${path}`, path, token: "t" },
          error: null,
        }),
        getPublicUrl: (path: string) => ({
          data: { publicUrl: `https://cdn.test/${bucket}/${path}` },
        }),
      }),
    },
  },
}));
vi.mock("@/lib/current-user-id", () => ({ getCurrentUserId: async () => "user-1" }));
vi.mock("@/lib/image-uploads.functions", () => ({
  finalizeImageUpload: async () => ({ ok: true, quarantined: false }),
}));
vi.mock("@/lib/image-variants", () => ({ warmImageVariants: () => {} }));
vi.mock("@/lib/blocked-images", () => ({ refreshBlockedImages: async () => {} }));
vi.mock("@tanstack/react-start", () => ({
  createServerFn: () => {
    let validate = (d: unknown) => d;
    const b = {
      middleware() {
        return b;
      },
      inputValidator(fn: (d: unknown) => unknown) {
        validate = fn;
        return b;
      },
      handler(fn: (ctx: { data: unknown; context: unknown }) => unknown) {
        return (arg: { data: unknown; context: unknown }) =>
          fn({ data: validate(arg.data), context: arg.context });
      },
    };
    return b;
  },
}));
vi.mock("@/integrations/supabase/auth-middleware", () => ({ requireSupabaseAuth: {} }));
vi.mock("./account-type-guard", () => ({ requireAccountType: async () => {} }));

/** A minimal XMLHttpRequest that records what a signed-URL PUT would send. */
class FakeXhr {
  status = 200;
  upload: { onprogress: ((e: unknown) => void) | null } = { onprogress: null };
  onload: (() => void) | null = null;
  onerror: (() => void) | null = null;
  onabort: (() => void) | null = null;
  private headers: Record<string, string> = {};
  open() {}
  setRequestHeader(k: string, v: string) {
    this.headers[k] = v;
  }
  send(body: Blob) {
    h.sent.push({ body, headers: this.headers });
    queueMicrotask(() => this.onload?.());
  }
}
vi.stubGlobal("XMLHttpRequest", FakeXhr);

const { uploadDataUrlToBucket } = await import("./image-upload");
const { uploadTeamCover } = await import("./team-covers");
const { uploadProofScreenshot } = await import("./payments");
const { stripImageFile, strippedImageDataUrl } = await import("./image-metadata-file");
const { cleanStaffAvatars, stripImageDataUrl } = await import("./inline-image-metadata");
const { createTeam, updateTeam } = await import("./teams.functions");

const cleanJpeg = async () =>
  u8(
    await sharp({ create: { width: 64, height: 64, channels: 3, background: "#336699" } })
      .jpeg()
      .toBuffer(),
  );
const gpsJpeg = async () => {
  const j = await cleanJpeg();
  return cat(j.subarray(0, 2), exifApp1(), j.subarray(2));
};
const bytesOf = async (b: Blob) => new Uint8Array(await b.arrayBuffer());
/** Has a readable header (validation passes) but no end of image, so it cannot be stripped. */
const brokenJpeg = async () => {
  const t = await gpsJpeg();
  return t.subarray(0, t.length - 2);
};

beforeEach(() => {
  h.uploads.length = 0;
  h.sent.length = 0;
  h.inserted.length = 0;
  h.updated.length = 0;
});

describe("gallery and cropper uploads (uploadDataUrlToBucket)", () => {
  it("sends the picture without its GPS block", async () => {
    await uploadDataUrlToBucket(
      "org-covers",
      "org-1",
      `data:image/jpeg;base64,${b64(await gpsJpeg())}`,
    );
    expect(h.uploads).toHaveLength(1);
    const sent = await bytesOf(h.uploads[0]!.body);
    expect(latin1(sent)).not.toContain("GPS");
    expect(sent).toEqual(await cleanJpeg());
  });

  it("sends nothing when the picture cannot be cleaned", async () => {
    await expect(
      uploadDataUrlToBucket(
        "org-covers",
        "org-1",
        `data:image/jpeg;base64,${b64(await brokenJpeg())}`,
      ),
    ).rejects.toThrow(METADATA_IMAGE_REFUSAL);
    expect(h.uploads).toEqual([]);
  });
});

describe("direct uploads with no server step", () => {
  it("team cover: the signed PUT carries the clean bytes and their real type", async () => {
    const file = new File([(await gpsJpeg()) as BlobPart], "cover.jpg", { type: "image/jpeg" });
    await uploadTeamCover(file);
    expect(h.sent).toHaveLength(1);
    expect(latin1(await bytesOf(h.sent[0]!.body))).not.toContain("GPS");
    expect(h.sent[0]!.headers["Content-Type"]).toBe("image/jpeg");
  });

  it("team cover: nothing is sent for a file that cannot be cleaned", async () => {
    const file = new File([(await brokenJpeg()) as BlobPart], "cover.jpg", { type: "image/jpeg" });
    await expect(uploadTeamCover(file)).rejects.toThrow(METADATA_IMAGE_REFUSAL);
    expect(h.sent).toEqual([]);
  });

  it("payment proof: the stored screenshot has no GPS block", async () => {
    const file = new File([(await gpsJpeg()) as BlobPart], "proof.jpg", { type: "image/jpeg" });
    await uploadProofScreenshot(file);
    expect(h.uploads).toHaveLength(1);
    expect(h.uploads[0]!.bucket).toBe("payment-proofs");
    expect(latin1(await bytesOf(h.uploads[0]!.body))).not.toContain("GPS");
    expect(h.uploads[0]!.options).toMatchObject({ contentType: "image/jpeg" });
  });

  it("payment proof: nothing is stored for a file that cannot be cleaned", async () => {
    const file = new File([(await brokenJpeg()) as BlobPart], "proof.jpg", { type: "image/jpeg" });
    await expect(uploadProofScreenshot(file)).rejects.toThrow(METADATA_IMAGE_REFUSAL);
    expect(h.uploads).toEqual([]);
  });

  it("stripImageFile keeps the name and gives null for a type it cannot handle", async () => {
    const out = await stripImageFile(
      new File([(await gpsJpeg()) as BlobPart], "a.jpg", { type: "image/jpeg" }),
    );
    expect(out?.name).toBe("a.jpg");
    expect(latin1(await bytesOf(out!))).not.toContain("GPS");
    expect(
      await stripImageFile(new File([enc.encode("GIF89a....")], "a.gif", { type: "image/gif" })),
    ).toBeNull();
  });
});

describe("staff avatars stored inline in the team row", () => {
  it("the edit screen's data URL is already clean", async () => {
    const url = await strippedImageDataUrl(
      new Blob([(await gpsJpeg()) as BlobPart], { type: "image/jpeg" }),
    );
    expect(url).toMatch(/^data:image\/jpeg;base64,/);
    expect(latin1(unb64(url!.split(",")[1]!))).not.toContain("GPS");
  });

  it("stripImageDataUrl cleans a picture and refuses one it cannot parse", async () => {
    const out = stripImageDataUrl(`data:image/jpeg;base64,${b64(await gpsJpeg())}`);
    expect(unb64(out!.split(",")[1]!)).toEqual(await cleanJpeg());
    expect(stripImageDataUrl(`data:image/jpeg;base64,${b64(await brokenJpeg())}`)).toBeNull();
    expect(stripImageDataUrl("data:image/jpeg;base64,!!!")).toBeNull();
    expect(stripImageDataUrl("https://cdn.test/a.jpg")).toBeNull();
  });

  it("cleanStaffAvatars strips pictures, drops ones it cannot clean to initials, and leaves the rest", async () => {
    const staff = [
      { name: "Ana Diaz", role: "Coach", avatar: `data:image/jpeg;base64,${b64(await gpsJpeg())}` },
      {
        name: "Bo Kim",
        role: "Coach",
        avatar: `data:image/heic;base64,${b64(enc.encode("ftypheic GPS"))}`,
      },
      { name: "Cy", role: "Manager", avatar: "CY" },
      { name: "Di Ek", role: "Manager", avatar: "data:image/svg+xml;utf8,<svg/>" },
    ];
    const out = cleanStaffAvatars(staff);
    expect(latin1(unb64(out[0]!.avatar.split(",")[1]!))).not.toContain("GPS");
    expect(out[1]!.avatar).toBe("BK");
    expect(out[2]).toBe(staff[2]);
    // SVG can wrap a raster with its own metadata, and the app never makes SVG staff photos.
    expect(out[3]!.avatar).toBe("DE");
  });

  it("cleanStaffAvatars cleans every data: avatar by its bytes, not by the type it declares", async () => {
    // The team page shows any avatar starting with data: as a picture, and a browser shows it by its bytes, so a
    // JPEG labelled octet-stream (an old bundle reading a File with an empty type) or SVG must be stripped too.
    const jpeg = b64(await gpsJpeg());
    const prefixes = [
      "data:application/octet-stream;base64,",
      "data:;base64,",
      "data:image/svg+xml;base64,",
      "data:image/jpeg;charset=binary;base64,",
      "DATA:image/jpeg;base64,",
    ];
    const out = cleanStaffAvatars(
      prefixes.map((prefix) => ({ name: "Ana Diaz", role: "Coach", avatar: prefix + jpeg })),
    );
    for (const member of out) {
      expect(member.avatar).toMatch(/^data:image\/jpeg;base64,/);
      expect(latin1(unb64(member.avatar.split(",")[1]!))).not.toContain("GPS");
    }
    const svgWithRaster = `<svg xmlns="http://www.w3.org/2000/svg"><image href="data:image/jpeg;base64,${jpeg}"/></svg>`;
    const [utf8Svg, base64Svg, notBase64] = cleanStaffAvatars([
      { name: "Bo Kim", role: "Coach", avatar: `data:image/svg+xml;utf8,${svgWithRaster}` },
      { name: "Bo Kim", role: "Coach", avatar: `data:image/svg+xml;base64,${btoa(svgWithRaster)}` },
      { name: "Bo Kim", role: "Coach", avatar: `data:image/jpeg,${latin1(await gpsJpeg())}` },
    ]);
    expect(utf8Svg!.avatar).toBe("BK");
    expect(base64Svg!.avatar).toBe("BK");
    expect(notBase64!.avatar).toBe("BK");
  });

  it("createTeam and updateTeam store the stripped staff avatars", async () => {
    const chain = (sink: Record<string, unknown>[]) => {
      const c: Record<string, unknown> = {};
      c.insert = (row: Record<string, unknown>) => (sink.push(row), c);
      c.update = (row: Record<string, unknown>) => (sink.push(row), c);
      c.eq = () => c;
      c.select = () => c;
      c.single = async () => ({ data: { id: "t-1" }, error: null });
      return c;
    };
    const context = {
      userId: "user-1",
      supabase: { from: () => chain(h.inserted) },
    };
    const avatar = `data:image/jpeg;base64,${b64(await gpsJpeg())}`;
    const call = createTeam as unknown as (a: {
      data: unknown;
      context: unknown;
    }) => Promise<unknown>;
    await call({
      data: {
        id: "t-1",
        kind: "team",
        name: "Team",
        handle: "team",
        staff: [{ name: "Ana Diaz", role: "Coach", avatar }],
      },
      context,
    });
    const update = updateTeam as unknown as (a: {
      data: unknown;
      context: unknown;
    }) => Promise<unknown>;
    await update({
      data: { id: "t-1", staff: [{ name: "Ana Diaz", role: "Coach", avatar }] },
      context: { ...context, supabase: { from: () => chain(h.updated) } },
    });
    for (const row of [h.inserted[0]!, h.updated[0]!]) {
      const stored = (row.staff as { avatar: string }[])[0]!.avatar;
      expect(stored).toMatch(/^data:image\/jpeg;base64,/);
      expect(latin1(unb64(stored.split(",")[1]!))).not.toContain("GPS");
    }
  });
});
