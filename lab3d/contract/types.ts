/**
 * Laboratorio3D — versioned import contract between the 2D character generator
 * and the 3D pipeline.
 *
 * The shapes below were derived from the REAL exports of the 2D generator
 * (`2dc-v1`, catalog VERSION `2dc-r3`):
 *
 *   - `2dc-receita.json`      → { version, recipe, mix, locks }
 *     (dist/app.js: `#recipe` click handler)
 *   - `2dc-ficha-<family>.json` → { name, recipe, characteristics,
 *     physicalHeightCm, front, additionalViews, readyFor3D, missing }
 *     (dist/character-sheet.js: `exportData()`)
 *   - `2dc-<family>.png`      → 900 × 1280 RGBA
 *     (dist/compositor.js: `exportPNG`, WIDTH/HEIGHT)
 *
 * Nothing here invents attributes. Every field is either copied verbatim from
 * one of those exports or added by this lab and clearly namespaced.
 */

export const CONTRACT_ID = "lab3d.character-import" as const;
export const CONTRACT_VERSION = 1 as const;

/** Catalog categories, literal from 2dc-v1 `dist/catalog.js` → `categories`. */
export const RECIPE_CATEGORIES = [
  "outfit",
  "body",
  "face",
  "hair",
  "eyes",
  "nose",
  "mouth",
  "brows",
  "ears",
  "skin",
  "marks",
  "upper",
  "lower",
] as const;

export type RecipeCategory = (typeof RECIPE_CATEGORIES)[number];

/** Colour channels, literal from 2dc-v1 `dist/catalog.js` → `canonicalRecipe`. */
export const RECIPE_COLOR_KEYS = ["eyeColor", "hairColor", "naikeColor", "suitColor"] as const;

export type RecipeColorKey = (typeof RECIPE_COLOR_KEYS)[number];

export type Family = "female" | "male";

/**
 * The recipe exactly as the 2D generator emits it through `canonicalRecipe()`.
 * Extra keys are preserved so a newer 2D revision is never silently truncated.
 */
export interface CharacterRecipe {
  family: Family;
  eyeColor: string;
  hairColor: string;
  naikeColor: string;
  suitColor: string;
  outfit: string;
  body: string;
  face: string;
  hair: string;
  eyes: string;
  nose: string;
  mouth: string;
  brows: string;
  ears: string;
  skin: string;
  marks: string;
  upper: string;
  lower: string;
  /** Present only when the natural skin tone comes from a different face. */
  skinSource?: string;
  [extra: string]: unknown;
}

/** One row of the 2D "ficha" — verbatim from `characterFacts()`. */
export interface FactRow {
  key: string;
  label: string;
  value: string;
  id?: string;
  color?: string | null;
  [extra: string]: unknown;
}

export interface FactGroup {
  title: string;
  rows: FactRow[];
  [extra: string]: unknown;
}

/**
 * Reference angles the lab understands. `front` is the only angle the 2D
 * generator exports as a deterministic composite today; the others exist so a
 * caller can attach material it already has, and are carried as *labelled*
 * references. See `ReferenceImage.influence`.
 */
export const REFERENCE_ANGLES = ["front", "profile-left", "profile-right", "back", "three-quarter", "detail"] as const;

export type ReferenceAngle = (typeof REFERENCE_ANGLES)[number];

/**
 * How far a reference actually reaches into the pipeline.
 *
 * `pipeline`  — handed to the generator as the authoritative reference.
 * `stored`    — kept with the record and shown in the UI, but NOT consumed by
 *               any generation stage. Upstream Procedura takes a single
 *               `--image`; until a multi-view input path exists, every angle
 *               other than the authoritative one is `stored`.
 */
export type ReferenceInfluence = "pipeline" | "stored";

export interface ReferenceImage {
  angle: ReferenceAngle;
  /** File name inside the character record directory. */
  file: string;
  mime: "image/png" | "image/jpeg" | "image/webp";
  bytes: number;
  width: number | null;
  height: number | null;
  sha256: string;
  /** True for the single image used as the generation reference. */
  authoritative: boolean;
  influence: ReferenceInfluence;
  /** Free-text label supplied by the caller (optional). */
  note?: string;
}

export interface SourceInfo {
  /** Literal generator id. Only `2dc` is known today. */
  generator: string;
  /** `VERSION` from the 2D catalog, e.g. "2dc-r3". */
  generatorVersion: string;
  /** `WARDROBE_VERSION` when the caller provides it. */
  wardrobeVersion?: number;
  /** `VIEW_REVISION` when the caller provides it, e.g. "r17.3-turnaround-v1". */
  viewRevision?: string;
  /** ISO timestamp produced by the caller. */
  exportedAt?: string;
  /** Which real export file the data came from, for traceability. */
  adaptedFrom: "lab3d.character-import" | "2dc-receita" | "2dc-ficha";
}

/** The normalised bundle every importer produces. */
export interface CharacterBundle {
  contract: typeof CONTRACT_ID;
  contractVersion: typeof CONTRACT_VERSION;
  name: string;
  source: SourceInfo;
  recipe: CharacterRecipe;
  /** Human-readable ficha rows, when the caller sent them. */
  characteristics: FactGroup[];
  /**
   * Real-world height in centimetres. `null` when the 2D generator did not
   * record one — the lab never substitutes a guess.
   */
  physicalHeightCm: number | null;
  /** Dimensions declared by the exporter, or measured from the uploaded front. */
  front: { width: number; height: number };
  references: ReferenceImage[];
  /** Caller-declared readiness flags, carried verbatim. */
  readyFor3D: boolean;
  missing: string[];
}

/** Immutable ledger entry describing one imported character. */
export interface CharacterRecord {
  /** Stable identity: contract + generator version + recipe + image digests. */
  key: string;
  /** Short, human-friendly prefix of `key`. */
  shortKey: string;
  importedAt: string;
  bundle: CharacterBundle;
  /** SHA-256 of the canonical bundle payload, excluding volatile fields. */
  contentDigest: string;
}

export type RunPurpose = "generate" | "recompile" | "blender-authored";

/** Links a character record to one pipeline execution. */
export interface CharacterRun {
  characterKey: string;
  jobId: string;
  runId: string;
  purpose: RunPurpose;
  createdAt: string;
  /** The exact prompt text handed to the pipeline. */
  briefDigest: string;
  /** Reference file (inside the record dir) passed as `--image`. */
  referenceFile: string | null;
  options: Record<string, unknown>;
}
