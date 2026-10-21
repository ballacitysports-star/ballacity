// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

const h = vi.hoisted(() => ({
  saved: new Map<string, File>(),
  editorProps: null as null | { open: boolean; file: File | null; onConfirm: (d: string) => void },
  upload: vi.fn(async () => "https://cdn.example/new.jpg"),
}));

vi.mock("sonner", () => ({ toast: { error: vi.fn(), success: vi.fn() } }));
vi.mock("@/components/ResponsiveImage", () => ({ ResponsiveImage: () => <img alt="" /> }));
vi.mock("@/lib/image-upload", () => ({ uploadDataUrlToBucket: h.upload }));
vi.mock("@/components/ImageEditorDialog", () => ({
  ImageEditorDialog: (props: {
    open: boolean;
    file: File | null;
    onConfirm: (d: string) => void;
  }) => {
    h.editorProps = props;
    return props.open ? <div role="dialog">editing {props.file?.name}</div> : null;
  },
}));
vi.mock("@/lib/original-image-cache", () => ({
  originalKey: (owner: string, url: string) => `${owner}|${url}`,
  originalImageCache: () => ({
    has: async (k: string) => h.saved.has(k),
    load: async (k: string) => h.saved.get(k) ?? null,
    save: async (k: string, f: File) => {
      h.saved.set(k, f);
      return true;
    },
  }),
}));

import { ImageUploader } from "./ImageUploader";

beforeEach(() => {
  h.saved.clear();
  h.upload.mockClear();
});
afterEach(cleanup);

const url = "https://cdn.example/crop.jpg";
const original = new File([new Uint8Array(8)], "original.jpg", { type: "image/jpeg" });

function renderUploader(value: string) {
  return render(
    <ImageUploader
      kind="cover"
      bucket="team-covers"
      pathPrefix="u-1"
      value={value}
      onChange={() => {}}
    />,
  );
}

describe("ImageUploader adjust crop", () => {
  it("offers Adjust crop only when this device still has the original", async () => {
    renderUploader(url);
    expect(screen.queryByRole("button", { name: /adjust crop/i })).toBeNull();
    cleanup();
    h.saved.set(`u-1|${url}`, original);
    renderUploader(url);
    expect(await screen.findByRole("button", { name: /adjust crop/i })).toBeTruthy();
  });

  it("reopens the editor on the saved original", async () => {
    h.saved.set(`u-1|${url}`, original);
    renderUploader(url);
    fireEvent.click(await screen.findByRole("button", { name: /adjust crop/i }));
    expect((await screen.findByRole("dialog")).textContent).toContain("editing original.jpg");
  });

  it("keeps the original of a new upload on the device, never uploading it", async () => {
    renderUploader("");
    const input = document.querySelector('input[type="file"]') as HTMLInputElement;
    fireEvent.change(input, { target: { files: [original] } });
    await waitFor(() => expect(h.editorProps?.open).toBe(true));
    h.editorProps?.onConfirm("data:image/jpeg;base64,AAAA");
    await waitFor(() => expect(h.saved.get("u-1|https://cdn.example/new.jpg")).toBe(original));
    // Only the cropped result goes to storage.
    expect(h.upload).toHaveBeenCalledTimes(1);
    expect(h.upload).toHaveBeenCalledWith("team-covers", "u-1", "data:image/jpeg;base64,AAAA");
  });
});
