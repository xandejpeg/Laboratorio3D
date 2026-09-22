/** Real HTTP + local OpenSCAD integration. Provider credentials are disabled. */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve, sep } from "node:path";
import { stopProcessTree } from "../../src/runtime/process.ts";
import { sha256Hex } from "../contract/identity.ts";
import { CharacterRegistry } from "../src/registry.ts";
import { probeOpenscad } from "../src/runtime.ts";
import type { CharacterRecord } from "../contract/types.ts";
import { syntheticFicha, syntheticPng, syntheticRecipe } from "./fixtures.ts";

let root: string;
let url: string;
let proc: ReturnType<typeof Bun.spawn> | undefined;
let runtime: any;
let fixture: CharacterRecord;
let sourceText: string;
const sourceRunId = "fixture-local-scad";
const openscad = probeOpenscad(process.env);

const request = (path: string, init?: RequestInit) => fetch(`${url}${path}`, init);
const post = (path: string, body: unknown) => request(path, {
  method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body),
});

function upload(payload: unknown = syntheticFicha(), references: { angle: string; bytes: Uint8Array }[] = [{ angle: "front", bytes: syntheticPng(900, 1280) }]): FormData {
  const form = new FormData();
  form.set("sheet", new File([JSON.stringify(payload)], "synthetic-ficha.json", { type: "application/json" }));
  for (const image of references) form.append(image.angle, new File([new Uint8Array(image.bytes)], `${image.angle}.png`, { type: "image/png" }));
  return form;
}

beforeAll(async () => {
  root = mkdtempSync(join(tmpdir(), "lab3d-http-"));
  proc = Bun.spawn([process.execPath, "run", "lab3d/server.ts"], {
    cwd: resolve(import.meta.dir, "../.."), stdout: "pipe", stderr: "pipe",
    env: {
      ...process.env,
      NODE_ENV: "production", LAB3D_PORT: "0", LAB3D_OUTPUTS_ROOT: root,
      OPENAI_API_KEY: "", GEMINI_API_KEY: "", ANTHROPIC_API_KEY: "",
      OPENAI_BASE_URL: "http://127.0.0.1:1", GEMINI_BASE_URL: "http://127.0.0.1:1",
      PROCEDURA_MODEL: "gpt-5.2", PROCEDURA_PROVIDER: "openai", PROCEDURA_IMAGE_MODEL: "",
      PROCEDURA_ALLOW_CGAL_OPENSCAD: "1",
      OPENSCAD_PATH: openscad.path ?? "",
    },
  });
  const stderr = new Response(proc.stderr as ReadableStream<Uint8Array>).text();
  const reader = (proc.stdout as ReadableStream<Uint8Array>).getReader();
  const readiness = (async () => {
    let log = "";
    while (true) {
      const next = await reader.read();
      if (next.done) throw new Error(`Laboratory exited before listening: ${log}\n${await stderr}`);
      log += new TextDecoder().decode(next.value);
      const match = /http:\/\/127\.0\.0\.1:\d+/.exec(log);
      if (match) {
        url = match[0];
        // Continue draining startup logs without exposing environment values.
        void (async () => { try { while (!(await reader.read()).done) { /* drain */ } } catch { /* process stopped */ } })();
        return;
      }
    }
  })();
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([readiness, new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error("Laboratory HTTP startup timed out")), 30_000);
    })]);
  } finally { if (timer) clearTimeout(timer); }
  runtime = await (await request("/api/lab/runtime")).json();
  expect(runtime.llm.configured).toBe(false);
  expect(runtime.capabilities.generate).toBe(false);
  const imported = await request("/api/lab/import", { method: "POST", body: upload() });
  expect(imported.status).toBe(201);
  fixture = (await imported.json() as any).record;

  // A hand-authored SCAD control, explicitly a local test fixture. No model
  // output is fabricated and no generation endpoint is used to create it.
  sourceText = [
    'width = 4; // [1:1:10]',
    'enabled = true;',
    'style = "box"; // [box,sphere]',
    'mode = 1; // [1,2]',
    'cube([width, enabled ? 2 : 1, mode]);',
  ].join("\n") + "\n";
  const sourceDir = join(root, sourceRunId);
  mkdirSync(sourceDir);
  writeFileSync(join(sourceDir, "final.scad"), sourceText);
  new CharacterRegistry(join(root, "lab3d")).linkRun({
    characterKey: fixture.key, jobId: "fixture-local-job", runId: sourceRunId,
    purpose: "recompile", createdAt: "2026-09-22T12:00:00.000Z",
    briefDigest: sha256Hex("Hand-authored local SCAD fixture"), referenceFile: "front.png",
    options: { fixture: true, description: "Hand-authored SCAD; no LLM" },
  });
}, 40_000);

