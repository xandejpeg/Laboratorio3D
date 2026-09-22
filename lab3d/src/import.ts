/**
 * The import path: raw upload → validated bundle → frozen record.
 *
 * Exactly one reference is marked authoritative and reaches the pipeline;
 * every other angle is stored and labelled `influence: "stored"`, because the
 * upstream generator takes a single `--image`. Nothing here claims an
 * influence the pipeline does not actually have.
 */

import { adaptToBundle, ContractError } from "../contract/adapt.ts";
import { sha256Hex } from "../contract/identity.ts";
import {
  REFERENCE_ANGLES,
  type CharacterBundle,
  type ReferenceAngle,
  type ReferenceImage,
} from "../contract/types.ts";
import { sniffImage } from "./image.ts";
import type { CharacterRegistry, ImportResult, StoredReference } from "./registry.ts";

export const MAX_IMAGE_BYTES = 24 * 1024 * 1024;

export interface IncomingImage {
  angle: string;
  bytes: Uint8Array;
  note?: string;
}

export interface PreparedImport {
  bundle: CharacterBundle;
  stored: StoredReference[];
}

export function isReferenceAngle(value: string): value is ReferenceAngle {
  return (REFERENCE_ANGLES as readonly string[]).includes(value);
}

/**
 * Validate images and payload together. Throws `ContractError` with a list of
 * concrete problems so the UI can show the real reason an import failed.
 */
export function prepareImport(rawPayload: unknown, images: IncomingImage[], fallbackName?: string): PreparedImport {
  const problems: string[] = [];
  if (!images.length) problems.push("at least the frontal PNG is required");

  const seen = new Set<string>();
  const references: ReferenceImage[] = [];
  const stored: StoredReference[] = [];

  for (const img of images) {
    if (!isReferenceAngle(img.angle)) {
      problems.push(`unknown reference angle "${img.angle}" (expected ${REFERENCE_ANGLES.join(", ")})`);
      continue;
    }
    if (seen.has(img.angle)) {
      problems.push(`duplicate reference angle "${img.angle}"`);
      continue;
    }
    if (img.bytes.length > MAX_IMAGE_BYTES) {
      problems.push(`${img.angle}: image is larger than ${MAX_IMAGE_BYTES / 1024 / 1024} MB`);
      continue;
    }
    const info = sniffImage(img.bytes);
    if (!info) {
      problems.push(`${img.angle}: not a PNG, JPEG or WebP image`);
      continue;
    }
    seen.add(img.angle);
    const file = `${img.angle}${info.ext}`;
    references.push({
      angle: img.angle,
      file,
      mime: info.mime,
      bytes: img.bytes.length,
      width: info.width,
      height: info.height,
      sha256: sha256Hex(img.bytes),
      authoritative: img.angle === "front",
      influence: img.angle === "front" ? "pipeline" : "stored",
      ...(img.note ? { note: img.note } : {}),
    });
    stored.push({ angle: img.angle, file, bytes: img.bytes });
  }

  if (!seen.has("front") && !problems.length) {
    problems.push('the frontal reference is required and must be sent with angle "front"');
  }
  if (problems.length) throw new ContractError("import rejected", problems);

  const bundle = adaptToBundle(rawPayload, { references, ...(fallbackName ? { fallbackName } : {}) });

  // The 2D generator states the front composite size; a mismatch means the PNG
  // and the sheet do not belong together, which must not be silently accepted.
  const front = references.find((r) => r.angle === "front")!;
  if (
    front.width !== null &&
    front.height !== null &&
    (front.width !== bundle.front.width || front.height !== bundle.front.height)
  ) {
    throw new ContractError("front image does not match the sheet", [
      `sheet declares ${bundle.front.width}x${bundle.front.height}, image is ${front.width}x${front.height}`,
    ]);
  }

  return { bundle, stored };
}

export function importCharacter(
  registry: CharacterRegistry,
  rawPayload: unknown,
  images: IncomingImage[],
  fallbackName?: string,
): ImportResult {
  const { bundle, stored } = prepareImport(rawPayload, images, fallbackName);
  return registry.commit(bundle, stored, rawPayload);
}
