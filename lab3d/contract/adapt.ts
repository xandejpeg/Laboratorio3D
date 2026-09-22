/**
 * Adapters: real 2D export files → the lab's `CharacterBundle`.
 *
 * Three input shapes are accepted, all verified against the 2D source:
 *
 *  A. `lab3d.character-import` v1 — what we ask the 2D generator to emit.
 *  B. `2dc-ficha-<family>.json`   — `exportData()` in dist/character-sheet.js.
 *  C. `2dc-receita.json`          — the `#recipe` download in dist/app.js.
 *
 * C carries no ficha and no height, so its bundle has an empty
 * `characteristics` array and `physicalHeightCm: null`. The lab does not
 * fabricate the missing values; it records them as absent.
 */

import {
  CONTRACT_ID,
  CONTRACT_VERSION,
  RECIPE_CATEGORIES,
  RECIPE_COLOR_KEYS,
  type CharacterBundle,
  type CharacterRecipe,
  type FactGroup,
  type Family,
  type ReferenceImage,
} from "./types.ts";

export class ContractError extends Error {
  constructor(
    message: string,
    readonly details: string[] = [],
  ) {
    super(message);
    this.name = "ContractError";
  }
}

const FAMILIES: readonly Family[] = ["female", "male"];

function asRecord(value: unknown, what: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new ContractError(`${what} must be a JSON object`);
  }
  return value as Record<string, unknown>;
}

/**
 * Validate a recipe without re-implementing the 2D catalog. We check the
 * structure the contract depends on (family, required category keys, colour
 * keys as strings) and keep every other key verbatim. Whether an individual id
 * exists in the catalog is answered later by the vocabulary, which reports
 * unknown ids instead of rejecting them — a newer 2D revision must not be
 * blocked at the door.
 */
export function parseRecipe(raw: unknown): CharacterRecipe {
  const r = asRecord(raw, "recipe");
  const problems: string[] = [];
  const family = r["family"];
  if (typeof family !== "string" || !FAMILIES.includes(family as Family)) {
    problems.push(`recipe.family must be one of ${FAMILIES.join(", ")}`);
  }
  for (const key of RECIPE_CATEGORIES) {
    if (typeof r[key] !== "string" || !(r[key] as string).trim().length) {
      problems.push(`recipe.${key} must be a non-empty string (send canonicalRecipe())`);
    }
  }
  for (const key of RECIPE_COLOR_KEYS) {
    if (typeof r[key] !== "string" || !(r[key] as string).trim().length) {
      problems.push(`recipe.${key} must be a non-empty string (send canonicalRecipe())`);
    }
  }
  if (r["skinSource"] !== undefined && typeof r["skinSource"] !== "string") {
    problems.push("recipe.skinSource must be a string when present");
  }
  if (problems.length) throw new ContractError("invalid recipe", problems);
  return structuredClone(r) as unknown as CharacterRecipe;
}

function parseCharacteristics(raw: unknown): FactGroup[] {
  if (raw === undefined || raw === null) return [];
  if (!Array.isArray(raw)) throw new ContractError("characteristics must be an array");
  return raw.map((group, i) => {
    const g = asRecord(group, `characteristics[${i}]`);
    if (typeof g["title"] !== "string" || !Array.isArray(g["rows"])) {
      throw new ContractError(`characteristics[${i}] must have a string title and an array of rows`);
    }
    const rows = g["rows"] as unknown[];
    return {
      ...structuredClone(g),
      title: g["title"],
      rows: rows.map((row, j) => {
        const r = asRecord(row, `characteristics[${i}].rows[${j}]`);
        for (const key of ["key", "label", "value"]) {
          if (typeof r[key] !== "string") {
            throw new ContractError(`characteristics[${i}].rows[${j}].${key} must be a string`);
          }
        }
        if (r["id"] !== undefined && typeof r["id"] !== "string") {
          throw new ContractError(`characteristics[${i}].rows[${j}].id must be a string`);
        }
        if (r["color"] !== undefined && r["color"] !== null && typeof r["color"] !== "string") {
          throw new ContractError(`characteristics[${i}].rows[${j}].color must be a string or null`);
        }
        return structuredClone(r) as unknown as FactGroup["rows"][number];
      }),
    };
  });
}

function parseHeight(raw: unknown): number | null {
  if (raw === undefined || raw === null) return null;
  if (typeof raw !== "number") throw new ContractError("physicalHeightCm must be a number or null");
  const n = raw;
  if (!Number.isFinite(n) || n <= 0) throw new ContractError("physicalHeightCm must be a positive number or null");
  if (n < 50 || n > 260) throw new ContractError("physicalHeightCm is outside a plausible human range (50–260 cm)");
  return n;
}

