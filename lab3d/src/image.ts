/**
 * Minimal, dependency-free image sniffing.
 *
 * The upload path must know the real format and the real pixel size before a
 * character is admitted, because both take part in the identity digest and in
 * the 2D/3D comparison view. Only the three formats the Procedura Studio
 * already accepts are recognised.
 */

export type ImageMime = "image/png" | "image/jpeg" | "image/webp";

export interface ImageInfo {
  mime: ImageMime;
  ext: ".png" | ".jpg" | ".webp";
  width: number | null;
  height: number | null;
}

const PNG_MAGIC = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

export function sniffImage(bytes: Uint8Array): ImageInfo | null {
  if (bytes.length >= 24 && PNG_MAGIC.every((b, i) => bytes[i] === b)) {
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    // IHDR is always the first chunk: 8 magic + 4 length + 4 type, then w/h.
    const isIhdr = bytes[12] === 0x49 && bytes[13] === 0x48 && bytes[14] === 0x44 && bytes[15] === 0x52;
    return {
      mime: "image/png",
      ext: ".png",
      width: isIhdr ? view.getUint32(16, false) : null,
      height: isIhdr ? view.getUint32(20, false) : null,
    };
  }
  if (bytes.length >= 4 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return { mime: "image/jpeg", ext: ".jpg", ...jpegSize(bytes) };
  }
  if (
    bytes.length >= 16 &&
    bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x46 &&
    bytes[8] === 0x57 && bytes[9] === 0x45 && bytes[10] === 0x42 && bytes[11] === 0x50
  ) {
    return { mime: "image/webp", ext: ".webp", width: null, height: null };
  }
  return null;
}

function jpegSize(bytes: Uint8Array): { width: number | null; height: number | null } {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let offset = 2;
  while (offset + 9 < bytes.length) {
    if (bytes[offset] !== 0xff) {
      offset++;
      continue;
    }
    const marker = bytes[offset + 1]!;
    // SOF0..SOF15, skipping the non-frame markers DHT (c4), JPG (c8), DAC (cc).
    if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
      return { height: view.getUint16(offset + 5, false), width: view.getUint16(offset + 7, false) };
    }
    const length = view.getUint16(offset + 2, false);
    if (length < 2) return { width: null, height: null };
    offset += 2 + length;
  }
  return { width: null, height: null };
}
