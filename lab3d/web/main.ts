/**
 * Laboratorio3D front-end.
 *
 * Everything shown here comes from the server: the ficha is the imported one,
 * the progress is the real subprocess progress, and the mesh is the file the
 * pipeline wrote. No stage is simulated, and an unavailable capability is
 * reported as unavailable rather than hidden.
 */

import { createViewer, type ViewerHandle } from "./viewer.ts";
import { createBridgeReceiver } from "./bridge.ts";
import { displayArtifact, linkedResults } from "./results.ts";
import type { RunDetail as StudioRunDetail, ViewImage } from "../../web/shared/types.ts";

// ── shapes returned by /api/lab/* and the reused Studio routes ──────────────

interface DescribedAttribute {
  category: string;
  id: string;
  label: string | null;
  visual: string | null;
  headsTall?: number;
  known: boolean;
  referenceOnly: boolean;
  hex?: string;
}

interface Brief {
  text: string;
  attributes: DescribedAttribute[];
  unknownIds: { category: string; id: string }[];
  referenceOnly: DescribedAttribute[];
  inferredRegions: { region: string; reason: string }[];
  headsTall: number | null;
  physicalHeightCm: number | null;
}

interface ReferenceImage {
  angle: string;
  file: string;
  influence: "pipeline" | "stored";
  authoritative: boolean;
  width: number | null;
  height: number | null;
  note?: string;
}

interface FactRow { key: string; label: string; value: string; id?: string; color?: string }
interface FactGroup { title: string; rows: FactRow[] }

interface CharacterRecord {
  key: string;
  shortKey: string;
  importedAt: string;
  bundle: {
    name: string;
    source: { generator: string; generatorVersion: string; adaptedFrom: string; viewRevision?: string };
    recipe: Record<string, unknown> & { family: string };
    characteristics: FactGroup[];
    physicalHeightCm: number | null;
    front: { width: number; height: number };
    references: ReferenceImage[];
    readyFor3D: boolean;
    missing: string[];
  };
}

interface CharacterRun {
  characterKey: string;
  jobId: string;
  runId: string;
  purpose: string;
  createdAt: string;
  referenceFile: string | null;
  options?: { mode?: string };
}

interface JobRecord {
  id: string;
  runId: string;
  status: "queued" | "running" | "canceled" | "failed" | "succeeded" | "interrupted";
  error?: string;
  createdAt: number;
  startedAt?: number;
  endedAt?: number;
}

interface JobProgress {
  hasImage: boolean; planned: number; built: number; building: string | null;
  draftReady: boolean; renderSteps: number; refineSteps: number; finalReady: boolean;
  painted: boolean; phase: string;
}

interface RunSummary {
  id: string; title: string; status: string; mtime: number;
  hasFinalMesh: boolean; hasDraftMesh: boolean;
  purpose?: string;
  completion?: { ok: boolean } | null;
}

interface RunEvidence {
  purpose: string;
  completion?: { ok: boolean } | null;
  quality: { approval: string; verdict: string | null; stage: "draft" | "authored-result"; finalSummary: string | null; omittedParts: string[]; floaterParts: string[]; errors: string[] };
  elapsedMs: number | null;
  usage: { inputTokens: number | null; outputTokens: number | null; costUsd: number | null };
  configuration: { backend?: string; capabilities?: { recompileParams?: boolean }; options?: { mode?: string }; [key: string]: unknown } | null;
  artifacts: { path: string; sha256: string; bytes: number }[];
}

type RunDetail = Pick<StudioRunDetail,
  "id" | "status" | "verdict" | "finalSummary" | "draft" | "final" | "painted" | "liveBuild" |
  "files" | "imagePath" | "previewViews" | "previewPainted" | "cycles" | "renderSteps" | "incremental"
>;

interface ScadParam {
  name: string; type: string; value: number | boolean | string;
  group?: string; min?: number; max?: number; step?: number; options?: (number | string)[];
}

interface RuntimeReport {
  platform: string; bun: string;
  openscad: { path: string | null; version: string | null; manifold?: boolean; notes: string[] };
  blender: { path: string | null; version: string | null; notes: string[] };
  llm: { configured: boolean; baseUrl: string; model: string; notes: string[] };
  capabilities: { import: boolean; brief: boolean; generate: boolean; recompileParams: boolean; visualCritique: boolean };
  generationEnabled: boolean;
  isaac?: { available: boolean; validation: string; note: string };
}

// ── tiny DOM helpers ────────────────────────────────────────────────────────

const $ = <T extends HTMLElement>(sel: string): T => {
  const el = document.querySelector<T>(sel);
  if (!el) throw new Error(`missing element ${sel}`);
  return el;
};

const el = <K extends keyof HTMLElementTagNameMap>(
  tag: K,
  props: Partial<HTMLElementTagNameMap[K]> = {},
  children: (Node | string)[] = [],
): HTMLElementTagNameMap[K] => {
  const node = Object.assign(document.createElement(tag), props);
  for (const child of children) node.append(child);
  return node;
};

async function api<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, init);
  const text = await response.text();
  let body: unknown = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    throw new Error(`resposta inválida do servidor (HTTP ${response.status})`);
  }
  if (!response.ok) {
    const payload = body as { error?: string; details?: string[] } | null;
    const details = payload?.details?.length ? `\n- ${payload.details.join("\n- ")}` : "";
    throw new Error(`${payload?.error ?? `HTTP ${response.status}`}${details}`);
  }
  return body as T;
}

const setStatus = (node: HTMLElement, message: string, kind: "ok" | "error" | "info" = "info"): void => {
  node.className = `status ${kind}`;
  node.textContent = message;
};

const bytes = (n: number): string =>
  n > 1024 * 1024 ? `${(n / 1024 / 1024).toFixed(1)} MB` : n > 1024 ? `${(n / 1024).toFixed(0)} kB` : `${n} B`;

const swatch = (color: string): HTMLElement => {
  const span = el("span", { className: "swatch" });
  span.style.background = color;
  return span;
};

// ── state ───────────────────────────────────────────────────────────────────

let runtime: RuntimeReport | null = null;
let selected: { record: CharacterRecord; brief: Brief; runs: CharacterRun[] } | null = null;
let viewer: ViewerHandle | null = null;
let activeStream: EventSource | null = null;
let activeJobId: string | null = null;
let shownRunId: string | null = null;
let selectionVersion = 0;
let runVersion = 0;
let readyVersion = 0;
let generationPending = false;
let independentMode = false;
let independentListVersion = 0;

