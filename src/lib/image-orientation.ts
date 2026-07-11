/**
 * Load an image File as a fully upright, EXIF-normalized data URL.
 *
 * iPhone and Android cameras frequently store JPEGs with an EXIF Orientation
 * tag (values 2–8) instead of physically rotating the pixels. Browsers apply
 * that tag inconsistently — especially when the image is drawn to a canvas —
 * so we bake the correct orientation into the pixels ourselves via
 * createImageBitmap({ imageOrientation: 'from-image' }).
 *
 * Falls back to FileReader for browsers without createImageBitmap options.
 */
export async function loadNormalizedDataUrl(file: File): Promise<string> {
  try {
    if (typeof createImageBitmap === "function") {
      const bmp = await createImageBitmap(file, {
        imageOrientation: "from-image",
      } as ImageBitmapOptions);
      try {
        const canvas = document.createElement("canvas");
        canvas.width = bmp.width;
        canvas.height = bmp.height;
        const ctx = canvas.getContext("2d");
        if (ctx) {
          ctx.drawImage(bmp, 0, 0);
          const mime = file.type === "image/png" ? "image/png" : "image/jpeg";
          return canvas.toDataURL(mime, 0.95);
        }
      } finally {
        bmp.close?.();
      }
    }
  } catch {
    // fall through
  }
  return await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(reader.error ?? new Error("read failed"));
    reader.readAsDataURL(file);
  });
}

/** Load an EXIF-normalized image ready to draw on a canvas. */
export async function loadNormalizedImage(file: File): Promise<HTMLImageElement> {
  const src = await loadNormalizedDataUrl(file);
  return await new Promise<HTMLImageElement>((resolve, reject) => {
    const el = new Image();
    // Belt-and-braces for the FileReader fallback path.
    el.style.imageOrientation = "from-image";
    el.onload = () => resolve(el);
    el.onerror = () => reject(new Error("image decode failed"));
    el.src = src;
  });
}
