/**
 * Turns an imported character into the text the Procedura pipeline actually
 * receives, plus an honest account of what that text does NOT cover.
 *
 * Three rules govern this file:
 *  - every attribute keeps its 2D id AND gains a visual description;
 *  - an id with no vocabulary entry is reported, never guessed;
 *  - no measurement is invented. Head-to-body ratios appear only when the 2D
 *    art direction stated one, and a real height only when the ficha carried it.
 */

import { RECIPE_CATEGORIES, RECIPE_COLOR_KEYS, type CharacterBundle, type RecipeCategory } from "../contract/types.ts";
import { describeAttribute, describeColor, type DescribedAttribute } from "../contract/vocabulary.ts";

export interface InferredRegion {
  region: string;
  reason: string;
}

export interface CharacterBrief {
  /** The prompt handed to the pipeline via `--prompt-file`. */
  text: string;
  /** Attributes in the order they are described. */
  attributes: DescribedAttribute[];
  /** Ids the vocabulary does not know. Surfaced in the UI; not guessed. */
  unknownIds: { category: string; id: string }[];
  /** Attributes whose appearance only exists in the artwork. */
  referenceOnly: DescribedAttribute[];
  /** Body regions with no visual reference in the supplied images. */
  inferredRegions: InferredRegion[];
  /** Head-to-body ratio, only when the 2D art direction stated one. */
  headsTall: number | null;
  /** Real height, only when the ficha carried one. */
  physicalHeightCm: number | null;
}

/**
 * Categories that only matter for the mix-and-match outfit. When any other
 * outfit is selected the 2D compositor ignores them, so describing them would
 * put garments in the brief that are not in the picture.
 */
const MIX_ONLY: RecipeCategory[] = ["upper", "lower"];

const CATEGORY_TITLES: Record<RecipeCategory, string> = {
  outfit: "Outfit",
  body: "Body build",
  face: "Face shape",
  hair: "Hair",
  eyes: "Eye shape",
  nose: "Nose",
  mouth: "Mouth",
  brows: "Eyebrows",
  ears: "Ears",
  skin: "Skin tone",
  marks: "Facial marks",
  upper: "Upper garment",
  lower: "Lower garment and footwear",
};

const COLOR_TITLES: Record<(typeof RECIPE_COLOR_KEYS)[number], string> = {
  eyeColor: "Iris colour",
  hairColor: "Hair colour",
  naikeColor: "Sportswear colour",
  suitColor: "Suit colour",
};

/** Colour channels the 2D compositor ignores unless its outfit is selected. */
function colorApplies(key: (typeof RECIPE_COLOR_KEYS)[number], outfitId: string, family: string): boolean {
  if (key === "naikeColor") return outfitId === `${family}-outfit-3`;
  if (key === "suitColor") return outfitId === `${family}-outfit-4`;
  return true;
}

export function buildBrief(bundle: CharacterBundle): CharacterBrief {
  const { recipe } = bundle;
  const family = recipe.family;
  const isMixOutfit = recipe.outfit === `${family}-outfit-1`;

  const attributes: DescribedAttribute[] = [];
  for (const category of RECIPE_CATEGORIES) {
    if (MIX_ONLY.includes(category) && !isMixOutfit) continue;
    const id = recipe[category];
    if (typeof id !== "string") continue;
    attributes.push(describeAttribute(family, category, id));
  }
  for (const key of RECIPE_COLOR_KEYS) {
    if (!colorApplies(key, recipe.outfit, family)) continue;
    attributes.push(describeColor(key, recipe[key]));
  }
  if (recipe.skin === `${family}-skin-0` && typeof recipe.skinSource === "string") {
    const skin = attributes.find((a) => a.category === "skin");
    const source = describeAttribute(family, "face", recipe.skinSource);
    if (skin) skin.visual = `natural skin colour inherited from ${source.label ?? "the source identity"} [skinSource=${recipe.skinSource}], not necessarily the selected face. Preserve the colour visible in the PNG; no RGB value is invented.`;
  }

  const unknownIds = attributes.filter((a) => !a.known).map((a) => ({ category: String(a.category), id: a.id }));
  const referenceOnly = attributes.filter((a) => a.known && a.referenceOnly);
  const headsTall = attributes.find((a) => a.headsTall !== undefined)?.headsTall ?? null;

  return {
    text: renderPrompt(bundle, attributes, headsTall),
    attributes,
    unknownIds,
    referenceOnly,
    inferredRegions: inferredRegions(bundle),
    headsTall,
    physicalHeightCm: bundle.physicalHeightCm,
  };
}

/**
 * Regions the pipeline has to invent because no supplied reference shows them.
 * Only references actually connected to generation can reduce its uncertainty.
 * Stored review images do not supply hidden geometry to the model.
 */
export function inferredRegions(bundle: CharacterBundle): InferredRegion[] {
  const angles = new Set(bundle.references.filter((r) => r.influence === "pipeline").map((r) => r.angle));
  const out: InferredRegion[] = [];
  const add = (region: string, reason: string) => out.push({ region, reason });

  if (!angles.has("back")) add("back of the body, back of the head and hair, garment rear", "no back reference supplied");
  if (!angles.has("profile-left") && !angles.has("profile-right") && !angles.has("three-quarter")) {
    add("body depth: chest/back thickness, side of the skull, nose and ear projection", "no profile or 3/4 reference supplied");
  }
  add("top of the head and crown of the hair", "the 2D composite is a straight frontal view; the crown is not visible");
  add("soles of the feet and palms of the hands", "not visible in a straight frontal standing pose");
  add("underside of the chin and jaw", "not visible in a straight frontal view");
  return out;
}

