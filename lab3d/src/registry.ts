/**
 * Immutable character ledger.
 *
 * Layout under <labRoot>:
 *
 *   characters/<key>/record.json        the frozen import record
 *   characters/<key>/bundle.json        the bundle exactly as adapted
 *   characters/<key>/source.json        the raw payload the caller sent
 *   characters/<key>/<angle>.<ext>      the reference images
 *   characters/<key>/runs.jsonl         append-only link to pipeline runs
 *
 * `record.json` is written once. A re-import of the same key is only accepted
 * when it produces the same content digest; otherwise it is rejected, because
 * two different characters sharing a key would let one show the other's model.
 */

import { appendFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { canonicalJson, characterKey, contentDigest, sha256Hex, shortKey } from "../contract/identity.ts";
import type { CharacterBundle, CharacterRecord, CharacterRun } from "../contract/types.ts";

export class RegistryConflict extends Error {
  constructor(
    readonly key: string,
    message: string,
  ) {
    super(message);
    this.name = "RegistryConflict";
  }
}

export interface StoredReference {
  angle: string;
  file: string;
  bytes: Uint8Array;
}

export interface ImportResult {
  record: CharacterRecord;
  /** True when the exact same character had already been imported. */
  reused: boolean;
}

const validKey = (key: string): boolean => /^[a-f0-9]{64}$/.test(key);
const validRunId = (id: string): boolean => /^[A-Za-z0-9][A-Za-z0-9._-]{0,199}$/.test(id);
const validReferenceFile = (file: string): boolean => /^(front|profile-left|profile-right|back|three-quarter|detail)\.(png|jpg|webp)$/.test(file);

export class CharacterRegistry {
  constructor(private readonly labRoot: string) {}

  get dir(): string {
    return join(this.labRoot, "characters");
  }

  private recordDir(key: string): string {
    return join(this.dir, key);
  }

  has(key: string): boolean {
    return this.read(key) !== null;
  }

  read(key: string): CharacterRecord | null {
    if (!validKey(key)) return null;
    const file = join(this.recordDir(key), "record.json");
    if (!existsSync(file)) return null;
    try {
      const record = JSON.parse(readFileSync(file, "utf8")) as CharacterRecord;
      if (record.key !== key || characterKey(record.bundle) !== key) return null;
      // Preserve previously written v1 records, whose content digest included
      // exportedAt and multipart order. Both formats are checked from bytes.
      if (contentDigest(record.bundle) !== record.contentDigest && sha256Hex(canonicalJson(record.bundle)) !== record.contentDigest) return null;
      for (const ref of record.bundle.references) {
        if (!validReferenceFile(ref.file)) return null;
        const bytes = readFileSync(join(this.recordDir(key), ref.file));
        if (bytes.length !== ref.bytes || sha256Hex(bytes) !== ref.sha256) return null;
      }
      return record;
    } catch {
      return null;
    }
  }

  list(): CharacterRecord[] {
    if (!existsSync(this.dir)) return [];
    const out: CharacterRecord[] = [];
    for (const name of readdirSync(this.dir)) {
      const rec = this.read(name);
      if (rec) out.push(rec);
    }
    return out.sort((a, b) => b.importedAt.localeCompare(a.importedAt));
  }

  /**
   * Freeze a character. Returns the existing record untouched when the same
   * combination was already imported; throws when the key collides with
   * different content.
   */
  commit(bundle: CharacterBundle, references: StoredReference[], rawPayload: unknown): ImportResult {
    bundle = structuredClone(bundle);
    const key = characterKey(bundle);
    const digest = contentDigest(bundle);
    const existing = this.read(key);
    if (existing) {
      if (contentDigest(existing.bundle) !== digest) {
        throw new RegistryConflict(
          key,
          "a different character already occupies this identity; refusing to overwrite an immutable record",
        );
      }
      return { record: existing, reused: true };
    }

    const dir = this.recordDir(key);
    if (existsSync(dir)) {
      throw new RegistryConflict(key, "this identity has an incomplete or corrupt record; refusing to overwrite its files");
    }
    if (references.length !== bundle.references.length || new Set(references.map((r) => r.file)).size !== references.length) {
      throw new RegistryConflict(key, "reference files do not match the bundle");
    }
    for (const ref of references) {
      const expected = bundle.references.find((r) => r.angle === ref.angle && r.file === ref.file);
      if (!validReferenceFile(ref.file) || !expected || expected.bytes !== ref.bytes.length || expected.sha256 !== sha256Hex(ref.bytes)) {
        throw new RegistryConflict(key, "reference bytes differ from the validated import");
      }
    }
    const record: CharacterRecord = {
      key,
      shortKey: shortKey(key),
      importedAt: new Date().toISOString(),
      bundle,
      contentDigest: digest,
    };
    mkdirSync(this.dir, { recursive: true });
    // Only expose complete records. A failed write leaves the final identity
    // untouched; a competing writer can never replace an occupied directory.
    const staging = mkdtempSync(join(this.dir, ".import-"));
    try {
      for (const ref of references) writeFileSync(join(staging, ref.file), ref.bytes, { flag: "wx" });
      writeFileSync(join(staging, "bundle.json"), JSON.stringify(bundle, null, 2), { encoding: "utf8", flag: "wx" });
      writeFileSync(join(staging, "source.json"), JSON.stringify(rawPayload, null, 2), { encoding: "utf8", flag: "wx" });
      writeFileSync(join(staging, "record.json"), JSON.stringify(record, null, 2), { encoding: "utf8", flag: "wx" });
      try {
        renameSync(staging, dir);
      } catch (error) {
        const winner = this.read(key);
        if (winner && contentDigest(winner.bundle) === digest) return { record: winner, reused: true };
        if (existsSync(dir)) throw new RegistryConflict(key, "another import occupied this identity; refusing to replace it");
        throw error;
      }
    } finally {
      // staging is the exact unique directory this call created, under dir.
      if (existsSync(staging)) rmSync(staging, { recursive: true, force: true });
    }
    return { record, reused: false };
  }

  /** Append-only: a run is never rewritten, so history stays auditable. */
  linkRun(run: CharacterRun): void {
    if (!validKey(run.characterKey) || !validRunId(run.runId) || !validRunId(run.jobId)) throw new Error("invalid character or execution identifier");
    const record = this.read(run.characterKey);
    if (!record) throw new Error(`unknown or corrupt character ${run.characterKey}`);
    if (run.referenceFile !== null && !record.bundle.references.some((r) => r.file === run.referenceFile)) {
      throw new Error("execution reference is not part of this character");
    }
    // Consult legacy ledgers even when their character files are damaged:
    // corruption must not release ownership of an already used execution id.
    for (const key of existsSync(this.dir) ? readdirSync(this.dir).filter(validKey) : []) {
      const previous = this.runs(key).find((r) => r.runId === run.runId);
      if (!previous) continue;
      if (canonicalJson(previous) === canonicalJson(run)) return;
      throw new RegistryConflict(run.characterKey, "this execution is already linked; refusing to change its character or provenance");
    }
    // Exclusive ownership also covers concurrent processes. Retries with the
    // exact same provenance can finish an interrupted append.
    const index = join(this.labRoot, "run-index");
    mkdirSync(index, { recursive: true });
    const owner = join(index, `${run.runId}.json`);
    try {
      writeFileSync(owner, JSON.stringify(run), { encoding: "utf8", flag: "wx" });
    } catch (error) {
      if (!existsSync(owner)) throw error;
      const previous = JSON.parse(readFileSync(owner, "utf8"));
      if (canonicalJson(previous) !== canonicalJson(run)) throw new RegistryConflict(run.characterKey, "this execution belongs to a different immutable provenance record");
    }
    const dir = this.recordDir(run.characterKey);
    appendFileSync(join(dir, "runs.jsonl"), `${JSON.stringify(run)}\n`, "utf8");
  }

  runs(key: string): CharacterRun[] {
    if (!validKey(key)) return [];
    const file = join(this.recordDir(key), "runs.jsonl");
    if (!existsSync(file)) return [];
    return readFileSync(file, "utf8")
      .split("\n")
      .filter((l) => l.trim())
      .flatMap((line) => {
        try {
          const run = JSON.parse(line) as CharacterRun;
          return run.characterKey === key && validRunId(run.runId) ? [run] : [];
        } catch {
          return [];
        }
      });
  }

  /** Absolute path of a file inside a record, or null when it escapes. */
  assetPath(key: string, file: string): string | null {
    if (!validKey(key) || !validReferenceFile(file)) return null;
    const record = this.read(key);
    if (!record?.bundle.references.some((r) => r.file === file)) return null;
    const abs = join(this.recordDir(key), file);
    return existsSync(abs) ? abs : null;
  }
}
