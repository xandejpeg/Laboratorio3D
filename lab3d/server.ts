/**
 * Laboratorio3D server.
 *
 * It does NOT replace the Procedura Studio. It reuses the upstream job manager
 * (`web/server/jobs.ts`), run scanner (`web/server/scan.ts`), parameter
 * customizer (`web/server/customize.ts`) and path guard (`web/server/safe.ts`)
 * with focused Windows fixes, so every generation is a real `scripts/procedura.ts` subprocess
 * writing real artifacts — and adds the character contract on top.
 *
 * Two deliberate differences from upstream:
 *   - it binds to 127.0.0.1 only (upstream binds 0.0.0.0 with no auth);
 *   - verified binary paths are recorded and passed to the child environment.
 */

import { copyFileSync, existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { basename, extname, join, relative, resolve } from "node:path";

import { parseEnvFile } from "../web/server/env.ts";
import { JobManager } from "../web/server/jobs.ts";
import { compileCustom, extractParams, overrideToDefine, resolveScadFile } from "../web/server/customize.ts";
import { listRuns, readRunDetail, resolveRunDir } from "../web/server/scan.ts";
import { safeJoin } from "../web/server/safe.ts";
import type { JobEvent, JobOptions, ScadParam } from "../web/shared/types.ts";

import index from "./web/index.html";

import { ContractError } from "./contract/adapt.ts";
import { sha256Hex } from "./contract/identity.ts";
import type { CharacterRun, RunPurpose } from "./contract/types.ts";
import { buildBrief } from "./src/brief.ts";
import { importCharacter, type IncomingImage } from "./src/import.ts";
import { CharacterRegistry, RegistryConflict } from "./src/registry.ts";
import { probeRuntime } from "./src/runtime.ts";
import { bridgeOrigins } from "./src/bridge-origins.ts";
import { collectEvidence, freezeEvidence, readJsonFile, UPSTREAM_COMMIT } from "./src/evidence.ts";

const REPO = resolve(import.meta.dir, "..");
const ROOT = resolve(process.env["LAB3D_OUTPUTS_ROOT"] ?? join(REPO, "outputs"));
const LAB_ROOT = join(ROOT, "lab3d");
const PORT = Number(process.env["LAB3D_PORT"] ?? 8770);
/** Local-only by design for this milestone. */
const HOST = "127.0.0.1";
const DEV = process.env["NODE_ENV"] !== "production";
const MAX_SHEET_BYTES = 2 * 1024 * 1024;

mkdirSync(LAB_ROOT, { recursive: true });

const registry = new CharacterRegistry(LAB_ROOT);
const dotEnv = parseEnvFile(join(REPO, ".env"));
const effectiveEnv = { ...dotEnv, ...process.env };
const allowed2DOrigins = bridgeOrigins(effectiveEnv["LAB3D_2D_ORIGINS"]);
const runtime = probeRuntime(effectiveEnv);
const childEnv: Record<string, string> = Object.fromEntries(Object.entries(effectiveEnv).filter((entry): entry is [string, string] => typeof entry[1] === "string"));
// The core and customizer must execute the same binary that passed the probe.
if (runtime.openscad.path) {
  childEnv["OPENSCAD_PATH"] = runtime.openscad.path;
}
if (runtime.blender.path) {
  childEnv["PROCEDURA_BLENDER_PATH"] = runtime.blender.path;
}

const OPENSCAD = runtime.openscad.path ?? "openscad";

const jobs = new JobManager({
  root: ROOT,
  repo: existsSync(join(REPO, "node_modules")) ? REPO : null,
  childEnv,
  maxConcurrent: Math.max(1, Number(process.env["LAB3D_MAX_CONCURRENT"] ?? 1)),
  maxQueued: 8,
  retain: 500,
  defaultMaxSteps: 6,
});

// ── helpers ─────────────────────────────────────────────────────────────────

const json = (data: unknown, status = 200): Response =>
  new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
  });

