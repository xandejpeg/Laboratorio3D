/**
 * Mesh viewer for the geometry the pipeline actually produced.
 *
 * It loads the run's own OBJ/STL from /api/file. There is no stand-in model and
 * no procedural placeholder: if the pipeline produced nothing, the viewer shows
 * nothing and says so.
 */

import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { OBJLoader } from "three/examples/jsm/loaders/OBJLoader.js";
import { STLLoader } from "three/examples/jsm/loaders/STLLoader.js";

export interface ViewerHandle {
  load(url: string, mtlUrl?: string | null): Promise<{ triangles: number; size: THREE.Vector3; materials: number }>;
  clear(): void;
  setView(view: "front" | "left" | "right" | "back" | "top"): void;
  dispose(): void;
}

export function createViewer(host: HTMLElement): ViewerHandle {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x14171c);

  const camera = new THREE.PerspectiveCamera(38, 1, 0.01, 200);
  camera.position.set(0, 0.4, 4);

  const renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  host.appendChild(renderer.domElement);

  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.dampingFactor = 0.08;

  scene.add(new THREE.HemisphereLight(0xdfe7f2, 0x30343c, 2.1));
  const key = new THREE.DirectionalLight(0xffffff, 2.2);
  key.position.set(2.5, 3.5, 3);
  scene.add(key);
  const rim = new THREE.DirectionalLight(0x88a6ff, 0.9);
  rim.position.set(-3, 1.5, -2.5);
  scene.add(rim);

  const grid = new THREE.GridHelper(6, 12, 0x3a4150, 0x262b33);
  grid.position.y = -1.05;
  scene.add(grid);

  let current: THREE.Object3D | null = null;
  let radius = 2;
  let loadVersion = 0;
  let pending: AbortController | null = null;
  let modelSize = new THREE.Vector3(1, 2, 1);

  const material = new THREE.MeshStandardMaterial({ color: 0xb9c2cf, roughness: 0.72, metalness: 0.05 });

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

  function disposeObject(obj: THREE.Object3D): void {
    const disposed = new Set<THREE.Material>();
    obj.traverse((child) => {
      const mesh = child as THREE.Mesh;
      if (mesh.geometry) mesh.geometry.dispose();
      if (mesh.material) for (const mat of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) {
        if (mat !== material && !disposed.has(mat)) { mat.dispose(); disposed.add(mat); }
      }
    });
  }

  function clear(): void {
    loadVersion++;
    pending?.abort();
    pending = null;
    if (!current) return;
    scene.remove(current);
    disposeObject(current);
    current = null;
  }

  /** Centre on the origin and scale so the longest axis spans 2 units. */
  function frame(object: THREE.Object3D): { triangles: number; size: THREE.Vector3; materials: number } {
    // OpenSCAD and the upstream Blender exports use Z-up, as in Studio.
    object.rotateX(-Math.PI / 2);
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
        const next = palette.get(old.name) ?? material;
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
    dispose() {
      running = false;
      observer.disconnect();
      clear();
      material.dispose();
      controls.dispose();
      renderer.dispose();
      renderer.domElement.remove();
    },
  };
}
