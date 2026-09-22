/**
 * `bun run lab3d/scripts/doctor.ts`
 *
 * Reports what the machine can actually do right now, and what is missing for
 * each pipeline stage. It never installs anything and never guesses a path.
 */

import { existsSync } from "node:fs";
import { join, resolve } from "node:path";

import { parseEnvFile } from "../../web/server/env.ts";
import { probeRuntime } from "../src/runtime.ts";

const REPO = resolve(import.meta.dir, "..", "..");
const runtime = probeRuntime({ ...parseEnvFile(join(REPO, ".env")), ...process.env } as Record<string, string>);

const ok = (v: boolean) => (v ? "OK  " : "MISS");
const line = (label: string, value: string) => console.log(`  ${label.padEnd(18)} ${value}`);

console.log("\nLaboratorio3D — diagnóstico do ambiente\n");
line("plataforma", runtime.platform);
line("bun", runtime.bun);
line("repo", REPO);
line(
  "node_modules",
  existsSync(join(REPO, "node_modules"))
    ? "presente (CLI pode ser executada)"
    : "AUSENTE — rode `bun install` na raiz do repositório",
);

console.log("\nBinários\n");
line("openscad", `${ok(Boolean(runtime.openscad.path))} ${runtime.openscad.path ?? "-"}`);
if (runtime.openscad.version) line("  versão", runtime.openscad.version);
if (runtime.openscad.path) line("  manifold", runtime.openscad.manifold ? "sim" : "NÃO — compilação será lenta/recusada");
line("blender", `${ok(Boolean(runtime.blender.path))} ${runtime.blender.path ?? "-"}`);
if (runtime.blender.version) line("  versão", runtime.blender.version);

console.log("\nModelo de linguagem\n");
line("configurado", ok(runtime.llm.configured));
line("transporte", runtime.llm.provider);
line("base url", runtime.llm.baseUrl);
line("modelo", runtime.llm.model);

console.log("\nCapacidades\n");
const cap = runtime.capabilities;
line("importar 2D", ok(cap.import));
line("gerar briefing", ok(cap.brief));
line("gerar modelo 3D", ok(cap.generate));
line("recompilar params", ok(cap.recompileParams));
line("renderizar local", ok(cap.render));
line("crítica visual", ok(cap.visualCritique));

const notes = [...runtime.openscad.notes, ...runtime.blender.notes, ...runtime.llm.notes];
if (notes.length) {
  console.log("\nObservações\n");
  for (const note of notes) console.log(`  - ${note}`);
}

if (!cap.generate) {
  console.log("\nPara habilitar a geração, veja lab3d/docs/WINDOWS_SETUP.md\n");
} else {
  console.log("");
}
