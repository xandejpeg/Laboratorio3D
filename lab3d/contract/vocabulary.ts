/**
 * Translation of 2D catalog IDs into visual descriptions the 3D pipeline can
 * act on. A bare `female-body-3` tells a geometry model nothing.
 *
 * Provenance rules followed here:
 *
 *  - `label` is copied verbatim from the 2D catalog (`dist/catalog.js`).
 *  - `visual` is written from the project's own art-direction prompts
 *    (`2dc-v1/evidence/revision-12/*.prompt.txt`,
 *     `2dc-v1/evidence/revision-14/prompts/gray-suit-original-prompt.txt`)
 *    or is a faithful reading of a shape name. Nothing is invented.
 *  - `headsTall` is only present where the art prompt states it explicitly.
 *  - `visual: null` means the catalog entry is an *identity* variant whose
 *    appearance is only defined by the artwork. Those must be resolved from the
 *    reference image, never from a description.
 *  - An ID with no entry is reported as UNKNOWN. It is never guessed.
 */

import type { Family, RecipeCategory } from "./types.ts";

export interface VocabularyEntry {
  label: string;
  visual: string | null;
  /** Head-to-body ratio stated by the source art prompt, when it states one. */
  headsTall?: number;
  /** Why `visual` is null, when it is. */
  reason?: string;
}

export interface DescribedAttribute {
  category: RecipeCategory | "family" | RecipeColorAlias;
  id: string;
  label: string | null;
  visual: string | null;
  headsTall?: number;
  known: boolean;
  /** Set when the appearance is only carried by the artwork. */
  referenceOnly: boolean;
  hex?: string;
}

type RecipeColorAlias = "eyeColor" | "hairColor" | "naikeColor" | "suitColor";

const IDENTITY_REASON =
  "identity variant authored as artwork; its shape is only defined by the reference image";

const identity = (label: string): VocabularyEntry => ({
  label,
  visual: null,
  reason: IDENTITY_REASON,
});

/** Identity names, literal from `identityLabels` in the 2D catalog. */
export const IDENTITY_LABELS: Record<Family, readonly string[]> = {
  female: ["Serena", "Lívia", "Amara", "Íris", "Nina", "Helena"],
  male: ["Caio", "Davi", "Ravi", "Otávio", "Ivo", "Augusto"],
};

const FACE_SHAPES: Record<Family, VocabularyEntry[]> = {
  female: [
    { label: "Clássico 01", visual: "baseline female face outline of the family" },
    { label: "Clássico 02", visual: "second baseline female face outline of the family" },
    { label: "Oval suave", visual: "soft oval face: gently rounded jaw, no hard corners" },
    { label: "Redondo", visual: "round face: full cheeks, short chin, wide at the cheekbones" },
    { label: "Quadrado suave", visual: "softly squared face: broad jaw with rounded corners" },
    { label: "Alongado", visual: "long face: vertical proportions dominate, narrow cheeks" },
    { label: "Coração", visual: "heart-shaped face: wide forehead and cheekbones tapering to a narrow pointed chin" },
    { label: "Diamante", visual: "diamond face: narrow forehead, widest at the cheekbones, narrow chin" },
    { label: "Triangular", visual: "triangular face: narrow forehead widening toward the jaw" },
    { label: "Retangular", visual: "rectangular face: long with a straight broad jaw" },
    { label: "Anguloso", visual: "angular face: sharp cheekbones and a defined jaw line" },
    { label: "Maduro", visual: "mature face: heavier structure, softened mid-face, visible age in the planes" },
    ...IDENTITY_LABELS.female.map(identity),
  ],
  male: [
    { label: "Clássico 01", visual: "baseline male face outline of the family" },
    { label: "Clássico 02", visual: "second baseline male face outline of the family" },
    { label: "Oval", visual: "oval face: rounded jaw, balanced vertical proportions" },
    { label: "Redondo", visual: "round face: full cheeks, short chin" },
    { label: "Quadrado", visual: "square face: broad straight jaw, strong corners" },
    { label: "Alongado", visual: "long face: vertical proportions dominate" },
    { label: "Retangular", visual: "rectangular face: long with a straight broad jaw" },
    { label: "Triangular", visual: "triangular face: narrow forehead widening toward the jaw" },
    { label: "Coração", visual: "heart-shaped face: wide forehead tapering to a narrow chin" },
    { label: "Diamante", visual: "diamond face: widest at the cheekbones, narrow forehead and chin" },
    { label: "Anguloso", visual: "angular face: sharp cheekbones and a defined jaw line" },
    { label: "Maduro", visual: "mature face: heavier structure, visible age in the planes" },
    ...IDENTITY_LABELS.male.map(identity),
  ],
};