afterAll(async () => {
  if (proc) { stopProcessTree(proc.pid); await proc.exited; }
  if (root) {
    const resolved = resolve(root);
    // Remove only this suite's freshly created temporary directory.
    if (!resolved.startsWith(resolve(tmpdir()) + sep) || !resolved.includes(`${sep}lab3d-http-`)) throw new Error("unsafe HTTP test cleanup path");
    rmSync(resolved, { recursive: true, force: true });
  }
});

describe("laboratory HTTP import and boundaries", () => {
  test("reuses identical uploads and serves exactly their digested image", async () => {
    const response = await request("/api/lab/import", { method: "POST", body: upload() });
    expect(response.status).toBe(200);
    const body = await response.json() as any;
    expect(body.reused).toBe(true);
    expect(body.record).toEqual(fixture);
    const image = await request(`/api/lab/asset?key=${fixture.key}&file=front.png`);
    expect(image.status).toBe(200);
    expect(sha256Hex(new Uint8Array(await image.arrayBuffer()))).toBe(fixture.bundle.references[0]!.sha256);
    const loaded = await (await request(`/api/lab/character?key=${fixture.key}`)).json() as any;
    expect(loaded.record.key).toBe(fixture.key);
    expect(loaded.runs[0].runId).toBe(sourceRunId);
  });

  test("rejects mismatched images, invalid recipe keys and duplicate labels", async () => {
    const badImage = await request("/api/lab/import", { method: "POST", body: upload(syntheticFicha(), [{ angle: "front", bytes: syntheticPng(12, 12) }]) });
    expect(badImage.status).toBe(422);
    expect((await badImage.json() as any).details.join(" ")).toContain("900x1280");
    const badRecipe = await request("/api/lab/import", { method: "POST", body: upload(syntheticFicha({ recipe: { family: "female" } })) });
    expect(badRecipe.status).toBe(422);
    expect((await badRecipe.json() as any).details).toContain("recipe.hair must be a non-empty string (send canonicalRecipe())");
    const duplicate = await request("/api/lab/import", { method: "POST", body: upload(syntheticFicha(), [
      { angle: "front", bytes: syntheticPng(900, 1280) }, { angle: "front", bytes: syntheticPng(900, 1280) },
    ]) });
    expect(duplicate.status).toBe(422);
  });

  test("a changed character gets its own key and cannot inherit the existing run", async () => {
    const response = await request("/api/lab/import", { method: "POST", body: upload(syntheticFicha({ recipe: syntheticRecipe({ hairColor: "preto" }) })) });
    expect(response.status).toBe(201);
    const body = await response.json() as any;
    expect(body.record.key).not.toBe(fixture.key);
    expect(body.runs).toEqual([]);
  });

  test("foreign origins, foreign hosts and path escapes are refused", async () => {
    expect((await request("/api/lab/runtime", { headers: { origin: "https://unrelated.example" } })).status).toBe(403);
    expect((await request("/api/lab/runtime", { headers: { host: "unrelated.example" } })).status).toBe(403);
    expect((await request("/api/lab/runtime", { headers: { "sec-fetch-site": "cross-site" } })).status).toBe(403);
    expect((await request("/api/lab/runtime", { headers: { origin: url } })).status).toBe(200);
    expect((await request("/api/lab/character?key=..%2F..")).status).toBe(404);
    expect((await request(`/api/lab/asset?key=${fixture.key}&file=..%2Frecord.json`)).status).toBe(404);
    expect((await request("/api/file?path=..%2Fprivate.json")).status).toBe(403);
  });

  test("generation is refused with blank credentials and never creates a job", async () => {
    expect((await post("/api/lab/generate", { key: fixture.key })).status).toBe(503);
    expect((await (await request("/api/jobs")).json() as any).jobs).toEqual([]);
  });

  test("evidence exposes real hashes and keeps quality explicitly unreviewed", async () => {
    const preview = syntheticPng(8, 8);
    mkdirSync(join(root, sourceRunId, "preview_final"));
    writeFileSync(join(root, sourceRunId, "preview_final", "ao-front.png"), preview);
    const response = await request(`/api/lab/evidence?runId=${sourceRunId}`);
    expect(response.status).toBe(200);
    const body = await response.json() as any;
    expect(body.characterKey).toBe(fixture.key);
    expect(body.quality.approval).toBe("not-reviewed");
    expect(body.usage.costUsd).toBe(0);
    expect(body.artifacts.find((file: any) => file.path.endsWith("/final.scad")).sha256).toBe(sha256Hex(sourceText));
    expect(body.artifacts.find((file: any) => file.path.endsWith("/preview_final/ao-front.png")).sha256).toBe(sha256Hex(preview));
    expect((await request("/api/lab/evidence?runId=..%2Foutside")).status).toBe(404);
  });
});

