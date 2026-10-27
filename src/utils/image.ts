// Image helpers for the DJs library.

/** Longest edge a stored picture keeps. Covers and avatars never show bigger. */
const MAX_EDGE = 1000;

/** Already this small and this light, a picture is uploaded untouched. */
const KEEP_UNDER_BYTES = 500 * 1024;

/**
 * Shrink a picture before upload, so any photo can be used as a cover or a
 * profile picture without filling storage or making every row download a
 * full-size original.
 *
 * Small images pass through as they are, which also keeps a small animated
 * GIF animated. Formats that can be transparent come out as WebP (or PNG where
 * the browser can't write WebP), everything else as JPEG.
 *
 * Throws if the browser can't decode it -- HEIC outside Safari, mostly.
 */
export async function shrinkImage(image: Blob): Promise<Blob> {
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(image);
  } catch {
    throw new Error("Couldn't read that picture. Try a JPEG or PNG.");
  }

  try {
    const { width, height } = bitmap;
    const scale = Math.min(1, MAX_EDGE / Math.max(width, height));
    if (scale === 1 && image.size <= KEEP_UNDER_BYTES) return image;

    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(width * scale));
    canvas.height = Math.max(1, Math.round(height * scale));
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("Couldn't read that picture.");
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);

    const mayBeTransparent = /png|webp|gif|avif/.test(image.type);
    const out = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, mayBeTransparent ? "image/webp" : "image/jpeg", 0.85),
    );
    if (!out) throw new Error("Couldn't shrink that picture.");
    // Re-encoding a small, well-compressed file can make it bigger; keep the smaller.
    return out.size < image.size ? out : image;
  } finally {
    bitmap.close();
  }
}