const fail = (message: string, status = 400, details: string[] = []): Response =>
  json({ error: message, ...(details.length ? { details } : {}) }, status);

const q = (req: Request, name: string): string | null => new URL(req.url).searchParams.get(name);

const MIME: Record<string, string> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".obj": "model/obj",
  ".mtl": "model/mtl",
  ".stl": "model/stl",
  ".scad": "text/plain; charset=utf-8",
  ".txt": "text/plain; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".jsonl": "application/x-ndjson; charset=utf-8",
  ".usda": "text/plain; charset=utf-8",
  ".urdf": "application/xml; charset=utf-8",
};

function toError(e: unknown): Response {
  if (e instanceof ContractError) return fail(e.message, 422, e.details);
  if (e instanceof RegistryConflict) return fail(e.message, 409);
  return fail((e as Error).message ?? "unexpected error", 500);
}

// ── lab routes ──────────────────────────────────────────────────────────────

function handleRuntime(): Response {
  return json({
    ...runtime,
    root: ROOT,
    labRoot: LAB_ROOT,
    repo: REPO,
    generationEnabled: jobs.enabled,
    openscad: { ...runtime.openscad, effectivePath: OPENSCAD },
  });
}

async function handleImport(req: Request): Promise<Response> {
  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return fail("expected multipart/form-data");
  }

  const sheet = form.get("sheet");
  if (!(sheet instanceof File)) return fail('missing "sheet" (the 2D JSON export)');
  if (sheet.size > MAX_SHEET_BYTES) return fail("sheet JSON is too large", 413);
  let payload: unknown;
  try {
    payload = JSON.parse(await sheet.text());
  } catch (e) {
    return fail(`sheet is not valid JSON: ${(e as Error).message}`);
  }

  const images: IncomingImage[] = [];
  // The installed DOM/Bun typings narrow the entry value to string; at runtime
  // a file field is a File.
  const entries = [...form.entries()] as unknown as [string, string | File][];
  for (const [field, value] of entries) {
    if (typeof value === "string") continue;
    if (field === "sheet" || value.size === 0) continue;
    if (value.size > 24 * 1024 * 1024) return fail("image exceeds 24 MiB", 413);
    // Field name IS the labelled angle: front, profile-left, back, ...
    const note = form.get(`note:${field}`);
    images.push({
      angle: field,
      bytes: new Uint8Array(await value.arrayBuffer()),
      ...(typeof note === "string" && note.trim() ? { note: note.trim() } : {}),
    });
  }

  const nameField = form.get("name");
  try {
    const result = importCharacter(
      registry,
      payload,
      images,
      typeof nameField === "string" && nameField.trim() ? nameField.trim() : undefined,
    );
    return json(
      {
        ...result,
        brief: buildBrief(result.record.bundle),
        runs: registry.runs(result.record.key),
      },
      result.reused ? 200 : 201,
    );
  } catch (e) {
    return toError(e);
  }
}

function handleCharacters(): Response {
  const records = registry.list();
  return json({
    characters: records.map((record) => ({
      key: record.key,
      shortKey: record.shortKey,
      name: record.bundle.name,
      importedAt: record.importedAt,
      family: record.bundle.recipe.family,
      outfit: record.bundle.recipe.outfit,
      body: record.bundle.recipe.body,
      generatorVersion: record.bundle.source.generatorVersion,
      references: record.bundle.references.map((r) => ({ angle: r.angle, file: r.file, influence: r.influence })),
      runCount: registry.runs(record.key).length,
    })),
  });
}

function handleCharacter(req: Request): Response {
  const key = q(req, "key");
  if (!key) return fail("missing ?key");
  const record = registry.read(key);
  if (!record) return fail("character not found", 404);
  const runs = registry.runs(key);
  return json({
    record,
    brief: buildBrief(record.bundle),
    runs: runs.map((run) => ({ ...run, job: jobs.list().find((j) => j.id === run.jobId) ?? null })),
  });
}

