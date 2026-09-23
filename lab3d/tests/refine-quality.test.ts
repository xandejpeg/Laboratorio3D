/** Simulated state-machine regression tests; never a visual-quality evaluation. */
import { describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import type { RefineQualityReport } from "./refine-quality.fixture.ts";

async function withScenario(scenario: string, check: (report: RefineQualityReport, outputDir: string) => void): Promise<void> {
  const temp = mkdtempSync(join(tmpdir(), "lab3d-refine-quality-"));
  // Every run gets a fresh process so Bun module mocks cannot change other suites.
  const proc = Bun.spawn([process.execPath, "--no-env-file", "run", join(import.meta.dir, "refine-quality.fixture.ts"), scenario, temp], {
    cwd: resolve(import.meta.dir, "../.."), stdout: "pipe", stderr: "pipe",
    env: {
      ...process.env,
      OPENAI_API_KEY: "", GEMINI_API_KEY: "", ANTHROPIC_API_KEY: "", PROCEDURA_IMAGE_MODEL: "",
      OPENAI_BASE_URL: "http://127.0.0.1:1", GEMINI_BASE_URL: "http://127.0.0.1:1",
      PROCEDURA_FINAL_SNAP: "0", PROCEDURA_REFINE_MAX_BARREN: "2",
      PROCEDURA_REFINE_MIN_FACET_RATIO: "0.8", PROCEDURA_FEEDBACK_RENDER_SIZE: "1",
    },
  });
  const timeout = setTimeout(() => proc.kill(), 15_000);
  let exited = false;
  try {
    const [code, stdout, stderr] = await Promise.all([
      proc.exited,
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
    ]);
    exited = true;
    if (code !== 0) throw new Error(`Simulated refine fixture failed (${scenario}, exit ${code}):\n${stdout}\n${stderr}`);
    const report = JSON.parse(readFileSync(join(temp, "fixture-report.json"), "utf8")) as RefineQualityReport;
    expect(report.kind).toBe("simulated-state-machine");
    expect(report.networkAttempts).toBe(0);
    expect(report.result.outputs.diagnosisPath).toBe(join(temp, "final_summary.txt"));
    expect(readFileSync(join(temp, "draft.scad"), "utf8")).toBe(report.initialScad);
    expect(readFileSync(join(temp, "final.scad"), "utf8")).toBe(report.initialScad);
    expect(existsSync(join(temp, "final.obj"))).toBe(true);
    check(report, temp);
  } finally {
    clearTimeout(timeout);
    if (!exited) { proc.kill(); await proc.exited; }
    // The exact mkdtemp target must remain a direct child of the intended temp directory.
    if (dirname(resolve(temp)) !== resolve(tmpdir()) || !basename(temp).startsWith("lab3d-refine-quality-")) {
      throw new Error("Refusing cleanup outside the fixture temporary directory");
    }
    rmSync(temp, { recursive: true, force: true });
  }
}

describe("runDirectRefine verdict persistence (simulated dependencies, no providers)", () => {
  for (const scenario of ["malformed", "missing-issues", "empty-issues"]) {
    test(`${scenario} critic output ends as error and persists the invalid-diagnosis evidence`, async () => {
      await withScenario(scenario, (report, dir) => {
        expect(report.result.ok).toBe(false);
        expect(report.result.verdict).toBe("error");
        expect(report.result.steps).toBe(0);
        expect(report.criticCalls).toBe(1);
        expect(report.patchCalls).toBe(0);
        expect(report.result.toolCalls).toBe(1);
        const persisted = readFileSync(join(dir, "final_summary.txt"), "utf8");
        expect(persisted).toMatch(/^verdict: error\n/);
        expect(persisted).toContain(report.result.summary);
        expect(persisted).not.toContain("verdict: ok");
        const step = join(dir, "_refine_steps", "step_001");
        expect(readFileSync(join(step, "diagnosis.txt"), "utf8")).toBe(report.diagnosis.trim());
        const sidecar = JSON.parse(readFileSync(join(step, "summary.json"), "utf8"));
        expect(sidecar).toMatchObject({ cycle: 1, accepted: false, invalidDiagnosis: true });
        expect(sidecar.note).toBe(report.result.summary);
      });
    }, 20_000);
  }

  test("repeated HIGH + NOCHANGE cannot approve unchanged geometry, including the persisted verdict", async () => {
    await withScenario("high-nochange", (report, dir) => {
      expect(report.result.ok).toBe(false);
      expect(report.result.verdict).toBe("max-steps");
      expect(report.result.steps).toBe(0);
      expect(report.criticCalls).toBe(2);
      expect(report.patchCalls).toBe(4);
      expect(report.result.toolCalls).toBe(6);
      const persisted = readFileSync(join(dir, "final_summary.txt"), "utf8");
      expect(persisted).toMatch(/^verdict: max-steps\n/);
      expect(persisted).toContain("0 accepted edit(s) over 6 LLM call(s)");
      expect(persisted).not.toContain("verdict: ok");
      expect(readdirSync(join(dir, "_refine_steps"))).toEqual(["step_001", "step_002"]);
      for (const cycle of [1, 2]) {
        const step = join(dir, "_refine_steps", `step_00${cycle}`);
        const summary = JSON.parse(readFileSync(join(step, "summary.json"), "utf8"));
        expect(summary).toMatchObject({ cycle, accepted: false, barren: cycle });
        expect(summary.note).toContain("NOCHANGE cannot resolve");
        for (const attempt of [1, 2]) {
          expect(readFileSync(join(step, `patch_response_${attempt}.txt`), "utf8")).toBe("NOCHANGE");
          expect(readFileSync(join(step, `patch_rejected_${attempt}.txt`), "utf8")).toContain("HIGH issues");
        }
        expect(existsSync(join(step, "scad.scad"))).toBe(false);
      }
      expect(report.patchRepairTexts[1]).toContain("YOUR PREVIOUS ATTEMPT FAILED");
      expect(report.patchRepairTexts[1]).toContain("NOCHANGE cannot resolve");
    });
  }, 20_000);

  test("the upstream explicit clean-diagnosis format can finish ok without calling the patcher", async () => {
    await withScenario("clean", (report, dir) => {
      // This approves only the response-format/state transition, not a real image/model.
      expect(report.result.ok).toBe(true);
      expect(report.result.verdict).toBe("ok");
      expect(report.result.steps).toBe(0);
      expect(report.criticCalls).toBe(1);
      expect(report.patchCalls).toBe(0);
      expect(report.result.toolCalls).toBe(1);
      expect(report.diagnosis).toContain("ISSUES: (none");
      const persisted = readFileSync(join(dir, "final_summary.txt"), "utf8");
      expect(persisted).toMatch(/^verdict: ok\n/);
      expect(persisted).toContain("0 accepted edit(s) over 1 LLM call(s)");
      expect(persisted).toContain(report.result.summary);
      expect(readFileSync(join(dir, "_refine_steps", "step_001", "diagnosis.txt"), "utf8")).toBe(report.diagnosis);
    });
  }, 20_000);
});
