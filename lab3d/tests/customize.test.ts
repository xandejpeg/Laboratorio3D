import { expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { compileCustom } from "../../web/server/customize.ts";
import { computeBBox, loadSTL } from "../../src/mesh/stl.ts";
import { probeOpenscad } from "../src/runtime.ts";

const binary = probeOpenscad();
test.skipIf(!binary.path)("real parameter compile survives a long Windows workspace and retains cache reuse", async () => {
  const temp = mkdtempSync(join(tmpdir(), "lab3d-long-path-"));
  const runDir = join(temp, "r".repeat(Math.max(1, 152 - temp.length - 1)));
  mkdirSync(runDir);
  const source = join(runDir, "final.scad");
  writeFileSync(source, "width=12; cube([width,5,8]);\n");
  // The previous hash+UUID output exceeded Windows MAX_PATH at this length.
  expect(join(runDir, "_customize", `${"a".repeat(64)}-${"b".repeat(36)}.stl`).length).toBeGreaterThan(260);
  try {
    const options = { openscad: binary.path!, root: temp, runDir, scadAbs: source, defines: ["width=42"] };
    const first = await compileCustom(options);
    expect(first.ok).toBe(true);
    if (!first.ok) throw new Error(first.error);
    const bounds = computeBBox(loadSTL(join(temp, first.stl)));
    expect(bounds.size).toEqual([42, 5, 8]);
    const again = await compileCustom(options);
    expect(again.ok).toBe(true);
    if (!again.ok) throw new Error(again.error);
    expect(again.cached).toBe(true);
    expect(again.stl).toBe(first.stl);
  } finally {
    const resolved = resolve(temp);
    if (dirname(resolved) !== resolve(tmpdir()) || !basename(resolved).startsWith("lab3d-long-path-")) {
      throw new Error("Refusing cleanup outside the exact test temporary directory");
    }
    rmSync(resolved, { recursive: true, force: true });
  }
}, 20_000);