function handleAsset(req: Request): Response {
  const key = q(req, "key");
  const file = q(req, "file");
  if (!key || !file) return fail("missing ?key and ?file");
  const abs = registry.assetPath(key, file);
  if (!abs) return fail("asset not found", 404);
  const mime = MIME[extname(abs).toLowerCase()];
  if (!mime) return fail("unsupported asset type", 415);
  return new Response(Bun.file(abs), {
    headers: { "content-type": mime, "cache-control": "public, max-age=300" },
  });
}

interface LabGenerateRequest {
  key?: string;
  maxSteps?: number;
  paint?: boolean;
  contextRenders?: boolean;
  exportStl?: boolean;
  agentModel?: string;
  scadModel?: string;
}

async function handleLabGenerate(req: Request): Promise<Response> {
  if (!jobs.enabled) {
    return fail("generation unavailable: run `bun install` in the repo root so the CLI can be spawned", 503);
  }
  if (!runtime.capabilities.recompileParams) {
    return fail("generation unavailable: OpenSCAD was not found; see lab3d/docs/WINDOWS_SETUP.md", 503);
  }
  if (!runtime.llm.configured) {
    return fail("generation unavailable: no LLM credential configured (OPENAI_API_KEY in .env)", 503);
  }
  if (!runtime.blender.path) return fail("generation unavailable: Blender is required for shape evaluation", 503);

  let body: LabGenerateRequest;
  try {
    body = (await req.json()) as LabGenerateRequest;
    if (!body || typeof body !== "object" || Array.isArray(body)) return fail("expected a JSON object");
  } catch {
    return fail("invalid JSON body");
  }
  const key = body.key;
  if (!key) return fail("missing key");
  const record = registry.read(key);
  if (!record) return fail("character not found", 404);

  const brief = buildBrief(record.bundle);
  const front = record.bundle.references.find((r) => r.authoritative);
  if (!front) return fail("character has no authoritative reference image", 422);

  // The job manager copies the reference from <root>/<imagePath> into the run
  // dir, so the path must be relative to the runs root.
  const imageAbs = registry.assetPath(key, front.file);
  if (!imageAbs) return fail("reference image missing from the record", 500);
  const imagePath = relative(ROOT, imageAbs).split("\\").join("/");

  const options: JobOptions = { imagePath };
  const steps = body.maxSteps ?? 4;
  if (typeof steps !== "number" || !Number.isInteger(steps) || steps < 0 || steps > 20) return fail("maxSteps must be an integer from 0 to 20", 422);
  options.maxSteps = steps;
  if (body.paint === true) options.paint = true;
  if (body.contextRenders === true) options.contextRenders = true;
  if (body.exportStl === true) options.exportStl = true;
  for (const k of ["agentModel", "scadModel"] as const) {
    const v = body[k];
    if (typeof v === "string" && v.trim() && v.length < 200) options[k] = v.trim();
    else if (v !== undefined) return fail(`invalid ${k}`, 422);
  }
  // Record explicit effective models so a later .env change cannot relabel a run.
  options.agentModel ??= runtime.llm.model;
  options.scadModel ??= runtime.llm.model;

  try {
    const job = jobs.create(brief.text, options);
    const run: CharacterRun = {
      characterKey: key,
      jobId: job.id,
      runId: job.runId,
      purpose: "generate" satisfies RunPurpose,
      createdAt: new Date().toISOString(),
      briefDigest: sha256Hex(brief.text),
      referenceFile: front.file,
      options: { ...options },
    };
    try {
      registry.linkRun(run);
      writeFileSync(join(ROOT, job.runId, "lab3d-execution.json"), JSON.stringify({
        ...run, upstreamCommit: UPSTREAM_COMMIT,
        runtime: { bun: runtime.bun, openscad: runtime.openscad.version, blender: runtime.blender.version, llm: runtime.llm },
        referenceSha256: front.sha256,
      }, null, 2), { flag: "wx" });
    } catch (e) {
      jobs.cancel(job.id);
      throw e;
    }
    const save = () => {
      const current = jobs.byRunId(job.runId);
      if (current && current.status !== "running" && current.status !== "queued") {
        try { freezeEvidence(ROOT, join(ROOT, job.runId), run, current); } catch (e) { console.error("evidence:", (e as Error).message); }
      }
    };
    let off: (() => void) | null = null;
    off = jobs.subscribe(job.id, (event) => {
      if (event.type === "status" && !["running", "queued"].includes(event.job.status)) { save(); off?.(); }
    });
    save();
    return json({ job, run }, 201);
  } catch (e) {
    return toError(e);
  }
}

