/**
 * Deterministic identity for an imported character.
 *
 * The key must satisfy two requirements at once:
 *   1. the same combination re-imported reuses its previous result;
 *   2. a different character can never surface another character's result.
 *
 * It therefore covers the contract version, the generator version, the full
 * recipe and the digest of every reference image. Changing any of those
 * produces a different key, which produces a different record directory.
 */

import { createHash } from "node:crypto";

import type { CharacterBundle } from "./types.ts";

/** JSON with object keys sorted at every depth, so the digest is stable. */
export function canonicalJson(value: unknown): string {
  return JSON.stringify(sortDeep(value));
}

function sortDeep(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortDeep);
  if (value && typeof value === "object") {
    const src = value as Record<string, unknown>;
    // JSON allows an own __proto__ key. A normal object silently loses it via
    // the prototype setter, producing the same hash for different recipes.
    const out: Record<string, unknown> = Object.create(null);
    for (const k of Object.keys(src).sort()) {
      if (src[k] === undefined) continue;
      out[k] = sortDeep(src[k]);
    }
    return out;
  }
  return value;
}

export function sha256Hex(data: string | Uint8Array): string {
  return createHash("sha256").update(data).digest("hex");
}

/** The exact material the key is computed from — kept so it can be audited. */
export interface KeyMaterial {
  contract: string;
  contractVersion: number;
  generator: string;
  generatorVersion: string;
  recipe: Record<string, unknown>;
  references: { angle: string; sha256: string; authoritative: boolean }[];
  physicalHeightCm: number | null;
}

export function keyMaterial(bundle: CharacterBundle): KeyMaterial {
  return {
    contract: bundle.contract,
    contractVersion: bundle.contractVersion,
    generator: bundle.source.generator,
    generatorVersion: bundle.source.generatorVersion,
    recipe: bundle.recipe as Record<string, unknown>,
    references: [...bundle.references]
      .map((r) => ({ angle: r.angle, sha256: r.sha256, authoritative: r.authoritative }))
      .sort((a, b) => (a.angle === b.angle ? a.sha256.localeCompare(b.sha256) : a.angle.localeCompare(b.angle))),
    physicalHeightCm: bundle.physicalHeightCm,
  };
}

export function characterKey(bundle: CharacterBundle): string {
  return sha256Hex(canonicalJson(keyMaterial(bundle)));
}

/** Digest of the whole bundle, used to detect a conflicting re-import. */
export function contentDigest(bundle: CharacterBundle): string {
  const { exportedAt: _exportedAt, ...source } = bundle.source;
  return sha256Hex(canonicalJson({
    ...bundle,
    source,
    references: [...bundle.references].sort((a, b) => a.angle.localeCompare(b.angle)),
  }));
}

export const shortKey = (key: string): string => key.slice(0, 12);
