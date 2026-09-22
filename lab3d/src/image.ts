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
  if (bytes.length >= 45 && PNG_MAGIC.every((b, i) => bytes[i] === b)) {
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    // IHDR is always the first chunk: 8 magic + 4 length + 4 type, then w/h.
    const isIhdr = bytes[12] === 0x49 && bytes[13] === 0x48 && bytes[14] === 0x44 && bytes[15] === 0x52;
    if (!isIhdr || view.getUint32(8, false) !== 13) return null;
    let offset = 8;
    let hasPixels = false;
    let complete = false;
    while (offset + 12 <= bytes.length) {
      const length = view.getUint32(offset, false);
      if (offset + 12 + length > bytes.length) return null;
      const type = String.fromCharCode(...bytes.subarray(offset + 4, offset + 8));
      if (type === "IDAT" && length > 0) hasPixels = true;
      if (type === "IEND") { complete = length === 0; break; }
      offset += 12 + length;
    }
    const width = view.getUint32(16, false);
    const height = view.getUint32(20, false);
    if (!complete || !hasPixels || !width || !height) return null;
    return {
      mime: "image/png",
      ext: ".png",
      width,
      height,
    };
  }
  if (bytes.length >= 4 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    const size = jpegSize(bytes);
    if (!size.width || !size.height) return null;
    return { mime: "image/jpeg", ext: ".jpg", ...size };
  }
  if (
    bytes.length >= 16 &&
    bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x46 &&
    bytes[8] === 0x57 && bytes[9] === 0x45 && bytes[10] === 0x42 && bytes[11] === 0x50
  ) {
    const size = webpSize(bytes);
    if (!size) return null;
    return { mime: "image/webp", ext: ".webp", ...size };
  }
  return null;
}

function jpegSize(bytes: Uint8Array): { width: number | null; height: number | null } {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let offset = 2;
  while (offset + 4 <= bytes.length) {
    if (bytes[offset] !== 0xff) {
      offset++;
      continue;
    }
    const marker = bytes[offset + 1]!;
    if (marker === 0xff) { offset++; continue; }
    if (marker === 0xda || marker === 0xd9) break;
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd8)) { offset += 2; continue; }
    const length = view.getUint16(offset + 2, false);
    if (length < 2 || offset + 2 + length > bytes.length) return { width: null, height: null };
    // SOF0..SOF15, skipping the non-frame markers DHT (c4), JPG (c8), DAC (cc).
    if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
      if (length < 8) return { width: null, height: null };
      return { height: view.getUint16(offset + 5, false), width: view.getUint16(offset + 7, false) };
    }
    offset += 2 + length;
  }
  return { width: null, height: null };
}

/** RIFF chunk dimensions for lossy, lossless and extended WebP. */
function webpSize(bytes: Uint8Array): { width: number; height: number } | null {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const end = view.getUint32(4, true) + 8;
  if (end > bytes.length || end < 20) return null;
  const uint24 = (offset: number) => bytes[offset]! | (bytes[offset + 1]! << 8) | (bytes[offset + 2]! << 16);
  let size: { width: number; height: number } | null = null;
  let pixels = false;
  for (let offset = 12; offset + 8 <= end;) {
    const type = String.fromCharCode(...bytes.subarray(offset, offset + 4));
    const length = view.getUint32(offset + 4, true);
    const data = offset + 8;
    if (data + length > end) return null;
    if (type === "VP8X" && length >= 10) {
      size = { width: uint24(data + 4) + 1, height: uint24(data + 7) + 1 };
    } else if (type === "VP8 " && length >= 10) {
      if (bytes[data + 3] !== 0x9d || bytes[data + 4] !== 0x01 || bytes[data + 5] !== 0x2a) return null;
      size ??= { width: view.getUint16(data + 6, true) & 0x3fff, height: view.getUint16(data + 8, true) & 0x3fff };
      pixels = true;
    } else if (type === "VP8L" && length >= 5) {
      if (bytes[data] !== 0x2f) return null;
      const packed = view.getUint32(data + 1, true);
      size ??= { width: (packed & 0x3fff) + 1, height: ((packed >>> 14) & 0x3fff) + 1 };
      pixels = true;
    } else if (type === "ANMF" && length >= 16) {
      pixels = true;
    }
    offset = data + length + (length % 2);
  }
  return pixels && size?.width && size?.height ? size : null;
}