describe("real local recompilation", () => {
  test.skipIf(!openscad.path)("independent results never acquire a character association", async () => {
    const id = "independent-mechanical-control";
    mkdirSync(join(root, id));
    writeFileSync(join(root, id, "final.scad"), sourceText);
    const independent = await (await request("/api/lab/independent-runs")).json() as any;
    expect(independent.runs.some((run: any) => run.id === id)).toBe(true);
    expect(independent.runs.some((run: any) => run.id === sourceRunId)).toBe(false);
    const response = await post("/api/customize", { id, overrides: { width: 7 } });
    expect(response.status).toBe(200);
    const result = await response.json() as any;
    expect(result.run).toBeNull();
    expect(result.runId).toBeString();
    expect(await (await request(`/api/lab/run-character?runId=${result.runId}`)).json()).toEqual({ record: null, run: null });
    const evidence = await (await request(`/api/lab/evidence?runId=${result.runId}`)).json() as any;
    expect(evidence.characterKey).toBeNull();
    expect(evidence.purpose).toBe("recompile");
    expect(evidence.usage.costUsd).toBe(0);
    expect(evidence.completion.ok).toBe(true);
    const updated = await (await request("/api/lab/independent-runs")).json() as any;
    const displayed = updated.runs.find((run: any) => run.id === result.runId);
    expect(displayed.purpose).toBe("recompile");
    expect(displayed.completion).toEqual({ ok: true });
    expect(displayed.title).toContain("Recompilação de");
  });

  test.skipIf(!openscad.path)("external dependencies are refused before creating a misleading snapshot", async () => {
    const id = "scad-with-relative-dependency";
    mkdirSync(join(root, id));
    writeFileSync(join(root, id, "final.scad"), 'include <helper.scad>\nwidth = 4;\ncube(width);\n');
    const response = await post("/api/customize", { id, overrides: { width: 5 } });
    expect(response.status).toBe(422);
    expect((await response.json() as any).error).toContain("self-contained SCAD");
  });

  test.skipIf(!openscad.path)("rejects wrong ownership and invalid numeric, boolean and enum values", async () => {
    const differentKey = "f".repeat(64) === fixture.key ? "e".repeat(64) : "f".repeat(64);
    expect((await post("/api/customize", { id: sourceRunId, key: differentKey, overrides: { width: 8 } })).status).toBe(409);
    for (const overrides of [{ width: null }, { enabled: null }, { enabled: "true" }, { style: "unknown" }, { mode: 3 }, { width: 11 }]) {
      expect((await post("/api/customize", { id: sourceRunId, key: fixture.key, overrides })).status).toBe(422);
    }
  });

  test.skipIf(!openscad.path)("creates a distinct immutable run with effective parameters and verified geometry", async () => {
    expect(runtime.capabilities.recompileParams).toBe(true);
    const response = await post("/api/customize", {
      id: sourceRunId, key: fixture.key, overrides: { width: 8, enabled: false, style: "box", mode: 2 },
    });
    const body = await response.json() as any;
    expect(body.error).toBeUndefined();
    expect(response.status).toBe(200);
    const runId = body.run.runId;
    expect(runId).not.toBe(sourceRunId);
    expect(body.run.characterKey).toBe(fixture.key);
    expect(body.run.purpose).toBe("recompile");
    expect(body.run.options.sourceRunId).toBe(sourceRunId);
    expect(readFileSync(join(root, sourceRunId, "final.scad"), "utf8")).toBe(sourceText);
    const mesh = await request(`/api/file?path=${encodeURIComponent(body.stl)}`);
    expect(mesh.status).toBe(200);
    const bytes = new Uint8Array(await mesh.arrayBuffer());
    expect(stlDimensions(bytes)).toEqual([8, 1, 2]);
    const params = await (await request(`/api/params?id=${runId}`)).json() as any;
    const values = Object.fromEntries(params.params.map((param: any) => [param.name, param.value]));
    expect(values).toMatchObject({ width: 8, enabled: false, style: "box", mode: 2 });
    const evidence = await (await request(`/api/lab/evidence?runId=${runId}`)).json() as any;
    expect(evidence.configuration.sourceScadSha256).toBe(sha256Hex(sourceText));
    expect(evidence.quality.approval).toBe("not-reviewed");
    expect(evidence.usage.costUsd).toBe(0);
    expect(evidence.artifacts.find((file: any) => file.path === body.stl).sha256).toBe(sha256Hex(bytes));
    for (const file of evidence.artifacts) {
      expect(sha256Hex(readFileSync(join(root, file.path)))).toBe(file.sha256);
    }
    const frozen = JSON.parse(readFileSync(join(root, runId, "lab3d-evidence.json"), "utf8"));
    expect(frozen.characterKey).toBe(fixture.key);
    const reverse = await (await request(`/api/lab/run-character?runId=${runId}`)).json() as any;
    expect(reverse.record.key).toBe(fixture.key);
    expect((await (await request("/api/jobs")).json() as any).jobs).toEqual([]);

    // A subsequent edit must preserve both geometry and displayed values of
    // parameters inherited from the preceding recompilation.
    const firstScad = readFileSync(join(root, runId, "final.scad"), "utf8");
    const nextResponse = await post("/api/customize", { id: runId, key: fixture.key, overrides: { width: 6 } });
    expect(nextResponse.status).toBe(200);
    const next = await nextResponse.json() as any;
    expect(next.run.runId).not.toBe(runId);
    expect(next.run.options.sourceRunId).toBe(runId);
    const nextMesh = new Uint8Array(await (await request(`/api/file?path=${encodeURIComponent(next.stl)}`)).arrayBuffer());
    expect(stlDimensions(nextMesh)).toEqual([6, 1, 2]);
    const nextParams = await (await request(`/api/params?id=${next.run.runId}`)).json() as any;
    expect(Object.fromEntries(nextParams.params.map((param: any) => [param.name, param.value]))).toMatchObject({ width: 6, enabled: false, style: "box", mode: 2 });
    expect(readFileSync(join(root, runId, "final.scad"), "utf8")).toBe(firstScad);
  }, 20_000);
});

function stlDimensions(bytes: Uint8Array): number[] {
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  const add = (point: number[]) => point.forEach((value, axis) => { min[axis] = Math.min(min[axis]!, value); max[axis] = Math.max(max[axis]!, value); });
  const data = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const triangles = bytes.length >= 84 ? data.getUint32(80, true) : 0;
  if (triangles > 0 && bytes.length === 84 + triangles * 50) {
    for (let face = 0; face < triangles; face++) for (let corner = 0; corner < 3; corner++) {
      const offset = 84 + face * 50 + 12 + corner * 12;
      add([0, 1, 2].map((axis) => data.getFloat32(offset + axis * 4, true)));
    }
  } else {
    for (const match of new TextDecoder().decode(bytes).matchAll(/vertex\s+([\d.eE+-]+)\s+([\d.eE+-]+)\s+([\d.eE+-]+)/g)) add(match.slice(1).map(Number));
  }
  return min.map((value, axis) => max[axis]! - value);
}
