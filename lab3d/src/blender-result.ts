/** Local file registration only. Never executes Blender, Python or a model. */
import { existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { dirname, extname, join, relative, resolve, sep } from "node:path";
import { canonicalJson, sha256Hex } from "../contract/identity.ts";
import type { CharacterRun } from "../contract/types.ts";
import { CharacterRegistry, RegistryConflict } from "./registry.ts";
import { buildBrief } from "./brief.ts";
import { freezeEvidence, readJsonFile, UPSTREAM_COMMIT } from "./evidence.ts";

export interface BlenderResultManifest {
  contract: "lab3d.blender-result";
  contractVersion: 1;
  runId: string;
  characterKey: string;
  /** Exact digest of the authoritative image used to author this result. */
  referenceSha256: string;
  sourceRunId?: string;
  title: string;
  blenderVersion: string;
  /** Export convention, not a claim that physical character height was measured. */
  coordinates: "gltf-y-up";
  artifacts: string[];
  limitations: string[];
}

const HEX = /^[a-f0-9]{64}$/;
const RUN = /^[A-Za-z0-9][A-Za-z0-9_-]{0,149}$/;
const EXTENSIONS = new Set([".glb", ".blend", ".png", ".jpg", ".jpeg", ".webp", ".obj", ".mtl", ".py", ".json", ".txt"]);
const MAX_FILE_BYTES = 1024 * 1024 * 1024;
const RESERVED = new Set(["image.png", "prompt.txt", "prompt_input.txt", "record.json", "bundle.json", "source.json"]);

export function parseBlenderManifest(value: unknown): BlenderResultManifest {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Blender result manifest must be a JSON object");
  const m = value as Record<string, unknown>;
  if (m.contract !== "lab3d.blender-result" || m.contractVersion !== 1) throw new Error("Unsupported Blender result contract/version");
  if (typeof m.runId !== "string" || !RUN.test(m.runId)) throw new Error("Invalid result runId");
  if (typeof m.characterKey !== "string" || !HEX.test(m.characterKey) || typeof m.referenceSha256 !== "string" || !HEX.test(m.referenceSha256)) throw new Error("Exact character and reference SHA-256 are required");
  if (m.sourceRunId !== undefined && (typeof m.sourceRunId !== "string" || !/^[A-Za-z0-9][A-Za-z0-9._-]{0,199}$/.test(m.sourceRunId) || m.sourceRunId === m.runId)) throw new Error("Invalid sourceRunId");
  for (const key of ["title", "blenderVersion"]) if (typeof m[key] !== "string" || !(m[key] as string).trim() || (m[key] as string).length > 300) throw new Error(`${key} is required`);
  if (m.coordinates !== "gltf-y-up") throw new Error("GLB must declare the gltf-y-up export convention");
  if (!Array.isArray(m.limitations) || m.limitations.length > 30 || !m.limitations.every((item) => typeof item === "string" && item.length <= 2000)) throw new Error("limitations must be a bounded array of strings");
  if (!Array.isArray(m.artifacts) || m.artifacts.length < 2 || m.artifacts.length > 64 || !m.artifacts.every(safeArtifact)) throw new Error("Invalid artifact list: use relative supported files without hidden paths or reserved metadata names");
  if (new Set(m.artifacts.map((file: string) => file.toLowerCase())).size !== m.artifacts.length) throw new Error("Duplicate artifact path");
  if (!m.artifacts.includes("final.glb") || !m.artifacts.includes("character.blend")) throw new Error("final.glb and character.blend are required");
  return structuredClone(m) as unknown as BlenderResultManifest;
}

function safeArtifact(value: unknown): value is string {
  return typeof value === "string" && value.length <= 180 && value.split("/").every((part) => /^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(part))
    && !value.split("/").some((part) => part.toLowerCase().startsWith("lab3d-"))
    && !RESERVED.has(value.toLowerCase()) && EXTENSIONS.has(extname(value).toLowerCase());
}

/** Structural checks and resource policy; this is not a visual quality verdict. */
export function inspectGlb(bytes: Uint8Array): { meshes: number; materials: number; skins: number; animations: number } {
  if (bytes.length < 28 || bytes.length > MAX_FILE_BYTES) throw new Error("GLB is empty, truncated or too large");
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (view.getUint32(0, true) !== 0x46546c67 || view.getUint32(4, true) !== 2 || view.getUint32(8, true) !== bytes.length) throw new Error("Expected a complete GLB 2.0 container");
  let json: Record<string, any> | null = null;
  let binLength = 0;
  for (let offset = 12; offset < bytes.length;) {
    if (offset + 8 > bytes.length) throw new Error("Truncated GLB chunk");
    const length = view.getUint32(offset, true);
    const type = view.getUint32(offset + 4, true);
    const end = offset + 8 + length;
    if (length % 4 || end > bytes.length) throw new Error("Invalid GLB chunk length");
    if (offset === 12) {
      if (type !== 0x4e4f534a || length > 32 * 1024 * 1024) throw new Error("GLB must begin with a bounded JSON chunk");
      json = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes.subarray(offset + 8, end)));
    } else if (type === 0x004e4942 && !binLength) binLength = length;
    else throw new Error("Unsupported or duplicate GLB chunk");
    offset = end;
  }
  if (!json || typeof json !== "object" || json.asset?.version !== "2.0" || !Array.isArray(json.meshes) || !json.meshes.length || !binLength) throw new Error("GLB must contain glTF 2.0 mesh data and embedded geometry");
  const inspect = (node: unknown): void => {
    if (!node || typeof node !== "object") return;
    for (const [key, value] of Object.entries(node)) {
      if (key === "uri") throw new Error("GLB resources must be embedded: URI references are not accepted");
      inspect(value);
    }
  };
  inspect(json);
  const unsupported = new Set(["KHR_draco_mesh_compression", "EXT_meshopt_compression", "KHR_texture_basisu"]);
  if ([...(json.extensionsUsed ?? []), ...(json.extensionsRequired ?? [])].some((name: string) => unsupported.has(name))) throw new Error("Compressed GLB extensions require a decoder not configured in the laboratory");
  if (!Array.isArray(json.buffers) || json.buffers.length !== 1 || !Number.isSafeInteger(json.buffers[0]?.byteLength) || json.buffers[0].byteLength <= 0 || json.buffers[0].byteLength > binLength || binLength - json.buffers[0].byteLength > 3) throw new Error("Invalid embedded GLB buffer");
  if (!Array.isArray(json.bufferViews) || !json.bufferViews.length || !Array.isArray(json.accessors) || !json.accessors.length) throw new Error("GLB mesh accessors are missing");
  for (const buffer of json.bufferViews) {
    const offset = buffer.byteOffset ?? 0;
    if (buffer.buffer !== 0 || !Number.isSafeInteger(offset) || offset < 0 || !Number.isSafeInteger(buffer.byteLength) || buffer.byteLength <= 0 || offset + buffer.byteLength > json.buffers[0].byteLength) throw new Error("GLB buffer view escapes the embedded geometry");
  }
  for (const mesh of json.meshes) {
    if (!Array.isArray(mesh.primitives) || !mesh.primitives.length) throw new Error("GLB mesh has no primitives");
    for (const primitive of mesh.primitives) {
      const position = primitive.attributes?.POSITION;
      if (!Number.isSafeInteger(position) || position < 0 || !json.accessors[position] || json.accessors[position].type !== "VEC3" || json.accessors[position].count <= 0) throw new Error("GLB primitive has no valid position accessor");
    }
  }
  return { meshes: json.meshes.length, materials: json.materials?.length ?? 0, skins: json.skins?.length ?? 0, animations: json.animations?.length ?? 0 };
}