const HAIR: Record<Family, VocabularyEntry[]> = {
  female: [
    { label: "Trançado", visual: "braided hair kept close to the skull" },
    { label: "Ondulado", visual: "wavy shoulder-length hair with soft volume around the crown" },
    { label: "Chanel lateral", visual: "side-parted chin-length bob" },
    { label: "Longo liso", visual: "long straight hair falling past the shoulders" },
    { label: "Ondas largas", visual: "long hair in wide loose waves" },
    { label: "Rabo alto", visual: "high ponytail: hair pulled back tight over the skull, tail rising from the crown" },
    { label: "Pixie lateral", visual: "short side-swept pixie cut, close at the nape" },
    { label: "Cachos definidos", visual: "defined curls with clear individual curl clusters" },
    { label: "Afro arredondado", visual: "rounded afro forming an even dome around the whole skull" },
    { label: "Duas tranças", visual: "two braids, one on each side" },
  ],
  male: [
    { label: "Bagunçado 1", visual: "short messy hair with irregular strands" },
    { label: "Bagunçado 2", visual: "second short messy variant with more volume on top" },
    { label: "Hi Fade", visual: "high fade: very short sides climbing high, volume kept on top" },
    { label: "Careca", visual: "shaved head: scalp silhouette is the head silhouette" },
    { label: "Moicano", visual: "mohawk: shaved sides with a central strip of raised hair" },
    { label: "Punk Espetado", visual: "spiked punk hair standing away from the scalp" },
    { label: "Razor Part", visual: "side part with a shaved line, short sides" },
    { label: "Coque Samurai", visual: "top knot: hair gathered into a bun above the crown, sides pulled back" },
    { label: "Black Power", visual: "rounded afro forming an even dome around the whole skull" },
    { label: "Chavoso", visual: "short styled cut with a sharp edge-up at the hairline" },
    { label: "De Raul", visual: "longer swept hair covering the ears" },
    { label: "Reflexo de Cria", visual: "short cut with a bleached/contrasting top section" },
  ],
};

/**
 * Body builds. Head counts and volumes come from the authored art prompts in
 * `evidence/revision-12`. Index 0 is the original base artwork (no dedicated
 * prompt); indices 1..5 match, in order, the artwork ids
 * compact / tall / athletic / curvy / plus (female) and
 * compact / tall / muscular / belly / heavy (male).
 */
const BODY: Record<Family, VocabularyEntry[]> = {
  female: [
    { label: "Original", visual: "the family's original slender adult female base build" },
    {
      label: "Baixa e compacta",
      visual:
        "short compact adult woman: shorter legs, compact torso, moderately soft rounded flesh at abdomen, upper arms and thighs, narrow gently sloping shoulders, natural hips, small complete hands",
      headsTall: 6.2,
    },
    {
      label: "Alta e esguia",
      visual:
        "tall very slender adult woman: small head, long slim neck, elongated narrow rib cage, narrow hips, long lean legs and slender long arms, narrow softly sloping shoulders",
      headsTall: 7.2,
    },
    {
      label: "Equilibrada",
      visual:
        "fit adult woman: rounded deltoids and upper arms, substantial forearms, solid thighs and calves, defined natural waist, shoulders broad enough for an athlete but balanced by feminine hips, modest natural bust. Functional strength, not a bodybuilder",
      headsTall: 6.7,
      reason:
        "catalog label is 'Equilibrada' while the underlying artwork was authored as the athletic build; described from the artwork",
    },
    {
      label: "Curvilínea",
      visual:
        "full curvy adult woman: broad rounded pelvis and hips, full thick thighs, rounded seat volume, fuller bust, soft upper arms and forearms, shoulders clearly narrower than the hips, natural only moderately defined waist",
      headsTall: 6.5,
    },
    {
      label: "Ampla",
      visual:
        "plus-size adult woman: substantial rounded belly, full waist and torso, fuller bust, soft full arms, broad round hips, very thick thighs and calves, naturally sloped shoulders",
    },
  ],
  male: [
    { label: "Original", visual: "the family's original average broad-shouldered adult male base build" },
    { label: "Baixo e compacto", visual: "short compact adult man: shorter legs, compact torso, sturdy limbs" },
    { label: "Alto e magro", visual: "tall lean adult man: long limbs, narrow rib cage and hips, slight build" },
    { label: "Musculoso", visual: "muscular adult man: developed shoulders, chest and arms, tapered waist" },
    { label: "Barrigudo", visual: "adult man with a prominent belly over an otherwise average frame" },
    { label: "Grandalhão", visual: "large heavy adult man: broad and thick throughout, wide shoulders and torso" },
  ],
};

