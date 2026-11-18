/**
 * Hero 3D molar — tooth 36 (lower left first molar) from Dental Scope
 * (BodyParts3D-derived geometry, CC BY-SA). Pearl enamel over ivory dentin,
 * with a "See inside" mode that reveals the glowing pulp and root canals.
 * If WebGL or loading fails, the original hero photo simply stays visible.
 */
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';

const stage = document.querySelector('[data-tooth-stage]');
const figure = document.querySelector('.hero-banner');
const modeBtns = document.querySelectorAll('[data-tooth-mode]');
const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

function webglOK() {
  try {
    const c = document.createElement('canvas');
    return !!(window.WebGLRenderingContext && (c.getContext('webgl2') || c.getContext('webgl')));
  } catch (e) { return false; }
}

if (stage && webglOK()) init().catch(() => { /* keep the photo */ });

async function init() {
  // ---------- renderer / scene ----------
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;
  renderer.setClearColor(0x000000, 0);
  renderer.domElement.className = 'tooth-canvas';
  stage.prepend(renderer.domElement);

  const scene = new THREE.Scene();
  const pmrem = new THREE.PMREMGenerator(renderer);
  scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;

  const camera = new THREE.PerspectiveCamera(30, 1, 0.1, 100);
  camera.position.set(0, 0.15, 9);

  // neutral studio lighting, like Dental Scope's stage
  const key = new THREE.DirectionalLight(0xfff6ea, 2.2);
  key.position.set(-3, 5, 4);
  const fill = new THREE.DirectionalLight(0xeef0ff, 0.9);
  fill.position.set(4, 1, 3);
  const rim = new THREE.DirectionalLight(0xffffff, 1.4);
  rim.position.set(0, 3, -5);
  scene.add(key, fill, rim, new THREE.HemisphereLight(0xffffff, 0xe9e2d4, 0.7));

  // ---------- materials ----------
  const enamel = new THREE.MeshPhysicalMaterial({
    color: 0xf3efe4, roughness: 0.22, metalness: 0,
    clearcoat: 0.8, clearcoatRoughness: 0.12,
    sheen: 0.25, sheenColor: new THREE.Color(0xfffaf0), sheenRoughness: 0.5,
    transparent: true, opacity: 0.94, depthWrite: false, side: THREE.FrontSide, envMapIntensity: 0.9
  });
  const dentin = new THREE.MeshPhysicalMaterial({
    color: 0xe8d6ad, roughness: 0.5, transparent: true, opacity: 0.6, depthWrite: false
  });
  const cementum = new THREE.MeshPhysicalMaterial({
    color: 0xdcc69a, roughness: 0.6, transparent: true, opacity: 0.85, depthWrite: false
  });
  const pulp = new THREE.MeshStandardMaterial({
    color: 0xc4574d, emissive: 0x7a2018, emissiveIntensity: 0.2, roughness: 0.45
  });
  const canal = new THREE.MeshStandardMaterial({
    color: 0x2a3bd1, emissive: 0x1a2590, emissiveIntensity: 0.2, roughness: 0.4
  });

  // the two looks we blend between: solid (realistic) ↔ inside (x-ray glow)
  const looks = {
    solid:  { enamel: 0.94, dentin: 0.6,  cementum: 0.85, glow: 0.15 },
    inside: { enamel: 0.16, dentin: 0.16, cementum: 0.14, glow: 0.55 }
  };
  let mix = 0;        // 0 = solid, 1 = inside
  let mixTarget = 0;

  // ---------- model ----------
  const loader = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder);
  const gltf = await loader.loadAsync('./assets/models/tooth-36.glb');
  const tooth = gltf.scene;

  tooth.traverse((o) => {
    if (!o.isMesh) return;
    const n = o.name;
    if (n.startsWith('enamel')) { o.material = enamel; o.renderOrder = 4; }
    else if (n.startsWith('dentin')) { o.material = dentin; o.renderOrder = 3; }
    else if (n.startsWith('cementum')) { o.material = cementum; o.renderOrder = 2; }
    else if (n.startsWith('pulp')) { o.material = pulp; o.renderOrder = 1; }
    else if (n.startsWith('canal')) { o.material = canal; o.renderOrder = 1; }
    else o.visible = false; // periodontal ligament
  });

  // orient with the tooth's anatomical frame: crown up, cheek side facing us
  const v = (a) => new THREE.Vector3(...a);
  const axis = v([-0.1848, 0.9474, 0.2611]).normalize();
  const buccal = v([0.9386, 0.0914, 0.3326]);
  buccal.sub(axis.clone().multiplyScalar(buccal.dot(axis))).normalize();
  const mesial = new THREE.Vector3().crossVectors(axis, buccal).normalize();
  const basis = new THREE.Matrix4().makeBasis(mesial, axis, buccal);
  const orient = new THREE.Quaternion().setFromRotationMatrix(basis).invert();

  const inner = new THREE.Group();
  inner.add(tooth);
  inner.quaternion.copy(orient);

  // centre + scale to a fixed height
  const box = new THREE.Box3().setFromObject(inner);
  const size = box.getSize(new THREE.Vector3());
  const center = box.getCenter(new THREE.Vector3());
  inner.position.sub(center);
  const fit = new THREE.Group();
  fit.add(inner);
  fit.scale.setScalar(2.9 / Math.max(size.x, size.y, size.z));

  const pivot = new THREE.Group(); // receives user rotation
  pivot.add(fit);
  pivot.rotation.set(0.12, -0.6, 0);
  scene.add(pivot);

  // ---------- sizing ----------
  function resize() {
    const w = stage.clientWidth, h = stage.clientHeight;
    if (!w || !h) return;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    // keep the whole tooth in frame on tall/narrow stages
    camera.position.z = camera.aspect < 0.75 ? 9 / Math.max(camera.aspect / 0.75, 0.6) : 9;
    camera.updateProjectionMatrix();
  }
  new ResizeObserver(resize).observe(stage);
  resize();

  // ---------- interaction: drag to rotate with inertia ----------
  let dragging = false, lastX = 0, lastY = 0, velY = reduceMotion ? 0 : 0.004, velX = 0, idle = 0;
  const el = renderer.domElement;
  el.addEventListener('pointerdown', (e) => {
    dragging = true; lastX = e.clientX; lastY = e.clientY; idle = 0;
    el.setPointerCapture(e.pointerId); stage.classList.add('is-dragging');
  });
  el.addEventListener('pointermove', (e) => {
    if (!dragging) return;
    const dx = e.clientX - lastX, dy = e.clientY - lastY;
    lastX = e.clientX; lastY = e.clientY;
    velY = dx * 0.008; velX = dy * 0.006;
  });
  const end = () => { dragging = false; stage.classList.remove('is-dragging'); };
  el.addEventListener('pointerup', end);
  el.addEventListener('pointercancel', end);

  // gentle parallax from the mouse anywhere over the hero
  let px = 0, py = 0;
  figure.closest('.hero').addEventListener('pointermove', (e) => {
    px = (e.clientX / innerWidth - 0.5) * 0.25;
    py = (e.clientY / innerHeight - 0.5) * 0.15;
  });

  // ---------- inside toggle ----------
  function setInside(on) {
    mixTarget = on ? 1 : 0;
    stage.classList.toggle('is-inside', on);
    modeBtns.forEach((b) => b.setAttribute('aria-pressed', String((b.dataset.toothMode === 'inside') === on)));
    kick();
  }
  modeBtns.forEach((b) => b.addEventListener('click', () => setInside(b.dataset.toothMode === 'inside')));

  // ---------- render loop (only while on screen) ----------
  let visible = true, running = false;
  const clock = new THREE.Clock();
  new IntersectionObserver(([e]) => { visible = e.isIntersecting; if (visible) kick(); }).observe(stage);
  document.addEventListener('visibilitychange', kick);

  function kick() { if (!running && visible && !document.hidden) { running = true; clock.getDelta(); requestAnimationFrame(frame); } }

  const lerp = (a, b, t) => a + (b - a) * t;
  function frame() {
    if (!visible || document.hidden) { running = false; return; }
    const dt = Math.min(clock.getDelta(), 0.05), t = clock.elapsedTime;

    if (!dragging) {
      idle += dt;
      const auto = reduceMotion ? 0 : 0.0035;
      velY = lerp(velY, idle > 1.2 ? auto : velY, 0.03);
      velX = lerp(velX, 0, 0.08);
    }
    pivot.rotation.y += velY;
    pivot.rotation.x = THREE.MathUtils.clamp(pivot.rotation.x + velX, -0.7, 0.7);
    pivot.rotation.x = lerp(pivot.rotation.x, 0.12, dragging ? 0 : 0.01);

    if (!reduceMotion) {
      fit.position.y = Math.sin(t * 0.9) * 0.08;
    }
    camera.position.x = lerp(camera.position.x, px, 0.05);
    camera.position.y = lerp(camera.position.y, 0.15 - py, 0.05);
    camera.lookAt(0, 0, 0);

    mix = lerp(mix, mixTarget, reduceMotion ? 1 : 0.07);
    const s = looks.solid, i = looks.inside;
    enamel.opacity = lerp(s.enamel, i.enamel, mix);
    dentin.opacity = lerp(s.dentin, i.dentin, mix);
    cementum.opacity = lerp(s.cementum, i.cementum, mix);
    const pulse = 1;
    pulp.emissiveIntensity = lerp(s.glow, i.glow, mix) * pulse;
    canal.emissiveIntensity = lerp(s.glow, i.glow, mix) * pulse;

    renderer.render(scene, camera);
    requestAnimationFrame(frame);
  }

  figure.classList.add('has-3d');
  kick();

}
