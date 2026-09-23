/** Queue subprocess tests, using a test worker, never an LLM or synthetic generation. */
import { afterAll, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve, sep } from "node:path";
import { buildJobArguments, buildJobRecipe, JobManager } from "../../web/server/jobs.ts";

const temp = mkdtempSync(join(tmpdir(), "lab3d-queue-"));
const repo = join(temp, "worker");
const root = join(temp, "runs");
mkdirSync(join(repo, "scripts"), { recursive: true });
writeFileSync(join(repo, "scripts", "procedura.ts"), `
import { writeFileSync, readFileSync } from "node:fs";
import { join } from "node:path";
const args = process.argv.slice(2);
const dir = args[args.indexOf("-o") + 1]!;
writeFileSync(join(dir, "worker-args.json"), JSON.stringify(args));
writeFileSync(join(dir, "worker-env.json"), JSON.stringify(Object.fromEntries(
  ["PROCEDURA_LLM_TIMEOUT_MS", "PROCEDURA_LLM_DEADLINE_MS", "PROCEDURA_MAX_PARTS", "PROCEDURA_PROVIDER", "OPENSCAD_PATH"].map(key => [key, process.env[key]])
)));
console.log("queue test worker started");
await Bun.sleep(400);
console.error("queue test worker drained");
`);
const opts = { root, repo, childEnv: { OPENAI_API_KEY: "", GEMINI_API_KEY: "", PROCEDURA_LLM_TIMEOUT_MS: "123", PROCEDURA_LLM_DEADLINE_MS: "456", PROCEDURA_MAX_PARTS: "2", PROCEDURA_PROVIDER: "openai", OPENSCAD_PATH: "preserved-test-binary", PROCEDURA_ISAACSIM_PATH: join(temp, "absent-isaac") }, maxConcurrent: 1, maxQueued: 3, retain: 20, defaultMaxSteps: 3 };
const manager = new JobManager(opts);

async function terminal(id: string) {
  const deadline = Date.now() + 8_000;
  while (Date.now() < deadline) {
    const item = manager.detail(id)!;
    if (!["queued", "running"].includes(item.status)) return item;
    await Bun.sleep(25);
  }
  throw new Error("test worker did not finish");
}

afterAll(() => {
  for (const job of manager.list()) manager.cancel(job.id);
  const absolute = resolve(temp);
  if (!absolute.startsWith(resolve(tmpdir()) + sep) || !absolute.includes("lab3d-queue-")) throw new Error("unsafe fixture cleanup");
  rmSync(absolute, { recursive: true, force: true });
});

test("queued jobs reserve independent directories and cancel without starting", async () => {
  const first = manager.create("first queue test", { noImage: true, exportStl: true });
  const next = manager.create("second queue test", { noImage: true });
  expect(next.status).toBe("queued");
  expect(existsSync(join(root, next.runId))).toBe(true);
  writeFileSync(join(root, next.runId, "lab3d-execution.json"), "{}");
  expect(manager.cancel(next.id)).toBe(true);
  const done = await terminal(first.id);
  expect(done.status).toBe("succeeded");
  // Exit zero is process completion only; no mesh exists in this worker test.
  expect(done.progress.finalReady).toBe(false);
  expect(done.log.at(-2)).toContain("queue test worker drained");
  const args = JSON.parse(readFileSync(join(root, first.runId, "worker-args.json"), "utf8"));
  expect(args[args.indexOf("--max-steps") + 1]).toBe("3");
  expect(args).toContain("--export-stl");
  expect(existsSync(join(root, next.runId, "worker-args.json"))).toBe(false);
  const restored = new JobManager(opts).detail(first.id)!;
  expect(restored.log).toEqual(done.log);
}, 10_000);

test("running cancellation produces a serializable terminal record", async () => {
  const active = manager.create("cancellation worker", { noImage: true });
  expect(manager.cancel(active.id)).toBe(true);
  const deadline = Date.now() + 8_000;
  while (!manager.detail(active.id)?.endedAt && Date.now() < deadline) await Bun.sleep(25);
  const done = manager.detail(active.id)!;
  expect(done.status).toBe("canceled");
  expect(done.endedAt).toBeNumber();
  expect(() => JSON.stringify(done)).not.toThrow();
  const saved = JSON.parse(readFileSync(join(root, "_web_jobs", `${active.id}.json`), "utf8"));
  expect(saved.status).toBe("canceled");
  expect(saved.killTimer).toBeUndefined();
}, 10_000);

