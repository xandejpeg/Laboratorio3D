/** One user-initiated transfer per popup. This module never starts generation. */
export interface BridgePeer { postMessage(message: unknown, targetOrigin: string): void }
export interface BridgeEvent { source: unknown; origin: string; data: unknown }
export interface ImportReceipt { key: string; reused: boolean; url: string }

const ANGLES = new Set(["front", "profile-left", "profile-right", "back", "three-quarter", "detail"]);
const MIMES: Record<string, string> = { "image/png": "png", "image/jpeg": "jpg", "image/webp": "webp" };
const MiB = 1024 * 1024;

export function bridgeForm(sheet: unknown, images: unknown): FormData {
  if (!sheet || typeof sheet !== "object" || Array.isArray(sheet)) throw new Error("A ficha recebida é inválida.");
  const contract = sheet as Record<string, unknown>;
  if (contract.contract !== "lab3d.character-import" || contract.contractVersion !== 1) {
    throw new Error("O gerador deve enviar o contrato lab3d.character-import versão 1.");
  }
  const json = JSON.stringify(sheet);
  const sheetBlob = new Blob([json], { type: "application/json" });
  if (sheetBlob.size > 2 * MiB) throw new Error("A ficha excede 2 MiB.");
  if (!Array.isArray(images) || images.length < 1 || images.length > ANGLES.size) throw new Error("Envie a frente e até cinco referências rotuladas.");
  const form = new FormData();
  form.set("sheet", sheetBlob, "character.json");
  const seen = new Set<string>();
  let total = sheetBlob.size;
  for (const image of images) {
    if (!image || typeof image !== "object") throw new Error("Referência inválida.");
    const { angle, blob, note } = image;
    if (typeof angle !== "string" || !ANGLES.has(angle) || seen.has(angle)) throw new Error("Ângulo inválido ou repetido.");
    if (!(blob instanceof Blob) || !Object.hasOwn(MIMES, blob.type) || blob.size === 0 || blob.size > 24 * MiB) throw new Error("Cada referência deve ser PNG/JPEG/WebP válida, de até 24 MiB.");
    if (note !== undefined && (typeof note !== "string" || note.length > 2000)) throw new Error("Nota da referência inválida.");
    total += blob.size;
    // Leave room for multipart headers inside the server's 96 MiB body limit.
    if (total > 95 * MiB) throw new Error("O conjunto de referências excede o limite de envio.");
    seen.add(angle);
    form.set(angle, blob, `${angle}.${MIMES[blob.type]}`);
    if (note) form.set(`note:${angle}`, note);
  }
  if (!seen.has("front")) throw new Error("A imagem frontal é obrigatória.");
  return form;
}

export function createBridgeReceiver(options: {
  opener: BridgePeer | null;
  allowedOrigins: readonly string[];
  importForm: (form: FormData) => Promise<ImportReceipt>;
  onStatus: (message: string, kind: "info" | "ok" | "error") => void;
  now?: () => number;
}): (event: BridgeEvent) => Promise<void> {
  const opener = options.opener;
  const origins = new Set(options.allowedOrigins);
  const now = options.now ?? Date.now;
  let session: { id: string; origin: string; started: number; busy: boolean; reply?: unknown } | null = null;

  return async (event) => {
    if (!opener || event.source !== opener || !origins.has(event.origin)) return;
    const data = event.data;
    if (!data || typeof data !== "object") return;
    const message = data as Record<string, unknown>;
    if (message.version !== 1 || typeof message.requestId !== "string" || !/^[a-zA-Z0-9_-]{8,80}$/.test(message.requestId)) return;
    const id = message.requestId;
    if (message.type === "lab3d:hello") {
      if (!session) session = { id, origin: event.origin, started: now(), busy: false };
      if (session.id !== id || session.origin !== event.origin) return;
      opener.postMessage(session.reply ?? { type: "lab3d:ready", version: 1, requestId: id }, session.origin);
      return;
    }
    const current = session;
    if (message.type !== "lab3d:import" || !current || current.id !== id || current.origin !== event.origin) return;
    if (current.reply) { opener.postMessage(current.reply, current.origin); return; }
    if (current.busy) return;
    current.busy = true;
    try {
      if (now() - current.started > 120_000) throw new Error("O envio expirou. Clique novamente em Enviar ao Laboratorio3D no gerador.");
      const form = bridgeForm(message.sheet, message.images);
      options.onStatus("Recebendo a imagem e a ficha do gerador 2D…", "info");
      const receipt = await options.importForm(form);
      current.reply = { type: "lab3d:import-result", version: 1, requestId: id, ok: true, ...receipt };
      options.onStatus(receipt.reused ? "Personagem recebido do 2D. A combinação existente foi reaproveitada." : "Personagem recebido do 2D e salvo. Confira a referência antes de gerar.", "ok");
    } catch (error) {
      const text = error instanceof Error ? error.message : "Não foi possível receber o personagem.";
      current.reply = { type: "lab3d:import-result", version: 1, requestId: id, ok: false, error: text };
      options.onStatus(text, "error");
    } finally {
      current.busy = false;
    }
    opener.postMessage(current.reply, current.origin);
  };
}
