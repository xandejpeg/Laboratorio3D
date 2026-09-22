import { expect, test } from "bun:test";
import type { MeshArtifact } from "../../web/shared/types.ts";
import { displayArtifact, linkedResults } from "./results.ts";

test("the latest linked geometry uses immutable creation order, never unrelated files or mtime", () => {
  const available = [
    { id: "old-scad", hasFinalMesh: true, hasDraftMesh: false, mtime: 999 },
    { id: "other-character", hasFinalMesh: true, hasDraftMesh: false, mtime: 999 },
    { id: "new-blender", hasFinalMesh: true, hasDraftMesh: false, mtime: 1 },
    { id: "queued", hasFinalMesh: false, hasDraftMesh: false, mtime: 1000 },
  ];
  const linked = [
    { runId: "old-scad", createdAt: "2026-09-22T10:00:00Z" },
    { runId: "new-blender", createdAt: "2026-09-22T11:00:00Z" },
    { runId: "queued", createdAt: "2026-09-22T12:00:00Z" },
  ];
  expect(linkedResults(available, linked).map((run) => run.id)).toEqual(["new-blender", "old-scad"]);
  expect(available[0]!.id).toBe("old-scad");
  expect(linkedResults(available, linked.slice(0, 2).map((run) => ({ ...run, createdAt: "2026-09-22T10:00:00Z" }))).map((run) => run.id)).toEqual(["new-blender", "old-scad"]);
});

test("Blender prefers its final GLB while Procedura retains the painted OBJ and draft fallback", () => {
  const artifact = (paths: Partial<MeshArtifact>): MeshArtifact => ({ scadPath: null, stlPath: null, objPath: null, mtlPath: null, scadLines: null, ...paths });
  const painted = artifact({ objPath: "run/final_painted.obj", mtlPath: "run/final_painted.mtl" });
  const final = artifact({ glbPath: "run/final.glb", stlPath: "run/final.stl" });
  const draft = artifact({ stlPath: "run/draft.stl" });
  expect(displayArtifact({ painted, final, draft }, true)).toBe(final);
  expect(displayArtifact({ painted, final, draft }, false)).toBe(painted);
  expect(displayArtifact({ painted: null, final: null, draft }, false)).toBe(draft);
  expect(displayArtifact({ painted: null, final: null, draft: null }, true)).toBeUndefined();
});