function setIndependentMode(independent: boolean): void {
  independentMode = independent;
  for (const node of document.querySelectorAll<HTMLElement>(".character-only")) node.hidden = independent;
  $("#independent-note").hidden = !independent;
  $("#comparison").classList.toggle("independent", independent);
}

const statusLabel = (status: string): string => ({
  queued: "na fila", running: "em execução", canceled: "cancelada", failed: "falhou",
  succeeded: "processo concluído", interrupted: "interrompida", complete: "concluída",
  partial: "parcial", incomplete: "incompleta", empty: "sem artefatos",
}[status] ?? status);

const isLocalCompilation = (purpose?: string): boolean => purpose === "offline-compile" || purpose === "recompile";
const isBlenderAuthored = (purpose?: string, configuration?: RunEvidence["configuration"]): boolean =>
  purpose === "blender-authored" || configuration?.backend === "blender" || configuration?.options?.mode === "blender-authored-local";

function executionState(status: string, purpose?: string, completion?: { ok: boolean } | null): string {
  if (isBlenderAuthored(purpose)) return `Resultado Blender · ${completion?.ok === true ? "registrado" : completion?.ok === false ? "registro falhou" : "sem conclusão de registro"}`;
  if (!isLocalCompilation(purpose)) return statusLabel(status);
  const operation = purpose === "recompile" ? "Recompilação local" : "Compilação local";
  return `${operation} · ${completion?.ok === true ? "concluída" : completion?.ok === false ? "falhou" : "sem conclusão registrada"}`;
}

const fileUrl = (path: string): string => `/api/file?path=${encodeURIComponent(path)}`;

function updateCharacterAddress(key: string | null): void {
  const url = new URL(location.href);
  url.search = key ? `?character=${key}` : "";
  url.hash = "";
  history.replaceState(null, "", url);
}

function resetResult(message = "Nenhuma malha carregada para este personagem."): void {
  runVersion++;
  shownRunId = null;
  viewer?.clear();
  $("#viewer-empty").hidden = false;
  $("#viewer-empty").textContent = message;
  $("#mesh-info").textContent = "";
  $("#result-card").hidden = true;
  $("#result-verdict").replaceChildren();
  $("#result-evidence").replaceChildren();
  $("#file-list").replaceChildren();
  $("#render-list").replaceChildren();
  $("#params").replaceChildren();
  for (const button of document.querySelectorAll<HTMLButtonElement>("button[data-view], button[data-material]")) button.disabled = true;
}

function updateGenerationAvailability(): void {
  const available = !!selected && !!runtime?.capabilities.generate && !!runtime.generationEnabled;
  $<HTMLButtonElement>("#generate").disabled = generationPending || !available;
  $("#generation-availability").textContent = available
    ? "Geração usa o provedor configurado e pode gerar custos."
    : runtime?.capabilities.generate
      ? "Geração desativada neste ambiente. Configure a autorização de geração no servidor."
      : "Geração indisponível. Confira os requisitos e a configuração do provedor no estado do ambiente.";
  $("#physical-validation-note").textContent = !runtime?.isaac
    ? "Disponibilidade do Isaac Sim ainda não verificada. Exportar USD/URDF não comprova validação física."
    : runtime.isaac.available
      ? "Isaac Sim disponível; a validação física só poderá ser confirmada após a execução e seu relatório. Exportar USD/URDF não é validar física."
      : "Isaac Sim não está disponível neste ambiente: o pipeline pode executar e exportar USD/URDF, mas ficará sem validação física.";
}

// ── runtime banner ──────────────────────────────────────────────────────────

async function loadRuntime(): Promise<void> {
  const box = $("#runtime");
  try {
    runtime = await api<RuntimeReport>("/api/lab/runtime");
  } catch (e) {
    box.textContent = `ambiente indisponível: ${(e as Error).message}`;
    return;
  }
  const cap = runtime.capabilities;
  const mark = (ok: boolean, label: string) =>
    el("span", { className: ok ? "ok" : "no", textContent: `${ok ? "✓" : "✕"} ${label}` });
  box.replaceChildren(
    mark(cap.import, "importar"),
    document.createTextNode(" · "),
    mark(cap.generate && runtime.generationEnabled, "gerar"),
    document.createTextNode(" · "),
    mark(cap.recompileParams, "recompilar"),
    document.createTextNode(" · "),
    mark(cap.visualCritique, "crítica visual"),
  );
  const notes = [...runtime.openscad.notes, ...runtime.blender.notes, ...runtime.llm.notes];
  if (notes.length) box.append(el("div", { textContent: notes.join(" ") }));
  updateGenerationAvailability();
}

// ── import ──────────────────────────────────────────────────────────────────

function wireImport(): void {
  const form = $<HTMLFormElement>("#import-form");
  const status = $("#import-status");
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const button = form.querySelector("button[type=submit]") as HTMLButtonElement;
    button.disabled = true;
    setStatus(status, "importando…");
    try {
      const data = new FormData(form);
      // Empty file inputs must not be sent: the server treats every file field
      // as a labelled reference angle.
      const entries = [...data.entries()] as unknown as [string, string | File][];
      for (const [field, value] of entries) {
        if (typeof value !== "string" && value.size === 0) data.delete(field);
      }
      const result = await api<{ record: CharacterRecord; reused: boolean; brief: Brief; runs: CharacterRun[] }>(
        "/api/lab/import",
        { method: "POST", body: data },
      );
      setStatus(
        status,
        result.reused
          ? "Esta combinação já havia sido importada; o registro existente foi reaproveitado."
          : "Personagem importado e congelado.",
        "ok",
      );
      await refreshCharacters();
      await selectCharacter(result.record.key);
    } catch (e) {
      setStatus(status, (e as Error).message, "error");
    } finally {
      button.disabled = false;
    }
  });
}

// ── character list ──────────────────────────────────────────────────────────

interface CharacterSummary {
  key: string; shortKey: string; name: string; importedAt: string;
  family: string; outfit: string; runCount: number;
}

async function refreshCharacters(): Promise<void> {
  const list = $("#character-list");
  const { characters } = await api<{ characters: CharacterSummary[] }>("/api/lab/characters");
  if (!characters.length) {
    list.replaceChildren(el("li", { textContent: "nenhum personagem importado ainda" }));
    return;
  }
  list.replaceChildren(
    ...characters.map((c) => {
      const item = el("li", { className: `selectable${selected?.record.key === c.key ? " active" : ""}` }, [
        el("div", { className: "row" }, [
          el("strong", { textContent: c.name }),
          el("span", { className: "meta", textContent: `${c.runCount} execução(ões)` }),
        ]),
        el("div", {
          className: "meta",
          textContent: `${c.family} · ${c.outfit} · ${new Date(c.importedAt).toLocaleString()}`,
        }),
        el("div", { className: "meta" }, [el("code", { textContent: c.shortKey })]),
      ]);
      item.tabIndex = 0;
      item.setAttribute("role", "button");
      item.setAttribute("aria-label", `Selecionar ${c.name}`);
      item.setAttribute("aria-pressed", String(selected?.record.key === c.key));
      item.addEventListener("click", () => void selectCharacter(c.key));
      item.addEventListener("keydown", (event) => {
        if (event.key === "Enter" || event.key === " ") { event.preventDefault(); void selectCharacter(c.key); }
      });
      return item;
    }),
  );
}