function assetBytes(base: string, file: string): Uint8Array {
  let path = base;
  for (const segment of file.split("/")) {
    path = join(path, segment);
    if (lstatSync(path).isSymbolicLink()) throw new Error(`Artifact symlinks are not accepted: ${file}`);
  }
  const rel = relative(base, realpathSync(path));
  const stat = lstatSync(path);
  if (rel.startsWith("..") || resolve(base, rel) !== realpathSync(path) || !stat.isFile() || stat.size <= 0 || stat.size > MAX_FILE_BYTES) throw new Error(`Invalid artifact file: ${file}`);
  return readFileSync(path);
}

export function registerBlenderResult(rootInput: string, manifestPath: string): { run: CharacterRun; reused: boolean; directory: string } {
  const root = resolve(rootInput);
  const manifest = parseBlenderManifest(JSON.parse(readFileSync(manifestPath, "utf8")));
  const base = realpathSync(dirname(resolve(manifestPath)));
  const registry = new CharacterRegistry(join(root, "lab3d"));
  const record = registry.read(manifest.characterKey);
  if (!record) throw new Error("Character record is missing or corrupt; import its 2D snapshot first");
  const reference = record.bundle.references.find((item) => item.authoritative);
  if (!reference || reference.sha256 !== manifest.referenceSha256) throw new Error("Reference digest does not match this character's authoritative snapshot");
  if (manifest.sourceRunId && !registry.runs(record.key).some((run) => run.runId === manifest.sourceRunId)) throw new Error("Source execution does not belong to this character");
  const files = manifest.artifacts.map((file) => ({ file, bytes: assetBytes(base, file) }));
  const geometry = inspectGlb(files.find((file) => file.file === "final.glb")!.bytes);
  if (new TextDecoder().decode(files.find((file) => file.file === "character.blend")!.bytes.subarray(0, 7)) !== "BLENDER") throw new Error("character.blend does not have a Blender file header");
  const hashes = files.map(({ file, bytes }) => ({ path: `${manifest.runId}/${file}`, bytes: bytes.length, sha256: sha256Hex(bytes) }));
  const registrationDigest = sha256Hex(canonicalJson({ manifest, artifacts: hashes }));
  const directory = join(root, manifest.runId);
  if (existsSync(directory)) {
    const prior = readJsonFile(join(directory, "lab3d-execution.json"));
    if (prior?.registrationDigest !== registrationDigest || prior.characterKey !== record.key || prior.purpose !== "blender-authored") throw new RegistryConflict(record.key, "Result directory is already occupied; previous results are never overwritten");
    for (const hash of hashes) if (sha256Hex(assetBytes(directory, hash.path.slice(manifest.runId.length + 1))) !== hash.sha256) throw new RegistryConflict(record.key, "Registered result files changed; refusing reuse");
    const run = prior.run as CharacterRun;
    if (!run || run.characterKey !== record.key || run.runId !== manifest.runId) throw new RegistryConflict(record.key, "Registered provenance is incomplete");
    registry.linkRun(run);
    freezeEvidence(root, directory, run, null);
    return { run, reused: true, directory };
  }
  // Check ownership before publishing a new result. linkRun checks again with
  // an exclusive global run-index reservation when the result is complete.
  if (existsSync(join(root, "lab3d", "run-index", `${manifest.runId}.json`)) || registry.list().some((character) => registry.runs(character.key).some((run) => run.runId === manifest.runId))) throw new RegistryConflict(record.key, "runId already belongs to another immutable execution");
  const createdAt = new Date().toISOString();
  const brief = buildBrief(record.bundle).text;
  const run: CharacterRun = {
    characterKey: record.key, runId: manifest.runId, jobId: manifest.runId, purpose: "blender-authored", createdAt,
    briefDigest: sha256Hex(brief), referenceFile: reference.file,
    options: { mode: "blender-authored-local", backend: "blender", ...(manifest.sourceRunId ? { sourceRunId: manifest.sourceRunId } : {}), registrationDigest },
  };
  const configuration = { ...run, run, backend: "blender", registrationDigest, upstreamCommit: UPSTREAM_COMMIT,
    sourceContract: manifest.contract, sourceContractVersion: manifest.contractVersion,
    referenceSha256: reference.sha256, characterContentDigest: record.contentDigest,
    title: manifest.title, blenderVersion: manifest.blenderVersion, coordinates: manifest.coordinates,
    capabilities: { recompileParams: false }, geometry, limitations: manifest.limitations, artifacts: hashes,
    ...(manifest.sourceRunId ? { sourceRunId: manifest.sourceRunId } : {}),
  };
  mkdirSync(root, { recursive: true });
  const staging = mkdtempSync(join(root, ".blender-import-"));
  try {
    for (const { file, bytes } of files) {
      const destination = join(staging, file);
      mkdirSync(dirname(destination), { recursive: true });
      writeFileSync(destination, bytes, { flag: "wx" });
    }
    writeFileSync(join(staging, "image.png"), readFileSync(registry.assetPath(record.key, reference.file)!), { flag: "wx" });
    // Use the original extension for non-PNG references, not a mislabeled file.
    if (reference.mime !== "image/png") throw new Error("Blender character registration currently requires the original 2D PNG reference");
    writeFileSync(join(staging, "prompt_input.txt"), brief, { flag: "wx" });
    writeFileSync(join(staging, "prompt.txt"), manifest.title, { flag: "wx" });
    writeFileSync(join(staging, "lab3d-execution.json"), JSON.stringify(configuration, null, 2), { flag: "wx" });
    writeFileSync(join(staging, "lab3d-completion.json"), JSON.stringify({ ok: true, operation: "registered-existing-blender-files", completedAt: createdAt,
      note: "GLB structure and local file hashes checked. No generation or Blender compilation was executed by registration; visual review remains pending." }, null, 2), { flag: "wx" });
    renameSync(staging, directory);
  } finally {
    if (existsSync(staging) && resolve(staging).startsWith(root + sep)) rmSync(staging, { recursive: true, force: true });
  }
  // If linking is interrupted, an exact retry verifies the published files and
  // completes the append; it never rewrites a result with different bytes.
  registry.linkRun(run);
  freezeEvidence(root, directory, run, null);
  return { run, reused: false, directory };
}