function renderPrompt(bundle: CharacterBundle, attributes: DescribedAttribute[], headsTall: number | null): string {
  const { recipe } = bundle;
  const lines: string[] = [];

  lines.push(
    `Build a single connected 3D model of ONE standing adult ${recipe.family === "female" ? "woman" : "man"}, ` +
      "matching the attached reference image. The reference is the authority for identity, silhouette and proportions.",
  );
  lines.push("");
  lines.push("REFERENCE");
  lines.push(
    `- The attached image is a straight frontal full-body composite, ${bundle.front.width} x ${bundle.front.height} px, ` +
      "feet on the baseline, arms slightly away from the torso.",
  );
  for (const ref of bundle.references) {
    if (ref.authoritative) continue;
    lines.push(`- A "${ref.angle}" reference exists in the record but is NOT fed to this generation.`);
  }
  lines.push("");

  lines.push("PROPORTIONS");
  if (headsTall !== null) {
    lines.push(`- Head-to-body ratio of this build: approximately ${headsTall} heads tall.`);
  } else {
    lines.push("- No head-to-body ratio is recorded for this build; take it from the reference image.");
  }
  if (bundle.physicalHeightCm !== null) {
    lines.push(`- Declared real height: ${bundle.physicalHeightCm} cm.`);
  } else {
    lines.push("- No real-world height was recorded. Do not assume one; keep the reference's relative proportions.");
  }
  lines.push(
    "- Do not add muscle mass, do not slim the figure and do not idealise the silhouette. " +
      "Shoulder width, waist, hips and limb thickness must follow the reference.",
  );
  lines.push("");

  lines.push("ATTRIBUTES (2D id → appearance)");
  lines.push("Descriptions and art-direction ratios are context, not measurements of this export. If they conflict with visible anatomy, clothing or footwear, preserve the attached image.");
  for (const a of attributes) {
    const title = CATEGORY_TITLES[a.category as RecipeCategory] ?? COLOR_TITLES[a.category as keyof typeof COLOR_TITLES] ?? a.category;
    if (!a.known) {
      lines.push(`- ${title} [${a.id}]: UNKNOWN id — not in this lab's vocabulary. Take it entirely from the reference image.`);
      continue;
    }
    if (a.referenceOnly) {
      lines.push(`- ${title} [${a.id}] "${a.label}": authored artwork with no written description. Take it from the reference image.`);
      continue;
    }
    lines.push(`- ${title} [${a.id}] "${a.label}": ${a.visual}`);
  }
  lines.push("");

  const inferred = inferredRegions(bundle);
  if (inferred.length) {
    lines.push("REGIONS WITHOUT VISUAL REFERENCE (must be inferred, keep them plain and plausible)");
    for (const r of inferred) lines.push(`- ${r.region} — ${r.reason}.`);
    lines.push("");
  }

  lines.push("GEOMETRY REQUIREMENTS");
  lines.push("- Use +Z up, -Y front and +X the object's right in the modelling convention. State anatomical left/right explicitly; do not infer a mirror operation from screen position alone.");
  lines.push("- Model the figure as named parts: head, neck, torso, hips, upper arms, forearms, hands, thighs, shins, feet, hair, garment.");
  lines.push("- Every part must touch or overlap its neighbour so the result is one connected solid.");
  lines.push("- Keep the hair as its own part sitting on the skull; it must follow the cranium, not float above it.");
  lines.push("- Each hand needs a shaped palm, a correctly opposed thumb and four fingers, with visible taper and plausible knuckles. Keep digits attached and follow the reference's pose; do not substitute a ball, fork or block for a hand.");
  lines.push("- Match the footwear actually visible in the image: ankle transition, heel, sole thickness and toe direction. Check front and profile so feet do not point sideways or appear as blocks.");
  lines.push("- Build the face from the visible skull, jaw, cheek, brow, eyelid, nose and mouth proportions. Facial features must follow the surface; do not attach protruding spheres as eyes or a detached lip/nose. Preserve the visible expression and hairline.");
  lines.push("- The pelvis and buttocks must form a continuous transition between the clothed waist and thighs. Infer hidden depth conservatively; do not add exaggerated lobes, muscle or exposed mechanical joints.");
  lines.push("- Keep the standing pose shown in the reference, including arm spacing, hand orientation and foot spacing. Do not replace it with a T-pose or invent a pedestal.");
  lines.push("- If assembly or rigid motion is enabled, keep its interfaces inside the existing body silhouette. Mechanical export must not add external hinges, gaps or accessories absent from the reference; it is not a deformable human rig.");
  lines.push("");
  lines.push("VISUAL REVIEW PRIORITIES");
  lines.push("- Compare the frontal render with the reference using head/body, shoulder/waist/hip and limb-length ratios within each image. Compare ratios, not raw pixels from independently fitted cameras.");
  lines.push("- Review face, both hands, both feet and pelvis explicitly, then inspect front, both profiles and back for gaps or intersections. A compiling model, higher polygon count or painted surface is not evidence of resemblance.");
  lines.push("- Label profile/back geometry as inferred when those references are absent. Do not claim unseen anatomy or identity has been verified. If a critical region cannot be judged at the provided resolution, state the uncertainty instead of declaring it correct.");

  return lines.join("\n");
}
