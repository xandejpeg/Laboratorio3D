/** GLB inspection before Three.js can request buffers or textures. */
export function validateEmbeddedGlb(buffer: ArrayBuffer): void {
  const view = new DataView(buffer);
  if (buffer.byteLength < 20 || view.getUint32(0, true) !== 0x46546c67 || view.getUint32(4, true) !== 2) {
    throw new Error("O arquivo não é um GLB versão 2 válido.");
  }
  if (view.getUint32(8, true) !== buffer.byteLength) throw new Error("O arquivo GLB está incompleto.");
  let document: unknown;
  let offset = 12;
  while (offset < buffer.byteLength) {
    if (offset + 8 > buffer.byteLength) throw new Error("O arquivo GLB contém um bloco incompleto.");
    const length = view.getUint32(offset, true);
    const kind = view.getUint32(offset + 4, true);
    if (length % 4 !== 0 || offset + 8 + length > buffer.byteLength) throw new Error("O arquivo GLB contém um bloco inválido.");
    if (offset === 12 && kind !== 0x4e4f534a) throw new Error("O arquivo GLB não começa com sua descrição JSON.");
    if (kind === 0x4e4f534a) {
      if (document !== undefined) throw new Error("O arquivo GLB contém descrições duplicadas.");
      document = JSON.parse(new TextDecoder().decode(new Uint8Array(buffer, offset + 8, length)));
    }
    offset += 8 + length;
  }
  if (!document || typeof document !== "object" || Array.isArray(document)) throw new Error("A descrição do GLB é inválida.");
  const queue: unknown[] = [document];
  while (queue.length) {
    const entry = queue.pop();
    if (!entry || typeof entry !== "object") continue;
    for (const [key, value] of Object.entries(entry)) {
      // GLB bufferViews and data URIs are self-contained. Reject relative paths,
      // network URLs and supplied blob URLs before any decoder is invoked.
      if (key === "uri" && (typeof value !== "string" || !value.startsWith("data:"))) {
        throw new Error("Este GLB depende de arquivos externos. Exporte um GLB com buffers e texturas incorporados.");
      }
      if (typeof value === "object" && value !== null) queue.push(value);
    }
  }
}