// ── character detail ────────────────────────────────────────────────────────

async function selectCharacter(key: string): Promise<void> {
  const version = ++selectionVersion;
  setIndependentMode(false);
  selected = null;
  closeStream();
  resetResult();
  $<HTMLSelectElement>("#ready-run").replaceChildren(el("option", { value: "", textContent: "Carregando resultados deste personagem…" }));
  $<HTMLButtonElement>("#open-ready").disabled = true;
  updateGenerationAvailability();
  $("#character-panel").hidden = true;
  $("#empty").hidden = false;
  $("#empty").textContent = "Carregando a imagem e a ficha deste personagem…";
  let data: { record: CharacterRecord; brief: Brief; runs: CharacterRun[] };
  try {
    data = await api(`/api/lab/character?key=${encodeURIComponent(key)}`);
  } catch (e) {
    if (version === selectionVersion) $("#empty").textContent = `Não foi possível abrir o personagem: ${(e as Error).message}`;
    return;
  }
  if (version !== selectionVersion) return;
  selected = data;
  updateCharacterAddress(key);
  $("#empty").hidden = true;
  $("#character-panel").hidden = false;
  $("#progress-card").hidden = true;
  $("#result-card").hidden = true;
  $("#generate-status").textContent = "";

  $("#character-name").textContent = data.record.bundle.name;
  $("#character-key").textContent = data.record.shortKey;

  const front = data.record.bundle.references.find((r) => r.authoritative);
  const img = $<HTMLImageElement>("#ref-image");
  img.alt = `Referência frontal de ${data.record.bundle.name}`;
  img.src = front ? `/api/lab/asset?key=${encodeURIComponent(key)}&file=${encodeURIComponent(front.file)}` : "";

  renderFacts(data.record, data.brief);
  renderBriefWarnings(data.record, data.brief);
  $("#brief-text").textContent = data.brief.text;
  renderRuns(data.runs);
  updateGenerationAvailability();
  await refreshReadyRuns(true);
  if (version === selectionVersion) await refreshCharacters();
}

async function refreshIndependentRuns(): Promise<void> {
  const request = ++independentListVersion;
  const list = $("#independent-list");
  try {
    const { runs } = await api<{ runs: RunSummary[] }>("/api/lab/independent-runs");
    if (request !== independentListVersion) return;
    list.replaceChildren(...(runs.length ? runs.map((run) => {
      const title = run.title && run.title !== "(no prompt)" ? run.title : run.id;
      const item = el("li", { className: `selectable${independentMode && shownRunId === run.id ? " active" : ""}`, tabIndex: 0 }, [
        el("strong", { textContent: title }),
        el("div", { className: "meta", textContent: `${run.id} · ${executionState(run.status, run.purpose, run.completion)}` }),
      ]);
      item.setAttribute("role", "button");
      item.setAttribute("aria-label", `Abrir resultado independente ${title}`);
      item.addEventListener("click", () => void showIndependentRun(run.id));
      item.addEventListener("keydown", (event) => {
        if (event.key === "Enter" || event.key === " ") { event.preventDefault(); void showIndependentRun(run.id); }
      });
      return item;
    }) : [el("li", { textContent: "Nenhum resultado independente disponível." })]));
  } catch (e) {
    if (request === independentListVersion) list.replaceChildren(el("li", { textContent: `Não foi possível listar resultados: ${(e as Error).message}` }));
  }
}

async function showIndependentRun(runId: string): Promise<void> {
  ++selectionVersion;
  selected = null;
  updateCharacterAddress(null);
  closeStream();
  resetResult();
  setIndependentMode(true);
  const reference = $<HTMLImageElement>("#ref-image");
  reference.removeAttribute("src");
  reference.alt = "";
  $("#facts").replaceChildren();
  $("#brief-warnings").replaceChildren();
  $("#brief-text").textContent = "";
  $("#run-list").replaceChildren();
  $<HTMLSelectElement>("#ready-run").replaceChildren();
  $<HTMLButtonElement>("#open-ready").disabled = true;
  $("#generate-status").textContent = "";
  $("#progress-card").hidden = true;
  $("#empty").hidden = true;
  $("#character-panel").hidden = false;
  $("#character-name").textContent = "Resultado independente";
  $("#character-key").textContent = runId;
  updateGenerationAvailability();
  void refreshCharacters().catch(() => {});
  await showRun(runId);
  void refreshIndependentRuns();
}

function renderFacts(record: CharacterRecord, brief: Brief): void {
  const host = $("#facts");
  const groups: Node[] = [];

  if (record.bundle.characteristics.length) {
    for (const group of record.bundle.characteristics) {
      const table = el("table", { className: "facts" });
      for (const row of group.rows) {
        const value = el("td");
        if (row.color) value.append(swatch(row.color));
        value.append(document.createTextNode(row.value));
        if (row.id) value.append(document.createTextNode(" "), el("code", { textContent: row.id }));
        table.append(el("tr", {}, [el("td", { textContent: row.label }), value]));
      }
      groups.push(el("div", { className: "facts-group" }, [el("h4", { textContent: group.title }), table]));
    }
  } else {
    groups.push(
      el("div", { className: "note info", textContent: "Este export não trouxe a ficha legível; abaixo, a receita traduzida pelo laboratório." }),
    );
  }

  const table = el("table", { className: "facts" });
  for (const attr of brief.attributes) {
    const value = el("td");
    if (attr.hex) value.append(swatch(attr.hex));
    value.append(
      document.createTextNode(
        attr.known ? (attr.visual ?? `${attr.label} — aparência definida apenas pela arte`) : "ID desconhecido neste vocabulário",
      ),
    );
    value.append(document.createTextNode(" "), el("code", { textContent: attr.id }));
    table.append(el("tr", {}, [el("td", { textContent: attr.label ?? attr.category }), value]));
  }
  groups.push(el("div", { className: "facts-group" }, [el("h4", { textContent: "Tradução para o pipeline" }), table]));

  const meta = el("div", { className: "note info" }, [
    el("div", {
      textContent:
        `Origem: ${record.bundle.source.generator} ${record.bundle.source.generatorVersion} ` +
        `(adaptado de ${record.bundle.source.adaptedFrom}). Referência frontal declarada: ` +
        `${record.bundle.front.width}×${record.bundle.front.height}.`,
    }),
    el("div", {
      textContent:
        brief.physicalHeightCm !== null
          ? `Altura real declarada: ${brief.physicalHeightCm} cm.`
          : "Altura real não informada pelo gerador 2D — o laboratório não substitui por um palpite.",
    }),
    el("div", {
      textContent:
        brief.headsTall !== null
          ? `Proporção cabeça/corpo desta silhueta, segundo a direção de arte 2D: ~${brief.headsTall} cabeças.`
          : "Nenhuma proporção cabeça/corpo registrada para esta silhueta; será lida da imagem.",
    }),
  ]);
  groups.push(meta);

  host.replaceChildren(...groups);
}

