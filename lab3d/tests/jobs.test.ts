/** Queue subprocess tests, using a test worker, never an LLM or synthetic generation. */
import { afterAll, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve, sep } from "node:path";
import { JobManager } from "../../web/server/jobs.ts";

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
console.log("queue test worker started");
await Bun.sleep(400);
console.error("queue test worker drained");
`);
const opts = { root, repo, childEnv: { OPENAI_API_KEY: "", GEMINI_API_KEY: "" }, maxConcurrent: 1, maxQueued: 3, retain: 20, defaultMaxSteps: 3 };
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
