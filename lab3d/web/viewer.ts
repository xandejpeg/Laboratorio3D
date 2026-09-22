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
  load(url: string): Promise<{ triangles: number; size: THREE.Vector3 }>;
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

  const material = new THREE.MeshStandardMaterial({ color: 0xb9c2cf, roughness: 0.72, metalness: 0.05 });

  function resize(): void {
    const w = host.clientWidth || 1;
    const h = host.clientHeight || 1;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
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
    obj.traverse((child) => {
      const mesh = child as THREE.Mesh;
      if (mesh.geometry) mesh.geometry.dispose();
    });
  }

  function clear(): void {
    if (!current) return;
    scene.remove(current);
    disposeObject(current);
    current = null;
  }

  /** Centre on the origin and scale so the longest axis spans 2 units. */
  function frame(object: THREE.Object3D): { triangles: number; size: THREE.Vector3 } {
    const box = new THREE.Box3().setFromObject(object);
    const size = box.getSize(new THREE.Vector3());
    const centre = box.getCenter(new THREE.Vector3());
    const longest = Math.max(size.x, size.y, size.z) || 1;
    const scale = 2 / longest;
    object.position.sub(centre);
    object.scale.setScalar(scale);
    const wrapper = new THREE.Group();
    wrapper.add(object);
    scene.add(wrapper);
    current = wrapper;

    let triangles = 0;
    object.traverse((child) => {
      const mesh = child as THREE.Mesh;
      const geometry = mesh.geometry as THREE.BufferGeometry | undefined;
      if (!geometry) return;
      triangles += geometry.index ? geometry.index.count / 3 : (geometry.getAttribute("position")?.count ?? 0) / 3;
    });

    radius = 2.6;
    setView("front");
    return { triangles: Math.round(triangles), size };
  }

  function setView(view: "front" | "left" | "right" | "back" | "top"): void {
    const positions: Record<typeof view, [number, number, number]> = {
      front: [0, 0.2, radius],
      back: [0, 0.2, -radius],
      left: [-radius, 0.2, 0],
      right: [radius, 0.2, 0],
      top: [0, radius, 0.001],
    };
    const p = positions[view];
    camera.position.set(p[0], p[1], p[2]);
    controls.target.set(0, 0, 0);
    controls.update();
  }

  async function load(url: string): Promise<{ triangles: number; size: THREE.Vector3 }> {
    clear();
    const response = await fetch(url);
    if (!response.ok) throw new Error(`could not fetch the mesh (HTTP ${response.status})`);
    const buffer = await response.arrayBuffer();
    if (url.toLowerCase().includes(".stl")) {
      const geometry = new STLLoader().parse(buffer);
      geometry.computeVertexNormals();
      return frame(new THREE.Mesh(geometry, material));
    }
    const object = new OBJLoader().parse(new TextDecoder().decode(buffer));
    object.traverse((child) => {
      const mesh = child as THREE.Mesh;
      if (!mesh.isMesh) return;
      mesh.material = material;
      if (mesh.geometry && !mesh.geometry.getAttribute("normal")) mesh.geometry.computeVertexNormals();
    });
    return frame(object);
  }

  return {
    load,
    clear,
    setView,
    dispose() {
      running = false;
      observer.disconnect();
      clear();
      controls.dispose();
      renderer.dispose();
      renderer.domElement.remove();
    },
  };
}