function parseFront(raw: unknown, references: ReferenceImage[]): { width: number; height: number } {
  if (raw === undefined || raw === null) {
    const front = references.find((r) => r.angle === "front");
    if (front?.width && front?.height) return { width: front.width, height: front.height };
    throw new ContractError("front dimensions are absent and could not be read from the frontal image");
  }
  const f = asRecord(raw, "front");
  const width = f["width"];
  const height = f["height"];
  if (typeof width !== "number" || typeof height !== "number" || !Number.isSafeInteger(width) || !Number.isSafeInteger(height) || width <= 0 || height <= 0) {
    throw new ContractError("front.width and front.height must be positive integers");
  }
  return { width, height };
}

export interface AdaptOptions {
  /** References already written to disk and digested by the importer. */
  references: ReferenceImage[];
  /** Fallback display name when the payload has none. */
  fallbackName?: string;
}

/** Detect which of the three accepted shapes a payload is. */
export function detectShape(raw: unknown): "lab3d" | "ficha" | "receita" {
  const r = asRecord(raw, "payload");
  if ("contract" in r && r["contract"] !== CONTRACT_ID) {
    throw new ContractError(`unsupported contract ${String(r["contract"])}`);
  }
  if (r["contract"] === CONTRACT_ID) return "lab3d";
  if ("characteristics" in r || "additionalViews" in r) return "ficha";
  if ("recipe" in r && "version" in r) return "receita";
  if ("recipe" in r) return "ficha";
  throw new ContractError("unrecognised payload", [
    "expected a lab3d.character-import bundle, a 2dc-ficha-*.json, or a 2dc-receita.json",
  ]);
}

export function adaptToBundle(raw: unknown, opts: AdaptOptions): CharacterBundle {
  const shape = detectShape(raw);
  const r = asRecord(raw, "payload");
  const recipe = parseRecipe(r["recipe"]);

  if (shape === "lab3d") {
    const version = r["contractVersion"];
    if (version !== CONTRACT_VERSION) {
      throw new ContractError(
        `unsupported contractVersion ${r["contractVersion"] ?? "(missing)"}; this lab implements ${CONTRACT_VERSION}`,
      );
    }
  }

  const source = asRecord(r["source"] ?? {}, "source");
  const generatorVersion =
    (typeof source["generatorVersion"] === "string" && source["generatorVersion"]) ||
    (typeof r["version"] === "string" && r["version"]) ||
    "unknown";

  if (r["readyFor3D"] !== undefined && typeof r["readyFor3D"] !== "boolean") {
    throw new ContractError("readyFor3D must be a boolean when present");
  }
  if (r["missing"] !== undefined && (!Array.isArray(r["missing"]) || !r["missing"].every((item) => typeof item === "string"))) {
    throw new ContractError("missing must be an array of strings when present");
  }

  const bundle: CharacterBundle = {
    contract: CONTRACT_ID,
    contractVersion: CONTRACT_VERSION,
    name:
      (typeof r["name"] === "string" && r["name"].trim()) ||
      opts.fallbackName ||
      `Personagem ${recipe.family}`,
    source: {
      generator: typeof source["generator"] === "string" ? source["generator"] : "2dc",
      generatorVersion,
      adaptedFrom: shape === "lab3d" ? CONTRACT_ID : shape === "ficha" ? "2dc-ficha" : "2dc-receita",
      ...(typeof source["wardrobeVersion"] === "number" ? { wardrobeVersion: source["wardrobeVersion"] } : {}),
      ...(viewRevisionOf(r, source) ? { viewRevision: viewRevisionOf(r, source)! } : {}),
      ...(typeof source["exportedAt"] === "string" ? { exportedAt: source["exportedAt"] } : {}),
    },
    recipe,
    characteristics: parseCharacteristics(r["characteristics"]),
    physicalHeightCm: parseHeight(r["physicalHeightCm"]),
    front: parseFront(r["front"], opts.references),
    references: structuredClone(opts.references),
    readyFor3D: r["readyFor3D"] === true,
    missing: r["missing"] ? [...r["missing"] as string[]] : [],
  };
  return bundle;
}

function viewRevisionOf(r: Record<string, unknown>, source: Record<string, unknown>): string | null {
  if (typeof source["viewRevision"] === "string") return source["viewRevision"];
  const views = r["additionalViews"];
  if (views && typeof views === "object" && !Array.isArray(views)) {
    const rev = (views as Record<string, unknown>)["revision"];
    if (typeof rev === "string") return rev;
  }
  return null;
}
