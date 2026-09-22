import type { MeshArtifact } from "../../web/shared/types.ts";

interface AvailableRun { id: string; hasFinalMesh: boolean; hasDraftMesh: boolean }
interface LinkedRun { runId: string; createdAt: string }

/** File writes must not make an old result newer than its immutable record. */
export function linkedResults<T extends AvailableRun>(available: T[], linked: LinkedRun[]): T[] {
  const records = new Map(linked.map((run, index) => [run.runId, { index, time: Date.parse(run.createdAt) || 0 }]));
  return available.filter((run) => records.has(run.id) && (run.hasFinalMesh || run.hasDraftMesh))
    .sort((a, b) => {
      const first = records.get(a.id)!;
      const second = records.get(b.id)!;
      return second.time - first.time || second.index - first.index;
    });
}

export function displayArtifact(
  detail: { painted: MeshArtifact | null; final: MeshArtifact | null; draft: MeshArtifact | null },
  blenderAuthored: boolean,
): MeshArtifact | undefined {
  // A Blender result's GLB carries its UVs/materials. An optional legacy OBJ
  // export must not take precedence over that authored delivery.
  if (blenderAuthored) {
    const glb = [detail.final, detail.painted, detail.draft].find((item) => item?.glbPath);
    if (glb) return glb;
  }
  return [detail.painted, detail.final, detail.draft].find((item): item is MeshArtifact =>
    Boolean(item?.glbPath || item?.objPath || item?.stlPath));
}
