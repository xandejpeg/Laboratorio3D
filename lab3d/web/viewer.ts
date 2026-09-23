/**
 * Mesh viewer for the geometry the pipeline actually produced.
 *
 * It loads the run's own GLB/OBJ/STL from /api/file. There is no stand-in model and
 * no procedural placeholder: if the pipeline produced nothing, the viewer shows
 * nothing and says so.
 */

import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { OBJLoader } from "three/examples/jsm/loaders/OBJLoader.js";
import { STLLoader } from "three/examples/jsm/loaders/STLLoader.js";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { validateEmbeddedGlb } from "./glb.ts";

export type MaterialMode = "colors" | "gray";

/** Keep the original material objects intact, including every GLB texture slot. */
export function createMaterialInspection() {
  const originals = new Map<THREE.Mesh, THREE.Material | THREE.Material[]>();
  const gray = new THREE.MeshStandardMaterial({ color: 0x999999, roughness: 0.8, metalness: 0, side: THREE.DoubleSide });
  let mode: MaterialMode = "colors";
  const setMode = (next: MaterialMode): void => {
    mode = next;
    for (const [mesh, material] of originals) mesh.material = mode === "gray" ? gray : material;
  };
  const clear = (): void => {
    // Restore before the viewer disposes a run, so its original textures and
    // materials remain reachable by the normal resource cleanup.
    for (const [mesh, material] of originals) mesh.material = material;
    originals.clear();
  };
  return {
    setMode,
    clear,
    attach(root: THREE.Object3D): void {
      clear();
      root.traverse((child) => {
        const mesh = child as THREE.Mesh;
        if (mesh.isMesh) originals.set(mesh, mesh.material);
      });
      setMode(mode);
    },
    dispose(): void { clear(); gray.dispose(); },
  };
}

export interface ViewerHandle {
  load(url: string, mtlUrl?: string | null): Promise<{ triangles: number; size: THREE.Vector3; materials: number }>;
  clear(): void;
  setView(view: "front" | "left" | "right" | "back" | "top"): void;
  setMaterialMode(mode: MaterialMode): void;
  dispose(): void;
}

