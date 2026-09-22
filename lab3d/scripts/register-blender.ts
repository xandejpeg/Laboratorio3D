/** Register already-created local files. Does not generate or execute code. */
import { resolve } from "node:path";
import { registerBlenderResult } from "../src/blender-result.ts";

const args = process.argv.slice(2);
const values = new Map<string, string>();
for (let i = 0; i < args.length; i += 2) {
  const key = args[i];
  const value = args[i + 1];
  if (!key || !["--root", "--manifest"].includes(key) || !value || values.has(key)) {
    console.error("Usage: bun run lab3d/scripts/register-blender.ts --root <outputs-directory> --manifest <blender-result.json>");
    process.exit(2);
  }
  values.set(key, value);
}
if (!values.has("--root") || !values.has("--manifest")) {
  console.error("Both --root and --manifest are required. No service restart or model call is performed.");
  process.exit(2);
}
try {
  const result = registerBlenderResult(resolve(values.get("--root")!), resolve(values.get("--manifest")!));
  console.log(JSON.stringify({ runId: result.run.runId, characterKey: result.run.characterKey, reused: result.reused,
    directory: result.directory, characterPath: `/?character=${result.run.characterKey}` }, null, 2));
} catch (error) {
  console.error(`Blender result registration refused: ${(error as Error).message}`);
  process.exit(1);
}
