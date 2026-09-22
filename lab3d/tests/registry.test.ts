import { afterEach, describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { ContractError } from "../contract/adapt.ts";
import { canonicalJson, sha256Hex } from "../contract/identity.ts";
import { importCharacter, prepareImport } from "../src/import.ts";
import { CharacterRegistry, RegistryConflict } from "../src/registry.ts";
import { syntheticBundlePayload, syntheticFicha, syntheticPng, syntheticRecipe, syntheticReceita } from "./fixtures.ts";

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

  test("receita accepts actual image dimensions without inventing a default", () => {
    const { bundle } = prepareImport(syntheticReceita(), [{ angle: "front", bytes: syntheticPng(24, 32) }]);
    expect(bundle.front).toEqual({ width: 24, height: 32 });
  });

  test("preparation snapshots image bytes so caller mutation cannot corrupt storage", () => {
    const registry = tempRegistry();
    const image = front();
    const prepared = prepareImport(syntheticFicha(), [image]);
    const original = image.bytes.slice();
    image.bytes.fill(0);
    const result = registry.commit(prepared.bundle, prepared.stored, syntheticFicha());
    expect(new Uint8Array(readFileSync(join(registry.dir, result.record.key, "front.png")))).toEqual(original);
    expect(registry.read(result.record.key)).not.toBeNull();
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

  test("re-exporting the same bundle preserves its original timestamp and source", () => {
    const registry = tempRegistry();
    const original = syntheticBundlePayload();
    const a = importCharacter(registry, original, [front(), { angle: "back", bytes: syntheticPng(16, 24) }]);
    const sourceFile = join(registry.dir, a.record.key, "source.json");
    const source = readFileSync(sourceFile, "utf8");
    const later = structuredClone(original);
    (later["source"] as Record<string, unknown>)["exportedAt"] = "2026-09-22T18:00:00.000Z";
    const b = importCharacter(registry, later, [{ angle: "back", bytes: syntheticPng(16, 24) }, front()]);
    expect(b.reused).toBe(true);
    expect(b.record).toEqual(a.record);
    expect(readFileSync(sourceFile, "utf8")).toBe(source);
  });

  test("keeps older v1 records readable without rewriting their digest", () => {
    const registry = tempRegistry();
    const payload = syntheticBundlePayload();
    const { record } = importCharacter(registry, payload, [front()]);
    const legacy = { ...record, contentDigest: sha256Hex(canonicalJson(record.bundle)) };
    const recordFile = join(registry.dir, record.key, "record.json");
    const saved = JSON.stringify(legacy);
    writeFileSync(recordFile, saved);
    expect(registry.read(record.key)).toEqual(legacy);
    expect(importCharacter(registry, payload, [front()]).reused).toBe(true);
    expect(readFileSync(recordFile, "utf8")).toBe(saved);
  });

  test("does not reuse or overwrite an image corrupted after import", () => {
    const registry = tempRegistry();
    const { record } = importCharacter(registry, syntheticFicha(), [front()]);
    const imagePath = join(registry.dir, record.key, "front.png");
    writeFileSync(imagePath, "corrupt");
    expect(registry.read(record.key)).toBeNull();
    expect(registry.assetPath(record.key, "front.png")).toBeNull();
    expect(() => importCharacter(registry, syntheticFicha(), [front()])).toThrow(RegistryConflict);
    expect(readFileSync(imagePath, "utf8")).toBe("corrupt");
  });

  test("never overwrites a malformed existing record", () => {
    const registry = tempRegistry();
    const { record } = importCharacter(registry, syntheticFicha(), [front()]);
    const recordPath = join(registry.dir, record.key, "record.json");
    writeFileSync(recordPath, "{");
    expect(() => importCharacter(registry, syntheticFicha(), [front()])).toThrow(RegistryConflict);
    expect(readFileSync(recordPath, "utf8")).toBe("{");
  });

  test("a write failure leaves no partial character and a retry can finish", () => {
    const registry = tempRegistry();
    const prepared = prepareImport(syntheticFicha(), [front()]);
    expect(() => registry.commit(prepared.bundle, prepared.stored, { unsupported: 1n })).toThrow();
    expect(readdirSync(registry.dir)).toEqual([]);
    expect(registry.commit(prepared.bundle, prepared.stored, syntheticFicha()).reused).toBe(false);
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
    expect(registry.assetPath("..", "record.json")).toBeNull();
    expect(registry.assetPath(record.key, "record.json")).toBeNull();
    expect(registry.read("../..")).toBeNull();
    expect(registry.runs("../..")).toEqual([]);
  });

  test("a run cannot be reassigned to another character or silently rewritten", () => {
    const registry = tempRegistry();
    const first = importCharacter(registry, syntheticFicha(), [front()]);
    const second = importCharacter(registry, syntheticFicha({ recipe: syntheticRecipe({ hairColor: "preto" }) }), [front()]);
    const run = {
      characterKey: first.record.key, jobId: "job-unique", runId: "run-unique", purpose: "generate" as const,
      createdAt: "2026-09-22T12:00:00.000Z", briefDigest: "digest", referenceFile: "front.png", options: {},
    };
    registry.linkRun(run);
    registry.linkRun(run);
    expect(registry.runs(first.record.key)).toHaveLength(1);
    expect(() => registry.linkRun({ ...run, characterKey: second.record.key })).toThrow(RegistryConflict);
    expect(() => registry.linkRun({ ...run, options: { changed: true } })).toThrow(RegistryConflict);
    expect(() => registry.linkRun({ ...run, runId: "../outside" })).toThrow();
    expect(registry.runs(second.record.key)).toEqual([]);
  });
});
