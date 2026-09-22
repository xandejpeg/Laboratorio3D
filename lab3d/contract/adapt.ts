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
    if (typeof r[key] !== "string" || !(r[key] as string).length) {
      problems.push(`recipe.${key} must be a non-empty string (send canonicalRecipe())`);
    }
  }
  for (const key of RECIPE_COLOR_KEYS) {
    if (typeof r[key] !== "string" || !(r[key] as string).length) {
      problems.push(`recipe.${key} must be a non-empty string (send canonicalRecipe())`);
    }
  }
  if (r["skinSource"] !== undefined && typeof r["skinSource"] !== "string") {
    problems.push("recipe.skinSource must be a string when present");
  }
  if (problems.length) throw new ContractError("invalid recipe", problems);
  return r as unknown as CharacterRecipe;
}

function parseCharacteristics(raw: unknown): FactGroup[] {
  if (raw === undefined || raw === null) return [];
  if (!Array.isArray(raw)) throw new ContractError("characteristics must be an array");
  return raw.map((group, i) => {
    const g = asRecord(group, `characteristics[${i}]`);
    const rows = Array.isArray(g["rows"]) ? (g["rows"] as unknown[]) : [];
    return {
      title: typeof g["title"] === "string" ? g["title"] : `Grupo ${i + 1}`,
      rows: rows.map((row, j) => {
        const r = asRecord(row, `characteristics[${i}].rows[${j}]`);
        const out: FactGroup["rows"][number] = {
          key: String(r["key"] ?? ""),
          label: String(r["label"] ?? ""),
          value: String(r["value"] ?? ""),
        };
        if (typeof r["id"] === "string") out.id = r["id"];
        if (typeof r["color"] === "string") out.color = r["color"];
        return out;
      }),
    };
  });
}

function parseHeight(raw: unknown): number | null {
  if (raw === undefined || raw === null || raw === "") return null;
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) throw new ContractError("physicalHeightCm must be a positive number or null");
  if (n < 50 || n > 260) throw new ContractError("physicalHeightCm is outside a plausible human range (50–260 cm)");
  return n;
}

function parseFront(raw: unknown): { width: number; height: number } {
  if (raw === undefined || raw === null) return { width: 900, height: 1280 };
  const f = asRecord(raw, "front");
  const width = Number(f["width"]);
  const height = Number(f["height"]);
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
    throw new ContractError("front.width and front.height must be positive numbers");
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
    const version = Number(r["contractVersion"]);
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
    front: parseFront(r["front"]),
    references: opts.references,
    readyFor3D: r["readyFor3D"] === true,
    missing: Array.isArray(r["missing"]) ? (r["missing"] as unknown[]).map(String) : [],
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