/** Reverse lookup so a run page can show which character produced it. */
function handleRunCharacter(req: Request): Response {
  const runId = q(req, "runId");
  if (!runId) return fail("missing ?runId");
  for (const record of registry.list()) {
    const run = registry.runs(record.key).find((r) => r.runId === runId);
    if (run) return json({ record, run });
  }
  return json({ record: null, run: null });
}

function linkedRun(runId: string): CharacterRun | null {
  for (const record of registry.list()) {
    const run = registry.runs(record.key).find((r) => r.runId === runId);
    if (run) return run;
  }
  return null;
}

function handleIndependentRuns(): Response {
  const linked = new Set(registry.list().flatMap((record) => registry.runs(record.key).map((run) => run.runId)));
  return json({ runs: listRuns(ROOT).filter((run) => !linked.has(run.id)).map((run) => {
    const dir = resolveRunDir(ROOT, run.id);
    const configuration = dir ? readJsonFile(join(dir, "lab3d-execution.json")) : null;
    const completion = dir ? readJsonFile(join(dir, "lab3d-completion.json")) : null;
    return { ...run, purpose: configuration?.purpose ?? "unlinked",
      completion: typeof completion?.ok === "boolean" ? { ok: completion.ok } : null };
  }) });
}

function handleEvidence(req: Request): Response {
  const runId = q(req, "runId");
  if (!runId) return fail("missing ?runId");
  const dir = resolveRunDir(ROOT, runId);
  if (!dir) return fail("run not found", 404);
  return json(collectEvidence(ROOT, dir, linkedRun(runId), jobs.byRunId(runId)));
}

// ── reused Procedura studio routes ──────────────────────────────────────────

function runDirFromReq(req: Request): { dir: string } | Response {
  const id = q(req, "id");
  if (!id) return fail("missing ?id");
  const dir = resolveRunDir(ROOT, id);
  if (!dir) return fail("run not found", 404);
  return { dir };
}

const handleRuns = (): Response => json({ root: ROOT, runs: existsSync(ROOT) ? listRuns(ROOT) : [] });

function handleRun(req: Request): Response {
  const r = runDirFromReq(req);
  if (r instanceof Response) return r;
  try {
    return json(readRunDetail(ROOT, r.dir));
  } catch (e) {
    return fail(`could not read run: ${(e as Error).message}`, 500);
  }
}

const handleJobs = (): Response => json({ jobs: jobs.list(), generation: jobs.enabled });

function handleJob(req: Request): Response {
  const id = q(req, "id");
  if (!id) return fail("missing ?id");
  const detail = jobs.detail(id);
  return detail ? json(detail) : fail("job not found", 404);
}

function handleCancel(req: Request): Response {
  const id = q(req, "id");
  if (!id) return fail("missing ?id");
  return json({ canceled: jobs.cancel(id) });
}

