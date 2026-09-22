import { describe, expect, test } from "bun:test";

import { adaptToBundle, ContractError, detectShape, parseRecipe } from "../contract/adapt.ts";
import { characterKey, canonicalJson, contentDigest } from "../contract/identity.ts";
import { describeAttribute, describeColor } from "../contract/vocabulary.ts";
import { buildBrief } from "../src/brief.ts";
import { sniffImage } from "../src/image.ts";
import { syntheticBundlePayload, syntheticFicha, syntheticPng, syntheticRecipe, syntheticReceita } from "./fixtures.ts";
import type { ReferenceImage } from "../contract/types.ts";

const frontRef = (sha = "aaaa"): ReferenceImage => ({
  angle: "front",
  file: "front.png",
  mime: "image/png",
  bytes: 1234,
  width: 900,
  height: 1280,
  sha256: sha,
  authoritative: true,
  influence: "pipeline",
});

const backRef: ReferenceImage = {
  angle: "back",
  file: "back.png",
  mime: "image/png",
  bytes: 999,
  width: 900,
  height: 1280,
  sha256: "bbbb",
  authoritative: false,
  influence: "stored",
};

describe("shape detection", () => {
  test("recognises all three accepted payloads", () => {
    expect(detectShape(syntheticBundlePayload())).toBe("lab3d");
    expect(detectShape(syntheticFicha())).toBe("ficha");
    expect(detectShape(syntheticReceita())).toBe("receita");
  });

  test("rejects an unrecognised payload instead of improvising", () => {
    expect(() => detectShape({ hello: "world" })).toThrow(ContractError);
  });
});

describe("recipe validation", () => {
  test("accepts a canonical recipe and preserves unknown keys", () => {
    const recipe = parseRecipe(syntheticRecipe({ futureKey: "female-future-1" }));
    expect(recipe.family).toBe("female");
    expect((recipe as Record<string, unknown>)["futureKey"]).toBe("female-future-1");
  });

  test("reports every missing key at once", () => {
    const partial = syntheticRecipe();
    delete (partial as Record<string, unknown>)["hair"];
    delete (partial as Record<string, unknown>)["skin"];
    try {
      parseRecipe(partial);
      throw new Error("should have thrown");
    } catch (e) {
      expect(e).toBeInstanceOf(ContractError);
      expect((e as ContractError).details.join(" ")).toContain("recipe.hair");
      expect((e as ContractError).details.join(" ")).toContain("recipe.skin");
    }
  });

  test("rejects an unknown family", () => {
    expect(() => parseRecipe(syntheticRecipe({ family: "robot" }))).toThrow(ContractError);
  });
});

describe("adapters", () => {
  test("ficha keeps the declared height and the ficha rows", () => {
    const bundle = adaptToBundle(syntheticFicha(), { references: [frontRef()] });
    expect(bundle.physicalHeightCm).toBe(168);
    expect(bundle.characteristics.length).toBe(1);
    expect(bundle.source.adaptedFrom).toBe("2dc-ficha");
  });

  test("receita has no height and no ficha, and nothing is invented", () => {
    const bundle = adaptToBundle(syntheticReceita(), { references: [frontRef()] });
    expect(bundle.physicalHeightCm).toBeNull();
    expect(bundle.characteristics).toEqual([]);
    expect(bundle.source.generatorVersion).toBe("2dc-r3");
  });

  test("an unsupported contract version is refused", () => {
    expect(() => adaptToBundle(syntheticBundlePayload({ contractVersion: 99 }), { references: [frontRef()] })).toThrow(
      ContractError,
    );
  });

  test("an implausible height is refused rather than clamped", () => {
    expect(() => adaptToBundle(syntheticFicha({ physicalHeightCm: 12 }), { references: [frontRef()] })).toThrow(
      ContractError,
    );
  });
});

