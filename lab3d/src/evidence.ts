/** Evidence comes from the upstream scanner and actual files, never job success alone. */
import { createHash } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { readRunDetail } from "../../web/server/scan.ts";
import { safeJoin } from "../../web/server/safe.ts";
import type { JobRecord } from "../../web/shared/types.ts";
import type { CharacterRun } from "../contract/types.ts";

export const UPSTREAM_COMMIT = "fac191ed49f55fcc2e0f23897e986042249f59fe";

export function readJsonFile(path: string): Record<string, any> | null {
  try { return JSON.parse(readFileSync(path, "utf8")); } catch { return null; }
}

export function collectEvidence(root: string, dir: string, run: CharacterRun | null, job: JobRecord | null) {
  const detail = readRunDetail(root, dir);
  const configuration = readJsonFile(join(dir, "lab3d-execution.json"));
  const completion = readJsonFile(join(dir, "lab3d-completion.json"));
  const purpose = run?.purpose ?? configuration?.purpose ?? "unlinked";
  const offline = purpose === "recompile" || purpose === "offline-compile";
  const parts = detail.incremental;
  const generated = new Set(parts?.parts.filter((p) => p.generated).map((p) => p.name) ?? []);
  const omittedParts = parts?.plan.filter((p) => !generated.has(p.name)).map((p) => p.name) ?? [];
  const errors = [job?.error, completion?.error, ...(parts?.parts.map((p) => p.error) ?? [])]
    .filter((e): e is string => typeof e === "string" && Boolean(e));
  const primary = detail.files.filter((f) => f.kind === "mesh" || f.kind === "scad" || f.kind === "image" || /summary|materials|lab3d-/.test(f.path))
    .filter((f) => !f.path.endsWith("lab3d-evidence.json"))
    .map((f) => f.path);
  const views = [...detail.previewViews, ...detail.previewPainted,
    ...detail.cycles.flatMap((cycle) => cycle.views),
    ...detail.renderSteps.flatMap((step) => [...step.ao, ...step.partsColor])];
  const artifacts = [...new Set([...primary, ...views.map((view) => view.path)])]
    .flatMap((path) => {
      const abs = safeJoin(root, path);
      if (!abs) return [];
      try {
        const bytes = readFileSync(abs);
        return [{ path, bytes: bytes.length, sha256: createHash("sha256").update(bytes).digest("hex") }];
      }
      catch { return []; } // An in-progress artifact may be replaced while scanning.
    });
  return {
    runId: detail.id,
    characterKey: run?.characterKey ?? configuration?.characterKey ?? null,
    purpose,
    job,
    configuration,
    completion,
    elapsedMs: job?.startedAt != null ? (job.endedAt ?? Date.now()) - job.startedAt : completion?.durationMs ?? null,
    quality: {
      approval: "not-reviewed" as const,
      stage: "draft" as const,
      verdict: detail.verdict,
      finalSummary: existsSync(join(dir, "final_summary.txt")) ? readFileSync(join(dir, "final_summary.txt"), "utf8") : null,
      omittedParts,
      floaterParts: parts?.parts.filter((p) => p.connected === false).map((p) => p.name) ?? [],
      errors,
      note: "Omissões e peças soltas descrevem o rascunho. Consulte o resumo final para o refino; a conclusão do processo não aprova identidade, anatomia, UVs ou rig.",
    },
    usage: {
      inputTokens: offline ? 0 : null,
      outputTokens: offline ? 0 : null,
      costUsd: offline ? 0 : null,
      note: offline ? "Compilação local, sem chamadas de modelo." : "O caminho direto upstream não persiste consumo completo. Consulte o provedor; ausência não é custo zero.",
    },
    artifacts,
  };
}

/** Final evidence is frozen once; live requests can still inspect current files. */
export function freezeEvidence(root: string, dir: string, run: CharacterRun | null, job: JobRecord | null): void {
  const path = join(dir, "lab3d-evidence.json");
  if (existsSync(path)) return;
  writeFileSync(path, JSON.stringify(collectEvidence(root, dir, run, job), null, 2), { flag: "wx" });
}
