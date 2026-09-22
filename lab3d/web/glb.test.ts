import { describe, expect, test } from "bun:test";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { BoxGeometry, Group, Mesh, MeshStandardMaterial, Texture } from "three";
import { validateEmbeddedGlb } from "./glb.ts";
import { createMaterialInspection } from "./viewer.ts";

function glb(document: unknown, binary?: Uint8Array): ArrayBuffer {
  const source = new TextEncoder().encode(JSON.stringify(document));
  const jsonLength = Math.ceil(source.byteLength / 4) * 4;
  const binaryLength = binary ? Math.ceil(binary.byteLength / 4) * 4 : 0;
  const result = new ArrayBuffer(20 + jsonLength + (binary ? 8 + binaryLength : 0));
  const view = new DataView(result);
  view.setUint32(0, 0x46546c67, true);
  view.setUint32(4, 2, true);
  view.setUint32(8, result.byteLength, true);
  view.setUint32(12, jsonLength, true);
  view.setUint32(16, 0x4e4f534a, true);
  new Uint8Array(result, 20, jsonLength).fill(32);
  new Uint8Array(result, 20, source.byteLength).set(source);
  if (binary) {
    view.setUint32(20 + jsonLength, binaryLength, true);
    view.setUint32(24 + jsonLength, 0x004e4942, true);
    new Uint8Array(result, 28 + jsonLength, binary.byteLength).set(binary);
  }
  return result;
}

describe("embedded GLB viewer input", () => {
  test("rejects external buffers and images before the loader can request them", () => {
    for (const uri of ["https://example.invalid/image.png", "../image.png", "file:///image.png", "blob:untrusted", "//example.invalid/a.bin"]) {
      expect(() => validateEmbeddedGlb(glb({ asset: { version: "2.0" }, images: [{ uri }] }))).toThrow("arquivos externos");
      expect(() => validateEmbeddedGlb(glb({ asset: { version: "2.0" }, buffers: [{ uri, byteLength: 4 }] }))).toThrow("arquivos externos");
    }
  });

  test("accepts embedded image bufferViews and data URIs", () => {
    expect(() => validateEmbeddedGlb(glb({ asset: { version: "2.0" }, images: [{ bufferView: 0, mimeType: "image/png" }] }))).not.toThrow();
    expect(() => validateEmbeddedGlb(glb({ asset: { version: "2.0" }, buffers: [{ uri: "data:application/octet-stream;base64,AAAAAA==", byteLength: 4 }] }))).not.toThrow();
  });

  test("rejects truncated or non-GLB input", () => {
    expect(() => validateEmbeddedGlb(new ArrayBuffer(8))).toThrow("GLB");
    const buffer = glb({ asset: { version: "2.0" } });
    expect(() => validateEmbeddedGlb(buffer.slice(0, -4))).toThrow("incompleto");
    new DataView(buffer).setUint32(12, 0xfffffffc, true);
    expect(() => validateEmbeddedGlb(buffer)).toThrow("bloco inválido");
  });

  test("Three r169 preserves UVs, PBR values and Y-up geometry from GLB", async () => {
    const values = new Float32Array([0, 0, 0, 2, 0, 0, 0, 4, 0, 0, 0, 1, 0, 0, 1]);
    const buffer = glb({
      asset: { version: "2.0" }, scene: 0, scenes: [{ nodes: [0] }], nodes: [{ mesh: 0, translation: [1, 2, 3] }],
      buffers: [{ byteLength: values.byteLength }],
      bufferViews: [{ buffer: 0, byteOffset: 0, byteLength: 36 }, { buffer: 0, byteOffset: 36, byteLength: 24 }],
      accessors: [{ bufferView: 0, componentType: 5126, count: 3, type: "VEC3", min: [0, 0, 0], max: [2, 4, 0] }, { bufferView: 1, componentType: 5126, count: 3, type: "VEC2" }],
      materials: [{ pbrMetallicRoughness: { baseColorFactor: [0.4, 0.5, 0.6, 1], metallicFactor: 0.15, roughnessFactor: 0.8 } }],
      meshes: [{ primitives: [{ attributes: { POSITION: 0, TEXCOORD_0: 1 }, material: 0 }] }],
    }, new Uint8Array(values.buffer));
    validateEmbeddedGlb(buffer);
    const result = await new GLTFLoader().parseAsync(buffer, "");
    const mesh = result.scene.children[0] as Mesh;
    const material = mesh.material as MeshStandardMaterial;
    expect(mesh.position.toArray()).toEqual([1, 2, 3]);
    expect(mesh.geometry.getAttribute("position").getY(2)).toBe(4);
    expect(mesh.geometry.getAttribute("position").getZ(2)).toBe(0);
    expect(mesh.geometry.getAttribute("uv").count).toBe(3);
    expect(material.metalness).toBe(0.15);
    expect(material.roughness).toBe(0.8);
    expect(material.color.toArray()).toEqual([0.4, 0.5, 0.6]);
    mesh.geometry.dispose(); material.dispose();
  });
});

test("gray inspection restores original texture materials and persists across model changes", () => {
  const texture = new Texture();
  const first = new MeshStandardMaterial({ map: texture, roughness: 0.35, metalness: 0.2 });
  const second = new MeshStandardMaterial({ color: 0xff0000 });
  const original = [first, second];
  const geometry = new BoxGeometry();
  const mesh: Mesh = new Mesh(geometry, original);
  mesh.position.set(1, 2, 3);
  const root = new Group().add(mesh);
  const inspection = createMaterialInspection();
  let disposed = 0;
  first.addEventListener("dispose", () => disposed++);
  texture.addEventListener("dispose", () => disposed++);
  inspection.attach(root);
  inspection.setMode("gray");
  const gray = mesh.material;
  expect(gray).not.toBe(original);
  expect((gray as MeshStandardMaterial).map).toBeNull();
  expect(mesh.geometry).toBe(geometry);
  expect(mesh.position.toArray()).toEqual([1, 2, 3]);
  inspection.setMode("colors");
  expect(mesh.material).toBe(original);
  expect(first.map).toBe(texture);
  expect(first.roughness).toBe(0.35);
  inspection.setMode("gray");
  inspection.clear();
  expect(mesh.material).toBe(original);
  const next: Mesh = new Mesh(geometry, second);
  inspection.attach(next);
  expect(next.material).toBe(gray);
  inspection.dispose();
  expect(next.material).toBe(second);
  expect(disposed).toBe(0);
  geometry.dispose(); first.dispose(); second.dispose(); texture.dispose();
});
