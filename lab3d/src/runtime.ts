/**
 * Runtime probing for Windows.
 *
 * Upstream resolves OpenSCAD and Blender from `$HOME/opt/...`, `/usr/local/bin`
 * and `/opt` (src/scad/compile.ts, src/render/ao.ts). None of those exist on
 * Windows, so this module probes the real install locations and reports what
 * is genuinely usable. It does not patch upstream: it produces the values that
 * belong in `.env` (`OPENSCAD_PATH`, `PROCEDURA_BLENDER_PATH`), which upstream
 * reads first.
 */

import { existsSync, readdirSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

export interface BinaryProbe {
  name: string;
  path: string | null;
  version: string | null;
  /** OpenSCAD only: a non-Manifold build is orders of magnitude slower. */
  manifold?: boolean;
  envVar: string;
  notes: string[];
}

function run(bin: string, args: string[]): { ok: boolean; out: string } {
  try {
    const r = Bun.spawnSync([bin, ...args], { stdout: "pipe", stderr: "pipe" });
    return { ok: r.exitCode === 0, out: `${r.stdout.toString()}\n${r.stderr.toString()}` };
  } catch {
    return { ok: false, out: "" };
  }
}

function firstExisting(candidates: string[]): string | null {
  for (const c of candidates) {
    try {
      if (existsSync(c)) return c;
    } catch {
      /* unreadable mount */
    }
  }
  return null;
}

function programFiles(): string[] {
  return [
    process.env["ProgramFiles"] ?? "C:\\Program Files",
    process.env["ProgramFiles(x86)"] ?? "C:\\Program Files (x86)",
    process.env["LOCALAPPDATA"] ? join(process.env["LOCALAPPDATA"]!, "Programs") : "",
  ].filter(Boolean);
}

export function probeOpenscad(): BinaryProbe {
  const notes: string[] = [];
  const fromEnv = process.env["OPENSCAD_PATH"];
  const candidates = [
    ...(fromEnv ? [fromEnv] : []),
    ...programFiles().flatMap((base) => [
      join(base, "OpenSCAD", "openscad.exe"),
      join(base, "OpenSCAD (Nightly)", "openscad.exe"),
    ]),
    join(homedir(), "opt", "openscad", "openscad.exe"),
  ];
  let path = firstExisting(candidates);
  if (!path) {
    const which = run("where.exe", ["openscad"]);
    const line = which.out.split(/\r?\n/).find((l) => l.trim().toLowerCase().endsWith(".exe"));
    if (which.ok && line) path = line.trim();
  }
  if (!path) {
    notes.push(
      "OpenSCAD not found. Without it no geometry can be compiled: the pipeline cannot produce a mesh, " +
        "and parameter recompilation is unavailable.",
    );
    return { name: "OpenSCAD", path: null, version: null, manifold: false, envVar: "OPENSCAD_PATH", notes };
  }
  const help = run(path, ["--help"]);
  const manifold = help.out.includes("--backend");
  if (!manifold) {
    notes.push(
      "This build does not advertise --backend, so it is not Manifold-capable. Upstream refuses to run " +
        "unless PROCEDURA_ALLOW_CGAL_OPENSCAD=1, and CGAL is orders of magnitude slower.",
    );
  }
  const version = run(path, ["--version"]).out.trim().split(/\r?\n/)[0] ?? null;
  return { name: "OpenSCAD", path, version, manifold, envVar: "OPENSCAD_PATH", notes };
}

export function probeBlender(): BinaryProbe {
  const notes: string[] = [];
  const fromEnv = process.env["PROCEDURA_BLENDER_PATH"];
  const candidates: string[] = fromEnv ? [fromEnv] : [];
  for (const base of programFiles()) {
    const root = join(base, "Blender Foundation");
    try {
      if (!existsSync(root)) continue;
      for (const dir of readdirSync(root)) candidates.push(join(root, dir, "blender.exe"));
    } catch {
      /* unreadable */
    }
  }
  // Newest install wins when several versions are present.
  candidates.sort().reverse();
  let path = firstExisting(candidates);
  if (!path) {
    const which = run("where.exe", ["blender"]);
    const line = which.out.split(/\r?\n/).find((l) => l.trim().toLowerCase().endsWith(".exe"));
    if (which.ok && line) path = line.trim();
  }
  if (!path) {
    notes.push("Blender not found. The refine loop cannot render the model, so visual critique is unavailable.");
    return { name: "Blender", path: null, version: null, envVar: "PROCEDURA_BLENDER_PATH", notes };
  }
  const version = run(path, ["--version"]).out.trim().split(/\r?\n/)[0] ?? null;
  return { name: "Blender", path, version, envVar: "PROCEDURA_BLENDER_PATH", notes };
}

export interface LlmProbe {
  configured: boolean;
  baseUrl: string;
  model: string;
  imageGeneration: boolean;
  notes: string[];
}

export function probeLlm(env: Record<string, string | undefined> = process.env): LlmProbe {
  const key = env["OPENAI_API_KEY"] ?? "";
  const gemini = env["GEMINI_API_KEY"] ?? "";
  const notes: string[] = [];
  const configured = Boolean(key || gemini);
  if (!configured) {
    notes.push(
      "No LLM credential is set. Planning, part generation and refinement all call a model, so generation " +
        "cannot start. Import, the registry, the brief and the viewer work without it.",
    );
  }
  return {
    configured,
    baseUrl: env["OPENAI_BASE_URL"] ?? "https://api.openai.com/v1",
    model: env["PROCEDURA_MODEL"] ?? "gpt-5.2",
    imageGeneration: Boolean(env["PROCEDURA_IMAGE_MODEL"]),
    notes,
  };
}

export interface RuntimeReport {
  platform: string;
  bun: string;
  openscad: BinaryProbe;
  blender: BinaryProbe;
  llm: LlmProbe;
  /** What the lab can actually do right now, given the probes above. */
  capabilities: {
    import: boolean;
    brief: boolean;
    generate: boolean;
    recompileParams: boolean;
    visualCritique: boolean;
  };
}

export function probeRuntime(env: Record<string, string | undefined> = process.env): RuntimeReport {
  const openscad = probeOpenscad();
  const blender = probeBlender();
  const llm = probeLlm(env);
  return {
    platform: `${process.platform} ${process.arch}`,
    bun: Bun.version,
    openscad,
    blender,
    llm,
    capabilities: {
      import: true,
      brief: true,
      generate: Boolean(openscad.path) && llm.configured,
      recompileParams: Boolean(openscad.path),
      visualCritique: Boolean(blender.path),
    },
  };
}
