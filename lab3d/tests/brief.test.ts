import { expect, test } from "bun:test";
import { prepareImport } from "../src/import.ts";
import { buildBrief } from "../src/brief.ts";
import { syntheticFicha, syntheticRecipe, syntheticPng } from "./fixtures.ts";

test("natural skin inherited from another identity is described without inventing its RGB", () => {
  const prepared = prepareImport(syntheticFicha({ recipe: syntheticRecipe({ skinSource: "female-face-13" }) }),
    [{ angle: "front", bytes: syntheticPng(900, 1280) }]);
  const brief = buildBrief(prepared.bundle);
  expect(brief.text).toContain("skinSource=female-face-13");
  expect(brief.text).toContain("Lívia");
  expect(brief.text).toContain("no RGB value is invented");
});
