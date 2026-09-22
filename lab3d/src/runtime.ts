/** Local executable/credential probes only. Never makes a provider request. */
import { MODEL_CATALOG } from "../../src/config/models.ts";
import { openscadCandidates, resolveBlenderPath, probeBinary, type RuntimeEnv } from "../../src/runtime/binaries.ts";

export interface BinaryProbe {
  name: string;
  path: string | null;
  version: string | null;
  manifold?: boolean;
  envVar: string;
  notes: string[];
}

export function probeOpenscad(env: RuntimeEnv = process.env): BinaryProbe {
  const notes: string[] = [];
  let fallback: { path: string; version: string } | undefined;
  for (const path of openscadCandidates(env)) {
    const version = probeBinary(path, ["--version"]);
    if (!version.ok || !version.output.includes("OpenSCAD")) continue;
    const firstLine = version.output.split(/\r?\n/)[0]!;
    fallback ??= { path, version: firstLine };
    if (probeBinary(path, ["--help"]).output.includes("--backend")) {
      if (env.OPENSCAD_PATH && env.OPENSCAD_PATH !== path) notes.push("OPENSCAD_PATH não funcionou com Manifold; outra instalação compatível foi encontrada.");
      return { name: "OpenSCAD", path, version: firstLine, manifold: true, envVar: "OPENSCAD_PATH", notes };
    }
  }
  if (fallback) {
    notes.push("A instalação encontrada não oferece Manifold. A geração é bloqueada sem PROCEDURA_ALLOW_CGAL_OPENSCAD=1; compilações CGAL podem ser muito mais lentas.");
    return { name: "OpenSCAD", ...fallback, manifold: false, envVar: "OPENSCAD_PATH", notes };
  }
  notes.push("OpenSCAD executável não encontrado; geração e recompilação de geometria estão indisponíveis.");
  return { name: "OpenSCAD", path: null, version: null, manifold: false, envVar: "OPENSCAD_PATH", notes };
}

export function probeBlender(env: RuntimeEnv = process.env): BinaryProbe {
  const path = resolveBlenderPath(env);
  const result = path ? probeBinary(path, ["--version"]) : null;
  if (!path || !result?.ok || !result.output.includes("Blender")) {
    return { name: "Blender", path: null, version: null, envVar: "PROCEDURA_BLENDER_PATH",
      notes: ["Blender executável não encontrado; renderização e avaliação visual estão indisponíveis."] };
  }
  const notes = env.PROCEDURA_RENDER_GPU === "0"
    ? ["Renderização configurada para CPU (PROCEDURA_RENDER_GPU=0)."] : [];
  return { name: "Blender", path, version: result.output.split(/\r?\n/)[0]!, envVar: "PROCEDURA_BLENDER_PATH", notes };
}

export interface LlmProbe {
  configured: boolean;
  provider: "openai" | "gemini";
  baseUrl: string;
  model: string;
  imageGeneration: boolean;
  notes: string[];
}

/** Never expose URL credentials, query tokens or fragments in diagnostics/API. */
function publicEndpoint(value: string): string {
  try {
    const url = new URL(value);
    return `${url.protocol}//${url.host}${url.pathname}`;
  } catch { return "endpoint inválido"; }
}

export function probeLlm(env: RuntimeEnv = process.env): LlmProbe {
  const model = env.PROCEDURA_MODEL ?? "gpt-5.2";
  const prefix = /^(openai|gemini):.+$/.exec(model)?.[1];
  const provider = (prefix ?? MODEL_CATALOG[model]?.ref.providerId ?? (env.PROCEDURA_PROVIDER === "gemini" ? "gemini" : "openai")) as "openai" | "gemini";
  const keyName = provider === "gemini" ? "GEMINI_API_KEY" : "OPENAI_API_KEY";
  const configured = Boolean(env[keyName]?.trim());
  const notes = configured
    ? ["Credencial presente para o transporte selecionado; acesso ao modelo, orçamento e geração ainda não foram validados."]
    : [`Credencial ${keyName} ausente para o modelo selecionado. Importação, briefing e visualização continuam disponíveis; geração requer configuração e orçamento autorizado.`];
  return {
    configured, provider, model,
    baseUrl: publicEndpoint(provider === "gemini"
      ? env.GEMINI_BASE_URL ?? "https://generativelanguage.googleapis.com/v1beta"
      : env.OPENAI_BASE_URL ?? "https://api.openai.com/v1"),
    imageGeneration: Boolean(env.PROCEDURA_IMAGE_MODEL), notes,
  };
}

export interface RuntimeReport {
  platform: string;
  bun: string;
  openscad: BinaryProbe;
  blender: BinaryProbe;
  llm: LlmProbe;
  capabilities: {
    import: boolean;
    brief: boolean;
    generate: boolean;
    recompileParams: boolean;
    render: boolean;
    visualCritique: boolean;
  };
}

export function probeRuntime(env: RuntimeEnv = process.env): RuntimeReport {
  const openscad = probeOpenscad(env);
  const blender = probeBlender(env);
  const llm = probeLlm(env);
  const canCompile = Boolean(openscad.path) && (Boolean(openscad.manifold) || env.PROCEDURA_ALLOW_CGAL_OPENSCAD === "1");
  return {
    platform: `${process.platform} ${process.arch}`, bun: Bun.version, openscad, blender, llm,
    capabilities: {
      import: true, brief: true,
      generate: canCompile && Boolean(blender.path) && llm.configured,
      recompileParams: canCompile,
      render: Boolean(blender.path),
      visualCritique: Boolean(blender.path) && llm.configured,
    },
  };
}