function handleJobStream(req: Request): Response {
  const id = q(req, "id");
  if (!id) return fail("missing ?id");
  const snap = jobs.snapshot(id);
  if (!snap) return fail("job not found", 404);

  const enc = new TextEncoder();
  let live: ((ev: JobEvent) => void) | null = null;
  let unsubscribe: (() => void) | null = null;
  const buffered: JobEvent[] = [];
  unsubscribe = jobs.subscribe(id, (ev) => (live ? live(ev) : buffered.push(ev)));

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const finish = () => {
        unsubscribe?.();
        unsubscribe = null;
        live = null;
        try { controller.close(); } catch { /* already closed */ }
      };
      req.signal.addEventListener("abort", finish, { once: true });
      const send = (ev: JobEvent) => {
        try {
          controller.enqueue(enc.encode(`data: ${JSON.stringify(ev)}\n\n`));
        } catch {
          /* client gone */
        }
      };
      send({ type: "progress", progress: snap.progress });
      for (const line of snap.log) send({ type: "log", line });
      // A terminal status tells EventSource clients to close. Send it last so
      // reopening a completed run still delivers its persisted log first.
      send({ type: "status", job: snap.record });
      for (const ev of buffered.splice(0)) send(ev);
      live = (ev) => {
        send(ev);
        if (ev.type === "status" && ev.job && ev.job.status !== "running" && ev.job.status !== "queued") {
          finish();
        }
      };
      if (!["running", "queued"].includes(snap.record.status)) finish();
    },
    cancel() {
      unsubscribe?.();
      unsubscribe = null;
    },
  });

  return new Response(stream, {
    headers: {
      "content-type": "text/event-stream",
      "cache-control": "no-cache, no-transform",
      connection: "keep-alive",
    },
  });
}

function handleParams(req: Request): Response {
  const r = runDirFromReq(req);
  if (r instanceof Response) return r;
  const which = q(req, "which") ?? "final";
  const scadAbs = resolveScadFile(r.dir, which);
  if (!scadAbs) return fail("no SCAD file for this run", 404);
  let params: ScadParam[] = [];
  try {
    params = extractParams(readFileSync(scadAbs, "utf8"));
    const saved = readJsonFile(join(r.dir, "lab3d-execution.json"));
    const applied = extractParams((saved?.defines ?? []).join(";\n") + ";");
    const values = new Map(applied.map((p) => [p.name, p.value]));
    params = params.map((p) => values.has(p.name) ? { ...p, value: values.get(p.name)! } : p);
  } catch (e) {
    return fail(`could not read SCAD: ${(e as Error).message}`, 500);
  }
  return json({
    params,
    scadPath: relative(ROOT, scadAbs).split("\\").join("/"),
    customizeAvailable: runtime.capabilities.recompileParams,
  });
}

