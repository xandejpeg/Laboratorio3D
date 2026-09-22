/**
 * Synthetic fixtures only.
 *
 * No real character, no private artwork and no real export file is committed to
 * this repository. Everything here is generated in code so the versioned tests
 * carry no private data.
 */

import { deflateSync } from "node:zlib";

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(bytes: Uint8Array): number {
  let c = 0xffffffff;
  for (const b of bytes) c = CRC_TABLE[(c ^ b) & 0xff]! ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type: string, data: Uint8Array): Uint8Array {
  const out = new Uint8Array(12 + data.length);
  const view = new DataView(out.buffer);
  view.setUint32(0, data.length);
  for (let i = 0; i < 4; i++) out[4 + i] = type.charCodeAt(i);
  out.set(data, 8);
  view.setUint32(8 + data.length, crc32(out.subarray(4, 8 + data.length)));
  return out;
}

/** A real, decodable PNG of the requested size, filled with one flat colour. */
export function syntheticPng(width: number, height: number, rgb: [number, number, number] = [128, 128, 128]): Uint8Array {
  const raw = new Uint8Array(height * (1 + width * 3));
  for (let y = 0; y < height; y++) {
    const row = y * (1 + width * 3);
    raw[row] = 0; // filter: none
    for (let x = 0; x < width; x++) {
      const p = row + 1 + x * 3;
      raw[p] = rgb[0];
      raw[p + 1] = rgb[1];
      raw[p + 2] = rgb[2];
    }
  }
  const ihdr = new Uint8Array(13);
  const view = new DataView(ihdr.buffer);
  view.setUint32(0, width);
  view.setUint32(4, height);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // colour type: truecolour
  const signature = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const parts = [
    signature,
    chunk("IHDR", ihdr),
    chunk("IDAT", new Uint8Array(deflateSync(raw))),
    chunk("IEND", new Uint8Array(0)),
  ];
  const total = parts.reduce((n, p) => n + p.length, 0);
  const png = new Uint8Array(total);
  let offset = 0;
  for (const part of parts) {
    png.set(part, offset);
    offset += part.length;
  }
  return png;
}

/**
 * A synthetic recipe using the real key set and id grammar of the 2D generator
 * (verified against `canonicalRecipe()`), with invented-but-valid ids.
 */
export function syntheticRecipe(overrides: Record<string, string> = {}): Record<string, string> {
  return {
    family: "female",
    outfit: "female-outfit-0",
    body: "female-body-3",
    face: "female-face-12",
    hair: "female-hair-natural",
    eyes: "female-eyes-natural",
    nose: "female-nose-natural",
    mouth: "female-mouth-natural",
    brows: "female-brows-natural",
    ears: "female-ears-natural",
    skin: "female-skin-0",
    marks: "female-marks-0",
    upper: "female-upper-natural",
    lower: "female-lower-natural",
    eyeColor: "castanho",
    hairColor: "castanho-claro",
    naikeColor: "cinza",
    suitColor: "preto",
    ...overrides,
  };
}

/** Shape B: the `2dc-ficha-<family>.json` export. */
export function syntheticFicha(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    name: "Personagem sintética",
    recipe: syntheticRecipe(),
    characteristics: [
      {
        title: "Identidade e corpo",
        rows: [
          { key: "family", label: "Sexo", value: "Feminino" },
          { key: "body", label: "Corpo", value: "Equilibrada", id: "female-body-3" },
        ],
      },
    ],
    physicalHeightCm: 168,
    front: { width: 900, height: 1280 },
    additionalViews: { key: "synthetic", status: "pending", revision: "r17.3-turnaround-v1", automatic: false, views: [] },
    readyFor3D: false,
    missing: ["Vistas ortográficas validadas"],
    ...overrides,
  };
}

/** Shape C: the `2dc-receita.json` download (no ficha, no height). */
export function syntheticReceita(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return { version: "2dc-r3", recipe: syntheticRecipe(), mix: null, locks: [], ...overrides };
}

/** Shape A: the contract we ask the 2D generator to emit. */
export function syntheticBundlePayload(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    contract: "lab3d.character-import",
    contractVersion: 1,
    name: "Personagem sintética",
    source: { generator: "2dc", generatorVersion: "2dc-r3", wardrobeVersion: 1, exportedAt: "2024-01-01T00:00:00.000Z" },
    recipe: syntheticRecipe(),
    characteristics: [],
    physicalHeightCm: 168,
    front: { width: 900, height: 1280 },
    readyFor3D: false,
    missing: [],
    ...overrides,
  };
}
