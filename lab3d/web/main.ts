/**
 * Laboratorio3D front-end.
 *
 * Everything shown here comes from the server: the ficha is the imported one,
 * the progress is the real subprocess progress, and the mesh is the file the
 * pipeline wrote. No stage is simulated, and an unavailable capability is
 * reported as unavailable rather than hidden.
 */

import { createViewer, type ViewerHandle } from "./viewer.ts";

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

interface MeshArtifact { scadPath: string | null; stlPath: string | null; objPath: string | null; mtlPath: string | null }
interface ArtifactFile { path: string; bytes: number; kind: string }

interface RunSummary {
  id: string; title: string; status: string; mtime: number;
  hasFinalMesh: boolean; hasDraftMesh: boolean;
}

interface RunDetail {
  id: string; status: string; verdict: string | null; finalSummary: string | null;
  draft: MeshArtifact | null; final: MeshArtifact | null; painted: MeshArtifact | null;
  liveBuild: { path: string; mtime: number } | null;
  files: ArtifactFile[];
}

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
      item.addEventListener("click", () => void selectCharacter(c.key));
      return item;
    }),
  );
}

// ── character detail ────────────────────────────────────────────────────────

async function selectCharacter(key: string): Promise<void> {
  const data = await api<{ record: CharacterRecord; brief: Brief; runs: CharacterRun[] }>(
    `/api/lab/character?key=${encodeURIComponent(key)}`,
  );
  selected = data;
  closeStream();
  shownRunId = null;
  $("#empty").hidden = true;
  $("#character-panel").hidden = false;
  $("#progress-card").hidden = true;
  $("#result-card").hidden = true;

  $("#character-name").textContent = data.record.bundle.name;
  $("#character-key").textContent = data.record.shortKey;

  const front = data.record.bundle.references.find((r) => r.authoritative);
  const img = $<HTMLImageElement>("#ref-image");
  img.src = front ? `/api/lab/asset?key=${encodeURIComponent(key)}&file=${encodeURIComponent(front.file)}` : "";

  ensureViewer();
  viewer?.clear();
  $("#viewer-empty").hidden = false;
  $("#mesh-info").textContent = "";

  renderFacts(data.record, data.brief);
  renderBriefWarnings(data.record, data.brief);
  $("#brief-text").textContent = data.brief.text;
  renderRuns(data.runs);
  await refreshReadyRuns();
  await refreshCharacters();
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
  notes.push(
    el("div", { className: "note info" }, [
      el("strong", { textContent: "Referências" }),
      el("div", {
        textContent:
          `1 imagem entra na geração (frontal). ${stored.length} referência(s) adicional(is) está(ão) guardada(s) ` +
          "e rotulada(s), mas NÃO influencia(m) o pipeline: o gerador upstream recebe uma única imagem.",
      }),
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
      follow.addEventListener("click", () => followJob(run.jobId));
      return el("li", {}, [
        el("div", { className: "row" }, [
          el("strong", { textContent: run.purpose === "generate" ? "Geração" : "Recompilação" }),
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
  button.addEventListener("click", async () => {
    if (!selected) return;
    button.disabled = true;
    setStatus(status, "enfileirando execução…");
    try {
      const body = {
        key: selected.record.key,
        maxSteps: Number($<HTMLInputElement>("#max-steps").value),
        paint: $<HTMLInputElement>("#opt-paint").checked,
        contextRenders: $<HTMLInputElement>("#opt-context").checked,
      };
      const result = await api<{ job: JobRecord; run: CharacterRun }>("/api/lab/generate", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      setStatus(status, `Execução ${result.job.runId} enfileirada. Isto leva minutos.`, "ok");
      selected.runs.push(result.run);
      renderRuns(selected.runs);
      followJob(result.job.id);
    } catch (e) {
      setStatus(status, (e as Error).message, "error");
    } finally {
      button.disabled = false;
    }
  });

  $("#cancel-job").addEventListener("click", async () => {
    if (!activeJobId) return;
    await api(`/api/jobs/cancel?id=${encodeURIComponent(activeJobId)}`, { method: "POST" });
  });

  $("#open-ready").addEventListener("click", () => {
    const id = $<HTMLSelectElement>("#ready-run").value;
    if (id) void showRun(id);
  });
}

/** Every run already on disk, so a finished model can be opened without executing anything. */
async function refreshReadyRuns(): Promise<void> {
  const select = $<HTMLSelectElement>("#ready-run");
  let runs: RunSummary[] = [];
  try {
    ({ runs } = await api<{ runs: RunSummary[] }>("/api/runs"));
  } catch {
    /* the runs root may not exist yet */
  }
  const withMesh = runs.filter((r) => r.hasFinalMesh || r.hasDraftMesh);
  select.replaceChildren(
    ...(withMesh.length
      ? withMesh.map((run) =>
          el("option", { value: run.id, textContent: `${run.id} — ${run.title || run.status}`.slice(0, 80) }),
        )
      : [el("option", { value: "", textContent: "nenhum resultado com malha ainda" })]),
  );
  $<HTMLButtonElement>("#open-ready").disabled = !withMesh.length;
}

function closeStream(): void {
  activeStream?.close();
  activeStream = null;
  activeJobId = null;
}

function followJob(jobId: string): void {
  closeStream();
  activeJobId = jobId;
  $("#progress-card").hidden = false;
  const log = $("#job-log");
  log.textContent = "";
  const summary = $("#progress-summary");
  summary.replaceChildren(el("span", { className: "chip", textContent: "conectando…" }));

  const source = new EventSource(`/api/jobs/stream?id=${encodeURIComponent(jobId)}`);
  activeStream = source;
  let runId: string | null = null;

  source.addEventListener("message", (event) => {
    const ev = JSON.parse((event as MessageEvent<string>).data) as {
      type: string; job?: JobRecord; progress?: JobProgress; line?: string;
    };
    if (ev.type === "log" && ev.line !== undefined) {
      log.textContent += `${ev.line}\n`;
      log.scrollTop = log.scrollHeight;
    }
    if (ev.type === "progress" && ev.progress) renderProgress(ev.progress, null);
    if (ev.type === "status" && ev.job) {
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
    if (activeStream === source) {
      summary.append(el("span", { className: "chip", textContent: "conexão de progresso encerrada" }));
      closeStream();
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
  if (j) chips.push(el("span", { className: "chip phase", textContent: `status: ${j.status}` }));
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
  shownRunId = runId;
  const detail = await api<RunDetail>(`/api/run?id=${encodeURIComponent(runId)}`);
  $("#result-card").hidden = false;

  const verdict = $("#result-verdict");
  const meshPath =
    detail.painted?.objPath ?? detail.final?.objPath ?? detail.final?.stlPath ?? detail.draft?.objPath ?? detail.draft?.stlPath ?? null;

  verdict.replaceChildren(
    el("div", { className: "note info" }, [
      el("div", { textContent: `Execução ${detail.id} · status do scanner: ${detail.status}` }),
      el("div", {
        textContent: detail.verdict
          ? `Veredito do refino: ${detail.verdict}`
          : "O refino não registrou um veredito para esta execução.",
      }),
      el("div", {
        textContent:
          "Uma malha existente não significa aprovação visual. Compare com a referência ao lado antes de considerar o resultado utilizável.",
      }),
    ]),
  );

  ensureViewer();
  const info = $("#mesh-info");
  if (!meshPath) {
    viewer?.clear();
    $("#viewer-empty").hidden = false;
    info.textContent = "esta execução não produziu malha";
  } else {
    try {
      const result = await viewer!.load(`/api/file?path=${encodeURIComponent(meshPath)}`);
      $("#viewer-empty").hidden = true;
      info.textContent = `${result.triangles.toLocaleString()} triângulos · ${meshPath.split("/").pop()}`;
    } catch (e) {
      $("#viewer-empty").hidden = false;
      info.textContent = `falha ao carregar a malha: ${(e as Error).message}`;
    }
  }

  renderFiles(detail);
  await renderParams(runId);
}

function renderFiles(detail: RunDetail): void {
  const list = $("#file-list");
  const deliverables = detail.files.filter(
    (f) => f.kind === "mesh" || f.kind === "scad" || /final_summary|final_materials|\.mtl$/.test(f.path),
  );
  const shown = deliverables.length ? deliverables : detail.files.slice(0, 40);
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

async function renderParams(runId: string): Promise<void> {
  const host = $("#params");
  let data: { params: ScadParam[]; customizeAvailable: boolean };
  try {
    data = await api(`/api/params?id=${encodeURIComponent(runId)}&which=final`);
  } catch (e) {
    host.replaceChildren(el("div", { className: "note info", textContent: `Sem parâmetros: ${(e as Error).message}` }));
    return;
  }
  if (!data.params.length) {
    host.replaceChildren(
      el("div", {
        className: "note info",
        textContent:
          "Nenhum parâmetro de topo foi exposto por este arquivo SCAD. O customizador só reconhece variáveis simples no nível superior; expressões não viram controles.",
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
        ...(param.step !== undefined ? { step: String(param.step) } : {}),
      });
    }
    inputs.set(param.name, field);
    rows.push(el("div", { className: "param-row" }, [el("label", { textContent: param.name, title: param.name }), field]));
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
    button.disabled = true;
    status.className = "status info";
    status.textContent = "recompilando — isto executa o OpenSCAD e pode demorar…";
    try {
      const overrides: Record<string, number | boolean | string> = {};
      for (const param of data.params) {
        const field = inputs.get(param.name);
        if (!field) continue;
        if (param.type === "boolean") overrides[param.name] = (field as HTMLInputElement).checked;
        else if (param.type === "number" || param.type === "enum-number") overrides[param.name] = Number(field.value);
        else overrides[param.name] = field.value;
      }
      const result = await api<{ stl: string; durationMs: number; cached: boolean }>("/api/customize", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ id: runId, which: "final", overrides }),
      });
      status.className = "status ok";
      status.textContent = `recompilado em ${(result.durationMs / 1000).toFixed(1)} s${result.cached ? " (cache)" : ""}`;
      ensureViewer();
      const loaded = await viewer!.load(`/api/file?path=${encodeURIComponent(result.stl)}`);
      $("#viewer-empty").hidden = true;
      $("#mesh-info").textContent = `${loaded.triangles.toLocaleString()} triângulos · recompilado`;
    } catch (e) {
      status.className = "status error";
      status.textContent = (e as Error).message;
    } finally {
      button.disabled = false;
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

for (const button of document.querySelectorAll<HTMLButtonElement>(".views button[data-view]")) {
  button.addEventListener("click", () => {
    ensureViewer();
    viewer?.setView(button.dataset["view"] as "front" | "left" | "right" | "back" | "top");
  });
}

wireImport();
wireGenerate();
void loadRuntime();
void refreshCharacters();

// Keep an open result in sync after a recompile triggered elsewhere.
window.addEventListener("focus", () => {
  if (shownRunId && !activeStream) void showRun(shownRunId);
});