function renderBriefWarnings(record: CharacterRecord, brief: Brief): void {
  const host = $("#brief-warnings");
  const notes: Node[] = [];

  const stored = record.bundle.references.filter((r) => !r.authoritative);
  const angleLabels: Record<string, string> = { front: "Frente", "profile-left": "Perfil esquerdo", "profile-right": "Perfil direito", back: "Costas" };
  notes.push(
    el("div", { className: "note info" }, [
      el("strong", { textContent: "Referências" }),
      el("div", {
        textContent:
          `1 imagem entra na geração (frontal). ${stored.length} referência(s) adicional(is) está(ão) guardada(s) ` +
          "e rotulada(s), mas NÃO influencia(m) o pipeline: o gerador upstream recebe uma única imagem.",
      }),
      el("ul", {}, record.bundle.references.map((reference) => el("li", {}, [
        el("a", {
          href: `/api/lab/asset?key=${encodeURIComponent(record.key)}&file=${encodeURIComponent(reference.file)}`,
          target: "_blank", rel: "noopener",
          textContent: angleLabels[reference.angle] ?? reference.angle,
        }),
        ` · ${reference.width ?? "?"}×${reference.height ?? "?"} · ${reference.influence === "pipeline" ? "usada pelo pipeline" : "guardada; sem influência na geração"}`,
      ]))),
    ]),
  );

  if (brief.unknownIds.length) {
    notes.push(
      el("div", { className: "note bad" }, [
        el("strong", { textContent: "IDs desconhecidos" }),
        el("div", { textContent: "Não estão no vocabulário do laboratório e não foram adivinhados; o pipeline terá de lê-los da imagem." }),
        el("ul", {}, brief.unknownIds.map((u) => el("li", { textContent: `${u.category}: ${u.id}` }))),
      ]),
    );
  }

  if (brief.referenceOnly.length) {
    notes.push(
      el("div", { className: "note warn" }, [
        el("strong", { textContent: "Atributos definidos apenas pela arte" }),
        el("div", { textContent: "Variações de identidade sem descrição escrita; dependem inteiramente da imagem de referência." }),
        el("ul", {}, brief.referenceOnly.map((a) => el("li", { textContent: `${a.label} (${a.id})` }))),
      ]),
    );
  }

  notes.push(
    el("div", { className: "note warn" }, [
      el("strong", { textContent: "Regiões inferidas (sem referência visual)" }),
      el("ul", {}, brief.inferredRegions.map((r) => el("li", { textContent: `${r.region} — ${r.reason}` }))),
    ]),
  );

  if (record.bundle.missing.length) {
    notes.push(
      el("div", { className: "note info" }, [
        el("strong", { textContent: "Pendências declaradas pelo gerador 2D" }),
        el("ul", {}, record.bundle.missing.map((m) => el("li", { textContent: m }))),
      ]),
    );
  }

  host.replaceChildren(...notes);
}

function renderRuns(runs: CharacterRun[]): void {
  const list = $("#run-list");
  if (!runs.length) {
    list.replaceChildren(el("li", { textContent: "nenhuma execução ainda" }));
    return;
  }
  list.replaceChildren(
    ...[...runs].reverse().map((run) => {
      const open = el("button", { textContent: "Abrir resultado", className: "ghost" });
      open.addEventListener("click", () => void showRun(run.runId));
      const follow = el("button", { textContent: "Acompanhar", className: "ghost" });
      follow.disabled = !run.jobId || run.purpose === "recompile" || isBlenderAuthored(run.purpose);
      follow.addEventListener("click", () => followJob(run.jobId));
      return el("li", {}, [
        el("div", { className: "row" }, [
          el("strong", { textContent: isBlenderAuthored(run.purpose) ? "Construção no Blender" : run.options?.mode === "codex-authored-local" ? "Modelo criado por Codex" : run.purpose === "generate" ? "Geração" : "Recompilação" }),
          el("span", { className: "meta", textContent: new Date(run.createdAt).toLocaleString() }),
        ]),
        el("div", { className: "meta" }, [el("code", { textContent: run.runId })]),
        el("div", { className: "views" }, [open, follow]),
      ]);
    }),
  );
}

// ── generation ──────────────────────────────────────────────────────────────