test("best expands once, records only non-secret configuration, and preserves other presets", () => {
  const env = { ...opts.childEnv, OPENAI_API_KEY: "synthetic-secret-never-persist", PROCEDURA_MODEL: "test-default-model", PROCEDURA_RENDER_GPU: "CPU", PROCEDURA_ALLOW_CGAL_OPENSCAD: "1" };
  const options = { preset: "best" as const, imagePath: "front.png", maxSteps: 1, paint: false, noImage: true, oneShot: true, paintModel: "test-paint" };
  const best = buildJobRecipe(options, 6, env, false);
  expect(best.options).toMatchObject({ preset: "best", imagePath: "front.png", maxSteps: 12, noImage: false, oneShot: false,
    contextRenders: true, assembly: true, paint: true, motion: true, motionUrdf: true, motionNoValidate: true,
    agentModel: "test-default-model", scadModel: "test-default-model", paintModel: "test-paint", motionModel: "test-default-model" });
  expect(options.maxSteps).toBe(1);
  expect(buildJobRecipe(best.options, 6, env, false)).toEqual(best);
  expect(best.environmentOverrides).toEqual({ PROCEDURA_LLM_TIMEOUT_MS: "1800000", PROCEDURA_LLM_DEADLINE_MS: "1800000", PROCEDURA_MAX_PARTS: "0" });
  expect(best.effectiveConfiguration.environment).toMatchObject({ OPENSCAD_PATH: "preserved-test-binary", PROCEDURA_PROVIDER: "openai", PROCEDURA_RENDER_GPU: "CPU", PROCEDURA_ALLOW_CGAL_OPENSCAD: "1" });
  expect(JSON.stringify(best.effectiveConfiguration)).not.toContain("synthetic-secret");
  expect(best.effectiveConfiguration.physicalValidation.status).toBe("skipped-unavailable");
  const args = buildJobArguments(best.options, "run path", "prompt path", "copied front.png");
  for (const flag of ["--image", "--3d-feedback", "--assembly", "--paint", "--motion", "--motion-urdf", "--motion-no-validate", "--max-steps", "--paint-model", "--motion-model"]) expect(args.filter(v => v === flag)).toHaveLength(1);
  expect(args).not.toContain("--no-image");
  expect(args).not.toContain("--one-shot");
  expect(args[args.indexOf("--max-steps") + 1]).toBe("12");
  for (const preset of ["default", "custom"] as const) {
    const other = buildJobRecipe({ preset, noImage: true, maxSteps: 2, paint: false }, 6, env, false);
    expect(other.options).toEqual({ preset, noImage: true, maxSteps: 2, paint: false });
    expect(other.environmentOverrides).toEqual({});
  }
  expect(buildJobRecipe({ motionUrdf: true }, 6, env).effectiveConfiguration.physicalValidation.requested).toBe(true);
  expect(buildJobRecipe({ motionModel: "test-motion" }, 6, env).effectiveConfiguration.physicalValidation.requested).toBe(true);
  expect(buildJobRecipe({ motionModel: "test-motion", motion: false }, 6, env).options.motion).toBe(true);
});

test("best subprocess receives the existing image, models, exact flags and per-job limits", async () => {
  mkdirSync(root, { recursive: true });
  const reference = new Uint8Array([1, 2, 3, 4]); // Test-worker bytes; never submitted to the pipeline.
  writeFileSync(join(root, "fixture-reference.png"), reference);
  const job = manager.create("best queue worker", { preset: "best", imagePath: "fixture-reference.png", agentModel: "test-agent", scadModel: "test-scad", paintModel: "test-paint", motionModel: "test-motion" });
  const done = await terminal(job.id);
  expect(done.status).toBe("succeeded");
  expect(done.progress.finalReady).toBe(false);
  const args = JSON.parse(readFileSync(join(root, job.runId, "worker-args.json"), "utf8"));
  const copied = args[args.indexOf("--image") + 1];
  expect(Array.from(readFileSync(copied))).toEqual(Array.from(reference));
  expect(copied).toBe(join(root, job.runId, "image_input.png"));
  expect(args).toEqual(buildJobArguments(done.options, join(root, job.runId), join(root, job.runId, "prompt_input.txt"), copied).slice(2));
  const env = JSON.parse(readFileSync(join(root, job.runId, "worker-env.json"), "utf8"));
  expect(env).toEqual({ PROCEDURA_LLM_TIMEOUT_MS: "1800000", PROCEDURA_LLM_DEADLINE_MS: "1800000", PROCEDURA_MAX_PARTS: "0", PROCEDURA_PROVIDER: "openai", OPENSCAD_PATH: "preserved-test-binary" });
  expect(new JobManager(opts).detail(job.id)?.effectiveConfiguration).toEqual(done.effectiveConfiguration);
  const ordinary = manager.create("ordinary worker after best", { noImage: true });
  await terminal(ordinary.id);
  expect(JSON.parse(readFileSync(join(root, ordinary.runId, "worker-env.json"), "utf8"))).toMatchObject({ PROCEDURA_LLM_TIMEOUT_MS: "123", PROCEDURA_LLM_DEADLINE_MS: "456", PROCEDURA_MAX_PARTS: "2" });
}, 10_000);
