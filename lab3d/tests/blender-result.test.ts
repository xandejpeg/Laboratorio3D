import { afterEach, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { listRuns, readRunDetail } from "../../web/server/scan.ts";
import { sha256Hex } from "../contract/identity.ts";
import { inspectGlb, parseBlenderManifest, registerBlenderResult } from "../src/blender-result.ts";
import { importCharacter } from "../src/import.ts";
import { CharacterRegistry, RegistryConflict } from "../src/registry.ts";
import { collectEvidence } from "../src/evidence.ts";
import { syntheticFicha, syntheticPng, syntheticRecipe } from "./fixtures.ts";
import { triangleGlb } from "./glb-fixture.ts";

const folders: string[] = [];
afterEach(() => { for (const folder of folders.splice(0)) rmSync(folder, { recursive: true, force: true }); });

function fixture() {
  const temp = mkdtempSync(join(tmpdir(), "lab3d-blender-")); folders.push(temp);
  const root = join(temp, "outputs");
  const source = join(temp, "authoring-files"); mkdirSync(source);
  const registry = new CharacterRegistry(join(root, "lab3d"));
  const front = syntheticPng(2, 3);
  const { record } = importCharacter(registry, syntheticFicha({ front: { width: 2, height: 3 } }), [{ angle: "front", bytes: front }]);
  writeFileSync(join(source, "final.glb"), triangleGlb());
  writeFileSync(join(source, "character.blend"), "BLENDER-v300synthetic-header-for-registration-test");
  writeFileSync(join(source, "build.py"), "# This fixture is never executed.\n");
  mkdirSync(join(source, "preview")); writeFileSync(join(source, "preview", "front.png"), front);
  const manifest = { contract: "lab3d.blender-result", contractVersion: 1, runId: "blender-synthetic", characterKey: record.key,
    referenceSha256: sha256Hex(front), title: "Synthetic Blender registration", blenderVersion: "synthetic-test",
    coordinates: "gltf-y-up", artifacts: ["final.glb", "character.blend", "build.py", "preview/front.png"], limitations: ["Synthetic geometry; not a character likeness"] };
  const path = join(source, "blender-result.json");
  const save = () => writeFileSync(path, JSON.stringify(manifest)); save();
  return { root, source, registry, record, manifest, path, save };
}

describe("Blender GLB resource policy", () => {
  test("reads actual uncompressed embedded geometry without claiming visual quality", () => {
    expect(inspectGlb(triangleGlb())).toEqual({ meshes: 1, materials: 0, skins: 0, animations: 0 });
  });
  test("rejects truncated, external-resource, out-of-bounds and compressed GLBs", () => {
    expect(() => inspectGlb(triangleGlb().subarray(0, 32))).toThrow();
    expect(() => inspectGlb(triangleGlb({ images: [{ uri: "https://unrelated.example/texture.png" }] }))).toThrow("embedded");
    expect(() => inspectGlb(triangleGlb({ buffers: [{ byteLength: 36, uri: "geometry.bin" }] }))).toThrow("embedded");
    expect(() => inspectGlb(triangleGlb({ bufferViews: [{ buffer: 0, byteOffset: 32, byteLength: 36 }] }))).toThrow("escapes");
    expect(() => inspectGlb(triangleGlb({ extensionsRequired: ["KHR_draco_mesh_compression"] }))).toThrow("decoder");
    expect(() => inspectGlb(triangleGlb({ meshes: [] }))).toThrow();
  });
});

describe("immutable Blender result registration", () => {
  test("registers a distinct linked GLB result, retains original inputs and hashes every declared artifact", () => {
    const f = fixture();
    const before = readFileSync(join(f.registry.dir, f.record.key, "record.json"), "utf8");
    const result = registerBlenderResult(f.root, f.path);
    expect(result.reused).toBe(false);
    expect(result.run).toMatchObject({ characterKey: f.record.key, purpose: "blender-authored", runId: f.manifest.runId });
    expect(result.run.options["mode"]).toBe("blender-authored-local");
    expect(f.registry.runs(f.record.key)).toEqual([result.run]);
    expect(readFileSync(join(f.registry.dir, f.record.key, "record.json"), "utf8")).toBe(before);
    const detail = readRunDetail(f.root, result.directory);
    expect(detail.final?.glbPath).toBe(`${f.manifest.runId}/final.glb`);
    expect(detail.final?.scadPath).toBeNull();
    expect(detail.hasFinalMesh).toBe(true);
    expect(listRuns(f.root).some((run) => run.id === f.manifest.runId && run.hasFinalMesh)).toBe(true);
    const evidence = collectEvidence(f.root, result.directory, result.run, null);
    expect(evidence.purpose).toBe("blender-authored");
    expect(evidence.configuration?.capabilities.recompileParams).toBe(false);
    expect(evidence.quality.approval).toBe("not-reviewed");
    expect(evidence.usage.costUsd).toBeNull();
    expect(evidence.configuration?.referenceSha256).toBe(f.manifest.referenceSha256);
    for (const name of f.manifest.artifacts) {
      const artifact = evidence.artifacts.find((item) => item.path === `${f.manifest.runId}/${name}`)!;
      expect(artifact.sha256).toBe(sha256Hex(readFileSync(join(f.source, name))));
    }
    expect(existsSync(join(result.directory, "lab3d-evidence.json"))).toBe(true);
    expect(existsSync(join(f.source, "final.glb"))).toBe(true);
  });
  test("identical retries reuse the same provenance; edits cannot overwrite the prior result", () => {
    const f = fixture();
    const first = registerBlenderResult(f.root, f.path);
    const original = readFileSync(join(first.directory, "lab3d-execution.json"), "utf8");
    expect(registerBlenderResult(f.root, f.path).reused).toBe(true);
    expect(f.registry.runs(f.record.key)).toHaveLength(1);
    expect(readFileSync(join(first.directory, "lab3d-execution.json"), "utf8")).toBe(original);
    writeFileSync(join(f.source, "build.py"), "# A changed source must become a separate result.");
    expect(() => registerBlenderResult(f.root, f.path)).toThrow(RegistryConflict);
    expect(readFileSync(join(first.directory, "lab3d-execution.json"), "utf8")).toBe(original);
  });
  test("wrong reference or a source run from another character is refused before publication", () => {
    const f = fixture();
    f.manifest.referenceSha256 = "f".repeat(64); f.save();
    expect(() => registerBlenderResult(f.root, f.path)).toThrow("Reference digest");
    expect(existsSync(join(f.root, f.manifest.runId))).toBe(false);
    f.manifest.referenceSha256 = f.record.bundle.references[0]!.sha256;
    writeFileSync(f.path, JSON.stringify({ ...f.manifest, sourceRunId: "not-this-character" }));
    expect(() => registerBlenderResult(f.root, f.path)).toThrow("does not belong");
    const other = importCharacter(f.registry, syntheticFicha({ recipe: syntheticRecipe({ hairColor: "preto" }), front: { width: 2, height: 3 } }), [{ angle: "front", bytes: syntheticPng(2, 3, [5, 6, 7]) }]);
    writeFileSync(f.path, JSON.stringify({ ...f.manifest, characterKey: other.record.key }));
    expect(() => registerBlenderResult(f.root, f.path)).toThrow("Reference digest");
  });
  test("malformed files and paths cannot publish a run or alter its character", () => {
    const f = fixture();
    for (const name of ["../secret.txt", "C:/private/file.txt", ".env", "lab3d-execution.json", "preview/../../private.txt", "image.png"]) {
      expect(() => parseBlenderManifest({ ...f.manifest, artifacts: [...f.manifest.artifacts, name] })).toThrow();
    }
    expect(() => parseBlenderManifest({ ...f.manifest, coordinates: "z-up" })).toThrow();
    writeFileSync(join(f.source, "final.glb"), "not a glb");
    expect(() => registerBlenderResult(f.root, f.path)).toThrow();
    expect(f.registry.runs(f.record.key)).toEqual([]);
    expect(readdirSync(f.root)).toEqual(["lab3d"]);
  });
  test("registered bytes are rechecked before reuse and cannot silently inherit another run", () => {
    const f = fixture();
    const first = registerBlenderResult(f.root, f.path);
    writeFileSync(join(first.directory, "final.glb"), "corrupt");
    expect(() => registerBlenderResult(f.root, f.path)).toThrow("changed");
    expect(readFileSync(join(first.directory, "final.glb"), "utf8")).toBe("corrupt");
  });
  test("scanner discovers GLB-only directories without claiming SCAD support", () => {
    const f = fixture();
    const directory = join(f.root, "unlinked-glb"); mkdirSync(directory); writeFileSync(join(directory, "final.glb"), triangleGlb());
    const detail = readRunDetail(f.root, directory);
    expect(detail.final?.glbPath).toBe("unlinked-glb/final.glb");
    expect(detail.final?.scadPath).toBeNull();
    expect(listRuns(f.root).some((run) => run.id === "unlinked-glb" && run.hasFinalMesh)).toBe(true);
  });
});