function wireGenerate(): void {
  const button = $<HTMLButtonElement>("#generate");
  const status = $("#generate-status");
  const preset = $<HTMLSelectElement>("#generation-preset");
  const steps = $<HTMLInputElement>("#max-steps");
  const paint = $<HTMLInputElement>("#opt-paint");
  const context = $<HTMLInputElement>("#opt-context");
  const updatePreset = () => {
    const best = preset.value === "best";
    steps.disabled = paint.disabled = context.disabled = best;
    steps.value = best ? "12" : "4";
    paint.checked = context.checked = best;
    $("#preset-description").textContent = best
      ? "Best usa a referência 2D existente, feedback 3D por peça, montagem, pintura, movimento e URDF; até 12 ciclos de refino, sem limite de peças no planejador. Timeout inicial e deadline LLM configurados em 30 minutos; streaming ativo e a execução total podem durar mais. Pode gerar mais custos; não garante aprovação visual ou física."
      : "Usa a referência 2D existente. Ajuste ciclos, pintura e renders de contexto abaixo; os demais limites do ambiente são preservados.";
  };
  preset.addEventListener("change", updatePreset);
  updatePreset();
  button.addEventListener("click", async () => {
    if (!selected) return;
    const character = selected;
    const version = selectionVersion;
    generationPending = true;
    updateGenerationAvailability();
    setStatus(status, "enfileirando execução…");
    try {
      const body = {
        key: character.record.key,
        preset: preset.value,
        maxSteps: Number($<HTMLInputElement>("#max-steps").value),
        paint: $<HTMLInputElement>("#opt-paint").checked,
        contextRenders: $<HTMLInputElement>("#opt-context").checked,
      };
      if (!Number.isInteger(body.maxSteps) || body.maxSteps < 0 || body.maxSteps > 20) throw new Error("Informe de 0 a 20 ciclos de refino.");
      const result = await api<{ job: JobRecord; run: CharacterRun }>("/api/lab/generate", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      if (version === selectionVersion && selected === character) {
        setStatus(status, `Execução ${result.job.runId} enfileirada. Isto leva minutos.`, "ok");
        character.runs.push(result.run);
        renderRuns(character.runs);
        followJob(result.job.id);
      }
      await refreshCharacters();
    } catch (e) {
      if (version === selectionVersion) setStatus(status, (e as Error).message, "error");
    } finally {
      generationPending = false;
      updateGenerationAvailability();
    }
  });

  $("#cancel-job").addEventListener("click", async () => {
    if (!activeJobId) return;
    const jobId = activeJobId;
    try {
      await api(`/api/jobs/cancel?id=${encodeURIComponent(jobId)}`, { method: "POST" });
    } catch (e) {
      if (activeJobId === jobId) setStatus($("#generate-status"), `Falha ao cancelar: ${(e as Error).message}`, "error");
    }
  });

  $("#open-ready").addEventListener("click", () => {
    const id = $<HTMLSelectElement>("#ready-run").value;
    if (id) void showRun(id);
  });
}

/** Only runs bound to the selected immutable import may share its reference. */
async function refreshReadyRuns(openLatest = false): Promise<void> {
  const request = ++readyVersion;
  const character = selected;
  const version = selectionVersion;
  if (!character) return;
  const select = $<HTMLSelectElement>("#ready-run");
  let runs: RunSummary[] = [];
  try {
    ({ runs } = await api<{ runs: RunSummary[] }>("/api/runs"));
  } catch {
    /* the runs root may not exist yet */
  }
  if (request !== readyVersion || version !== selectionVersion || selected !== character) return;
  const withMesh = linkedResults(runs, character.runs);
  const preferredId = shownRunId ?? select.value;
  select.replaceChildren(
    ...(withMesh.length
      ? withMesh.map((run) =>
          el("option", { value: run.id, textContent: `${run.id} — ${run.title || run.status}`.slice(0, 80) }),
        )
      : [el("option", { value: "", textContent: "este personagem ainda não tem malha" })]),
  );
  if (withMesh.some((run) => run.id === preferredId)) select.value = preferredId;
  $<HTMLButtonElement>("#open-ready").disabled = !withMesh.length;
  // Returning to an immutable character should restore its actual saved geometry.
  // Retain the selection/race guards above and never replace a manually opened run.
  if (openLatest && !shownRunId && withMesh.length) {
    const latest = withMesh.find((run) => run.hasFinalMesh) ?? withMesh[0]!;
    select.value = latest.id;
    await showRun(latest.id);
  }
}

function closeStream(): void {
  activeStream?.close();
  activeStream = null;
  activeJobId = null;
  lastProgress = null;
  lastJob = null;
}

function followJob(jobId: string): void {
  const character = selected;
  if (!character?.runs.some((run) => run.jobId === jobId)) return;
  const version = selectionVersion;
  closeStream();
  activeJobId = jobId;
  $("#progress-card").hidden = false;
  const log = $("#job-log");
  log.textContent = "";
  const summary = $("#progress-summary");
  summary.replaceChildren(el("span", { className: "chip", textContent: "conectando…" }));
  $<HTMLButtonElement>("#cancel-job").disabled = true;

  const source = new EventSource(`/api/jobs/stream?id=${encodeURIComponent(jobId)}`);
  activeStream = source;
  let runId: string | null = null;

  source.addEventListener("message", (event) => {
    if (activeStream !== source || version !== selectionVersion || selected !== character) return;
    let ev: {
      type: string; job?: JobRecord; progress?: JobProgress; line?: string;
    };
    try { ev = JSON.parse((event as MessageEvent<string>).data) as typeof ev; }
    catch { return; }
    if (ev.type === "log" && ev.line !== undefined) {
      log.textContent = `${log.textContent ?? ""}${ev.line}\n`.slice(-200_000);
      log.scrollTop = log.scrollHeight;
    }
    if (ev.type === "progress" && ev.progress) renderProgress(ev.progress, null);
    if (ev.type === "status" && ev.job) {
      if (!character.runs.some((run) => run.runId === ev.job!.runId && run.jobId === jobId)) return;
      runId = ev.job.runId;
      renderProgress(null, ev.job);
      if (ev.job.status !== "running" && ev.job.status !== "queued") {
        closeStream();
        void refreshReadyRuns();
        if (runId) void showRun(runId);
      }
    }
  });
  source.addEventListener("error", () => {
    // The stream closes itself once the job reaches a terminal state; only
    // report a failure while we still believe the job is live.
    if (activeStream === source && version === selectionVersion) {
      summary.append(el("span", { className: "chip", textContent: "conexão de progresso encerrada" }));
      closeStream();
      $<HTMLButtonElement>("#cancel-job").disabled = true;
      if (runId) void showRun(runId);
    }
  });
}

let lastProgress: JobProgress | null = null;
let lastJob: JobRecord | null = null;

function renderProgress(progress: JobProgress | null, job: JobRecord | null): void {
  if (progress) lastProgress = progress;
  if (job) lastJob = job;
  const p = lastProgress;
  const j = lastJob;
  const chips: HTMLElement[] = [];
  if (j) chips.push(el("span", { className: "chip phase", textContent: `Estado: ${statusLabel(j.status)}` }));
  if (p) {
    chips.push(el("span", { className: "chip phase", textContent: `fase: ${p.phase}` }));
    chips.push(el("span", { className: `chip${p.hasImage ? " on" : ""}`, textContent: "referência" }));
    chips.push(el("span", { className: "chip", textContent: `peças ${p.built}/${p.planned || "?"}` }));
    if (p.building) chips.push(el("span", { className: "chip", textContent: `construindo: ${p.building}` }));
    chips.push(el("span", { className: `chip${p.draftReady ? " on" : ""}`, textContent: "rascunho" }));
    chips.push(el("span", { className: "chip", textContent: `refino ${p.refineSteps}` }));
    chips.push(el("span", { className: `chip${p.finalReady ? " on" : ""}`, textContent: "final" }));
    if (p.painted) chips.push(el("span", { className: "chip on", textContent: "pintado" }));
  }
  if (j?.error) chips.push(el("span", { className: "chip", textContent: `erro: ${j.error}` }));
  $("#progress-summary").replaceChildren(...chips);
  $<HTMLButtonElement>("#cancel-job").disabled = !j || (j.status !== "running" && j.status !== "queued");
}

// ── results ─────────────────────────────────────────────────────────────────

function ensureViewer(): void {
  if (!viewer) viewer = createViewer($("#viewer"));
}

async function showRun(runId: string): Promise<void> {
  const character = selected;
  const selection = selectionVersion;
  const independent = independentMode;
  if (!character && !independent) return;
  resetResult(independent ? "Conferindo a origem deste resultado independente…" : "Conferindo o vínculo da execução com este personagem…");
  const version = runVersion;
  const isCurrent = () => version === runVersion && selection === selectionVersion && selected === character && independentMode === independent;
  shownRunId = runId;
  try {
    const binding = await api<{ record: CharacterRecord | null; run: CharacterRun | null }>(
      `/api/lab/run-character?runId=${encodeURIComponent(runId)}`,
    );
    if (!isCurrent()) return;
    if (independent ? binding.record !== null || binding.run !== null : !character || binding.record?.key !== character.record.key || binding.run?.characterKey !== character.record.key || binding.run?.runId !== runId) {
      if (independent) throw new Error("Esta execução pertence a um personagem. Abra-a pelo histórico desse personagem.");
      throw new Error("Esta execução não pertence ao personagem selecionado. A comparação foi bloqueada.");
    }
    const [detail, evidence] = await Promise.all([
      api<RunDetail>(`/api/run?id=${encodeURIComponent(runId)}`),
      api<RunEvidence>(`/api/lab/evidence?runId=${encodeURIComponent(runId)}`).catch(() => null),
    ]);
    if (!isCurrent()) return;
    const purpose = evidence?.purpose ?? binding.run?.purpose;
    const localCompilation = isLocalCompilation(purpose);
    const blenderAuthored = isBlenderAuthored(purpose, evidence?.configuration) || binding.run?.options?.mode === "blender-authored-local";
    const codexAuthored = binding.run?.options?.["mode"] === "codex-authored-local";
    $("#result-card").hidden = false;
    if (independent) $("#character-key").textContent = detail.id;

    const verdict = $("#result-verdict");
    const artifact = displayArtifact(detail, blenderAuthored);
    const meshPath = artifact?.glbPath ?? artifact?.objPath ?? artifact?.stlPath ?? null;
    const stage = blenderAuthored ? "Modelo Blender" : localCompilation ? "Geometria compilada" : artifact === detail.painted ? "Pintura" : artifact === detail.final ? "Final" : "Rascunho";

    verdict.replaceChildren(
    el("div", { className: "note info" }, [
      el("strong", { textContent: character ? `${character.record.bundle.name} · ${character.record.shortKey}` : "Resultado independente, sem personagem 2D associado" }),
      el("div", { textContent: `Execução ${detail.id} · ${executionState(detail.status, purpose, evidence?.completion)}` }),
      el("div", { textContent: meshPath ? `${stage} · arquivo exibido: ${meshPath}` : "Esta execução ainda não produziu uma malha." }),
      el("div", {
        textContent: blenderAuthored ? "Modelo construído no Blender e exportado como GLB. Este resultado tem fonte Blender própria; não é uma recompilação paramétrica do SCAD anterior. Consulte a configuração registrada." : codexAuthored ? "Modelo construído por Codex nesta conversa, compilado no OpenSCAD e renderizado no Blender. O gerador automático por API não foi executado." : localCompilation ? "Sem avaliação por modelo. Esta execução compilou o SCAD localmente, sem executar planejamento ou refino por IA." : detail.verdict
          ? `Veredito do refino: ${detail.verdict}`
          : "O refino não registrou um veredito para esta execução.",
      }),
      el("div", {
        textContent:
          independent ? "Uma malha existente não significa aprovação visual. Consulte a origem, as configurações e os arquivos deste ensaio." : "Uma malha existente não significa aprovação visual. Compare com a referência ao lado antes de considerar o resultado utilizável.",
      }),
    ]),
    );
    if (detail.finalSummary) verdict.append(el("details", {}, [
      el("summary", { textContent: "Resumo registrado pelo pipeline" }),
      el("pre", { className: "pre", textContent: detail.finalSummary }),
    ]));
    renderFiles(detail);
    renderEvidence(evidence, isCurrent);
    if (blenderAuthored || evidence?.configuration?.capabilities?.recompileParams === false) {
      $("#params").replaceChildren(el("div", { className: "note info", textContent: "Este resultado foi construído no Blender. Alterações de forma devem usar sua fonte Blender; os parâmetros SCAD não recompilam este modelo. O resultado Procedura anterior continua no histórico." }));
    } else {
      void renderParams(runId, isCurrent, artifact === detail.draft ? "draft" : "final");
    }

    const info = $("#mesh-info");
    if (!meshPath) {
      $("#viewer-empty").textContent = "Esta execução não produziu malha.";
    } else {
      ensureViewer();
      $("#viewer-empty").textContent = "Carregando o arquivo de geometria…";
      const result = await viewer!.load(fileUrl(meshPath), artifact?.mtlPath ? fileUrl(artifact.mtlPath) : null);
      if (!isCurrent()) return;
      $("#viewer-empty").hidden = true;
      info.textContent = `${result.triangles.toLocaleString("pt-BR")} triângulos · ${stage.toLowerCase()}${result.materials ? ` · ${result.materials} materiais` : " · material neutro"}`;
      for (const button of document.querySelectorAll<HTMLButtonElement>("button[data-view], button[data-material]")) button.disabled = false;
    }
  } catch (e) {
    if (!isCurrent()) return;
    viewer?.clear();
    $("#viewer-empty").hidden = false;
    $("#viewer-empty").textContent = (e as Error).message;
    setStatus($("#generate-status"), `Não foi possível abrir o resultado: ${(e as Error).message}`, "error");
  }
}

function renderEvidence(data: RunEvidence | null, isCurrent: () => boolean): void {
  const host = $("#result-evidence");
  try {
    if (!isCurrent()) return;
    if (!data) throw new Error("O servidor não retornou as evidências desta execução.");
    const quality = data.quality;
    const localCompilation = isLocalCompilation(data.purpose);
    const blenderAuthored = isBlenderAuthored(data.purpose, data.configuration);
    const codexAuthored = data.configuration?.["options"]?.["mode"] === "codex-authored-local";
    const purpose = blenderAuthored ? "Construção local no Blender, com fonte e artefatos próprios" : codexAuthored ? "Reconstrução escrita por Codex nesta conversa; OpenSCAD e Blender locais, sem API externa" : ({ generate: "Geração pelo pipeline Procedura", recompile: "Recompilação local de parâmetros, sem IA", "offline-compile": "Ensaio local: SCAD manual compilado, sem geração por IA", unlinked: "Origem não documentada" } as Record<string, string>)[data.purpose] ?? data.purpose;
    host.replaceChildren(el("div", { className: "note warn" }, [
      el("strong", { textContent: blenderAuthored || codexAuthored ? "Modelo local · validação visual do usuário pendente" : localCompilation ? "Sem avaliação por modelo · revisão humana pendente" : "Aprovação visual: revisão humana pendente" }),
      el("div", { textContent: `Processo: ${purpose}.` }),
      el("div", { textContent: `Tempo registrado: ${data.elapsedMs === null ? "não disponível" : `${(data.elapsedMs / 1000).toFixed(1)} s`}. Tokens: entrada ${data.usage.inputTokens ?? "não disponível"}, saída ${data.usage.outputTokens ?? "não disponível"}. Custo: ${data.usage.costUsd === null ? "não informado pelo provedor" : `US$ ${data.usage.costUsd}`}.` }),
      ...(!localCompilation && !blenderAuthored ? [
        el("div", { textContent: `No rascunho — peças omitidas: ${quality.omittedParts.join(", ") || "nenhuma registrada"}; peças soltas: ${quality.floaterParts.join(", ") || "nenhuma registrada"}.` }),
        el("div", { textContent: "Esses registros são da montagem inicial. O refino pode alterar as peças e a conectividade; eles não validam a malha final." }),
      ] : []),
      ...(quality.errors.length ? [el("ul", {}, quality.errors.map((error) => el("li", { textContent: error })))] : []),
    ]), ...(quality.finalSummary ? [el("details", {}, [
      el("summary", { textContent: "Evidência final registrada pelo pipeline" }),
      el("pre", { className: "pre", textContent: quality.finalSummary }),
    ])] : localCompilation || blenderAuthored ? [] : [el("div", { className: "note info", textContent: "Nenhum resumo final registrado. A conectividade final não foi confirmada por estas evidências." })]), el("details", {}, [
      el("summary", { textContent: "Configuração e hashes dos artefatos" }),
      el("pre", { className: "pre", textContent: JSON.stringify({ configuration: data.configuration, completion: data.completion, artifacts: data.artifacts }, null, 2) }),
    ]));
  } catch (e) {
    if (isCurrent()) host.replaceChildren(el("div", { className: "note info", textContent: `Registro de evidências indisponível: ${(e as Error).message}` }));
  }
}

function renderFiles(detail: RunDetail): void {
  const list = $("#file-list");
  const shown = detail.files;
  // The scanner lists top-level files separately from images inside render
  // directories. Only its explicit render collections belong in this gallery;
  // image.png / image_input.png are input references, never generated renders.
  const renders = new Map<string, { path: string; label: string }>();
  const viewLabels: Record<string, string> = { front: "Frente", back: "Costas", left: "Esquerda", right: "Direita", top: "Topo", isometric: "Isométrica" };
  const referencePath = detail.imagePath?.replace(/\\/g, "/");
  const addViews = (views: ViewImage[] | undefined, stage: string) => {
    for (const view of views ?? []) {
      const path = view.path.replace(/\\/g, "/");
      if (path === referencePath || !/\.(png|jpe?g|webp)$/i.test(path) || /(?:^|\/)image(?:_input)?\.[^/]+$/i.test(path)) continue;
      if (!renders.has(path)) renders.set(path, { path, label: `${stage} · ${viewLabels[view.view] ?? view.view}` });
    }
  };
  addViews(detail.previewViews, "Prévia final");
  addViews(detail.previewPainted, "Pintura");
  for (const cycle of detail.cycles ?? []) addViews(cycle.views, `Ciclo ${cycle.cycle} · antes da correção`);
  for (const step of detail.renderSteps ?? []) {
    addViews(step.ao, `Render ${step.step} · oclusão ambiente`);
    addViews(step.partsColor, `Render ${step.step} · cores por peça`);
  }
  for (const part of detail.incremental?.parts ?? []) addViews(part.contextViews, `Montagem · ${part.name}`);
  $("#render-list").replaceChildren(...[...renders.values()].map((render) => el("div", {}, [
    el("a", { href: fileUrl(render.path), target: "_blank", rel: "noopener", title: render.path }, [
      el("img", { src: fileUrl(render.path), alt: render.label, loading: "lazy" }),
      el("span", { textContent: render.label }),
    ]),
    el("a", { href: `${fileUrl(render.path)}&download`, textContent: "Baixar imagem", title: render.path }),
  ])));
  if (!shown.length) {
    list.replaceChildren(el("li", { textContent: "nenhum arquivo produzido" }));
    return;
  }
  list.replaceChildren(
    ...shown.map((file) =>
      el("li", {}, [
        el("div", { className: "row" }, [
          el("a", {
            href: `/api/file?path=${encodeURIComponent(file.path)}&download`,
            textContent: file.path,
          }),
          el("span", { className: "meta", textContent: bytes(file.bytes) }),
        ]),
      ]),
    ),
  );
}

async function renderParams(runId: string, isCurrent: () => boolean, which: "draft" | "final"): Promise<void> {
  const host = $("#params");
  let data: { params: ScadParam[]; customizeAvailable: boolean; reason?: string };
  try {
    data = await api(`/api/params?id=${encodeURIComponent(runId)}&which=${which}`);
  } catch (e) {
    if (!isCurrent()) return;
    host.replaceChildren(el("div", { className: "note info", textContent: `Sem parâmetros: ${(e as Error).message}` }));
    return;
  }
  if (!isCurrent()) return;
  if (!data.params.length) {
    host.replaceChildren(
      el("div", {
        className: "note info",
        textContent: data.reason ?? "Nenhum parâmetro de topo foi exposto por este arquivo SCAD. O customizador só reconhece variáveis simples no nível superior; expressões não viram controles.",
      }),
    );
    return;
  }

  const inputs = new Map<string, HTMLInputElement | HTMLSelectElement>();
  const rows: Node[] = [];
  for (const param of data.params.slice(0, 120)) {
    let field: HTMLInputElement | HTMLSelectElement;
    if (param.type === "boolean") {
      field = el("input", { type: "checkbox", checked: Boolean(param.value) });
    } else if (param.options?.length) {
      const select = el("select");
      for (const option of param.options) {
        select.append(el("option", { value: String(option), textContent: String(option), selected: option === param.value }));
      }
      field = select;
    } else {
      field = el("input", {
        type: param.type === "number" ? "number" : "text",
        value: String(param.value),
        ...(param.min !== undefined ? { min: String(param.min) } : {}),
        ...(param.max !== undefined ? { max: String(param.max) } : {}),
        ...(param.type === "number" ? { step: param.step === undefined ? "any" : String(param.step) } : {}),
      });
    }
    inputs.set(param.name, field);
    field.id = `param-${inputs.size}`;
    rows.push(el("div", { className: "param-row" }, [el("label", { textContent: param.name, title: param.name, htmlFor: field.id }), field]));
  }

  const status = el("div", { className: "status info" });
  const button = el("button", {
    className: "primary",
    textContent: "Recompilar geometria",
    disabled: !data.customizeAvailable,
  });
  if (!data.customizeAvailable) {
    status.textContent = "OpenSCAD não encontrado: recompilação indisponível.";
  }
  button.addEventListener("click", async () => {
    if (!isCurrent() || (!selected && !independentMode)) return;
    const character = selected;
    button.disabled = true;
    status.className = "status info";
    status.textContent = "recompilando — isto executa o OpenSCAD e pode demorar…";
    try {
      const overrides: Record<string, number | boolean | string> = {};
      for (const param of data.params) {
        const field = inputs.get(param.name);
        if (!field) continue;
        if (!field.checkValidity()) { field.reportValidity(); throw new Error(`Confira o valor de ${param.name}.`); }
        if (param.type === "boolean") overrides[param.name] = (field as HTMLInputElement).checked;
        else if (param.type === "number" || param.type === "enum-number") overrides[param.name] = Number(field.value);
        else overrides[param.name] = field.value;
      }
      const result = await api<{ stl: string; durationMs: number; cached: boolean; run: CharacterRun | null; runId: string }>("/api/customize", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ id: runId, ...(character ? { key: character.record.key } : {}), which, overrides }),
      });
      if (character ? result.run?.characterKey !== character.record.key : result.run !== null) throw new Error("A recompilação retornou um vínculo de personagem inválido.");
      const outputRunId = result.run?.runId ?? result.runId;
      if (!outputRunId) throw new Error("A recompilação não informou o identificador do novo resultado.");
      // Save the new history entry even when the user opened another run while
      // OpenSCAD was working. Only the originally active view may be replaced.
      if (character && result.run && selected === character) {
        if (!character.runs.some((run) => run.runId === outputRunId)) character.runs.push(result.run);
        renderRuns(character.runs);
        void refreshReadyRuns();
      }
      if (!character) void refreshIndependentRuns();
      void refreshCharacters().catch(() => {});
      if (!isCurrent()) return;
      status.className = "status ok";
      status.textContent = `recompilado em ${(result.durationMs / 1000).toFixed(1)} s${result.cached ? " (cache)" : ""}`;
      setStatus($("#generate-status"), `Geometria recompilada em ${(result.durationMs / 1000).toFixed(1)} s. Novo resultado: ${outputRunId}.`, "ok");
      await showRun(outputRunId);
      if (character) await refreshReadyRuns();
      else await refreshIndependentRuns();
      await refreshCharacters();
    } catch (e) {
      if (!isCurrent()) return;
      status.className = "status error";
      status.textContent = (e as Error).message;
    } finally {
      button.disabled = !data.customizeAvailable || !isCurrent();
    }
  });

  const groups = el("div", { className: "params-group" }, rows);
  host.replaceChildren(
    el("div", {
      className: "note info",
      textContent:
        "Estes são os parâmetros que o Procedura realmente expõe deste SCAD. Alterá-los recompila a geometria com OpenSCAD; não chama o modelo de linguagem e não é instantâneo.",
    }),
    groups,
    button,
    status,
  );
}

