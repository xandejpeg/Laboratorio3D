/** A valid self-contained, uncompressed GLB with one triangle; no private art. */
export function triangleGlb(overrides: Record<string, unknown> = {}): Uint8Array {
  const gltf = { asset: { version: "2.0" }, scene: 0, scenes: [{ nodes: [0] }], nodes: [{ mesh: 0 }],
    meshes: [{ primitives: [{ attributes: { POSITION: 0 } }] }],
    buffers: [{ byteLength: 36 }], bufferViews: [{ buffer: 0, byteOffset: 0, byteLength: 36 }],
    accessors: [{ bufferView: 0, componentType: 5126, count: 3, type: "VEC3", min: [0, 0, 0], max: [1, 1, 0] }],
    ...overrides };
  const json = new TextEncoder().encode(JSON.stringify(gltf));
  const padded = Math.ceil(json.length / 4) * 4;
  const bytes = new Uint8Array(12 + 8 + padded + 8 + 36);
  const view = new DataView(bytes.buffer);
  view.setUint32(0, 0x46546c67, true); view.setUint32(4, 2, true); view.setUint32(8, bytes.length, true);
  view.setUint32(12, padded, true); view.setUint32(16, 0x4e4f534a, true);
  bytes.fill(0x20, 20, 20 + padded); bytes.set(json, 20);
  view.setUint32(20 + padded, 36, true); view.setUint32(24 + padded, 0x004e4942, true);
  [0, 0, 0, 1, 0, 0, 0, 1, 0].forEach((value, index) => view.setFloat32(28 + padded + index * 4, value, true));
  return bytes;
}
