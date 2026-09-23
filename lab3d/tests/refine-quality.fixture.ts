/**
 * Isolated simulated dependency fixture, launched by refine-quality.test.ts.
 * The real runDirectRefine + writeFinalOutputs persist all verdicts/sidecars.
 * LLM, OpenSCAD and Blender are mocked; this is NOT a visual-quality approval.
 * Do not import this helper into the shared test process: Bun module mocks are global.
 */
import { mock } from "bun:test";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import type { CompileOpts, CompileResult } from "../../src/scad/compile.ts";
import type { RenderAOOpts } from "../../src/render/ao.ts";
import type { RenderPartsColorOpts } from "../../src/render/parts_color.ts";

export interface RefineQualityReport {
  kind: "simulated-state-machine";
  scenario: string;
  result: { ok: boolean; verdict: string; summary: string; steps: number; toolCalls: number; outputs: { diagnosisPath: string } };
  initialScad: string;
  diagnosis: string;
  criticCalls: number;
  patchCalls: number;
  networkAttempts: number;
  patchRepairTexts: string[];
  compiledSources: string[];
}

const scenario = process.argv[2];
const outputDir = process.argv[3];
if (!outputDir || !scenario || !["malformed", "missing-issues", "empty-issues", "high-nochange", "clean"].includes(scenario)) {
  throw new Error("Expected a known simulated scenario and a temporary output directory");
}

// Defense in depth: importing an unexpected transport must never spend a call.
let networkAttempts = 0;
globalThis.fetch = (() => {
  networkAttempts += 1;
  throw new Error("Network access is forbidden in the simulated refine-quality fixture");
}) as unknown as typeof fetch;

const initialScad = "// Synthetic tetrahedron, not a character or model output.\n" +
  "module body(){polyhedron(points=[[0,0,0],[1,0,0],[0,1,0],[0,0,1]],faces=[[0,2,1],[0,1,3],[0,3,2],[1,2,3]]);}\nbody();\n";
mkdirSync(outputDir, { recursive: true });
writeFileSync(join(outputDir, "draft.scad"), initialScad);
writeFileSync(join(outputDir, "prompt.txt"), "Synthetic state-machine fixture only. No visual likeness is evaluated.\n");

const points = [[0, 0, 0], [1, 0, 0], [0, 1, 0], [0, 0, 1]] as const;
const faces = [[0, 2, 1], [0, 1, 3], [0, 3, 2], [1, 2, 3]] as const;
function tetraStl(): Buffer {
  const bytes = Buffer.alloc(84 + faces.length * 50);
  bytes.write("SIMULATED REFINE STATE-MACHINE FIXTURE");
  bytes.writeUInt32LE(faces.length, 80);
  faces.forEach((face, index) => {
    face.forEach((vertex, corner) => {
      points[vertex].forEach((value, axis) => bytes.writeFloatLE(value, 84 + index * 50 + 12 + corner * 12 + axis * 4));
    });
  });
  return bytes;
}
const compiledSources: string[] = [];
const compileScad = async (scad: string, opts: CompileOpts): Promise<CompileResult> => {
  compiledSources.push(scad);
  mkdirSync(opts.outputDir, { recursive: true });
  const stlPath = join(opts.outputDir, "output.stl");
  const objPath = join(opts.outputDir, "output.obj");
  writeFileSync(stlPath, tetraStl());
  writeFileSync(objPath, "# simulated tetrahedron\n" + points.map(p => `v ${p.join(" ")}`).join("\n") + "\n" +
    faces.map(f => `f ${f.map(i => i + 1).join(" ")}`).join("\n") + "\n");
  const summary = { geometry: { facets: faces.length } };
  writeFileSync(join(opts.outputDir, "output.summary.json"), JSON.stringify(summary));
  return { stlPath, objPath, summary, stdout: "simulated compile", stderr: "", durationMs: 0, exitCode: 0, empty: false };
};

