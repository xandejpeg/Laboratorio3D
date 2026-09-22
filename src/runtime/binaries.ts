/** Shared native executable discovery. Explicit paths always remain first. */
import { existsSync, readdirSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

export type RuntimeEnv = Record<string, string | undefined>;

function matchingDirectories(base: string, prefix: string): string[] {
  try {
    return readdirSync(base, { withFileTypes: true })
      .filter((entry) => entry.isDirectory() && entry.name.toLowerCase().startsWith(prefix))
      .map((entry) => entry.name)
      .sort((a, b) => b.localeCompare(a, undefined, { numeric: true }))
      .map((name) => join(base, name));
  } catch {
    return [];
  }
}

function windowsInstallRoots(env: RuntimeEnv): string[] {
  return [env.ProgramFiles ?? "C:\\Program Files", env["ProgramFiles(x86)"] ?? "C:\\Program Files (x86)",
    ...(env.LOCALAPPDATA ? [join(env.LOCALAPPDATA, "Programs")] : [])];
}

export function openscadCandidates(env: RuntimeEnv = process.env): string[] {
  const native = process.platform === "win32"
    ? windowsInstallRoots(env).flatMap((base) => matchingDirectories(base, "openscad").map((dir) => join(dir, "openscad.exe")))
    : [join(env.HOME ?? homedir(), "opt", "openscad"), "/usr/local/bin/openscad", "/opt/openscad/openscad"];
  return [...new Set([env.OPENSCAD_PATH, ...native, Bun.which("openscad", { PATH: env.PATH }), "openscad"].filter((value): value is string => Boolean(value)))];
}

export function blenderCandidates(env: RuntimeEnv = process.env): string[] {
  const native = process.platform === "win32"
    ? windowsInstallRoots(env).flatMap((base) => matchingDirectories(join(base, "Blender Foundation"), "blender").map((dir) => join(dir, "blender.exe")))
    : [join(env.HOME ?? homedir(), "opt", "blender", "blender"), "/usr/local/bin/blender", "/opt/blender/blender",
      ...(process.platform === "darwin" ? ["/Applications/Blender.app/Contents/MacOS/Blender"] : [])];
  return [...new Set([env.PROCEDURA_BLENDER_PATH, ...native, Bun.which("blender", { PATH: env.PATH })].filter((value): value is string => Boolean(value)))];
}

export function resolveBlenderPath(env: RuntimeEnv = process.env): string | null {
  // A typo in an explicit override must be reported, not silently ignored.
  if (env.PROCEDURA_BLENDER_PATH) return env.PROCEDURA_BLENDER_PATH;
  return blenderCandidates(env).find((path) => existsSync(path)) ?? null;
}

export function probeBinary(path: string, args: string[]): { ok: boolean; output: string } {
  try {
    const result = Bun.spawnSync([path, ...args], { stdout: "pipe", stderr: "pipe", timeout: 10_000 });
    return { ok: result.exitCode === 0, output: `${result.stdout.toString()}\n${result.stderr.toString()}`.trim() };
  } catch {
    return { ok: false, output: "" };
  }
}