// ── boot ────────────────────────────────────────────────────────────────────

async function wire2DBridge(): Promise<void> {
  if (window.top !== window || new URLSearchParams(location.search).get("bridge") !== "2dc") return;
  const status = $("#bridge-status");
  status.hidden = false;
  if (!window.opener) {
    setStatus(status, "Abra esta ligação pelo botão Enviar ao Laboratorio3D no gerador 2D.", "info");
    return;
  }
  setStatus(status, "Aguardando o personagem enviado pelo gerador 2D…");
  const opener = window.opener as Window;
  try {
    const config = await api<{ version: number; allowedOrigins: string[] }>("/api/lab/bridge-config");
    const receive = createBridgeReceiver({ opener, allowedOrigins: config.allowedOrigins,
      onStatus: (message, kind) => setStatus(status, message, kind),
      importForm: async (form) => {
        const result = await api<{ record: CharacterRecord; reused: boolean }>("/api/lab/import", { method: "POST", body: form });
        await refreshCharacters();
        await selectCharacter(result.record.key);
        const url = new URL(location.href);
        url.search = `?character=${result.record.key}`;
        url.hash = "";
        if (selected?.record.key === result.record.key) $("#character-panel").scrollIntoView({ behavior: "smooth", block: "start" });
        return { key: result.record.key, reused: result.reused, url: url.href };
      },
    });
    window.addEventListener("message", (event) => { void receive(event); });
  } catch (error) { setStatus(status, `Ligação com o 2D indisponível: ${(error as Error).message}`, "error"); }
}

