import { afterEach, describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { ContractError } from "../contract/adapt.ts";
import { importCharacter, prepareImport } from "../src/import.ts";
import { CharacterRegistry, RegistryConflict } from "../src/registry.ts";
import { syntheticFicha, syntheticPng, syntheticRecipe } from "./fixtures.ts";

const temps: string[] = [];
function tempRegistry(): CharacterRegistry {
  const dir = mkdtempSync(join(tmpdir(), "lab3d-test-"));
  temps.push(dir);
  return new CharacterRegistry(dir);
}

afterEach(() => {
  for (const dir of temps.splice(0)) rmSync(dir, { recursive: true, force: true });
});

const front = () => ({ angle: "front", bytes: syntheticPng(900, 1280) });

describe("import validation", () => {
  test("requires the frontal reference", () => {
    expect(() => prepareImport(syntheticFicha(), [{ angle: "back", bytes: syntheticPng(900, 1280) }])).toThrow(
      ContractError,
    );
  });

  test("rejects an unknown angle label", () => {
    try {
      prepareImport(syntheticFicha(), [front(), { angle: "diagonal", bytes: syntheticPng(900, 1280) }]);
      throw new Error("should have thrown");
    } catch (e) {
      expect((e as ContractError).details.join(" ")).toContain("diagonal");
    }
  });

  test("rejects a front PNG whose size contradicts the sheet", () => {
    try {
      prepareImport(syntheticFicha(), [{ angle: "front", bytes: syntheticPng(512, 512) }]);
      throw new Error("should have thrown");
    } catch (e) {
      expect((e as ContractError).details.join(" ")).toContain("900x1280");
    }
  });

  test("only the frontal reference is marked as influencing the pipeline", () => {
    const { bundle } = prepareImport(syntheticFicha(), [
      front(),
      { angle: "back", bytes: syntheticPng(900, 1280), note: "costas" },
      { angle: "profile-left", bytes: syntheticPng(900, 1280) },
    ]);
    const influencing = bundle.references.filter((r) => r.influence === "pipeline");
    expect(influencing.length).toBe(1);
    expect(influencing[0]!.angle).toBe("front");
    expect(bundle.references.filter((r) => r.influence === "stored").length).toBe(2);
    expect(bundle.references.find((r) => r.angle === "back")!.note).toBe("costas");
  });
});

describe("immutable ledger", () => {
  test("stores the record, the bundle, the raw payload and the images", () => {
    const registry = tempRegistry();
    const payload = syntheticFicha();
    const { record, reused } = importCharacter(registry, payload, [front()]);
    expect(reused).toBe(false);
    const dir = join(registry.dir, record.key);
    for (const file of ["record.json", "bundle.json", "source.json", "front.png"]) {
      expect(existsSync(join(dir, file))).toBe(true);
    }
    expect(JSON.parse(readFileSync(join(dir, "source.json"), "utf8"))).toEqual(payload);
  });

  test("re-importing the same character reuses the record rather than rewriting it", () => {
    const registry = tempRegistry();
    const first = importCharacter(registry, syntheticFicha(), [front()]);
    const second = importCharacter(registry, syntheticFicha(), [front()]);
    expect(second.reused).toBe(true);
    expect(second.record.key).toBe(first.record.key);
    expect(second.record.importedAt).toBe(first.record.importedAt);
  });

  test("a different character gets a different record, never the other's result", () => {
    const registry = tempRegistry();
    const a = importCharacter(registry, syntheticFicha(), [front()]);
    const b = importCharacter(
      registry,
      syntheticFicha({ recipe: syntheticRecipe({ hair: "female-hair-5", hairColor: "preto" }) }),
      [front()],
    );
    expect(a.record.key).not.toBe(b.record.key);
    expect(registry.list().length).toBe(2);
  });

  test("a key collision with different content is refused", () => {
    const registry = tempRegistry();
    const { record } = importCharacter(registry, syntheticFicha(), [front()]);
    const tampered = { ...record, contentDigest: "different" };
    // Simulate a corrupted/forged record occupying the key.
    writeFileSync(join(registry.dir, record.key, "record.json"), JSON.stringify(tampered), "utf8");
    expect(() => importCharacter(registry, syntheticFicha(), [front()])).toThrow(RegistryConflict);
  });

  test("runs are appended, never rewritten", () => {
    const registry = tempRegistry();
    const { record } = importCharacter(registry, syntheticFicha(), [front()]);
    for (const n of [1, 2, 3]) {
      registry.linkRun({
        characterKey: record.key,
        jobId: `job-${n}`,
        runId: `run-${n}`,
        purpose: "generate",
        createdAt: new Date().toISOString(),
        briefDigest: "deadbeef",
        referenceFile: "front.png",
        options: {},
      });
    }
    expect(registry.runs(record.key).map((r) => r.runId)).toEqual(["run-1", "run-2", "run-3"]);
  });

  test("asset paths cannot escape the record directory", () => {
    const registry = tempRegistry();
    const { record } = importCharacter(registry, syntheticFicha(), [front()]);
    expect(registry.assetPath(record.key, "front.png")).not.toBeNull();
    expect(registry.assetPath(record.key, "../../record.json")).toBeNull();
    expect(registry.assetPath(record.key, "..\\record.json")).toBeNull();
    expect(registry.assetPath("../..", "front.png")).toBeNull();
  });
});