const EYES_BASE: VocabularyEntry[] = [
  { label: "Clássico", visual: "neutral almond eye opening of the family baseline" },
  { label: "Marcado", visual: "strongly outlined eyes with a heavier lash line" },
  { label: "Amendoados", visual: "almond eyes tapering at the outer corner" },
  { label: "Arredondados", visual: "round wide-open eyes" },
  { label: "Serenos", visual: "calm slightly hooded eyes with a relaxed upper lid" },
  { label: "Intensos", visual: "intense narrowed eyes with a lowered upper lid" },
];

const MARKS: VocabularyEntry[] = [
  { label: "0 · Sem marca", visual: "no facial mark" },
  { label: "1 · Cicatriz no olho", visual: "scar crossing the eye region" },
  { label: "2 · Cicatriz na maçã", visual: "scar on the cheekbone" },
  { label: "3 · Olheira fraca", visual: "faint under-eye shadow" },
  { label: "4 · Olheira forte", visual: "pronounced under-eye shadow" },
];

/**
 * Outfits. `Macacão cinza` is described from the garment brief that produced
 * the artwork (`evidence/revision-14/prompts/gray-suit-original-prompt.txt`).
 */
const OUTFIT: VocabularyEntry[] = [
  {
    label: "Macacão cinza",
    visual:
      "plain medium-gray opaque matte fitted long-sleeved ONE-PIECE COVERALL: small round collar at the base of the neck, covered shoulders, torso and arms down to the wrists, fitted legs down to the ankles, thin plain gray low-profile shoes. Neck and hands remain bare skin. No belt, cargo pockets, straps, vest, zipper or decoration; plain gray across the whole garment. Fabric follows the natural body silhouette smoothly — it is a neutral anatomy-readable base garment, not armour and not a glossy suit",
  },
  {
    label: "Conjunto 1",
    visual:
      "mix-and-match set: the `upper` and `lower` selections define the actual garments (burgundy short-sleeve collared polo with an open charcoal work vest, belt with a rectangular metal buckle, and the chosen trousers with work boots)",
  },
  { label: "Mecânico 1", visual: "mechanic work outfit, supplied as a single complete garment set" },
  { label: "Naike Tech", visual: "technical sportswear set in a single colour, colour given by `naikeColor`" },
  { label: "Terno", visual: "formal suit: jacket, shirt and trousers, colour given by `suitColor`" },
];

const UPPER: VocabularyEntry[] = [
  {
    label: "Oficina",
    visual: "workshop top: burgundy short-sleeve collared polo under an open charcoal work vest with pockets and stitching",
  },
  { label: "Concessionária", visual: "dealership top: cleaner presentable shirt-based upper" },
];

const LOWER: Record<Family, VocabularyEntry[]> = {
  female: [
    {
      label: "Cargo oliva",
      visual: "olive cargo trousers with side cargo pockets and dark reinforced knee patches, dark brown work boots",
    },
    { label: "Social azul", visual: "clean navy-blue dress trousers with no cargo pockets or knee patches" },
  ],
  male: [
    {
      label: "Cargo grafite",
      visual: "graphite cargo trousers with side cargo pockets and reinforced knee patches, work boots",
    },
    { label: "Social azul", visual: "clean navy-blue dress trousers with no cargo pockets or knee patches" },
  ],
};

/** Skin tone labels and hex values, literal from the 2D `skinTones` table. */
export const SKIN_TONES: { id: string; label: string; hex: string | null }[] = [
  { id: "natural", label: "Natural do rosto", hex: null },
  { id: "pele-01", label: "Pele 01", hex: "#efd4bf" },
  { id: "pele-02", label: "Pele 02", hex: "#e3bda3" },
  { id: "pele-03", label: "Pele 03", hex: "#d4a17e" },
  { id: "pele-04", label: "Pele 04", hex: "#bf8863" },
  { id: "pele-05", label: "Pele 05", hex: "#ab724f" },
  { id: "pele-06", label: "Pele 06", hex: "#96613f" },
  { id: "pele-07", label: "Pele 07", hex: "#7d5038" },
  { id: "pele-08", label: "Pele 08", hex: "#663f30" },
  { id: "pele-09", label: "Pele 09", hex: "#503125" },
  { id: "pele-10", label: "Pele 10", hex: "#38261f" },
];