for (const button of document.querySelectorAll<HTMLButtonElement>(".views button[data-view]")) {
  button.addEventListener("click", () => {
    ensureViewer();
    viewer?.setView(button.dataset["view"] as "front" | "left" | "right" | "back" | "top");
  });
}

for (const button of document.querySelectorAll<HTMLButtonElement>("button[data-material]")) {
  button.addEventListener("click", () => {
    const mode = button.dataset["material"];
    if (!viewer || (mode !== "colors" && mode !== "gray")) return;
    viewer.setMaterialMode(mode);
    for (const choice of document.querySelectorAll<HTMLButtonElement>("button[data-material]")) {
      choice.setAttribute("aria-pressed", String(choice === button));
    }
  });
}

wireImport();
wireGenerate();
$("#refresh-independent").addEventListener("click", () => void refreshIndependentRuns());
resetResult();
updateGenerationAvailability();
void loadRuntime();
void wire2DBridge();
void refreshIndependentRuns();
void refreshCharacters().then(async () => {
  const key = new URLSearchParams(location.search).get("character");
  // A slow boot request must not replace a user's newer selection or an import
  // already started through the 2D bridge (both advance selectionVersion).
  if (key && /^[a-f0-9]{64}$/.test(key) && selectionVersion === 0) await selectCharacter(key);
}).catch((error: Error) => {
  $("#character-list").replaceChildren(el("li", { textContent: `Não foi possível listar personagens: ${error.message}` }));
});
