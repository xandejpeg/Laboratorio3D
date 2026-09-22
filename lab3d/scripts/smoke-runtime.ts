/** Real OpenSCAD + Blender smoke. Synthetic geometry only; no LLM imports/calls. */
import { copyFileSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { createHash } from "node:crypto";
import { probeRuntime } from "../src/runtime.ts";
import { loadSTL, computeBBox } from "../../src/mesh/stl.ts";
import { compileCustom } from "../../web/server/customize.ts";

const REPO = resolve(import.meta.dir, "..", "..");
const out = resolve(process.argv[2] ?? join(REPO, "outputs", "runtime-smoke", new Date().toISOString().replace(/[:.]/g, "-")));
mkdirSync(out, { recursive: true });
const runtime = probeRuntime();
if (!runtime.capabilities.recompileParams || !runtime.capabilities.render) throw new Error("OpenSCAD Manifold and Blender must pass doctor first");
process.env.OPENSCAD_PATH = runtime.openscad.path!;
process.env.PROCEDURA_BLENDER_PATH = runtime.blender.path!;
const { compileScad } = await import("../../src/scad/compile.ts");
const { renderAOViews } = await import("../../src/render/ao.ts");
const started = Date.now();
const code = readFileSync(join(REPO, "lab3d/tests/fixtures/mechanical-bracket.scad"), "utf8");
writeFileSync(join(out, "fixture.scad"), code);
const checks: Record<string, unknown> = {};
function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}
const result = await compileScad(code, { outputDir: join(out, "compile"), writeObj: true, timeoutMs: 60_000 });
assert(result.exitCode === 0 && !result.empty, "OpenSCAD compilation failed");
const mesh = loadSTL(result.stlPath);
checks.compile = { durationMs: result.durationMs, exitCode: result.exitCode, triangles: mesh.triCount,
  bounds: computeBBox(mesh), stlBytes: statSync(result.stlPath).size, objBytes: statSync(result.objPath).size };
console.log("OpenSCAD: compiled synthetic bracket to STL + OBJ");

const renderStart = Date.now();
const rendered = await renderAOViews({ stlPath: result.stlPath, outDir: join(out, "renders"),
  views: ["front", "right", "back", "isometric"], size: 384, samples: 16, aoSamples: 4,
  gpu: false, bg: 0.92, timeoutMs: 180_000, log: console.log });
assert(rendered.ok, `Blender failed: ${rendered.ok ? "" : rendered.error}`);
checks.render = { durationMs: Date.now() - renderStart, device: "CPU", size: 384, samples: 16,
  aoSamples: 4, views: rendered.views.map((view) => ({ view: view.view, bytes: statSync(view.path).size })) };
console.log("Blender: rendered front, right, back and isometric views");

const custom = { openscad: runtime.openscad.path!, root: out, runDir: out, scadAbs: join(out, "fixture.scad"), defines: ["width=52"] };
const first = await compileCustom(custom);
assert(first.ok && !first.cached, "First parameter change should compile");
const cached = await compileCustom(custom);
assert(cached.ok && cached.cached && cached.stl === first.stl, "Unchanged source/parameters should reuse result");
writeFileSync(custom.scadAbs, code.replace("height = 30;", "height = 34;"));
const changed = await compileCustom(custom);
assert(changed.ok && !changed.cached && changed.stl !== first.stl, "Changed SCAD source must invalidate cached mesh");
const changedBounds = computeBBox(loadSTL(join(out, changed.stl)));
assert(Math.abs(changedBounds.max[0] - changedBounds.min[0] - 52) < 0.001, "Width override did not reach geometry");
assert(Math.abs(changedBounds.max[2] - changedBounds.min[2] - 34) < 0.001, "Changed source did not reach geometry");
checks.recompile = { firstDurationMs: first.durationMs, cacheReused: true, sourceChangeInvalidatedCache: true, bounds: changedBounds };
writeFileSync(custom.scadAbs, code);

let malformedRejected = false;
try { await compileScad("cube([10, 10, );", { outputDir: join(out, "compile"), timeoutMs: 10_000 }); }
catch { malformedRejected = true; }
assert(malformedRejected, "Malformed SCAD must fail instead of reusing previous STL");
// Restore the valid artifacts for inspection after proving the stale-output gate.
await compileScad(code, { outputDir: join(out, "compile"), writeObj: true, timeoutMs: 60_000 });
checks.malformedRejected = true;
const report = { kind: "synthetic-mechanical-runtime-smoke", startedAt: new Date(started).toISOString(),
  durationMs: Date.now() - started, sourceSha256: createHash("sha256").update(code).digest("hex"),
  runtime: { platform: runtime.platform, bun: runtime.bun, openscad: runtime.openscad.version, blender: runtime.blender.version },
  modelCalls: 0, modelTokens: 0, modelCostUsd: 0, memoryPeak: null, checks,
  limitations: ["Synthetic SCAD fixture; model planning, code generation, visual critique and refinement were not executed.",
    "Mechanical runtime success does not establish human likeness or paid pipeline quality.", "Peak RAM/VRAM was not measured."] };
writeFileSync(join(out, "report.json"), JSON.stringify(report, null, 2));
// Publish the successfully validated fixture in the normal Studio layout.
// These metadata label it explicitly as a local compile, never an AI generation.
writeFileSync(join(out, "final.scad"), code);
copyFileSync(result.stlPath, join(out, "final.stl"));
copyFileSync(result.objPath, join(out, "final.obj"));
writeFileSync(join(out, "prompt_input.txt"), "Ensaio mecânico local / SCAD sintético escrito manualmente, sem geração por IA\n");
copyFileSync(join(out, "prompt_input.txt"), join(out, "prompt.txt"));
mkdirSync(join(out, "preview_final"), { recursive: true });
for (const view of rendered.views) {
  copyFileSync(view.path, join(out, "preview_final", `ao-${view.view}.png`));
}
writeFileSync(join(out, "lab3d-execution.json"), JSON.stringify({
  purpose: "offline-compile", characterKey: null,
  upstreamCommit: "fac191ed49f55fcc2e0f23897e986042249f59fe", modelCalls: 0,
}, null, 2));
writeFileSync(join(out, "lab3d-completion.json"), JSON.stringify({
  durationMs: report.durationMs, completedAt: new Date().toISOString(), ok: true,
}, null, 2));
console.log(`PASS: ${join(out, "report.json")}`);