export function createViewer(host: HTMLElement): ViewerHandle {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x14171c);

  const camera = new THREE.PerspectiveCamera(38, 1, 0.01, 200);
  camera.position.set(0, 0.4, 4);

  const renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1;
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  host.appendChild(renderer.domElement);

  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.dampingFactor = 0.08;

  // Neutral studio fill keeps downward-facing facial planes readable. Strong
  // overhead-only lighting exaggerates shadows already present in image textures.
  scene.add(new THREE.HemisphereLight(0xe5e9ef, 0x86807a, 2.0));
  const key = new THREE.DirectionalLight(0xffffff, 1.65);
  key.position.set(2.5, 3.5, 3);
  scene.add(key);
  const fill = new THREE.DirectionalLight(0xfff7f0, 0.75);
  fill.position.set(0, 0.3, 5);
  scene.add(fill);
  const rim = new THREE.DirectionalLight(0xd6deea, 0.6);
  rim.position.set(-3, 1.5, -2.5);
  scene.add(rim);

  const grid = new THREE.GridHelper(6, 12, 0x3a4150, 0x262b33);
  grid.position.y = -1.05;
  scene.add(grid);

  let current: THREE.Object3D | null = null;
  let additionalScenes: THREE.Object3D[] = [];
  let radius = 2;
  let loadVersion = 0;
  let pending: AbortController | null = null;
  let modelSize = new THREE.Vector3(1, 2, 1);

  const material = new THREE.MeshStandardMaterial({ color: 0xb9c2cf, roughness: 0.72, metalness: 0.05 });
  const inspection = createMaterialInspection();

  function resize(): void {
    const w = host.clientWidth || 1;
    const h = host.clientHeight || 1;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    radius = Math.max(modelSize.y, modelSize.x / camera.aspect) / (2 * Math.tan(THREE.MathUtils.degToRad(camera.fov / 2))) + modelSize.z / 2 + 0.3;
  }

  const observer = new ResizeObserver(resize);
  observer.observe(host);
  resize();

  let running = true;
  function tick(): void {
    if (!running) return;
    controls.update();
    renderer.render(scene, camera);
    requestAnimationFrame(tick);
  }
  tick();

  function disposeObject(obj: THREE.Object3D, extra: THREE.Object3D[] = []): void {
    const disposed = new Set<THREE.Material>();
    const geometries = new Set<THREE.BufferGeometry>();
    const textures = new Set<THREE.Texture>();
    const bitmaps = new Set<ImageBitmap>();
    for (const root of new Set([obj, ...extra])) root.traverse((child) => {
      const mesh = child as THREE.Mesh;
      if (mesh.geometry && !geometries.has(mesh.geometry)) { mesh.geometry.dispose(); geometries.add(mesh.geometry); }
      if (mesh.material) for (const mat of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) {
        if (mat === material || disposed.has(mat)) continue;
        // GLTFLoader creates PBR texture slots (base color, normal, roughness,
        // metallic, emissive, AO and supported extension maps) on the material.
        for (const value of Object.values(mat)) {
          if (!(value instanceof THREE.Texture) || textures.has(value)) continue;
          textures.add(value);
          const image: unknown = value.source?.data;
          if (typeof ImageBitmap !== "undefined" && image instanceof ImageBitmap && !bitmaps.has(image)) {
            bitmaps.add(image);
            image.close();
          }
          value.dispose();
        }
        mat.dispose(); disposed.add(mat);
      }
      if ((child as THREE.SkinnedMesh).isSkinnedMesh) (child as THREE.SkinnedMesh).skeleton?.dispose();
    });
  }

  function clear(): void {
    loadVersion++;
    pending?.abort();
    pending = null;
    inspection.clear();
    if (!current) return;
    scene.remove(current);
    disposeObject(current, additionalScenes);
    current = null;
    additionalScenes = [];
  }

  /** Centre on the origin and scale so the longest axis spans 2 units. */
  function frame(object: THREE.Object3D, zUp = true): { triangles: number; size: THREE.Vector3; materials: number } {
    // OBJ/STL from OpenSCAD are Z-up; glTF already supplies Y-up coordinates.
    if (zUp) object.rotateX(-Math.PI / 2);
    object.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(object);
    const size = box.getSize(new THREE.Vector3());
    const centre = box.getCenter(new THREE.Vector3());
    const longest = Math.max(size.x, size.y, size.z);
    if (!Number.isFinite(longest) || longest <= 0) throw new Error("O arquivo não contém geometria 3D válida.");
    const scale = 2 / longest;
    object.position.sub(centre);
    const wrapper = new THREE.Group();
    wrapper.add(object);
    wrapper.scale.setScalar(scale);
    scene.add(wrapper);
    current = wrapper;

    let triangles = 0;
    const materials = new Set<THREE.Material>();
    object.traverse((child) => {
      const mesh = child as THREE.Mesh;
      if (!mesh.isMesh) return;
      const geometry = mesh.geometry as THREE.BufferGeometry | undefined;
      if (!geometry) return;
      for (const mat of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) {
        if (mat !== material) materials.add(mat);
      }
      triangles += geometry.index ? geometry.index.count / 3 : (geometry.getAttribute("position")?.count ?? 0) / 3;
    });

    modelSize = size.clone().multiplyScalar(scale);
    grid.position.y = -modelSize.y / 2 - 0.025;
    resize();
    setView("front");
    inspection.attach(object);
    return { triangles: Math.round(triangles), size, materials: materials.size };
  }

  function setView(view: "front" | "left" | "right" | "back" | "top"): void {
    const positions: Record<typeof view, [number, number, number]> = {
      front: [0, 0, radius],
      back: [0, 0, -radius],
      left: [-radius, 0, 0],
      right: [radius, 0, 0],
      top: [0, radius, 0.001],
    };
    const p = positions[view];
    camera.position.set(p[0], p[1], p[2]);
    controls.target.set(0, 0, 0);
    controls.update();
  }

  async function load(url: string, mtlUrl?: string | null): Promise<{ triangles: number; size: THREE.Vector3; materials: number }> {
    clear();
    const version = loadVersion;
    const controller = new AbortController();
    pending = controller;
    const response = await fetch(url, { signal: controller.signal });
    if (!response.ok) throw new Error(`Não foi possível carregar a malha (HTTP ${response.status}).`);
    const buffer = await response.arrayBuffer();
    const assertCurrent = () => {
      if (version !== loadVersion || !running) throw new DOMException("Carregamento substituído.", "AbortError");
    };
    assertCurrent();
    const meshPath = new URL(url, window.location.href).searchParams.get("path") ?? url;
    if (/\.glb$/i.test(meshPath)) {
      validateEmbeddedGlb(buffer);
      const manager = new THREE.LoadingManager();
      manager.setURLModifier((resource) => {
        // Blob URLs here are made by GLTFLoader from embedded bufferViews;
        // validateEmbeddedGlb rejects blob URLs supplied by the file itself.
        if (resource.startsWith("blob:") || resource.startsWith("data:")) return resource;
        throw new Error("O GLB tentou carregar um recurso externo.");
      });
      const gltf = await new GLTFLoader(manager).parseAsync(buffer, "");
      const object = gltf.scene;
      try {
        assertCurrent();
        // Keep the loader's PBR materials, color spaces, UVs and object
        // transforms. An exported rig is displayed in its saved rest pose.
        const result = frame(object, false);
        additionalScenes = gltf.scenes.filter((scene) => scene !== object);
        return result;
      } catch (e) {
        disposeObject(object, gltf.scenes);
        throw e;
      }
    }
    if (/\.stl$/i.test(meshPath)) {
      const geometry = new STLLoader().parse(buffer);
      geometry.computeVertexNormals();
      const mesh = new THREE.Mesh(geometry, material);
      try { return frame(mesh); } catch (e) { disposeObject(mesh); throw e; }
    }
    // Only load the explicit MTL artifact returned by the run scanner. Never
    // follow external texture URLs embedded in user-provided OBJ/MTL files.
    const palette = new Map<string, THREE.MeshStandardMaterial>();
    if (mtlUrl) {
      const mtl = await fetch(mtlUrl, { signal: controller.signal });
      if (!mtl.ok) throw new Error(`Não foi possível carregar os materiais (HTTP ${mtl.status}).`);
      const source = await mtl.text();
      assertCurrent();
      let mat: THREE.MeshStandardMaterial | null = null;
      for (const line of source.split(/\r?\n/)) {
        const [key, ...parts] = line.trim().split(/\s+/);
        if (key === "newmtl") {
          mat = new THREE.MeshStandardMaterial({ roughness: 0.6 });
          mat.name = parts.join(" ");
          palette.set(mat.name, mat);
        } else if (mat) {
          const numbers = parts.map(Number);
          if (!numbers.every(Number.isFinite)) continue;
          if (key === "Kd" && numbers.length >= 3) mat.color.setRGB(numbers[0]!, numbers[1]!, numbers[2]!, THREE.SRGBColorSpace);
          if (key === "Pr") mat.roughness = THREE.MathUtils.clamp(numbers[0] ?? 0.6, 0.05, 1);
          if (key === "Pm") mat.metalness = THREE.MathUtils.clamp(numbers[0] ?? 0, 0, 1);
          if (key === "d") { mat.opacity = THREE.MathUtils.clamp(numbers[0] ?? 1, 0, 1); mat.transparent = mat.opacity < 1; }
        }
      }
    }
    assertCurrent();
    const object = new OBJLoader().parse(new TextDecoder().decode(buffer));
    const used = new Set<THREE.Material>();
    object.traverse((child) => {
      const mesh = child as THREE.Mesh;
      if (!mesh.isMesh) return;
      const replace = (old: THREE.Material) => {
        let next = palette.get(old.name) ?? material;
        // OBJ's optional per-vertex RGB stores the actual exported surface paint.
        // Clone so mixed colored/uncolored meshes never mutate a shared material.
        if (mesh.geometry.getAttribute("color")) {
          next = next.clone();
          next.vertexColors = true;
        }
        old.dispose();
        used.add(next);
        return next;
      };
      mesh.material = Array.isArray(mesh.material) ? mesh.material.map(replace) : replace(mesh.material);
      if (mesh.geometry && !mesh.geometry.getAttribute("normal")) mesh.geometry.computeVertexNormals();
    });
    for (const mat of palette.values()) if (!used.has(mat)) mat.dispose();
    try { return frame(object); } catch (e) { disposeObject(object); throw e; }
  }

  return {
    load,
    clear,
    setView,
    setMaterialMode: inspection.setMode,
    dispose() {
      running = false;
      observer.disconnect();
      clear();
      inspection.dispose();
      material.dispose();
      controls.dispose();
      renderer.dispose();
      renderer.domElement.remove();
    },
  };
}
