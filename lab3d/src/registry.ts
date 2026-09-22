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

import { appendFileSync, existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { characterKey, contentDigest, shortKey } from "../contract/identity.ts";
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

export class CharacterRegistry {
  constructor(private readonly labRoot: string) {}

  get dir(): string {
    return join(this.labRoot, "characters");
  }

  private recordDir(key: string): string {
    return join(this.dir, key);
  }

  has(key: string): boolean {
    return existsSync(join(this.recordDir(key), "record.json"));
  }

  read(key: string): CharacterRecord | null {
    const file = join(this.recordDir(key), "record.json");
    if (!existsSync(file)) return null;
    try {
      return JSON.parse(readFileSync(file, "utf8")) as CharacterRecord;
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
    const key = characterKey(bundle);
    const digest = contentDigest(bundle);
    const existing = this.read(key);
    if (existing) {
      if (existing.contentDigest !== digest) {
        throw new RegistryConflict(
          key,
          "a different character already occupies this identity; refusing to overwrite an immutable record",
        );
      }
      return { record: existing, reused: true };
    }

    const dir = this.recordDir(key);
    mkdirSync(dir, { recursive: true });
    for (const ref of references) writeFileSync(join(dir, ref.file), ref.bytes);
    writeFileSync(join(dir, "bundle.json"), JSON.stringify(bundle, null, 2), "utf8");
    writeFileSync(join(dir, "source.json"), JSON.stringify(rawPayload, null, 2), "utf8");

    const record: CharacterRecord = {
      key,
      shortKey: shortKey(key),
      importedAt: new Date().toISOString(),
      bundle,
      contentDigest: digest,
    };
    writeFileSync(join(dir, "record.json"), JSON.stringify(record, null, 2), "utf8");
    return { record, reused: false };
  }

  /** Append-only: a run is never rewritten, so history stays auditable. */
  linkRun(run: CharacterRun): void {
    const dir = this.recordDir(run.characterKey);
    if (!existsSync(dir)) throw new Error(`unknown character ${run.characterKey}`);
    appendFileSync(join(dir, "runs.jsonl"), `${JSON.stringify(run)}\n`, "utf8");
  }

  runs(key: string): CharacterRun[] {
    const file = join(this.recordDir(key), "runs.jsonl");
    if (!existsSync(file)) return [];
    return readFileSync(file, "utf8")
      .split("\n")
      .filter((l) => l.trim())
      .flatMap((line) => {
        try {
          return [JSON.parse(line) as CharacterRun];
        } catch {
          return [];
        }
      });
  }

  /** Absolute path of a file inside a record, or null when it escapes. */
  assetPath(key: string, file: string): string | null {
    if (!/^[A-Za-z0-9._-]+$/.test(key) || !/^[A-Za-z0-9._-]+$/.test(file) || file.startsWith(".")) return null;
    const abs = join(this.recordDir(key), file);
    return existsSync(abs) ? abs : null;
  }
}