async function handleCustomize(req: Request): Promise<Response> {
  if (!runtime.capabilities.recompileParams) return fail("recompilation unavailable: working OpenSCAD/Manifold required", 503);
  let body: { id?: string; key?: string; which?: string; overrides?: Record<string, number | boolean | string>; preview?: boolean };
  try {
    body = (await req.json()) as typeof body;
    if (!body || typeof body !== "object" || Array.isArray(body)) return fail("expected a JSON object");
  } catch {
    return fail("invalid JSON body");
  }
  if (!body.id) return fail("missing id");
  const dir = resolveRunDir(ROOT, body.id);
  if (!dir) return fail("run not found", 404);
  const scadAbs = resolveScadFile(dir, body.which ?? "final");
  if (!scadAbs) return fail("no SCAD file for this run", 404);
  const parent = linkedRun(body.id);
  if (body.key && parent?.characterKey !== body.key) return fail("run does not belong to this character", 409);
  const active = jobs.byRunId(body.id);
  if (active && ["running", "queued"].includes(active.status)) return fail("wait for the source generation to finish", 409);
  if (body.preview === true) return fail("use a full recompilation for a saved laboratory result", 422);
  if (!body.overrides || typeof body.overrides !== "object" || Array.isArray(body.overrides)) return fail("overrides must be an object", 422);

  const source = readFileSync(scadAbs, "utf8");
  const codeOnly = source.replace(/\/\*[\s\S]*?\*\/|\/\/[^\r\n]*|"(?:\\.|[^"\\])*"/g, "");
  if (/\b(?:include|use)\s*<|\b(?:import|surface)\s*\(/.test(codeOnly)) {
    return fail("saved recompilation currently requires self-contained SCAD; external include/use/import/surface dependencies are not copied", 422);
  }
  const params = extractParams(source);
  const byName = new Map(params.map((p) => [p.name, p]));
  const inherited = readJsonFile(join(dir, "lab3d-execution.json"));
  const effectiveDefines = new Map<string, string>();
  if (Array.isArray(inherited?.defines)) {
    for (const p of extractParams(inherited.defines.join(";\n") + ";")) {
      const param = byName.get(p.name);
      const define = param && overrideToDefine(param, p.value);
      if (define) effectiveDefines.set(p.name, define);
    }
  }
  for (const [name, value] of Object.entries(body.overrides ?? {})) {
    const param = byName.get(name);
    if (!param) return fail(`unknown parameter "${name}"`, 422);
    if ((param.type === "number" || param.type === "enum-number") && (typeof value !== "number" || !Number.isFinite(value))) return fail(`invalid number for "${name}"`, 422);
    if (param.type === "boolean" && typeof value !== "boolean") return fail(`invalid boolean for "${name}"`, 422);
    if (["string", "enum-string", "vector"].includes(param.type) && typeof value !== "string") return fail(`invalid text for "${name}"`, 422);
    if (param.options && !param.options.includes(value as never)) return fail(`value is not a supported option for "${name}"`, 422);
    if (typeof value === "number" && ((param.min !== undefined && value < param.min) || (param.max !== undefined && value > param.max))) return fail(`value outside declared range for "${name}"`, 422);
    const define = overrideToDefine(param, value);
    if (!define) return fail(`invalid value for "${name}"`, 422);
    effectiveDefines.set(name, define);
  }
  const defines = [...effectiveDefines.values()];

  const runId = `recompile-${Date.now().toString(36)}-${randomUUID().slice(0, 8)}`;
  const runDir = join(ROOT, runId);
  mkdirSync(runDir);
  // Keep the original execution immutable. The new SCAD carries the values
  // applied by OpenSCAD; external dependencies were rejected above.
  const effectiveScad = source + "\n// Laboratorio3D applied parameters\n" + defines.map((d) => d + ";").join("\n") + "\n";
  writeFileSync(join(runDir, "final.scad"), effectiveScad, { flag: "wx" });
  writeFileSync(join(runDir, "prompt_input.txt"), `Recompilação de ${body.id}; sem chamada de modelo.\n`, { flag: "wx" });
  copyFileSync(join(runDir, "prompt_input.txt"), join(runDir, "prompt.txt"));
  const run: CharacterRun | null = parent ? {
    characterKey: parent.characterKey, runId, jobId: runId, purpose: "recompile", createdAt: new Date().toISOString(),
    briefDigest: parent.briefDigest, referenceFile: parent.referenceFile,
    options: { sourceRunId: body.id, which: body.which ?? "final", overrides: body.overrides },
  } : null;
  writeFileSync(join(runDir, "lab3d-execution.json"), JSON.stringify({
    ...(run ?? { runId, purpose: "recompile", characterKey: null }), upstreamCommit: UPSTREAM_COMMIT,
    sourceRunId: body.id, sourceScadSha256: sha256Hex(source), defines,
    openscad: { version: runtime.openscad.version, path: OPENSCAD },
  }, null, 2), { flag: "wx" });
  if (run) registry.linkRun(run);
  const result = await compileCustom({
    openscad: OPENSCAD,
    root: ROOT,
    runDir: dir,
    scadAbs,
    defines,
    preview: false,
  });
  writeFileSync(join(runDir, "lab3d-completion.json"), JSON.stringify({ ...result, completedAt: new Date().toISOString() }, null, 2), { flag: "wx" });
  if (result.ok) {
    copyFileSync(safeJoin(ROOT, result.stl)!, join(runDir, "final.stl"));
    freezeEvidence(ROOT, runDir, run, null);
    return json({
      stl: `${runId}/final.stl`,
      run,
      runId,
      durationMs: result.durationMs,
      cached: result.cached,
      preview: result.preview ?? null,
    });
  }
  freezeEvidence(ROOT, runDir, run, null);
  return fail(result.error, result.busy ? 429 : 422);
}