/** Colour palettes, literal from the 2D catalog. */
export const COLOR_PALETTES: Record<RecipeColorAlias, { id: string; label: string; hex: string }[]> = {
  eyeColor: [
    { id: "castanho", label: "Castanho", hex: "#75462a" },
    { id: "mel", label: "Mel", hex: "#b57d2e" },
    { id: "avela", label: "Avelã", hex: "#8c8745" },
    { id: "verde", label: "Verde", hex: "#508553" },
    { id: "azul", label: "Azul", hex: "#467dbb" },
    { id: "cinza", label: "Cinza", hex: "#8794a5" },
  ],
  hairColor: [
    { id: "loiro", label: "Loiro", hex: "#d0a766" },
    { id: "ruivo", label: "Ruivo", hex: "#b7522e" },
    { id: "castanho-escuro", label: "Castanho escuro", hex: "#493025" },
    { id: "castanho-claro", label: "Castanho claro", hex: "#a47550" },
    { id: "preto", label: "Preto", hex: "#202127" },
    { id: "branco", label: "Branco", hex: "#e6e3dc" },
  ],
  naikeColor: [
    { id: "cinza", label: "Cinza", hex: "#93969b" },
    { id: "preto", label: "Preto", hex: "#282b31" },
    { id: "marinho", label: "Azul-marinho", hex: "#233b61" },
  ],
  suitColor: [
    { id: "preto", label: "Preto", hex: "#292c33" },
    { id: "vinho", label: "Vinho", hex: "#752d40" },
  ],
};

const perFamily = (family: Family): Partial<Record<RecipeCategory, VocabularyEntry[]>> => ({
  face: FACE_SHAPES[family],
  hair: HAIR[family],
  body: BODY[family],
  outfit: OUTFIT,
  upper: UPPER,
  lower: LOWER[family],
  marks: MARKS,
  eyes: [...EYES_BASE, ...IDENTITY_LABELS[family].map((n) => identity(`Olhar · ${n}`))],
  nose: [
    { label: "Nariz 01", visual: "baseline nose of the family" },
    { label: "Nariz 02", visual: "second baseline nose of the family" },
    ...IDENTITY_LABELS[family].map((n) => identity(`Nariz · ${n}`)),
  ],
  mouth: [
    { label: "Boca 01", visual: "baseline mouth of the family" },
    { label: "Boca 02", visual: "second baseline mouth of the family" },
    ...IDENTITY_LABELS[family].map((n) => identity(`Boca · ${n}`)),
  ],
  brows: [
    { label: "Clássica 01", visual: "baseline eyebrow shape of the family" },
    { label: "Clássica 02", visual: "second baseline eyebrow shape of the family" },
    ...IDENTITY_LABELS[family].map((n) => identity(`Sobrancelhas · ${n}`)),
  ],
  ears: IDENTITY_LABELS[family].map((n) => identity(`Orelhas · ${n}`)),
  skin: SKIN_TONES.map((t) => ({
    label: t.label,
    visual: t.hex ? `skin tone ${t.label} (${t.hex})` : "skin tone taken from the selected face artwork",
  })),
});

const VOCABULARY: Record<Family, Partial<Record<RecipeCategory, VocabularyEntry[]>>> = {
  female: perFamily("female"),
  male: perFamily("male"),
};

const ID_PATTERN = /^(female|male)-([a-z]+)-(natural|\d+)$/;

/** Parse a catalog id into its parts. Returns null when the shape is unknown. */
export function parseCatalogId(id: string): { family: Family; category: string; index: number | "natural" } | null {
  const m = ID_PATTERN.exec(id);
  if (!m) return null;
  const [, family, category, tail] = m;
  return {
    family: family as Family,
    category: category!,
    index: tail === "natural" ? "natural" : Number(tail),
  };
}

/** Describe one recipe attribute. Never guesses: unknown ids come back `known: false`. */
export function describeAttribute(family: Family, category: RecipeCategory, id: string): DescribedAttribute {
  const parsed = parseCatalogId(id);
  if (!parsed || parsed.family !== family || parsed.category !== category) {
    return { category, id, label: null, visual: null, known: false, referenceOnly: false };
  }
  if (parsed.index === "natural") {
    return {
      category,
      id,
      label: "Natural do rosto",
      visual: "inherited from the selected face artwork, not chosen separately",
      known: true,
      referenceOnly: false,
    };
  }
  const entry = VOCABULARY[family][category]?.[parsed.index];
  if (!entry) {
    return { category, id, label: null, visual: null, known: false, referenceOnly: false };
  }
  const described: DescribedAttribute = {
    category,
    id,
    label: entry.label,
    visual: entry.visual,
    known: true,
    referenceOnly: entry.visual === null,
  };
  if (entry.headsTall !== undefined) described.headsTall = entry.headsTall;
  if (category === "skin") {
    const hex = SKIN_TONES[parsed.index]?.hex;
    if (hex) described.hex = hex;
  }
  return described;
}

/** Describe one colour channel. */
export function describeColor(key: RecipeColorAlias, id: string): DescribedAttribute {
  const found = COLOR_PALETTES[key].find((c) => c.id === id);
  if (!found) return { category: key, id, label: null, visual: null, known: false, referenceOnly: false };
  return {
    category: key,
    id,
    label: found.label,
    visual: `${found.label} (${found.hex})`,
    hex: found.hex,
    known: true,
    referenceOnly: false,
  };
}
