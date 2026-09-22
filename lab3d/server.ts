/**
 * Laboratorio3D server.
 *
 * It does NOT replace the Procedura Studio. It reuses the upstream job manager
 * (`web/server/jobs.ts`), run scanner (`web/server/scan.ts`), parameter
 * customizer (`web/server/customize.ts`) and path guard (`web/server/safe.ts`)
 * unchanged, so every generation is a real `scripts/procedura.ts` subprocess
 * writing real artifacts — and adds the character contract on top.
 *
 * Two deliberate differences from upstream:
 *   - it binds to 127.0.0.1 only (upstream binds 0.0.0.0 with no auth);
 *   - missing Windows binary paths discovered by the runtime probe are injected
 *     into the child environment, because upstream only searches POSIX paths.
 */

import { existsSync, mkdirSync, readFileSync, statSync } from "node:fs";
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
const runtime = probeRuntime();

const dotEnv = parseEnvFile(join(REPO, ".env"));
const childEnv: Record<string, string> = { ...dotEnv };
// Upstream searches $HOME/opt, /usr/local/bin and /opt. On Windows those never
// match, so hand it the paths the probe actually found.
if (!childEnv["OPENSCAD_PATH"] && !process.env["OPENSCAD_PATH"] && runtime.openscad.path) {
  childEnv["OPENSCAD_PATH"] = runtime.openscad.path;
}
if (!childEnv["PROCEDURA_BLENDER_PATH"] && !process.env["PROCEDURA_BLENDER_PATH"] && runtime.blender.path) {
  childEnv["PROCEDURA_BLENDER_PATH"] = runtime.blender.path;
}

const OPENSCAD = process.env["OPENSCAD_PATH"] || childEnv["OPENSCAD_PATH"] || runtime.openscad.path || "openscad";

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
    if (field === "sheet") continue;
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
  if (!runtime.openscad.path) {
    return fail("generation unavailable: OpenSCAD was not found; see lab3d/docs/WINDOWS_SETUP.md", 503);
  }
  if (!runtime.llm.configured) {
    return fail("generation unavailable: no LLM credential configured (OPENAI_API_KEY in .env)", 503);
  }

  let body: LabGenerateRequest;
  try {
    body = (await req.json()) as LabGenerateRequest;
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
  const steps = Number(body.maxSteps);
  if (Number.isFinite(steps) && steps >= 0 && steps <= 40) options.maxSteps = Math.floor(steps);
  if (body.paint === true) options.paint = true;
  if (body.contextRenders === true) options.contextRenders = true;
  for (const k of ["agentModel", "scadModel"] as const) {
    const v = body[k];
    if (typeof v === "string" && v.trim() && v.length < 200) options[k] = v.trim();
  }

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
    registry.linkRun(run);
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
      const send = (ev: JobEvent) => {
        try {
          controller.enqueue(enc.encode(`data: ${JSON.stringify(ev)}\n\n`));
        } catch {
          /* client gone */
        }
      };
      send({ type: "status", job: snap.record });
      send({ type: "progress", progress: snap.progress });
      for (const line of snap.log) send({ type: "log", line });
      for (const ev of buffered.splice(0)) send(ev);
      live = (ev) => {
        send(ev);
        if (ev.type === "status" && ev.job && ev.job.status !== "running" && ev.job.status !== "queued") {
          setTimeout(() => {
            try {
              controller.close();
            } catch {
              /* already closed */
            }
          }, 250);
        }
      };
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
  } catch (e) {
    return fail(`could not read SCAD: ${(e as Error).message}`, 500);
  }
  return json({
    params,
    scadPath: relative(ROOT, scadAbs).split("\\").join("/"),
    customizeAvailable: Boolean(runtime.openscad.path),
  });
}

async function handleCustomize(req: Request): Promise<Response> {
  if (!runtime.openscad.path) return fail("recompilation unavailable: OpenSCAD not found", 503);
  let body: { id?: string; which?: string; overrides?: Record<string, number | boolean | string>; preview?: boolean };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return fail("invalid JSON body");
  }
  if (!body.id) return fail("missing id");
  const dir = resolveRunDir(ROOT, body.id);
  if (!dir) return fail("run not found", 404);
  const scadAbs = resolveScadFile(dir, body.which ?? "final");
  if (!scadAbs) return fail("no SCAD file for this run", 404);

  const params = extractParams(readFileSync(scadAbs, "utf8"));
  const byName = new Map(params.map((p) => [p.name, p]));
  const defines: string[] = [];
  for (const [name, value] of Object.entries(body.overrides ?? {})) {
    const param = byName.get(name);
    if (!param) return fail(`unknown parameter "${name}"`, 422);
    const define = overrideToDefine(param, value);
    if (!define) return fail(`invalid value for "${name}"`, 422);
    defines.push(define);
  }

  const result = await compileCustom({
    openscad: OPENSCAD,
    root: ROOT,
    runDir: dir,
    scadAbs,
    defines,
    preview: body.preview === true,
  });
  if (result.ok) {
    return json({
      stl: result.stl,
      durationMs: result.durationMs,
      cached: result.cached,
      preview: result.preview ?? null,
    });
  }
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

const server = Bun.serve({
  port: PORT,
  hostname: HOST,
  development: DEV ? { hmr: true } : false,
  routes: {
    "/api/lab/runtime": { GET: handleRuntime },
    "/api/lab/import": { POST: handleImport },
    "/api/lab/characters": { GET: handleCharacters },
    "/api/lab/character": { GET: handleCharacter },
    "/api/lab/asset": { GET: handleAsset },
    "/api/lab/generate": { POST: handleLabGenerate },
    "/api/lab/run-character": { GET: handleRunCharacter },
    "/api/runs": { GET: handleRuns },
    "/api/run": { GET: handleRun },
    "/api/jobs": { GET: handleJobs },
    "/api/job": { GET: handleJob },
    "/api/jobs/cancel": { POST: handleCancel },
    "/api/jobs/stream": { GET: handleJobStream },
    "/api/params": { GET: handleParams },
    "/api/customize": { POST: handleCustomize },
    "/api/file": { GET: handleFile },
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