function handleFile(req: Request): Response {
  const path = q(req, "path");
  if (!path) return fail("missing ?path");
  if (path.split(/[/\\]/).some((seg) => seg.startsWith("."))) return fail("forbidden", 403);
  const mime = MIME[extname(path).toLowerCase()];
  if (!mime) return fail("unsupported file type", 415);
  const abs = safeJoin(ROOT, path);
  if (!abs) return fail("path escapes root", 403);
  if (!existsSync(abs) || !statSync(abs).isFile()) return fail("file not found", 404);
  const headers: Record<string, string> = { "content-type": mime, "cache-control": "no-store" };
  if (q(req, "download") !== null) {
    headers["content-disposition"] = `attachment; filename="${basename(abs).replace(/"/g, "")}"`;
  }
  return new Response(Bun.file(abs), { headers });
}

// ── serve ───────────────────────────────────────────────────────────────────

function local(handler: (req: Request) => Response | Promise<Response>) {
  return async (req: Request): Promise<Response> => {
    const url = new URL(req.url);
    if (!["127.0.0.1", "localhost"].includes(url.hostname)) return fail("local host required", 403);
    const origin = req.headers.get("origin");
    if (origin && origin !== url.origin) return fail("cross-origin access is disabled for this local laboratory", 403);
    if (req.headers.get("sec-fetch-site") === "cross-site") return fail("cross-site access is disabled", 403);
    try { return await handler(req); } catch (e) { return toError(e); }
  };
}

const server = Bun.serve({
  port: PORT,
  hostname: HOST,
  development: DEV ? { hmr: true } : false,
  maxRequestBodySize: 96 * 1024 * 1024,
  routes: {
    "/api/lab/bridge-config": { GET: local(() => json({ version: 1, allowedOrigins: allowed2DOrigins })) },
    "/api/lab/runtime": { GET: local(handleRuntime) },
    "/api/lab/import": { POST: local(handleImport) },
    "/api/lab/characters": { GET: local(handleCharacters) },
    "/api/lab/character": { GET: local(handleCharacter) },
    "/api/lab/asset": { GET: local(handleAsset) },
    "/api/lab/generate": { POST: local(handleLabGenerate) },
    "/api/lab/run-character": { GET: local(handleRunCharacter) },
    "/api/lab/evidence": { GET: local(handleEvidence) },
    "/api/lab/independent-runs": { GET: local(handleIndependentRuns) },
    "/api/runs": { GET: local(handleRuns) },
    "/api/run": { GET: local(handleRun) },
    "/api/jobs": { GET: local(handleJobs) },
    "/api/job": { GET: local(handleJob) },
    "/api/jobs/cancel": { POST: local(handleCancel) },
    "/api/jobs/stream": { GET: local(handleJobStream) },
    "/api/params": { GET: local(handleParams) },
    "/api/customize": { POST: local(handleCustomize) },
    "/api/file": { GET: local(handleFile) },
    "/*": index,
  },
});

const yn = (v: unknown) => (v ? "yes" : "no");
console.log(`\n  Laboratorio3D  →  http://127.0.0.1:${server.port}  (local only)`);
console.log(`  runs root      →  ${ROOT}`);
console.log(`  lab root       →  ${LAB_ROOT}`);
console.log(`  openscad       →  ${runtime.openscad.path ?? "NOT FOUND"}${runtime.openscad.manifold ? " (manifold)" : ""}`);
console.log(`  blender        →  ${runtime.blender.path ?? "NOT FOUND"}`);
console.log(
  `  capabilities   →  import ${yn(runtime.capabilities.import)} · brief ${yn(runtime.capabilities.brief)} · ` +
    `generate ${yn(runtime.capabilities.generate && jobs.enabled)} · recompile ${yn(runtime.capabilities.recompileParams)} · ` +
    `visual critique ${yn(runtime.capabilities.visualCritique)}`,
);
for (const note of [...runtime.openscad.notes, ...runtime.blender.notes, ...runtime.llm.notes]) {
  console.log(`  ! ${note}`);
}
console.log("");