// A 1x1 fixture PNG is data for the mocked render contract, not render evidence.
const pixel = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aK1sAAAAASUVORK5CYII=", "base64");
const defaultViews = ["front", "back", "right", "isometric"];
const renderFixture = async (opts: { outDir: string; views?: readonly string[] }) => {
  mkdirSync(opts.outDir, { recursive: true });
  const views = (opts.views ?? defaultViews).map(view => {
    const path = join(opts.outDir, `simulated-${view}.png`);
    writeFileSync(path, pixel);
    return { view, path, sizeKb: pixel.length / 1024 };
  });
  return { ok: true as const, views };
};

const modulePath = (relative: string) => fileURLToPath(new URL(relative, import.meta.url));
mock.module(modulePath("../../src/scad/compile.ts"), () => ({
  compileScad, OPENSCAD_PATH: "simulated-no-binary",
  checkOpenscad: async () => { throw new Error("Unexpected binary probe in simulated fixture"); },
}));
mock.module(modulePath("../../src/render/ao.ts"), () => ({
  renderAOViews: (opts: RenderAOOpts) => renderFixture(opts),
  BLENDER_BIN: "simulated-no-binary", AO_RENDER_SCRIPT: "simulated-no-script", DEFAULT_VIEWS: defaultViews,
}));
mock.module(modulePath("../../src/render/parts_color.ts"), () => ({
  renderPartsColorViews: async (opts: RenderPartsColorOpts) => ({ ...await renderFixture(opts), legend: "body: synthetic fixture color" }),
  DEFAULT_PALETTE: [[0.5, 0.5, 0.5]], PARTS_COLOR_RENDER_SCRIPT: "simulated-no-script",
}));

const upstreamPrompt = readFileSync(modulePath("../../src/pipeline/diagnose-prompt.md"), "utf8");
const cleanIssues = /If there are no issues, write `([^`]+)`/.exec(upstreamPrompt)?.[1];
if (!cleanIssues) throw new Error("The upstream clean-diagnosis example changed; review this fixture");
const diagnosis = scenario === "clean"
  ? `SUMMARY: Synthetic fixture has no reported issues.\n\n${cleanIssues}`
  : scenario === "high-nochange"
    ? "SUMMARY: One simulated high-severity issue remains.\n\nISSUES:\n1. [HIGH] [modules: body] Synthetic fixture requires a proportion correction. FIX: Correct the body module."
    : scenario === "missing-issues"
      ? "SUMMARY: A partial critic response without its issue section."
      : scenario === "empty-issues"
        ? "SUMMARY: The critic response was truncated.\n\nISSUES:\n"
        : "The response ended before producing the required diagnosis structure.";
let criticCalls = 0;
let patchCalls = 0;
const patchRepairTexts: string[] = [];
mock.module(modulePath("../../src/llm/generate.ts"), () => ({
  generateWithRetry: async (args: { label?: string; parts: Array<{ kind: string; text?: string }> }) => {
    if (args.label?.startsWith("critic ")) {
      criticCalls += 1;
      return { text: diagnosis, reasoning: "" };
    }
    if (args.label?.startsWith("patch ") && scenario === "high-nochange") {
      patchCalls += 1;
      patchRepairTexts.push(args.parts.filter(p => p.kind === "text").map(p => p.text ?? "").join("\n"));
      return { text: "NOCHANGE", reasoning: "" };
    }
    throw new Error(`Unexpected simulated LLM stage: ${args.label}`);
  },
  generateOnce: async () => { throw new Error("Unexpected unmocked one-shot path"); },
}));

// Import after module mocks. Finalization, persistence, diagnosis parsing and
// state transitions are production code, as are the small mesh utilities.
const { runDirectRefine } = await import("../../src/pipeline/refine-direct.ts");
const result = await runDirectRefine({
  outputDir, model: "openai:simulated-fixture", maxSteps: 5, exportStl: true,
  bannerLabel: "SIMULATED refine state-machine regression test",
});
const report: RefineQualityReport = {
  kind: "simulated-state-machine", scenario, result, initialScad, diagnosis,
  criticCalls, patchCalls, networkAttempts, patchRepairTexts, compiledSources,
};
writeFileSync(join(outputDir, "fixture-report.json"), JSON.stringify(report, null, 2));
if (networkAttempts !== 0) throw new Error("An unexpected network call was attempted");