describe("identity", () => {
  test("canonical JSON is key-order independent", () => {
    expect(canonicalJson({ b: 1, a: { d: 2, c: 3 } })).toBe(canonicalJson({ a: { c: 3, d: 2 }, b: 1 }));
  });

  test("the same character imported twice yields the same key", () => {
    const a = adaptToBundle(syntheticFicha(), { references: [frontRef()] });
    const b = adaptToBundle(syntheticFicha(), { references: [frontRef()] });
    expect(characterKey(a)).toBe(characterKey(b));
    expect(contentDigest(a)).toBe(contentDigest(b));
  });

  test("a different recipe yields a different key", () => {
    const a = adaptToBundle(syntheticFicha(), { references: [frontRef()] });
    const b = adaptToBundle(syntheticFicha({ recipe: syntheticRecipe({ hair: "female-hair-3" }) }), {
      references: [frontRef()],
    });
    expect(characterKey(a)).not.toBe(characterKey(b));
  });

  test("a different reference image yields a different key", () => {
    const a = adaptToBundle(syntheticFicha(), { references: [frontRef("aaaa")] });
    const b = adaptToBundle(syntheticFicha(), { references: [frontRef("cccc")] });
    expect(characterKey(a)).not.toBe(characterKey(b));
  });

  test("adding a labelled reference changes the identity, so results are never shared across imports", () => {
    const a = adaptToBundle(syntheticFicha(), { references: [frontRef()] });
    const b = adaptToBundle(syntheticFicha(), { references: [frontRef(), backRef] });
    expect(characterKey(a)).not.toBe(characterKey(b));
  });
});

describe("vocabulary", () => {
  test("the gray coverall is described, not left as a number", () => {
    const attr = describeAttribute("female", "outfit", "female-outfit-0");
    expect(attr.known).toBe(true);
    expect(attr.visual).toContain("gray");
    expect(attr.label).toBe("Macacão cinza");
  });

  test("an unknown id is reported, never guessed", () => {
    const attr = describeAttribute("female", "hair", "female-hair-999");
    expect(attr.known).toBe(false);
    expect(attr.visual).toBeNull();
  });

  test("identity-only variants are flagged as reference-only", () => {
    const attr = describeAttribute("female", "face", "female-face-12");
    expect(attr.referenceOnly).toBe(true);
    expect(attr.visual).toBeNull();
  });

  test("colours resolve to the catalog hex", () => {
    const attr = describeColor("hairColor", "castanho-claro");
    expect(attr.known).toBe(true);
    expect(attr.hex).toMatch(/^#[0-9a-fA-F]{6}$/);
  });
});

describe("brief", () => {
  const bundle = adaptToBundle(syntheticFicha(), { references: [frontRef()] });
  const brief = buildBrief(bundle);

  test("the prompt names the outfit in words and keeps the 2D id", () => {
    expect(brief.text).toContain("female-outfit-0");
    expect(brief.text.toLowerCase()).toContain("coverall");
  });

  test("the prompt forbids changing the build", () => {
    expect(brief.text.toLowerCase()).toContain("do not add muscle");
  });

  test("regions without a reference are listed honestly", () => {
    const regions = brief.inferredRegions.map((r) => r.region).join(" | ");
    expect(regions).toContain("back");
    expect(regions.toLowerCase()).toContain("depth");
  });

  test("a supplied back reference removes the back from the inferred list", () => {
    const withBack = buildBrief(adaptToBundle(syntheticFicha(), { references: [frontRef(), backRef] }));
    expect(withBack.inferredRegions.map((r) => r.region).join(" | ")).not.toContain("back of the body");
  });

  test("unknown ids reach the UI instead of being silently dropped", () => {
    const odd = buildBrief(
      adaptToBundle(syntheticFicha({ recipe: syntheticRecipe({ nose: "female-nose-777" }) }), {
        references: [frontRef()],
      }),
    );
    expect(odd.unknownIds.map((u) => u.id)).toContain("female-nose-777");
  });

  test("no measurement is invented when the ficha has none", () => {
    expect(buildBrief(adaptToBundle(syntheticReceita(), { references: [frontRef()] })).physicalHeightCm).toBeNull();
  });

  test("mix-only garment slots are skipped when the outfit is not the mix outfit", () => {
    expect(brief.attributes.some((a) => a.category === "upper")).toBe(false);
    const mix = buildBrief(
      adaptToBundle(syntheticFicha({ recipe: syntheticRecipe({ outfit: "female-outfit-1" }) }), {
        references: [frontRef()],
      }),
    );
    expect(mix.attributes.some((a) => a.category === "upper")).toBe(true);
  });
});

describe("image sniffing", () => {
  test("reads real PNG dimensions", () => {
    const info = sniffImage(syntheticPng(900, 1280));
    expect(info?.mime).toBe("image/png");
    expect(info?.width).toBe(900);
    expect(info?.height).toBe(1280);
    expect(info?.ext).toBe(".png");
  });

  test("rejects a non-image payload", () => {
    expect(sniffImage(new TextEncoder().encode("not an image at all"))).toBeNull();
  });
});
