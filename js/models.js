import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';

/* Built from primitives, except the Scout Mini base, the FIRST Global robot and the Knights Robotics Hero, which come from CAD.
   Units are meters, forward is +X, up is +Y, right is +Z. */

const PI = Math.PI;
const BOX = (w, h, d) => new THREE.BoxGeometry(w, h, d);
const RBOX = (w, h, d, r, s = 3) => new RoundedBoxGeometry(w, h, d, s, Math.min(r, w / 2, h / 2, d / 2));
const CYL = (rt, rb, h, seg = 32, open = false) => new THREE.CylinderGeometry(rt, rb, h, seg, 1, open);
const SPH = (r, w = 24, h = 16) => new THREE.SphereGeometry(r, w, h);

function add(parent, geo, mat, x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0, name) {
  const m = new THREE.Mesh(geo, mat);
  m.position.set(x, y, z);
  m.rotation.set(rx, ry, rz);
  if (name) m.name = name;
  parent.add(m);
  return m;
}
function grp(parent, name, x = 0, y = 0, z = 0) {
  const g = new THREE.Group();
  if (name) g.name = name;
  g.position.set(x, y, z);
  if (parent) parent.add(g);
  return g;
}
function anchor(parent, name, x, y, z) {
  const o = new THREE.Object3D();
  o.name = name;
  o.position.set(x, y, z);
  parent.add(o);
  return o;
}
// cylinder along Z (axles) or X
const cylZ = (r, h, seg = 32) => CYL(r, r, h, seg).rotateX(PI / 2);
const cylX = (r, h, seg = 32) => CYL(r, r, h, seg).rotateZ(PI / 2);

/* Canvas textures */
function canvasTex(w, h, draw, srgb = true, repeat = [1, 1]) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  draw(c.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(repeat[0], repeat[1]);
  t.anisotropy = 4;
  return t;
}
let seed = 11;
const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);

function makeTextures() {
  const carbon = canvasTex(128, 128, (g, w, h) => {
    const n = 16, s = w / n;
    for (let y = 0; y < n; y++)
      for (let x = 0; x < n; x++) {
        const on = ((x + y) >> 1) % 2 === 0;
        g.fillStyle = on ? '#2a2d31' : '#16181b';
        g.fillRect(x * s, y * s, s, s);
        g.fillStyle = on ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.25)';
        g.fillRect(x * s, y * s, s, 1);
      }
  }, true, [6, 6]);
  const solar = canvasTex(256, 256, (g, w, h) => {
    g.fillStyle = '#5d6672';
    g.fillRect(0, 0, w, h);
    const n = 8, s = w / n;
    for (let y = 0; y < n; y++)
      for (let x = 0; x < n; x++) {
        const k = 22 + Math.floor(rnd() * 8);
        g.fillStyle = `rgb(${k - 6},${k + 8},${k + 34})`;
        g.fillRect(x * s + 2, y * s + 2, s - 4, s - 4);
        g.fillStyle = 'rgba(160,175,195,0.35)';
        for (let i = 1; i < 4; i++) g.fillRect(x * s + 2, y * s + (i * s) / 4, s - 4, 1);
      }
  }, true, [1, 1]);
  const foilBump = canvasTex(256, 256, (g, w, h) => {
    g.fillStyle = '#808080';
    g.fillRect(0, 0, w, h);
    for (let i = 0; i < 900; i++) {
      const v = Math.floor(90 + rnd() * 90);
      g.fillStyle = `rgb(${v},${v},${v})`;
      g.beginPath();
      const x = rnd() * w, y = rnd() * h, r = 4 + rnd() * 16;
      g.moveTo(x, y);
      for (let k = 0; k < 5; k++) g.lineTo(x + (rnd() - 0.5) * r * 2, y + (rnd() - 0.5) * r * 2);
      g.closePath();
      g.fill();
    }
  }, false, [2, 2]);
  const wood = canvasTex(512, 128, (g, w, h) => {
    g.fillStyle = '#c49a66';
    g.fillRect(0, 0, w, h);
    for (let i = 0; i < 60; i++) {
      const y0 = rnd() * h, amp = 2 + rnd() * 6, f = 0.004 + rnd() * 0.01;
      g.strokeStyle = `rgba(${120 + rnd() * 30},${80 + rnd() * 20},${40},${0.18 + rnd() * 0.25})`;
      g.lineWidth = 0.6 + rnd() * 1.6;
      g.beginPath();
      for (let x = 0; x <= w; x += 8) g.lineTo(x, y0 + Math.sin(x * f + i) * amp);
      g.stroke();
    }
  }, true, [1, 1]);
  const layers = canvasTex(8, 64, (g, w, h) => {
    for (let y = 0; y < h; y++) {
      const v = y % 2 ? 150 : 110;
      g.fillStyle = `rgb(${v},${v},${v})`;
      g.fillRect(0, y, w, 1);
    }
  }, false, [1, 40]);
  const soil = canvasTex(256, 256, (g, w, h) => {
    g.fillStyle = '#3a2a1d';
    g.fillRect(0, 0, w, h);
    for (let i = 0; i < 2600; i++) {
      const v = rnd();
      g.fillStyle = v < 0.5 ? 'rgba(20,12,6,0.6)' : v < 0.85 ? 'rgba(90,66,44,0.5)' : 'rgba(140,120,100,0.45)';
      g.fillRect(rnd() * w, rnd() * h, 1 + rnd() * 3, 1 + rnd() * 3);
    }
  }, true, [3, 1]);
  return { carbon, solar, foilBump, wood, layers, soil };
}

let MAT = null;
export function materials() {
  if (MAT) return MAT;
  const T = makeTextures();
  const std = (color, roughness = 0.5, metalness = 0, extra = {}) =>
    new THREE.MeshStandardMaterial({ color, roughness, metalness, ...extra });
  MAT = {
    T,
    white: std(0xeceae4, 0.38),
    shell: std(0xe9e8e2, 0.34),
    print: std(0xeeece6, 0.72, 0, { bumpMap: T.layers, bumpScale: 0.6 }),
    black: std(0x1b1d20, 0.5),
    satin: std(0x24272b, 0.42, 0.1),
    graphite: std(0x34383e, 0.45, 0.2),
    rubber: std(0x141517, 0.9),
    roller: std(0x3b3f45, 0.75),
    red: std(0xb4241d, 0.3, 0.6),
    redPrint: std(0xcc2f27, 0.55),
    alu: std(0xbcc1c7, 0.3, 1.0),
    aluDark: std(0x50555c, 0.34, 0.9),
    steel: std(0x9aa0a6, 0.25, 1.0),
    carbon: new THREE.MeshPhysicalMaterial({ color: 0xffffff, map: T.carbon, roughness: 0.42, metalness: 0.15, clearcoat: 0.8, clearcoatRoughness: 0.2 }),
    carbonPlane: new THREE.MeshPhysicalMaterial({ color: 0xd9d9d9, map: T.carbon, roughness: 0.4, metalness: 0.1, clearcoat: 0.9, clearcoatRoughness: 0.15 }),
    blue: std(0x2453d6, 0.5),
    bluePCB: std(0x1d3f8f, 0.5),
    navyPCB: std(0x1c2350, 0.5),
    greenPCB: std(0x0f5a33, 0.5),
    hatPCB: std(0xeeede8, 0.5),
    chip: std(0x111214, 0.4),
    gold: std(0xe2b24c, 0.28, 1.0),
    brass: std(0xc9a24a, 0.35, 1.0),
    motorGold: std(0xd9a441, 0.32, 0.85),
    copper: std(0xc27a44, 0.35, 1.0),
    lens: new THREE.MeshPhysicalMaterial({ color: 0x07080b, roughness: 0.05, metalness: 0.2, clearcoat: 1, clearcoatRoughness: 0.05 }),
    acrylic: new THREE.MeshPhysicalMaterial({ color: 0xd8e3ec, roughness: 0.08, metalness: 0, transparent: true, opacity: 0.32, depthWrite: false }),
    poly: new THREE.MeshPhysicalMaterial({ color: 0xcfe0ea, roughness: 0.12, metalness: 0, transparent: true, opacity: 0.22, depthWrite: false, side: THREE.DoubleSide }),
    sheet: new THREE.MeshPhysicalMaterial({ color: 0xe6f0f5, roughness: 0.18, metalness: 0, transparent: true, opacity: 0.38, depthWrite: false, side: THREE.DoubleSide }),
    wood: std(0xffffff, 0.72, 0, { map: T.wood }),
    pine: std(0xf3e2c4, 0.78, 0, { map: T.wood }),
    woodDark: std(0x8a5a32, 0.7),
    soil: std(0xffffff, 0.98, 0, { map: T.soil }),
    leaf: std(0x3f8a3c, 0.55, 0, { side: THREE.DoubleSide }),
    leaf2: std(0x2f6f33, 0.55, 0, { side: THREE.DoubleSide }),
    leaf3: std(0x5aa047, 0.55, 0, { side: THREE.DoubleSide }),
    duck: std(0xf6cb2c, 0.3),
    beak: std(0xef8a21, 0.38),
    eye: std(0x0b0b0c, 0.2),
    orange: std(0xf07f2a, 0.6),
    // the satellite's foil: a soft sheen that moves with the light, without sparkling or clipping to white
    foil: std(0xd09a34, 0.42, 1.0, { bumpMap: T.foilBump, bumpScale: 0.6 }),
    foilSilver: std(0xa9aeb6, 0.44, 1.0, { bumpMap: T.foilBump, bumpScale: 0.55 }),
    // the cells sit just above the panel, so they always draw in front of it instead of flickering through
    solar: std(0xc4cbe6, 0.58, 0.0, { map: T.solar, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -4 }),
    panelBack: std(0xd8d6cf, 0.6),
    flag: std(0xd6342b, 0.7, 0, { side: THREE.DoubleSide }),
    mast: std(0xf1f0ea, 0.45),
    collar: std(0x2c6fd6, 0.45),
    dome: std(0x3a3e44, 0.55),
    breadboard: std(0xf0efe9, 0.6),
    armor: std(0xd8dbdf, 0.42),
    screen: std(0x0d1b2a, 0.25, 0, { emissive: 0x16324f, emissiveIntensity: 0.6 }),
    ledBlue: std(0x2b6cff, 0.4, 0, { emissive: 0x2b6cff, emissiveIntensity: 1.1 }),
    ledRed: std(0xff3b30, 0.4, 0, { emissive: 0xff3b30, emissiveIntensity: 1.0 }),
    ledYellow: std(0xffc21a, 0.4, 0, { emissive: 0xffb000, emissiveIntensity: 0.9 }),
    ledGreen: std(0x2fd36b, 0.4, 0, { emissive: 0x22c55e, emissiveIntensity: 0.9 }),
    wire: [std(0xc62828, 0.6), std(0xf2b100, 0.6), std(0x1565c0, 0.6), std(0x1b1b1b, 0.6), std(0x2e7d32, 0.6)],
    banner: std(0xffffff, 0.75, 0, { side: THREE.DoubleSide, transparent: true }),
    line: new THREE.LineBasicMaterial({ color: 0x2a2a2a }),
    cabin: std(0x2a2d31, 0.8, 0, { side: THREE.BackSide }),
    puck: std(0x0f0f10, 0.6),
    panelGrey: std(0xc4c8cc, 0.62),
    gunmetal: std(0x3d4249, 0.52, 0.6),
    matte: std(0x1a1c1f, 0.85),
    lightbar: std(0xe4ecf3, 0.22, 0.05),
    screenDark: std(0x15181c, 0.3, 0.1),
    glass: new THREE.MeshPhysicalMaterial({ color: 0xbfd6e4, roughness: 0.05, metalness: 0, clearcoat: 1, clearcoatRoughness: 0.05 }),
    aluSatin: std(0xa9afb6, 0.42, 0.85),
    ballRed: std(0xb3261e, 0.62),
    barrier: std(0x9a9ea3, 0.5),
    // the Knights Robotics plates are carbon fiber: no weave texture on CAD meshes, just the dark lacquered sheen
    carbonCF: new THREE.MeshPhysicalMaterial({ color: 0x1e2125, roughness: 0.46, metalness: 0.2, clearcoat: 0.65, clearcoatRoughness: 0.3 }),
    printWhite: std(0xe6e4de, 0.62),
    navyPrint: std(0x1e2f74, 0.58),
    bluePrint: std(0x3a78c0, 0.5),
    yellowPrint: std(0xe6b830, 0.5),
  };
  return MAT;
}

/* ------------------------------------------------------------------ */
/* CAD models                                                          */
/* ------------------------------------------------------------------ */
// The files carry no normals, to stay small. This rebuilds them from the shared vertices: smooth across
// gentle bends, sharp where faces meet at more than the crease angle.
function creaseNormals(geo, crease = 0.6) {
  const idx = geo.index.array, pos = geo.attributes.position;
  const nv = pos.count, nf = idx.length / 3, cosC = Math.cos(crease);
  const P = new Float32Array(nv * 3);
  for (let i = 0; i < nv; i++) { P[i * 3] = pos.getX(i); P[i * 3 + 1] = pos.getY(i); P[i * 3 + 2] = pos.getZ(i); }
  const fn = new Float32Array(nf * 3), fu = new Float32Array(nf * 3);
  for (let f = 0; f < nf; f++) {
    const a = idx[f * 3] * 3, b = idx[f * 3 + 1] * 3, c = idx[f * 3 + 2] * 3;
    const ux = P[b] - P[a], uy = P[b + 1] - P[a + 1], uz = P[b + 2] - P[a + 2];
    const vx = P[c] - P[a], vy = P[c + 1] - P[a + 1], vz = P[c + 2] - P[a + 2];
    const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    fn[f * 3] = nx; fn[f * 3 + 1] = ny; fn[f * 3 + 2] = nz;
    const l = Math.hypot(nx, ny, nz) || 1;
    fu[f * 3] = nx / l; fu[f * 3 + 1] = ny / l; fu[f * 3 + 2] = nz / l;
  }
  // faces around each vertex
  const start = new Uint32Array(nv + 1);
  for (let i = 0; i < idx.length; i++) start[idx[i] + 1]++;
  for (let v = 0; v < nv; v++) start[v + 1] += start[v];
  const fill = start.slice(0, nv), around = new Uint32Array(idx.length);
  for (let i = 0; i < idx.length; i++) around[fill[idx[i]]++] = (i / 3) | 0;
  const outP = new Float32Array(idx.length * 3), outN = new Float32Array(idx.length * 3);
  for (let i = 0; i < idx.length; i++) {
    const v = idx[i], f = (i / 3) | 0;
    let nx = 0, ny = 0, nz = 0;
    const fx = fu[f * 3], fy = fu[f * 3 + 1], fz = fu[f * 3 + 2];
    for (let k = start[v]; k < start[v + 1]; k++) {
      const g = around[k];
      if (fx * fu[g * 3] + fy * fu[g * 3 + 1] + fz * fu[g * 3 + 2] < cosC) continue;
      nx += fn[g * 3]; ny += fn[g * 3 + 1]; nz += fn[g * 3 + 2];
    }
    const l = Math.hypot(nx, ny, nz) || 1;
    outN[i * 3] = nx / l; outN[i * 3 + 1] = ny / l; outN[i * 3 + 2] = nz / l;
    outP[i * 3] = P[v * 3]; outP[i * 3 + 1] = P[v * 3 + 1]; outP[i * 3 + 2] = P[v * 3 + 2];
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(outP, 3));
  g.setAttribute('normal', new THREE.BufferAttribute(outN, 3));
  g.computeBoundingSphere();
  return g;
}

// material names in the files, mapped to the shared palette
const CAD_MAT = {
  shell: 'shell', black: 'black', dark: 'satin', rubber: 'rubber', hub: 'red', red: 'red', alu: 'aluSatin', steel: 'steel',
  aluDark: 'aluDark', white: 'white', panel: 'panelGrey', orange: 'orange', ballRed: 'ballRed', barrier: 'barrier', hubcase: 'graphite',
  carbon: 'carbonCF', gunmetal: 'gunmetal', print: 'printWhite', navy: 'navyPrint', blue: 'bluePrint', yellow: 'yellowPrint',
  green: 'greenPCB', roller: 'roller',
};
const CAD = {};
const idle = () => new Promise((r) => (window.requestIdleCallback ? requestIdleCallback(() => r(), { timeout: 120 }) : setTimeout(r, 16)));
// Load the CAD robots. 'lo' is the light parade copy, needed at the start; 'hi' is the close up copy at full
// detail, loaded afterwards in the background, one part at a time so scrolling stays smooth.
export async function loadCAD(level = 'lo', base = 'models/') {
  const M = materials();
  const loader = new GLTFLoader();
  loader.setMeshoptDecoder(MeshoptDecoder);
  // a copy of the page published somewhere that won't serve .glb files can carry them as base64 in JSON instead
  const packed = document.querySelector('meta[name="cad-format"]')?.content === 'base64';
  const fetchModel = async (name) => {
    if (!packed) return loader.loadAsync(base + name + '.glb');
    const j = await (await fetch(base + name + '.json')).json();
    const bin = Uint8Array.from(atob(j.glb), (c) => c.charCodeAt(0));
    return loader.parseAsync(bin.buffer, base);
  };
  const get = (name) => fetchModel(name).then(async (gltf) => {
    const meshes = [];
    gltf.scene.traverse((o) => { if (o.isMesh) meshes.push(o); });
    for (const o of meshes) {
      o.material = M[CAD_MAT[o.material.name]] || M.satin;
      if (!o.geometry.attributes.normal && o.geometry.index) {
        if (level === 'hi') await idle();
        o.geometry = creaseNormals(o.geometry);
      }
    }
    return gltf.scene;
  }).catch(() => null);
  const names = ['scout', 'fgc', 'qkrt'];
  const scenes = await Promise.all(names.map((n) => get(level === 'lo' ? n + '-lo' : n)));
  names.forEach((n, i) => { if (scenes[i]) (CAD[n] = CAD[n] || {})[level] = scenes[i]; });
  return names.filter((n, i) => scenes[i]);
}
export const hasCAD = (key, level) => !!(CAD[key] && CAD[key][level]);
const cadScene = (key, lod) => CAD[key] && (CAD[key][lod] || CAD[key].lo || CAD[key].hi);

/* Merge static meshes that share a material, group by group, so each robot costs a few draw calls. */
export function optimize(node) {
  node.children.slice().forEach((c) => {
    if ((c.isGroup || c.type === 'Object3D') && c.children.length) optimize(c);
  });
  const meshes = node.children.filter((c) => c.isMesh && !c.name && !c.children.length && !c.userData.keep);
  const byMat = new Map();
  for (const m of meshes) {
    if (!byMat.has(m.material)) byMat.set(m.material, []);
    byMat.get(m.material).push(m);
  }
  for (const [mat, list] of byMat) {
    if (list.length < 2) continue;
    const needUV = !!(mat.map || mat.bumpMap || mat.normalMap);
    const geos = [];
    let ok = true;
    for (const m of list) {
      m.updateMatrix();
      let g = m.geometry.index ? m.geometry.toNonIndexed() : m.geometry.clone();
      g.applyMatrix4(m.matrix);
      for (const k of Object.keys(g.attributes)) if (k !== 'position' && k !== 'normal' && k !== 'uv') g.deleteAttribute(k);
      if (!g.attributes.normal) g.computeVertexNormals();
      if (needUV) { if (!g.attributes.uv) { ok = false; break; } } else if (g.attributes.uv) g.deleteAttribute('uv');
      geos.push(g);
    }
    if (!ok) continue;
    const merged = mergeGeometries(geos, false);
    if (!merged) continue;
    list.forEach((m) => node.remove(m));
    node.add(new THREE.Mesh(merged, mat));
  }
}

/* Shared parts */

function tire(parent, M, r, w, { lugs = 20, hub = M.red, hubR = 0.55, tread = M.rubber, knob = 0.006 } = {}) {
  const g = grp(parent);
  const prof = [
    [r * 0.62, -w / 2], [r * 0.9, -w / 2], [r * 0.975, -w * 0.43], [r, -w * 0.28],
    [r, w * 0.28], [r * 0.975, w * 0.43], [r * 0.9, w / 2], [r * 0.62, w / 2],
  ].map(([a, b]) => new THREE.Vector2(a, b));
  add(g, new THREE.LatheGeometry(prof, 48).rotateX(PI / 2), tread);
  const step = (2 * PI) / lugs;
  for (let k = 0; k < lugs; k++) {
    for (const side of [-1, 1]) {
      const a = k * step + (side > 0 ? step / 2 : 0);
      const L = add(g, BOX(knob * 1.6, knob * 2.6, w * 0.4), tread, Math.cos(a) * (r + knob * 0.3), Math.sin(a) * (r + knob * 0.3), side * w * 0.2);
      L.rotation.z = a;
    }
  }
  add(g, cylZ(r * hubR, w * 0.82, 40), hub);
  add(g, cylZ(r * hubR * 0.42, w * 0.9, 24), M.satin);
  for (let k = 0; k < 5; k++) {
    const a = (k / 5) * 2 * PI;
    add(g, cylZ(r * 0.045, w * 0.92, 10), M.steel, Math.cos(a) * r * hubR * 0.7, Math.sin(a) * r * hubR * 0.7, 0);
  }
  return g;
}

function mecanum(parent, M, r, w, hand) {
  const g = grp(parent);
  add(g, cylZ(r * 0.8, 0.004, 40), M.alu, 0, 0, w / 2);
  add(g, cylZ(r * 0.8, 0.004, 40), M.alu, 0, 0, -w / 2);
  add(g, cylZ(r * 0.32, w * 0.9, 24), M.satin);
  const n = 10, rr = r * 0.17;
  const rollerGeo = new THREE.CapsuleGeometry(rr, w * 0.7, 4, 12);
  const up = new THREE.Vector3(0, 1, 0);
  for (let k = 0; k < n; k++) {
    const a = (k / n) * 2 * PI;
    const t = new THREE.Vector3(-Math.sin(a), Math.cos(a), 0);
    const axis = t.multiplyScalar(Math.SQRT1_2 * hand).add(new THREE.Vector3(0, 0, Math.SQRT1_2)).normalize();
    const m = add(g, rollerGeo, M.roller, Math.cos(a) * (r - rr), Math.sin(a) * (r - rr), 0);
    m.quaternion.setFromUnitVectors(up, axis);
  }
  return g;
}

function omni(parent, M, r, w) {
  const g = grp(parent);
  add(g, cylZ(r * 0.78, w * 0.7, 36), M.graphite);
  add(g, cylZ(r * 0.3, w * 0.9, 20), M.alu);
  const n = 9, rr = r * 0.16;
  const geo = new THREE.CapsuleGeometry(rr, r * 0.3, 4, 10);
  const up = new THREE.Vector3(0, 1, 0);
  for (const row of [-1, 1])
    for (let k = 0; k < n; k++) {
      const a = (k / n) * 2 * PI + (row > 0 ? PI / n : 0);
      const t = new THREE.Vector3(-Math.sin(a), Math.cos(a), 0);
      const m = add(g, geo, M.rubber, Math.cos(a) * (r - rr), Math.sin(a) * (r - rr), row * w * 0.24);
      m.quaternion.setFromUnitVectors(up, t);
    }
  return g;
}

function pcb(parent, M, w, d, mat, x, y, z, { chips = 3, pins = true } = {}) {
  const g = grp(parent, null, x, y, z);
  add(g, BOX(w, 0.0016, d), mat);
  for (let i = 0; i < chips; i++)
    add(g, BOX(w * (0.12 + rnd() * 0.12), 0.0016, d * (0.15 + rnd() * 0.15)), M.chip, (rnd() - 0.5) * w * 0.6, 0.0016, (rnd() - 0.5) * d * 0.5);
  if (pins) add(g, BOX(w * 0.6, 0.0035, 0.005), M.black, 0, 0.0025, -d / 2 + 0.004);
  return g;
}

function helix(r, h, turns, tubeR) {
  const pts = [];
  const n = turns * 24;
  for (let i = 0; i <= n; i++) {
    const t = i / n, a = t * turns * 2 * PI;
    pts.push(new THREE.Vector3(Math.cos(a) * r, (t - 0.5) * h, Math.sin(a) * r));
  }
  return new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), n, tubeR, 6, false);
}

function wire(parent, mat, pts, r = 0.0012) {
  const curve = new THREE.CatmullRomCurve3(pts.map((p) => new THREE.Vector3(...p)));
  return add(parent, new THREE.TubeGeometry(curve, 24, r, 6, false), mat);
}

/* NACA 4 digit section lofted along the span. Chord runs along negative X from the leading edge. */
function wingGeo({ z0, z1, chord0, chord1, sweep = 0, t = 0.12, m = 0.0, p = 0.4, nc = 26 }) {
  const xs = [];
  for (let i = 0; i <= nc; i++) xs.push(0.5 * (1 - Math.cos((PI * i) / nc)));
  const sec = [];
  const yt = (x) => 5 * t * (0.2969 * Math.sqrt(x) - 0.126 * x - 0.3516 * x * x + 0.2843 * x ** 3 - 0.1036 * x ** 4);
  const yc = (x) => (m === 0 ? 0 : x < p ? (m / (p * p)) * (2 * p * x - x * x) : (m / ((1 - p) ** 2)) * (1 - 2 * p + 2 * p * x - x * x));
  for (let i = nc; i >= 0; i--) sec.push([xs[i], yc(xs[i]) + yt(xs[i])]);
  for (let i = 1; i < nc; i++) sec.push([xs[i], yc(xs[i]) - yt(xs[i])]);
  const L = sec.length;
  const ns = 8;
  const pos = [], idx = [], uv = [];
  for (let j = 0; j <= ns; j++) {
    const f = j / ns, z = z0 + (z1 - z0) * f;
    const c = chord0 + (chord1 - chord0) * f;
    const xle = -sweep * f;
    for (let i = 0; i < L; i++) {
      pos.push(xle - sec[i][0] * c, sec[i][1] * c, z);
      uv.push(i / L, f);
    }
  }
  for (let j = 0; j < ns; j++)
    for (let i = 0; i < L; i++) {
      const a = j * L + i, b = j * L + ((i + 1) % L), c2 = (j + 1) * L + i, d = (j + 1) * L + ((i + 1) % L);
      idx.push(a, c2, b, b, c2, d);
    }
  // end caps: the section loop runs clockwise seen from +Z
  for (const j of [0, ns]) {
    const ci = pos.length / 3;
    let cx = 0, cy = 0;
    for (let i = 0; i < L; i++) { cx += pos[(j * L + i) * 3]; cy += pos[(j * L + i) * 3 + 1]; }
    pos.push(cx / L, cy / L, pos[(j * L) * 3 + 2]);
    uv.push(0.5, 0.5);
    for (let i = 0; i < L; i++) {
      const a = j * L + i, b = j * L + ((i + 1) % L);
      if (j === 0) idx.push(ci, a, b); else idx.push(ci, b, a);
    }
  }
  // a span running toward negative Z mirrors the loft, so flip every triangle back
  if (z1 < z0) for (let i = 0; i < idx.length; i += 3) { const t2 = idx[i + 1]; idx[i + 1] = idx[i + 2]; idx[i + 2] = t2; }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

/* ------------------------------------------------------------------ */
/* GPS satellite                                                       */
/* ------------------------------------------------------------------ */
function buildGPS() {
  const M = materials();
  const root = new THREE.Group();
  const body = grp(root, 'body');
  add(body, RBOX(1.9, 2.2, 1.9, 0.05), M.foil);
  for (const s of [1, -1]) {
    add(body, BOX(1.5, 1.6, 0.03), M.foilSilver, 0, 0.12, s * 0.965);
    add(body, BOX(0.03, 1.2, 1.3), M.foilSilver, s * 0.965, 0.2, 0);
  }
  // Earth facing panel with the L band helix array
  add(body, BOX(1.75, 0.05, 1.75), M.white, 0, -1.12, 0);
  const helixGeo = helix(0.06, 0.34, 6, 0.008);
  const ringN = 10;
  for (let k = 0; k <= ringN; k++) {
    const a = (k / ringN) * 2 * PI;
    const r = k === ringN ? 0 : 0.58;
    const x = Math.cos(a) * r, z = Math.sin(a) * r;
    add(body, CYL(0.075, 0.075, 0.04, 16), M.white, x, -1.16, z);
    add(body, helixGeo, M.white, x, -1.35, z);
    add(body, CYL(0.012, 0.012, 0.34, 8), M.graphite, x, -1.35, z);
  }
  // smaller antennas and a dish
  add(body, CYL(0.05, 0.05, 0.5, 12), M.white, 0.7, -1.38, 0.7);
  add(body, new THREE.LatheGeometry([0, 0.1, 0.2, 0.28].map((r) => new THREE.Vector2(r, r * r * 0.9)), 32), M.white, -0.62, -1.18, 0.62, PI, 0, 0);
  add(body, BOX(0.22, 0.18, 0.22), M.black, 0.55, 1.18, -0.5);
  add(body, CYL(0.05, 0.05, 0.3, 12), M.graphite, -0.6, 1.24, 0.4);
  // solar wings on booms along X
  for (const s of [1, -1]) {
    add(body, cylX(0.04, 0.7, 12), M.alu, s * 1.3, 0.1, 0);
    const wing = grp(root, s > 0 ? 'wingA' : 'wingB', s * 1.62, 0.1, 0);
    for (let p = 0; p < 2; p++) {
      const cx = s * (0.8 + p * 1.52);
      add(wing, BOX(1.46, 0.035, 2.3), M.panelBack, cx, 0, 0);
      add(wing, new THREE.PlaneGeometry(1.42, 2.26).rotateX(-PI / 2), M.solar, cx, 0.024, 0);
      add(wing, new THREE.PlaneGeometry(1.42, 2.26).rotateX(PI / 2), M.solar, cx, -0.024, 0);
    }
    add(wing, BOX(0.06, 0.04, 2.0), M.aluDark, s * 0.05, 0, 0);
  }
  anchor(root, 'a_body', 0.95, 0.4, 0.95);
  optimize(body);
  return root;
}

/* ------------------------------------------------------------------ */
/* AgileX Scout Mini with the Calian payload                           */
/* ------------------------------------------------------------------ */
// fallback base, only used if the CAD file can't load
function scoutStandIn(root, M) {
  const base = grp(root, 'base');
  add(base, RBOX(0.47, 0.075, 0.37, 0.012), M.black, 0, 0.125, 0);
  const prof = new THREE.Shape();
  prof.moveTo(-0.29, 0.0); prof.lineTo(0.29, 0.0); prof.lineTo(0.315, 0.05); prof.lineTo(0.275, 0.098);
  prof.lineTo(-0.275, 0.098); prof.lineTo(-0.315, 0.05); prof.closePath();
  const shellGeo = new THREE.ExtrudeGeometry(prof, { depth: 0.4, bevelEnabled: true, bevelSize: 0.008, bevelThickness: 0.008, bevelSegments: 3, steps: 1 });
  shellGeo.translate(0, 0, -0.2);
  add(base, shellGeo, M.shell, 0, 0.142, 0);
  const coil = helix(0.014, 0.07, 7, 0.0026);
  for (const sx of [1, -1])
    for (const sz of [1, -1]) {
      add(base, BOX(0.12, 0.016, 0.03), M.satin, sx * 0.18, 0.1, sz * 0.2);
      const c = add(base, coil, M.red, sx * 0.15, 0.13, sz * 0.205);
      c.rotation.z = sx * 0.5;
    }
  optimize(base);
  [[0.226, 0.226], [0.226, -0.226], [-0.226, 0.226], [-0.226, -0.226]].forEach(([x, z], i) => {
    const w = grp(root, 'wheel' + i, x, 0.085, z);
    const t = tire(w, M, 0.085, 0.08, { lugs: 18, knob: 0.0055 });
    if (z < 0) t.rotation.y = PI;
    optimize(w);
  });
}

function buildScout(lod = 'hi') {
  const M = materials();
  const root = new THREE.Group();
  // the base: the AgileX CAD, with the wheels as their own nodes so they can turn
  const cad = cadScene('scout', lod);
  if (cad) root.add(cad.clone(true));
  else scoutStandIn(root, M);

  // the payload I build on top of it, sized from photos of the real robot
  const y0 = 0.25;                                     // top of the base's mounting rails
  const bx = 0.015, BL = 0.37, BW = 0.3, BH = 0.066, LH = 0.03;
  const yt = y0 + BH + LH;                             // top of the lid
  const box = grp(root, 'payload', bx, y0 + BH / 2, 0);
  add(box, RBOX(BL, BH, BW, 0.022, 4), M.white, 0, 0, 0);
  add(box, BOX(BL - 0.03, 0.003, BW - 0.03), M.satin, 0, BH / 2 - 0.001, 0);
  const lid = grp(root, 'lid', bx, y0 + BH + LH / 2, 0);
  add(lid, RBOX(BL, LH, BW, 0.014, 4), M.white, 0, 0, 0);
  for (const [sx, sz] of [[1, 1], [1, -1], [-1, 1], [-1, -1]]) add(lid, CYL(0.004, 0.004, 0.002, 10), M.steel, sx * (BL / 2 - 0.02), LH / 2 + 0.0005, sz * (BW / 2 - 0.02));

  // inside: the Raspberry Pi, and the IMU in the back right corner
  const inside = grp(root, 'inside', bx, y0 + BH - 0.008, 0);
  const pi = pcb(inside, M, 0.085, 0.056, M.greenPCB, 0.04, 0, -0.03, { chips: 3 });
  add(pi, BOX(0.017, 0.016, 0.013), M.steel, 0.034, 0.008, -0.012);
  add(pi, BOX(0.017, 0.016, 0.013), M.steel, 0.034, 0.008, 0.008);
  add(pi, BOX(0.021, 0.013, 0.016), M.steel, 0.034, 0.007, 0.024);
  add(pi, BOX(0.014, 0.0012, 0.014), M.alu, -0.01, 0.0016, 0.004);
  const imu = pcb(inside, M, 0.026, 0.022, M.navyPCB, -0.14, 0, 0.105, { chips: 1, pins: false });
  add(imu, BOX(0.006, 0.002, 0.006), M.chip, 0, 0.0018, 0);
  wire(inside, M.wire[0], [[-0.13, 0.003, 0.098], [-0.06, 0.012, 0.05], [0.02, 0.004, -0.02]]);
  wire(inside, M.wire[2], [[-0.13, 0.003, 0.102], [-0.05, 0.014, 0.045], [0.02, 0.004, -0.024]]);
  anchor(inside, 'a_pi', 0.04, 0.01, -0.03);
  anchor(inside, 'a_imu', -0.14, 0.006, 0.105);

  // two GNSS antennas, front and back on the center line, in white housings like the real ones
  const ant = (name, x, z) => {
    const a = grp(root, name, x, yt, z);
    add(a, CYL(0.047, 0.049, 0.064, 40), M.white, 0, 0.032, 0);
    add(a, CYL(0.049, 0.049, 0.004, 40), M.alu, 0, 0.066, 0);
    add(a, SPH(0.04, 40, 20).scale(1, 0.42, 1), M.dome, 0, 0.068, 0);
    add(a, CYL(0.0035, 0.0035, 0.016, 8), M.satin, 0.046, 0.06, 0);
    wire(a, M.wire[3], [[0.047, 0.062, 0], [0.058, 0.05, 0.012], [0.05, 0.02, 0.03]], 0.0018);
    anchor(a, 'a_' + name, 0, 0.09, 0);
    return a;
  };
  ant('antA', 0.137, 0);
  ant('antB', -0.107, 0);
  // radio stub antenna in the middle of the lid
  const stub = grp(root, 'stub', bx, yt, 0);
  add(stub, CYL(0.006, 0.006, 0.008, 12), M.satin, 0, 0.004, 0);
  add(stub, CYL(0.0035, 0.0028, 0.045, 10), M.black, 0, 0.03, 0);

  // depth camera low on the front of the box, centered under the front antenna
  const cam = grp(root, 'camera', bx + BL / 2 + 0.013, y0 + 0.017, 0);
  add(cam, RBOX(0.026, 0.029, 0.124, 0.006), M.aluDark, 0, 0, 0);
  add(cam, BOX(0.002, 0.022, 0.112), M.lens, 0.0135, 0, 0);
  for (const z of [-0.047, 0.047]) add(cam, cylX(0.0075, 0.004, 20), M.chip, 0.015, 0, z);
  add(cam, cylX(0.004, 0.004, 16), M.chip, 0.015, 0, -0.018);
  add(cam, cylX(0.005, 0.004, 16), M.chip, 0.015, 0, 0.012);
  anchor(cam, 'a_cam', 0.016, 0, 0);

  // flag mast on the back left corner
  const mast = grp(root, 'mast', -0.235, 0.226, -0.14);
  add(mast, CYL(0.012, 0.014, 0.03, 16), M.collar, 0, 0.015, 0);
  add(mast, CYL(0.005, 0.006, 0.6, 10), M.mast, 0, 0.33, 0);
  const flagGeo = new THREE.PlaneGeometry(0.17, 0.1, 12, 2);
  flagGeo.translate(-0.085, 0, 0);
  const pa = flagGeo.attributes.position;
  for (let i = 0; i < pa.count; i++) {
    const x = pa.getX(i);
    pa.setY(i, pa.getY(i) * (1 + x / 0.17));
  }
  const flag = add(mast, flagGeo, M.flag, 0, 0.58, 0, 0, 0, 0, 'flag');
  flag.userData.base = Float32Array.from(pa.array);
  mast.rotation.z = 0.05;

  optimize(box); optimize(lid); optimize(inside); optimize(cam);
  return root;
}

/* ------------------------------------------------------------------ */
/* Queen's Knights Robotics infantry robot                             */
/* ------------------------------------------------------------------ */
// a mecanum wheel closer to the real ones: two drilled hub plates and twelve barrel rollers at 45 degrees
function mecanumHD(parent, M, r, w, hand) {
  const g = grp(parent);
  const plate = new THREE.Shape();
  plate.absarc(0, 0, r * 0.74, 0, 2 * PI, false);
  for (let k = 0; k < 6; k++) {
    const a = (k / 6) * 2 * PI, hole = new THREE.Path();
    hole.absarc(Math.cos(a) * r * 0.45, Math.sin(a) * r * 0.45, r * 0.13, 0, 2 * PI, true);
    plate.holes.push(hole);
  }
  const hub = new THREE.Path(); hub.absarc(0, 0, r * 0.16, 0, 2 * PI, true); plate.holes.push(hub);
  const plateGeo = new THREE.ExtrudeGeometry(plate, { depth: 0.004, bevelEnabled: true, bevelSize: 0.0012, bevelThickness: 0.0012, bevelSegments: 1, curveSegments: 28 });
  plateGeo.translate(0, 0, -0.002);
  for (const s of [1, -1]) add(g, plateGeo, M.alu, 0, 0, s * w * 0.42);
  add(g, cylZ(r * 0.17, w * 0.95, 24), M.aluDark);
  add(g, cylZ(r * 0.08, w * 1.02, 16), M.steel);
  const n = 12, rr = r * 0.17;
  const prof = [];
  for (let k = 0; k <= 10; k++) {
    const t = k / 10 - 0.5;
    prof.push(new THREE.Vector2(rr * (1 - 0.45 * (2 * t) ** 2) + 0.0006, t * w * 0.62));
  }
  const rollerGeo = new THREE.LatheGeometry(prof, 14);
  const up = new THREE.Vector3(0, 1, 0);
  for (let k = 0; k < n; k++) {
    const a = (k / n) * 2 * PI;
    const t = new THREE.Vector3(-Math.sin(a), Math.cos(a), 0);
    const axis = t.multiplyScalar(Math.SQRT1_2 * hand).add(new THREE.Vector3(0, 0, Math.SQRT1_2)).normalize();
    const m = add(g, rollerGeo, M.roller, Math.cos(a) * (r - rr), Math.sin(a) * (r - rr), 0);
    m.quaternion.setFromUnitVectors(up, axis);
  }
  return g;
}

// a plate outline with chamfered corners, in the XY plane
function chamferShape(w, h, c) {
  const s = new THREE.Shape();
  s.moveTo(-w / 2 + c, -h / 2); s.lineTo(w / 2 - c, -h / 2); s.lineTo(w / 2, -h / 2 + c); s.lineTo(w / 2, h / 2 - c);
  s.lineTo(w / 2 - c, h / 2); s.lineTo(-w / 2 + c, h / 2); s.lineTo(-w / 2, h / 2 - c); s.lineTo(-w / 2, -h / 2 + c); s.closePath();
  return s;
}

// the team's Hero robot, from the Onshape CAD; the pitch head is moved under the yaw turret so it turns with it
function buildQKRT(lod = 'hi') {
  const cad = cadScene('qkrt', lod);
  if (!cad) return qkrtStandIn();
  const root = new THREE.Group();
  const m = cad.clone(true);
  root.add(m);
  const node = (n) => m.getObjectByName(n);
  const yaw = node('yaw'), pitch = node('pitch');
  if (yaw && pitch && pitch.parent !== yaw) yaw.attach(pitch);
  for (const [name, on, x, y, z] of QKRT_ANCHORS) anchor(node(on) || m, name, x, y, z);
  return root;
}
// callout anchors, in the space of the part they ride on: [anchor, part, x, y, z]
const QKRT_ANCHORS = [
  ['a_armor', 'armorF', 0.37, 0.15, 0],           // the front armor module
  ['a_speed', 'pitch', 0.275, -0.01, 0],          // the speed monitor at the muzzle
  ['a_pitchmotor', 'pitch', 0, 0, -0.11],         // the motor that tilts the launcher
  ['a_yawgear', 'base', 0, 0.25, 0.107],          // the motor and pinion that turn the turret
  ['a_power', 'power', -0.124, 0.25, 0.006],      // the battery
];

// a stand in built from primitives, only used if the CAD file can't load
function qkrtStandIn() {
  const M = materials();
  const root = new THREE.Group();
  const gun = M.gunmetal;
  const chassis = grp(root, 'chassis');
  // lower deck and side rails, with lightening slots
  add(chassis, BOX(0.4, 0.008, 0.29), gun, 0, 0.066, 0);
  for (const s of [1, -1]) {
    add(chassis, BOX(0.44, 0.034, 0.008), gun, 0, 0.088, s * 0.146);
    for (let i = 0; i < 7; i++) add(chassis, RBOX(0.032, 0.013, 0.0024, 0.0011, 2), M.chip, -0.15 + i * 0.05, 0.088, s * 0.1505);
  }
  // wheel forks, a triangular plate either side of every wheel, with the suspension beside them
  const tri = new THREE.Shape();
  tri.moveTo(-0.075, 0.07); tri.lineTo(0.075, 0.07); tri.lineTo(0.014, -0.012); tri.lineTo(-0.014, -0.012); tri.closePath();
  const triHole = new THREE.Path(); triHole.absarc(0, 0.035, 0.016, 0, 2 * PI, true); tri.holes.push(triHole);
  const triGeo = new THREE.ExtrudeGeometry(tri, { depth: 0.006, bevelEnabled: true, bevelSize: 0.001, bevelThickness: 0.001, bevelSegments: 1, curveSegments: 16 });
  triGeo.translate(0, 0, -0.003);
  const WH = [[0.17, 0.235, 1], [0.17, -0.235, -1], [-0.17, 0.235, -1], [-0.17, -0.235, 1]];
  const coil = helix(0.0115, 0.056, 8, 0.0016);
  for (const [x, z] of WH) {
    const sx = Math.sign(x), sz = Math.sign(z);
    for (const dz of [-0.036, 0.036]) add(chassis, triGeo, M.aluDark, x, 0.076, z + dz);
    // two suspension arms from the side rail out to the fork
    for (const dx of [-0.032, 0.032]) add(chassis, BOX(0.012, 0.012, 0.088), M.aluDark, x + dx, 0.128, z - sz * 0.052);
    // coil over shock from the fork up to the body
    const shock = grp(chassis, null, x - sx * 0.07, 0.15, z - sz * 0.05);
    shock.rotation.z = sx * 0.22;
    add(shock, CYL(0.0055, 0.0055, 0.088, 12), M.black);
    add(shock, coil, M.alu, 0, -0.006, 0);
    add(shock, CYL(0.012, 0.012, 0.01, 18), M.alu, 0, 0.03, 0);
    add(shock, CYL(0.009, 0.009, 0.02, 14), M.black, 0, 0.04, 0);
    add(shock, cylZ(0.006, 0.016, 12), M.steel, 0, -0.046, 0);
    // louvered motor cover inboard of the wheel
    const mc = grp(chassis, null, x - sx * 0.085, 0.052, z - sz * 0.062);
    add(mc, RBOX(0.07, 0.04, 0.028, 0.003, 2), M.alu, 0, 0, 0);
    for (let i = 0; i < 7; i++) add(mc, BOX(0.0035, 0.03, 0.002), M.chip, -0.027 + i * 0.009, 0, sz * 0.0142);
  }
  // upper body: dark box with vertical vents, the blue inside showing through
  const body = grp(chassis, null, 0, 0.16, 0);
  add(body, RBOX(0.38, 0.09, 0.3, 0.006, 2), M.graphite, 0, 0, 0);
  for (const s of [1, -1]) {
    for (let i = 0; i < 21; i++) add(body, BOX(0.0062, 0.058, 0.003), M.navyPCB, -0.157 + i * 0.0157, 0.004, s * 0.1503);
    for (let i = 0; i < 15; i++) add(body, BOX(0.003, 0.058, 0.0062), M.navyPCB, s * 0.1903, 0.004, -0.115 + i * 0.0164);
    for (const t of [1, -1]) add(body, BOX(0.03, 0.012, 0.014), M.alu, s * 0.178, 0.044, t * 0.136);
    // light bar along the top of each side
    const lb = grp(body, null, 0.03, 0.03, s * 0.158);
    lb.rotation.x = s * 0.42;
    add(lb, RBOX(0.25, 0.024, 0.026, 0.01, 3), M.lightbar, 0, 0, 0);
    add(lb, RBOX(0.262, 0.03, 0.016, 0.006, 2), M.black, 0, -0.002, -s * 0.008);
  }
  add(body, BOX(0.36, 0.006, 0.28), M.matte, 0, 0.0485, 0);

  // the yaw drive: a big ring gear on the top plate, belted to a motor pulley at the back
  const ringY = 0.218;
  add(chassis, CYL(0.088, 0.088, 0.01, 64), M.black, 0.02, ringY, 0);
  for (let k = 0; k < 64; k++) {
    const a = (k / 64) * 2 * PI;
    const tth = add(chassis, BOX(0.005, 0.01, 0.004), M.black, 0.02 + Math.cos(a) * 0.09, ringY, Math.sin(a) * 0.09);
    tth.rotation.y = -a;
  }
  const pc = [-0.115, 0.098];
  add(chassis, CYL(0.026, 0.026, 0.02, 32), M.alu, pc[0], ringY + 0.004, pc[1]);
  for (const dy of [-0.008, 0.016]) add(chassis, CYL(0.031, 0.031, 0.003, 32), M.alu, pc[0], ringY + dy, pc[1]);
  add(chassis, CYL(0.022, 0.022, 0.03, 24), M.black, pc[0], ringY - 0.02, pc[1]);
  {
    const c1 = new THREE.Vector2(0.02, 0), c2 = new THREE.Vector2(pc[0], pc[1]);
    const d = c2.clone().sub(c1), L = d.length(), u = d.clone().divideScalar(L);
    for (const s of [1, -1]) {
      const n = new THREE.Vector2(-u.y * s, u.x * s);
      const p1 = c1.clone().addScaledVector(n, 0.091), p2 = c2.clone().addScaledVector(n, 0.028);
      const mid = p1.clone().add(p2).multiplyScalar(0.5), len = p1.distanceTo(p2);
      const belt = add(chassis, BOX(len, 0.012, 0.0025), M.black, mid.x, ringY + 0.004, mid.y);
      belt.rotation.y = -Math.atan2(p2.y - p1.y, p2.x - p1.x);
    }
  }

  // battery and the referee power module, inside the body, lifted out in the power step
  const power = grp(root, 'power', -0.09, 0.168, -0.05);
  add(power, RBOX(0.15, 0.042, 0.075, 0.006), M.black, 0, 0, 0);
  for (let i = 0; i < 5; i++) add(power, BOX(0.008, 0.004, 0.004), M.ledBlue, -0.02 + i * 0.012, 0.022, 0.03);
  add(power, CYL(0.006, 0.006, 0.004, 14), M.ledRed, 0.05, 0.022, 0.03);
  const pm = grp(power, null, 0.06, 0.002, 0.095);
  add(pm, RBOX(0.075, 0.026, 0.055, 0.003), M.black, 0, 0, 0);
  for (let i = 0; i < 6; i++) add(pm, BOX(0.07, 0.006, 0.003), M.graphite, 0, 0.015, -0.02 + i * 0.008);
  wire(power, M.wire[0], [[0.075, 0.0, 0.02], [0.09, 0.03, 0.06], [0.07, 0.01, 0.095]], 0.0022);
  wire(power, M.wire[3], [[0.075, -0.006, 0.02], [0.1, 0.02, 0.058], [0.08, 0.004, 0.09]], 0.0022);
  anchor(power, 'a_power', 0, 0.03, 0);

  const wheels = [];
  WH.forEach(([x, z, h], i) => {
    const w = grp(root, 'wheel' + i, x, 0.076, z);
    mecanumHD(w, M, 0.076, 0.05, h);
    wheels.push(w);
  });

  // armor modules on four sides: black plates with an orange edge and a dark screen, tilted out at the bottom
  const plateGeo = new THREE.ExtrudeGeometry(chamferShape(0.135, 0.112, 0.012), { depth: 0.008, bevelEnabled: true, bevelSize: 0.0015, bevelThickness: 0.0015, bevelSegments: 2 });
  plateGeo.translate(0, 0, -0.004).rotateY(PI / 2);
  const edgeGeo = new THREE.ExtrudeGeometry(chamferShape(0.143, 0.12, 0.014), { depth: 0.004, bevelEnabled: false });
  edgeGeo.translate(0, 0, -0.002).rotateY(PI / 2);
  const screenGeo = new THREE.ExtrudeGeometry(chamferShape(0.094, 0.06, 0.006), { depth: 0.002, bevelEnabled: false });
  screenGeo.rotateY(PI / 2);
  const armorPlate = (name, x, z, ry) => {
    const a = grp(root, name, x, 0.128, z);
    a.rotation.y = ry;
    const tilt = grp(a);
    tilt.rotation.z = 0.22;
    add(tilt, edgeGeo, M.orange, -0.004, 0, 0);
    add(tilt, plateGeo, M.black, 0, 0, 0);
    add(tilt, screenGeo, M.screenDark, 0.0058, 0.004, 0);
    for (const [py, pz] of [[0.044, 0.056], [0.044, -0.056], [-0.044, 0.056], [-0.044, -0.056]]) add(tilt, cylX(0.0028, 0.002, 10), M.steel, 0.006, py, pz);
    add(a, BOX(0.036, 0.012, 0.05), M.aluDark, -0.024, -0.045, 0);
    return a;
  };
  armorPlate('armorF', 0.236, 0, 0);
  armorPlate('armorB', -0.236, 0, PI);
  armorPlate('armorR', 0, 0.198, -PI / 2);
  armorPlate('armorL', 0, -0.198, PI / 2);
  anchor(root, 'a_armor', 0.25, 0.15, 0);

  // gimbal: printed blue base, tall plate column, and the pitch head with camera and launcher
  const yaw = grp(root, 'yaw', 0.02, ringY + 0.005, 0);
  add(yaw, CYL(0.056, 0.06, 0.022, 40), M.blue, 0, 0.011, 0);
  add(yaw, RBOX(0.1, 0.05, 0.12, 0.01, 3), M.blue, -0.012, 0.046, 0);
  const colShape = new THREE.Shape();
  colShape.moveTo(-0.045, 0); colShape.lineTo(0.04, 0); colShape.lineTo(0.03, 0.2); colShape.absarc(0, 0.205, 0.03, 0, PI, false); colShape.lineTo(-0.045, 0);
  const colHole = new THREE.Path(); colHole.absarc(-0.004, 0.13, 0.017, 0, 2 * PI, true); colShape.holes.push(colHole);
  const colGeo = new THREE.ExtrudeGeometry(colShape, { depth: 0.008, bevelEnabled: true, bevelSize: 0.0015, bevelThickness: 0.0015, bevelSegments: 1, curveSegments: 20 });
  colGeo.translate(0, 0, -0.004);
  for (const s of [1, -1]) add(yaw, colGeo, gun, 0, 0.06, s * 0.047);
  add(yaw, cylZ(0.042, 0.006, 40), M.aluDark, -0.002, 0.2, 0);
  for (let k = 0; k < 6; k++) { const a = (k / 6) * 2 * PI; add(yaw, cylZ(0.006, 0.0068, 12), M.chip, -0.002 + Math.cos(a) * 0.026, 0.2 + Math.sin(a) * 0.026, 0); }
  add(yaw, RBOX(0.05, 0.07, 0.07, 0.012, 3), M.blue, 0.035, 0.085, 0);
  // referee main control module on the back of the base
  const main = grp(yaw, 'mainctl', -0.075, 0.03, 0);
  add(main, RBOX(0.05, 0.03, 0.08, 0.004), M.black, 0, 0, 0);
  add(main, BOX(0.002, 0.018, 0.05), M.screen, -0.026, 0.002, 0);
  anchor(yaw, 'a_main', -0.08, 0.05, 0);
  // video transmitter antenna
  add(yaw, CYL(0.0025, 0.0025, 0.06, 8), M.black, -0.07, 0.09, 0.04);

  const pitch = grp(yaw, 'pitch', 0, 0.272, 0);
  add(pitch, RBOX(0.1, 0.05, 0.075, 0.006, 3), gun, -0.01, 0, 0);
  // slotted feed cage in the middle
  const cage = grp(pitch, null, 0.035, 0.002, 0);
  for (const s of [1, -1]) {
    add(cage, BOX(0.1, 0.056, 0.0035), M.alu, 0, 0, s * 0.04);
    for (let i = 0; i < 6; i++) add(cage, RBOX(0.007, 0.04, 0.004, 0.0025, 2), M.chip, -0.035 + i * 0.014, 0, s * 0.0402);
  }
  for (const dy of [-0.029, 0.029]) add(cage, BOX(0.1, 0.003, 0.084), M.alu, 0, dy, 0);
  for (const [dx, dz] of [[0.048, 0.04], [0.048, -0.04], [-0.048, 0.04], [-0.048, -0.04]]) add(cage, CYL(0.0032, 0.0032, 0.064, 10), M.steel, dx, 0, dz);
  // blue cover on top
  const cover = new THREE.Shape();
  cover.moveTo(-0.07, 0); cover.lineTo(0.05, 0); cover.lineTo(0.035, 0.03); cover.lineTo(-0.05, 0.034); cover.closePath();
  const coverGeo = new THREE.ExtrudeGeometry(cover, { depth: 0.07, bevelEnabled: true, bevelSize: 0.003, bevelThickness: 0.003, bevelSegments: 2 });
  coverGeo.translate(0, 0, -0.035);
  add(pitch, coverGeo, M.blue, 0.01, 0.033, 0);
  // aiming camera at the front
  const camg = grp(pitch, null, 0.115, 0.004, 0);
  add(camg, RBOX(0.06, 0.066, 0.078, 0.007, 3), M.black, 0, 0, 0);
  add(camg, cylX(0.031, 0.008, 36), M.aluDark, 0.032, 0, 0);
  add(camg, cylX(0.026, 0.014, 36), M.lens, 0.036, 0, 0);
  add(camg, cylX(0.015, 0.004, 28), M.glass, 0.044, 0, 0);
  for (const s2 of [1, -1]) add(camg, BOX(0.05, 0.006, 0.004), M.alu, 0, s2 * 0.036, 0.04);
  add(camg, RBOX(0.034, 0.012, 0.04, 0.003), M.blue, -0.004, 0.039, 0);
  // the launcher barrel under the camera, with the speed monitor on it
  add(pitch, cylX(0.0135, 0.11, 24), M.alu, 0.13, -0.04, 0);
  add(pitch, cylX(0.017, 0.012, 24), M.aluDark, 0.186, -0.04, 0);
  const speed = grp(pitch, 'speed', 0.155, -0.04, 0);
  add(speed, RBOX(0.03, 0.034, 0.034, 0.004), M.black, 0, 0, 0);
  anchor(pitch, 'a_speed', 0.16, -0.022, 0);
  // the long drum at the back
  add(pitch, cylX(0.03, 0.16, 40), gun, -0.14, 0.002, 0);
  add(pitch, cylX(0.031, 0.01, 40), M.alu, -0.222, 0.002, 0);
  add(pitch, cylX(0.016, 0.004, 24), M.chip, -0.228, 0.002, 0);
  // a thin antenna rod along the top
  add(pitch, cylX(0.0016, 0.46, 8), M.black, 0.02, 0.078, 0.028);
  for (const dx of [-0.21, 0.25]) add(pitch, SPH(0.004, 10, 8), M.black, dx, 0.078, 0.028);

  optimize(chassis); optimize(power); wheels.forEach(optimize);
  ['armorF', 'armorB', 'armorL', 'armorR'].forEach((n) => optimize(root.getObjectByName(n)));
  optimize(pitch); optimize(main); optimize(yaw);
  return root;
}

// the team's banner, as in pictures/plane-banner.jpg: the Queen's crest and wordmark in red on grey,
// redrawn once the crest has loaded
let bannerMat = null;
function bannerMaterial() {
  if (bannerMat) return bannerMat;
  const c = document.createElement('canvas');
  c.width = 1024; c.height = 205;
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  // the close up looks at the banner's back face, so mirror it to read the right way round
  tex.wrapS = THREE.RepeatWrapping;
  tex.repeat.x = -1;
  const crest = new Image();
  const serif = 'Georgia, "Times New Roman", Times, serif';
  const draw = () => {
    const g = c.getContext('2d');
    const W = c.width, H = c.height;
    g.fillStyle = '#b4b5b7';
    g.fillRect(0, 0, W, H);
    const word = 'Queen\u2019s', small = 'UNIVERSITY';
    const big = Math.round(H * 0.58), sm = Math.round(H * 0.15), track = sm * 0.16;
    g.font = `400 ${big}px ${serif}`;
    const wordW = g.measureText(word).width;
    g.font = `700 ${sm}px ${serif}`;
    const smallW = [...small].reduce((a, ch) => a + g.measureText(ch).width, 0) + track * (small.length - 1);
    // crest on the left, the wordmark beside it, the pair centered
    const crestH = H * 0.74, crestW = (crestH * 173) / 192, gap = H * 0.11;
    const x0 = (W - (crestW + gap + Math.max(wordW, smallW))) / 2;
    if (crest.naturalWidth) g.drawImage(crest, x0, (H - crestH) / 2, crestW, crestH);
    const tx = x0 + crestW + gap;
    g.fillStyle = '#b90e31';
    g.textAlign = 'left';
    g.textBaseline = 'alphabetic';
    g.font = `400 ${big}px ${serif}`;
    g.fillText(word, tx, H * 0.6);
    // UNIVERSITY, spaced out and lined up under the end of Queen's
    g.font = `700 ${sm}px ${serif}`;
    let x = tx + wordW - smallW;
    for (const ch of small) { g.fillText(ch, x, H * 0.85); x += g.measureText(ch).width + track; }
    tex.needsUpdate = true;
  };
  crest.onload = draw;
  crest.src = 'pictures/QueensCrest.png';
  draw();
  bannerMat = new THREE.MeshStandardMaterial({ map: tex, roughness: 0.8, side: THREE.DoubleSide, transparent: true });
  return bannerMat;
}

/* ------------------------------------------------------------------ */
/* Queen's Aerospace Design Team banner towing plane                   */
/* ------------------------------------------------------------------ */
function buildPlane() {
  const M = materials();
  const root = new THREE.Group();
  const air = grp(root, 'airframe');
  const skin = M.carbonPlane;
  // fuselage, a lathe around the X axis, nose at +X
  const prof = [
    [0, 0.62], [0.018, 0.61], [0.034, 0.585], [0.05, 0.55], [0.062, 0.5], [0.07, 0.44], [0.074, 0.36],
    [0.075, 0.25], [0.074, 0.12], [0.07, 0.04], [0.062, -0.04], [0.048, -0.12], [0.034, -0.22], [0.025, -0.34],
    [0.02, -0.44], [0.017, -0.5], [0, -0.505],
  ];
  const v2 = (arr) => arr.map(([r, y]) => new THREE.Vector2(r, y));
  const nose = prof.filter((p) => p[1] >= 0.36);
  const mid = prof.filter((p) => p[1] <= 0.36 && p[1] >= 0.12);
  const tail = prof.filter((p) => p[1] <= 0.12);
  // lathe profiles must run from tail to nose (rising y) or the normals point inward
  const lathe = (pts, a0 = 0, len = 2 * PI) => new THREE.LatheGeometry(v2(pts.slice().sort((p, q) => p[1] - q[1])), 48, a0, len).rotateZ(-PI / 2);
  const gap = 0.75;
  add(air, lathe(nose), skin);
  add(air, lathe(tail), skin);
  add(air, lathe(mid, 1.5 * PI + gap, 2 * PI - 2 * gap), skin);
  add(air, lathe(mid.map(([r, y]) => [r * 0.94, y]), 0, 2 * PI), M.cabin);
  add(air, BOX(0.24, 0.004, 0.09), M.graphite, 0.24, -0.02, 0);
  // the cabin hatch swings open on a hinge along its left edge
  const hatch = grp(root, 'hatch', 0, 0.0545, -0.0505);
  const hatchSkin = grp(hatch, null, 0, -0.0545, 0.0505);
  add(hatchSkin, lathe(mid, 1.5 * PI - gap, 2 * gap), skin);
  add(hatchSkin, BOX(0.245, 0.003, 0.004), M.black, 0.24, 0.0525, 0.051);
  add(hatchSkin, BOX(0.245, 0.003, 0.004), M.black, 0.24, 0.0525, -0.051);
  // passengers: nine rubber ducks and three pucks, in rows
  const cargo = grp(root, 'cargo');
  const duck = makeDuck(M, 0.0125);
  for (let i = 0; i < 9; i++) {
    const d = duck.clone();
    d.position.set(0.2 + (i % 3) * 0.058, -0.018, ((i / 3) | 0) * 0.034 - 0.034);
    d.rotation.y = (i % 2 ? 0.25 : -0.2);
    cargo.add(d);
  }
  for (let i = 0; i < 3; i++) add(cargo, CYL(0.019, 0.019, 0.0127, 24), M.puck, 0.145, -0.012, (i - 1) * 0.034);

  // wing: mid wing, 1.5 m span, slight taper
  const wingMat = skin;
  for (const s of [1, -1]) {
    add(air, wingGeo({ z0: 0, z1: s * 0.75, chord0: 0.42, chord1: 0.33, sweep: 0.03, t: 0.12, m: 0.04, p: 0.4 }), wingMat, 0.32, -0.005, 0);
    // control surface lines on the top skin
    for (const [za, zb] of [[0.12, 0.42], [0.43, 0.7]]) {
      const zm = (za + zb) / 2, c = 0.42 + (0.33 - 0.42) * (zm / 0.75), xh = 0.32 - 0.03 * (zm / 0.75) - 0.74 * c;
      add(air, BOX(0.003, 0.003, zb - za), M.black, xh, -0.005 + 0.052 * c * 0.9, s * zm);
      add(air, BOX(0.24 * c, 0.003, 0.003), M.black, xh - 0.13 * c, -0.005 + 0.04 * c, s * za);
      add(air, BOX(0.24 * c, 0.003, 0.003), M.black, xh - 0.13 * c, -0.005 + 0.04 * c, s * zb);
    }
  }
  // tail: horizontal stabilizer and fin
  for (const s of [1, -1]) add(air, wingGeo({ z0: 0, z1: s * 0.4, chord0: 0.15, chord1: 0.12, sweep: 0.02, t: 0.12 }), wingMat, -0.355, 0.006, 0);
  const fin = wingGeo({ z0: 0, z1: 0.21, chord0: 0.17, chord1: 0.085, sweep: 0.08, t: 0.1 });
  fin.rotateX(-PI / 2);
  add(air, fin, wingMat, -0.33, 0.012, 0);
  add(air, BOX(0.003, 0.003, 0.75), M.black, -0.47, 0.012, 0);

  // twin motors on the leading edge with props
  const props = [];
  for (const s of [1, -1]) {
    const z = s * 0.3;
    add(air, cylX(0.024, 0.05, 28), M.motorGold, 0.35, -0.012, z);
    add(air, cylX(0.026, 0.008, 28), M.satin, 0.322, -0.012, z);
    const prop = grp(root, s > 0 ? 'propA' : 'propB', 0.385, -0.012, z);
    add(prop, new THREE.ConeGeometry(0.014, 0.03, 20).rotateZ(-PI / 2), M.satin, 0.01, 0, 0);
    for (const b of [0, PI]) {
      const blade = add(prop, SPH(1, 16, 8).scale(0.006, 0.07, 0.016), M.black, 0, 0, 0);
      blade.rotation.x = b;
      blade.position.set(0, Math.cos(b) * 0.07, Math.sin(b) * 0.07);
      blade.rotation.y = 0.25;
    }
    const disc = add(prop, new THREE.CircleGeometry(0.14, 40).rotateY(PI / 2), M.poly, 0.002, 0, 0, 0, 0, 0, 'disc');
    disc.material = M.poly;
    props.push(prop);
  }
  // banner: stowed roll under the fuselage, tow lines, the banner itself
  const roll = grp(root, 'roll', -0.12, -0.07, 0);
  add(roll, cylZ(0.012, 0.09, 16), M.white, 0, 0, 0);
  const banner = grp(root, 'banner', -0.5, -0.02, 0);
  const bGeo = new THREE.PlaneGeometry(1.5, 0.3, 40, 4);
  bGeo.translate(-0.75, 0, 0);
  const bMesh = add(banner, bGeo, bannerMaterial(), 0, 0, 0, 0, 0, 0, 'bannerCloth');
  bMesh.userData.base = Float32Array.from(bGeo.attributes.position.array);
  const towGeo = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3()]);
  const tow = new THREE.LineSegments(towGeo, new THREE.LineBasicMaterial({ color: 0xcfd3d8, transparent: true, opacity: 0.9 }));
  tow.name = 'tow';
  root.add(tow);
  anchor(root, 'a_motor', 0.4, -0.012, 0.3);
  anchor(root, 'a_wing', -0.02, 0.01, -0.68);
  anchor(root, 'a_cabin', 0.24, 0.07, 0);
  anchor(root, 'a_tail', -0.48, 0.15, 0);
  anchor(root, 'a_banner', -1.2, -0.02, 0);
  optimize(air); optimize(hatchSkin); optimize(cargo); optimize(roll);
  return root;
}

function makeDuck(M, s = 0.02) {
  const d = new THREE.Group();
  add(d, SPH(s, 20, 14).scale(1.3, 0.85, 1.0), M.duck, 0, s * 0.85, 0);
  add(d, SPH(s * 0.62, 18, 12), M.duck, s * 0.55, s * 1.75, 0);
  add(d, SPH(s * 0.3, 12, 8).scale(1.4, 0.45, 1.0), M.beak, s * 1.12, s * 1.62, 0);
  for (const z of [-1, 1]) add(d, SPH(s * 0.09, 8, 6), M.eye, s * 0.95, s * 1.95, z * s * 0.3);
  add(d, new THREE.ConeGeometry(s * 0.35, s * 0.6, 10).rotateZ(PI / 2.8), M.duck, -s * 1.2, s * 1.2, 0);
  optimize(d);
  return d;
}

/* ------------------------------------------------------------------ */
/* FIRST Global robot, from the team's CAD                             */
/* ------------------------------------------------------------------ */
function buildFGC(lod = 'hi') {
  const cad = cadScene('fgc', lod);
  if (!cad) return fgcStandIn();
  const root = new THREE.Group();
  const m = cad.clone(true);
  root.add(m);
  const node = (n) => m.getObjectByName(n) || m;
  // anchors for the callouts ride on the parts they point at
  anchor(node('intake'), 'a_intake', 0.03, 0.01, 0.12);
  anchor(node('arms'), 'a_arms', -0.47, 0.41, 0.09);
  anchor(node('hubR'), 'a_hub', 0.08, 0.34, 0.205);
  return root;
}

// a simple stand in from REV style parts, only used if the CAD file can't load
function fgcStandIn() {
  const M = materials();
  const root = new THREE.Group();
  const frame = grp(root, 'frame');
  const ext = (len, axis, x, y, z) => {
    const g = axis === 'x' ? BOX(len, 0.015, 0.015) : axis === 'y' ? BOX(0.015, len, 0.015) : BOX(0.015, 0.015, len);
    add(frame, g, M.alu, x, y, z);
    const s = axis === 'x' ? BOX(len, 0.003, 0.0155) : axis === 'y' ? BOX(0.003, len, 0.0155) : BOX(0.0155, 0.003, len);
    add(frame, s, M.aluDark, x, y, z);
  };
  for (const s of [1, -1]) {
    ext(0.44, 'x', 0, 0.06, s * 0.2);
    ext(0.385, 'z', s * 0.21, 0.06, 0);
  }
  ext(0.385, 'z', 0, 0.06, 0);
  add(frame, BOX(0.4, 0.003, 0.38), M.poly, 0, 0.069, 0);
  // drive motors
  for (const sx of [1, -1]) for (const sz of [1, -1]) {
    add(frame, cylZ(0.018, 0.075, 20), M.black, sx * 0.16, 0.045, sz * 0.15);
    add(frame, BOX(0.04, 0.04, 0.03), M.satin, sx * 0.16, 0.045, sz * 0.19);
  }
  const wheels = [];
  [[0.16, 0.225], [0.16, -0.225], [-0.16, 0.225], [-0.16, -0.225]].forEach(([x, z], i) => {
    const w = grp(root, 'wheel' + i, x, 0.045, z);
    omni(w, M, 0.045, 0.03);
    wheels.push(w);
  });
  // control hub and battery
  const hub = grp(root, 'hub', 0.04, 0.088, 0.06);
  add(hub, RBOX(0.105, 0.03, 0.143, 0.006), M.black, 0, 0, 0);
  add(hub, BOX(0.06, 0.002, 0.08), M.graphite, 0, 0.016, 0);
  add(hub, SPH(0.003, 8, 6), M.ledGreen, 0.04, 0.017, 0.06);
  for (let i = 0; i < 6; i++) add(hub, BOX(0.008, 0.008, 0.01), M.steel, -0.054, 0.004, -0.05 + i * 0.02);
  anchor(root, 'a_hub', 0.04, 0.11, 0.06);
  add(frame, RBOX(0.13, 0.04, 0.065, 0.005), M.satin, -0.08, 0.092, -0.09);
  add(frame, BOX(0.07, 0.002, 0.04), M.white, -0.08, 0.113, -0.09);
  for (let i = 0; i < 4; i++)
    wire(frame, M.wire[i % 4], [[0.0, 0.09, 0.0], [0.08 * (i < 2 ? 1 : -1), 0.08, 0.05 * (i % 2 ? 1 : -1)], [0.16 * (i < 2 ? 1 : -1), 0.06, 0.15 * (i % 2 ? 1 : -1)]], 0.0016);
  // intake roller at the front
  const intake = grp(root, 'intake', 0.245, 0.06, 0);
  for (const s of [1, -1]) add(frame, BOX(0.06, 0.06, 0.006), M.alu, 0.235, 0.07, s * 0.18);
  add(intake, cylZ(0.004, 0.36, 8), M.steel, 0, 0, 0);
  for (let i = 0; i < 6; i++) {
    const z = -0.15 + i * 0.06;
    add(intake, cylZ(0.012, 0.018, 16), M.satin, 0, 0, z);
    for (let k = 0; k < 6; k++) {
      const a = (k / 6) * 2 * PI;
      const f = add(intake, BOX(0.024, 0.006, 0.016), M.orange, Math.cos(a) * 0.024, Math.sin(a) * 0.024, z);
      f.rotation.z = a;
    }
  }
  anchor(root, 'a_intake', 0.27, 0.07, 0.1);
  // lift: two fixed rails and an inner stage carrying a basket
  for (const s of [1, -1]) ext(0.4, 'y', -0.11, 0.27, s * 0.1);
  add(frame, BOX(0.015, 0.015, 0.215), M.alu, -0.11, 0.47, 0);
  const lift = grp(root, 'lift', 0, 0, 0);
  for (const s of [1, -1]) {
    add(lift, BOX(0.012, 0.36, 0.012), M.alu, -0.095, 0.26, s * 0.085);
    add(lift, BOX(0.012, 0.36, 0.003), M.aluDark, -0.095, 0.26, s * 0.085);
  }
  const basket = grp(lift, null, -0.02, 0.43, 0);
  add(basket, BOX(0.16, 0.004, 0.17), M.poly, 0, -0.05, 0);
  add(basket, BOX(0.16, 0.1, 0.004), M.poly, 0, 0, 0.085);
  add(basket, BOX(0.16, 0.1, 0.004), M.poly, 0, 0, -0.085);
  add(basket, BOX(0.004, 0.1, 0.17), M.poly, -0.08, 0, 0);
  add(basket, BOX(0.004, 0.06, 0.17), M.poly, 0.08, -0.02, 0);
  for (const s of [1, -1]) add(basket, BOX(0.17, 0.008, 0.008), M.alu, 0, 0.05, s * 0.086);
  add(basket, BOX(0.008, 0.008, 0.18), M.alu, -0.081, 0.05, 0);
  add(basket, SPH(0.03, 16, 12), M.orange, 0.01, -0.02, 0.03);
  add(basket, SPH(0.03, 16, 12), M.leaf3, -0.03, -0.02, -0.035);
  anchor(lift, 'a_lift', 0.06, 0.48, 0.09);
  optimize(frame); optimize(hub); wheels.forEach(optimize); optimize(intake);
  optimize(basket); optimize(lift);
  return root;
}

/* ------------------------------------------------------------------ */
/* The Quackston line follower                                         */
/* ------------------------------------------------------------------ */
function buildDuck() {
  const M = materials();
  const root = new THREE.Group();
  const car = grp(root, 'car');
  add(car, RBOX(0.22, 0.004, 0.1, 0.002), M.alu, 0, 0.036, 0);
  add(car, RBOX(0.2, 0.003, 0.1, 0.002), M.acrylic, 0, 0.078, 0);
  for (const x of [-0.08, 0.08]) for (const z of [-0.04, 0.04]) add(car, CYL(0.0025, 0.0025, 0.042, 8), M.brass, x, 0.057, z);
  // rear motors, battery
  for (const s of [1, -1]) add(car, cylZ(0.011, 0.04, 16), M.graphite, -0.07, 0.03, s * 0.035);
  add(car, RBOX(0.075, 0.02, 0.042, 0.003), M.black, -0.04, 0.05, 0);
  add(car, cylX(0.009, 0.065, 16), M.wire[2], -0.04, 0.058, 0.01);
  add(car, cylX(0.009, 0.065, 16), M.wire[2], -0.04, 0.058, -0.01);
  // steering servo
  add(car, BOX(0.023, 0.012, 0.023), M.blue, 0.08, 0.03, 0);
  // Raspberry Pi and Robot HAT on the top plate
  const brain = grp(root, 'brain', -0.01, 0.082, 0);
  pcb(brain, M, 0.085, 0.056, M.greenPCB, 0, 0, 0, { chips: 3 });
  for (const x of [-0.035, 0.035]) for (const z of [-0.022, 0.022]) add(brain, CYL(0.0022, 0.0022, 0.012, 8), M.brass, x, 0.007, z);
  const hat = pcb(brain, M, 0.085, 0.056, M.hatPCB, 0, 0.013, 0, { chips: 2 });
  for (let i = 0; i < 4; i++) add(hat, BOX(0.008, 0.008, 0.012), M.black, 0.03, 0.005, -0.018 + i * 0.012);
  add(hat, CYL(0.012, 0.012, 0.006, 24), M.black, -0.022, 0.004, 0.012);
  add(hat, CYL(0.009, 0.009, 0.0065, 24), M.graphite, -0.022, 0.0045, 0.012);
  for (let i = 0; i < 5; i++)
    wire(brain, M.wire[i], [[0.025, 0.02, -0.02 + i * 0.008], [0.07, 0.03, -0.02 + i * 0.01], [0.12, -0.01, -0.01 + i * 0.005]], 0.0011);
  anchor(root, 'a_brain', -0.01, 0.1, 0.0);
  // front sensors: ultrasonic eyes and the grayscale strip underneath
  const sonar = grp(root, 'sonar', 0.117, 0.064, 0);
  add(sonar, BOX(0.0016, 0.021, 0.045), M.bluePCB, 0, 0, 0);
  for (const z of [-0.013, 0.013]) {
    add(sonar, cylX(0.008, 0.012, 24), M.steel, 0.006, 0, z);
    add(sonar, cylX(0.0065, 0.0125, 20), M.chip, 0.0062, 0, z);
  }
  add(car, BOX(0.012, 0.03, 0.03), M.aluDark, 0.108, 0.05, 0);
  anchor(root, 'a_sonar', 0.13, 0.064, 0);
  const gray = grp(root, 'gray', 0.112, 0.013, 0);
  add(gray, BOX(0.022, 0.0016, 0.062), M.black, 0, 0, 0);
  for (const z of [-0.02, 0, 0.02]) {
    add(gray, BOX(0.006, 0.004, 0.005), M.chip, 0, -0.002, z);
    add(gray, cylZ(0.0018, 0.003, 10).rotateX(PI / 2), M.bluePCB, 0, -0.0035, z - 0.0012);
    add(gray, cylZ(0.0018, 0.003, 10).rotateX(PI / 2), M.chip, 0, -0.0035, z + 0.0012);
  }
  add(car, BOX(0.03, 0.022, 0.012), M.alu, 0.1, 0.024, 0);
  anchor(root, 'a_gray', 0.112, 0.008, 0);
  // wheels
  const wheels = [];
  [[0.075, 0.068], [0.075, -0.068], [-0.07, 0.068], [-0.07, -0.068]].forEach(([x, z], i) => {
    const w = grp(root, 'wheel' + i, x, 0.033, z);
    tire(w, M, 0.033, 0.025, { lugs: 16, hub: M.white, hubR: 0.6, knob: 0.0025 });
    wheels.push(w);
  });
  // LEDs on a mini breadboard
  const leds = grp(root, 'leds', 0.07, 0.084, 0.03);
  add(leds, BOX(0.035, 0.009, 0.046), M.breadboard, 0, 0, 0);
  [M.ledRed, M.ledYellow, M.ledGreen].forEach((m0, i) => {
    const m = m0.clone();
    add(leds, CYL(0.0026, 0.0026, 0.005, 12), m, -0.008 + i * 0.008, 0.007, 0.0, 0, 0, 0, 'led' + i);
    add(leds, SPH(0.0026, 12, 8), m, -0.008 + i * 0.008, 0.0095, 0.0, 0, 0, 0, 'ledcap' + i);
  });
  anchor(root, 'a_leds', 0.07, 0.095, 0.03);
  // canopy posts, frame and the vines
  const canopy = grp(root, 'canopy');
  const H = 0.24;
  for (const x of [-0.088, 0.088]) for (const z of [-0.046, 0.046]) add(canopy, CYL(0.0034, 0.0034, H - 0.08, 8), M.woodDark, x, (H + 0.08) / 2, z);
  for (const z of [-0.046, 0.046]) add(canopy, BOX(0.19, 0.005, 0.005), M.woodDark, 0, H, z);
  for (const x of [-0.088, 0.088]) add(canopy, BOX(0.005, 0.005, 0.1), M.woodDark, x, H, 0);
  add(canopy, BOX(0.18, 0.003, 0.094), M.woodDark, 0, H + 0.003, 0);
  const leafGeo = new THREE.ShapeGeometry((() => {
    const s = new THREE.Shape();
    s.moveTo(0, 0); s.bezierCurveTo(0.006, 0.004, 0.008, 0.012, 0, 0.018); s.bezierCurveTo(-0.008, 0.012, -0.006, 0.004, 0, 0);
    return s;
  })(), 4);
  const leafMats = [M.leaf, M.leaf2, M.leaf3];
  const vine = (pts, n) => {
    const c = new THREE.CatmullRomCurve3(pts.map((p) => new THREE.Vector3(...p)));
    add(canopy, new THREE.TubeGeometry(c, 20, 0.0012, 5, false), M.leaf2);
    for (let i = 0; i < n; i++) {
      const p = c.getPoint(i / (n - 1));
      const l = add(canopy, leafGeo, leafMats[(rnd() * 3) | 0], p.x, p.y, p.z);
      l.rotation.set(rnd() * PI * 2, rnd() * PI * 2, rnd() * PI * 2);
      const sc = 0.8 + rnd() * 0.7;
      l.scale.setScalar(sc);
    }
  };
  for (let k = 0; k < 7; k++) {
    const z = -0.045 + k * 0.015;
    vine([[-0.1, H + 0.004, z], [-0.03, H + 0.008, z + 0.004], [0.04, H + 0.006, z - 0.003], [0.1, H + 0.004, z]], 14);
  }
  for (const x of [-0.092, 0.092]) for (const z of [-0.05, 0.05]) {
    vine([[x, H, z], [x + (rnd() - 0.5) * 0.02, H - 0.06, z * 1.1], [x + (rnd() - 0.5) * 0.02, H - 0.12, z * 1.05]], 9);
  }
  vine([[-0.05, H, 0.05], [-0.04, H - 0.05, 0.056], [-0.05, H - 0.09, 0.052]], 7);
  vine([[0.03, H, -0.05], [0.035, H - 0.06, -0.056], [0.025, H - 0.1, -0.052]], 7);
  // treasure chest with gold coins, and the passenger
  const chest = grp(root, 'chest', -0.045, 0.1, 0);
  const cw = 0.07, ch = 0.04, cd = 0.06;
  add(chest, BOX(cw, 0.004, cd), M.wood, 0, 0.002, 0);
  add(chest, BOX(cw, ch, 0.004), M.wood, 0, ch / 2, cd / 2);
  add(chest, BOX(cw, ch, 0.004), M.wood, 0, ch / 2, -cd / 2);
  add(chest, BOX(0.004, ch, cd), M.wood, cw / 2, ch / 2, 0);
  add(chest, BOX(0.004, ch, cd), M.wood, -cw / 2, ch / 2, 0);
  const lidG = grp(chest, null, -cw / 2, ch, 0);
  add(lidG, BOX(cw, 0.005, cd), M.wood, cw / 2, 0, 0);
  lidG.rotation.z = 1.9;
  const coin = CYL(0.0065, 0.0065, 0.0016, 18);
  for (let i = 0; i < 46; i++) {
    const c = add(chest, coin, M.gold, (rnd() - 0.5) * cw * 0.8, ch * 0.55 + rnd() * 0.012, (rnd() - 0.5) * cd * 0.8);
    c.rotation.set((rnd() - 0.5) * 1.2, rnd() * 3, (rnd() - 0.5) * 1.2);
  }
  const duck = makeDuck(M, 0.014);
  duck.position.set(0.012, ch * 0.55 + 0.01, 0);
  duck.name = 'duck';
  chest.add(duck);
  anchor(root, 'a_duck', -0.03, 0.18, 0);
  optimize(car); optimize(brain); optimize(sonar); optimize(gray); wheels.forEach(optimize);
  optimize(leds); optimize(canopy); optimize(chest);
  return root;
}

/* ------------------------------------------------------------------ */
/* Lunar rover                                                         */
/* ------------------------------------------------------------------ */
function buildLunar() {
  const M = materials();
  const root = new THREE.Group();
  const body = grp(root, 'body');
  add(body, RBOX(0.25, 0.075, 0.13, 0.02, 4), M.print, 0, 0.095, 0);
  add(body, BOX(0.18, 0.02, 0.1), M.graphite, -0.01, 0.052, 0);
  for (const sx of [1, -1]) for (const sz of [1, -1]) add(body, cylZ(0.012, 0.03, 16), M.graphite, sx * 0.08, 0.055, sz * 0.055);
  // front eyes
  const eyes = grp(root, 'eyes', 0.126, 0.1, 0);
  add(eyes, RBOX(0.012, 0.05, 0.11, 0.006), M.print, 0, 0, 0);
  for (const z of [-0.028, 0.028]) {
    add(eyes, cylX(0.021, 0.018, 36), M.print, 0.008, 0, z);
    add(eyes, cylX(0.0165, 0.019, 32), M.graphite, 0.009, 0, z);
    add(eyes, cylX(0.006, 0.02, 16), M.chip, 0.0095, 0, z);
  }
  anchor(root, 'a_eyes', 0.145, 0.1, 0.028);
  // lid with the dark switch on top
  const lid = grp(root, 'lid', 0, 0.138, 0);
  add(lid, RBOX(0.25, 0.024, 0.13, 0.012, 4), M.print, 0, 0, 0);
  add(lid, RBOX(0.036, 0.024, 0.05, 0.008), M.black, 0.075, 0.016, 0.0);
  const inside = grp(root, 'inside', 0, 0.128, 0);
  pcb(inside, M, 0.068, 0.053, M.bluePCB, 0.01, 0, 0.01, { chips: 2 });
  pcb(inside, M, 0.045, 0.04, M.redPrint, -0.07, 0, -0.02, { chips: 1, pins: false });
  wire(inside, M.wire[0], [[-0.07, 0.003, -0.02], [-0.03, 0.01, 0.0], [0.0, 0.003, 0.01]]);
  wire(inside, M.wire[3], [[-0.07, 0.003, -0.026], [-0.03, 0.012, -0.006], [0.0, 0.003, 0.004]]);
  anchor(root, 'a_lid', 0.0, 0.16, 0.04);
  const wheels = [];
  [[0.085, 0.098], [0.085, -0.098], [-0.085, 0.098], [-0.085, -0.098]].forEach(([x, z], i) => {
    const w = grp(root, 'wheel' + i, x, 0.055, z);
    add(w, cylZ(0.046, 0.044, 40), M.print);
    const n = 14;
    for (let k = 0; k < n; k++) {
      const a = (k / n) * 2 * PI;
      const p = add(w, RBOX(0.014, 0.009, 0.044, 0.002, 2), M.print, Math.cos(a) * 0.05, Math.sin(a) * 0.05, 0);
      p.rotation.z = a;
    }
    add(w, cylZ(0.022, 0.05, 32), M.redPrint, 0, 0, 0);
    add(w, new THREE.CylinderGeometry(0.009, 0.009, 0.054, 6).rotateX(PI / 2), M.redPrint, 0, 0, 0);
    add(w, BOX(0.03, 0.006, 0.053), M.redPrint, 0, 0, 0);
    add(w, BOX(0.006, 0.03, 0.053), M.redPrint, 0, 0, 0);
    wheels.push(w);
  });
  anchor(root, 'a_wheel', 0.085, 0.09, 0.122);
  anchor(root, 'a_wheelR', 0.085, 0.09, -0.122);
  optimize(body); optimize(eyes); optimize(lid); optimize(inside); wheels.forEach(optimize);
  return root;
}

/* ------------------------------------------------------------------ */
/* ACE planter, after the real one: a pine box, rails that slope up to  */
/* the back, a threaded rod with spools along the front, and a plastic  */
/* sheet that the spools pull shut or let bunch up at the back.         */
/* ------------------------------------------------------------------ */
const ACE = { W: 0.4, L: 0.72, H: 0.16, t: 0.02 };
ACE.yF = ACE.t + ACE.H + 0.045; // rail top at the front
ACE.zF = ACE.L / 2 + ACE.t;
ACE.yB = ACE.t + ACE.H + 0.135; // rail top at the back
ACE.zB = -ACE.L / 2 - ACE.t - 0.02;
ACE.zBar = -ACE.L / 2 + 0.05; // the white bar the sheet hangs from
ACE.yAt = (z) => ACE.yF + (ACE.yB - ACE.yF) * (ACE.zF - z) / (ACE.zF - ACE.zB);

function buildACE() {
  const M = materials();
  const { W, L, H, t } = ACE;
  const root = new THREE.Group();
  const box = grp(root, 'box');
  const pine = M.pine;
  add(box, BOX(W + 2 * t, t, L + 2 * t), pine, 0, t / 2, 0);
  for (const sx of [1, -1]) add(box, BOX(t, H, L + 2 * t), pine, sx * (W / 2 + t / 2), t + H / 2, 0);
  for (const sz of [1, -1]) add(box, BOX(W, H, t), pine, 0, t + H / 2, sz * (L / 2 + t / 2));
  // sloped rails along the top of each side wall, rising toward the back
  const dz = ACE.zF - ACE.zB, dy = ACE.yB - ACE.yF;
  const railLen = Math.hypot(dz, dy) + 0.04;
  const slope = Math.atan2(dy, dz);
  for (const sx of [1, -1]) {
    const r = add(box, BOX(0.042, 0.048, railLen), pine, sx * (W / 2 + t / 2), (ACE.yF + ACE.yB) / 2 - 0.024, (ACE.zF + ACE.zB) / 2);
    r.rotation.x = slope;
    // the wall under the rail fills up to it
    const fill = new THREE.Shape();
    fill.moveTo(ACE.zF, t + H); fill.lineTo(ACE.zB + 0.02, t + H); fill.lineTo(ACE.zB + 0.02, ACE.yB - 0.05); fill.lineTo(ACE.zF, ACE.yF - 0.045);
    fill.closePath();
    const g = new THREE.ExtrudeGeometry(fill, { depth: t * 0.9, bevelEnabled: false });
    g.rotateY(PI / 2);
    add(box, g, pine, sx * (W / 2 + t / 2) - t * 0.45, 0, 0);
  }
  // corner posts: short ones at the front hold the rod, taller ones at the back hold the rails
  const screw = CYL(0.0045, 0.0045, 0.004, 10).rotateZ(PI / 2);
  for (const sx of [1, -1]) {
    const xp = sx * (W / 2 + t + 0.021);
    add(box, BOX(0.042, 0.24, 0.045), pine, xp, 0.12, ACE.zF - 0.03);
    add(box, BOX(0.042, ACE.yB - 0.01, 0.045), pine, xp, (ACE.yB - 0.01) / 2, ACE.zB + 0.03);
    for (const y of [0.06, 0.17]) add(box, screw, M.steel, xp + sx * 0.022, y, ACE.zF - 0.03);
    for (const y of [0.08, 0.22]) add(box, screw, M.steel, xp + sx * 0.022, y, ACE.zB + 0.03);
  }
  // soil, a little uneven, and the seedlings
  add(box, BOX(W - 0.004, 0.012, L - 0.004), M.soil, 0, t + H - 0.035, 0);
  for (let i = 0; i < 40; i++) {
    const lump = add(box, SPH(0.018 + rnd() * 0.02, 10, 6), M.soil, (rnd() - 0.5) * (W - 0.06), t + H - 0.03, (rnd() - 0.5) * (L - 0.06));
    lump.scale.y = 0.18 + rnd() * 0.2;
  }
  const plants = grp(root, 'plants');
  const leafGeo = new THREE.ShapeGeometry((() => {
    const sh = new THREE.Shape();
    sh.moveTo(0, 0); sh.bezierCurveTo(0.004, 0.006, 0.004, 0.016, 0, 0.024); sh.bezierCurveTo(-0.004, 0.016, -0.004, 0.006, 0, 0);
    return sh;
  })(), 4);
  [[0.02, -0.22, 1.0], [-0.07, -0.02, 0.8], [0.06, 0.06, 1.15], [-0.02, 0.2, 0.6]].forEach(([x, z, k]) => {
    const y0 = t + H - 0.03;
    add(plants, CYL(0.0012, 0.0018, 0.03 * k, 6), M.leaf2, x, y0 + 0.015 * k, z);
    const n = 9;
    for (let j = 0; j < n; j++) {
      const l = add(plants, leafGeo, j % 2 ? M.leaf : M.leaf2, x, y0 + 0.012 * k + (j % 3) * 0.006, z);
      l.rotation.set(-1.0 + rnd() * 0.5, (j / n) * PI * 2, 0);
      l.scale.setScalar(k * (0.8 + rnd() * 0.5));
    }
  });
  // sensor leads running into the soil
  wire(box, M.wire[2], [[-W / 2 + 0.03, t + H + 0.02, ACE.zF - 0.02], [-W / 2 + 0.04, t + H - 0.01, 0.1], [-W / 2 + 0.06, t + H - 0.035, -0.12]], 0.0016);
  wire(box, M.wire[0], [[W / 2 - 0.04, t + H + 0.02, ACE.zF - 0.02], [W / 2 - 0.05, t + H - 0.01, 0.05], [W / 2 - 0.07, t + H - 0.035, -0.18]], 0.0016);
  // the white bar at the back that the sheet hangs from
  add(box, BOX(W + 0.2, 0.006, 0.032), M.white, 0, ACE.yAt(ACE.zBar) + 0.012, ACE.zBar);
  // threaded rod with nuts, two white spools and a small blue reel
  const zr = ACE.zF + 0.02, yr = 0.075;
  add(box, cylX(0.005, W + 0.26, 16), M.steel, 0, yr, zr);
  for (const sx of [1, -1]) for (const o of [-0.026, 0.026]) add(box, new THREE.CylinderGeometry(0.009, 0.009, 0.008, 6).rotateZ(PI / 2), M.steel, sx * (W / 2 + t + 0.021) + o, yr, zr);
  const spools = grp(root, 'spools', 0, yr, zr);
  for (const sx of [1, -1]) {
    const x = sx * 0.135;
    for (const o of [-0.012, 0.012]) add(spools, cylX(0.028, 0.006, 32), M.white, x + o, 0, 0);
    add(spools, cylX(0.013, 0.03, 24), M.white, x, 0, 0);
    add(spools, cylX(0.0135, 0.022, 24), sx > 0 ? M.wire[0] : M.wire[2], x, 0, 0);
  }
  add(spools, cylX(0.011, 0.022, 20), M.blue, -0.035, 0, 0);
  // the sheet: a flat run down the rails plus whatever is bunched at the back
  const sheet = new THREE.Mesh(new THREE.PlaneGeometry(W + 0.08, 1, 1, 18), M.sheet);
  sheet.name = 'sheet';
  sheet.userData.keep = true;
  root.add(sheet);
  const bunchGeo = new THREE.PlaneGeometry(W + 0.08, 1, 10, 26);
  const bp = bunchGeo.attributes.position;
  bunchGeo.userData.base = Float32Array.from(bp.array);
  const bunch = new THREE.Mesh(bunchGeo, M.sheet);
  bunch.name = 'bunch';
  bunch.userData.keep = true;
  root.add(bunch);
  const edge = add(root, BOX(W + 0.08, 0.008, 0.022), M.white, 0, 0, 0, 0, 0, 0, 'edge');
  edge.userData.keep = true;
  const strings = new THREE.LineSegments(
    new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3()]),
    new THREE.LineBasicMaterial({ color: 0xd8d4c8 })
  );
  strings.name = 'strings';
  root.add(strings);
  optimize(box); optimize(plants); optimize(spools);
  return root;
}

/* ------------------------------------------------------------------ */
/* Definitions: framing, the parts each chapter points at, animation    */
/* ------------------------------------------------------------------ */
export const DEFS = {
  gps: { build: buildGPS, center: [0, 0, 0], radius: 4.9 },
  scout: {
    build: buildScout, center: [0, 0.23, 0], radius: 0.46, yaw: -38, pitch: 16,
    parts: {
      intro: { yaw: -40, pitch: 14 },
      antennas: { nodes: { antA: [0, 0.07, 0], antB: [0, 0.07, 0] }, anchors: ['a_antA', 'a_antB'], yaw: -62, pitch: 34, zoom: 1.0 },
      camera: { nodes: { camera: [0.06, 0, 0] }, anchors: ['a_cam'], yaw: -100, pitch: 10, zoom: 1.14, focus: [0.13, 0.26, 0] },
      inside: { nodes: { lid: [0, 0.16, 0], antA: [0, 0.16, 0], antB: [0, 0.16, 0], stub: [0, 0.16, 0], inside: [0, 0.05, 0] }, anchors: ['a_imu', 'a_pi'], yaw: 40, pitch: 48, zoom: 1.05, focus: [-0.02, 0.32, 0.03] },
    },
  },
  qkrt: {
    build: buildQKRT, center: [0, 0.26, 0], radius: 0.46, yaw: -40, pitch: 16,
    parts: {
      intro: { yaw: -40, pitch: 14 },
      wheels: { nodes: { wheel0: [0, 0, 0.04], wheel1: [0, 0, -0.04] }, anchors: ['wheel0'], yaw: -38, pitch: 9, zoom: 1.3, focus: [0.16, 0.16, 0.12] },
      armor: { nodes: { armorF: [0.06, 0, 0], armorL: [0, 0, -0.05], armorR: [0, 0, 0.05] }, anchors: ['a_armor'], yaw: -85, pitch: 12, zoom: 1.25, focus: [0.12, 0.2, 0] },
      gimbal: { nodes: { yaw: [0, 0.05, 0] }, anchors: ['a_speed', 'a_pitchmotor', 'a_yawgear'], yaw: -122, pitch: 12, zoom: 1.55, focus: [0.15, 0.42, 0] },
      power: { nodes: { power: [0, 0.15, 0], yaw: [0, 0.18, 0] }, anchors: ['a_power'], yaw: -255, pitch: 24, zoom: 1.35, focus: [-0.09, 0.32, 0.02] },
    },
  },
  plane: {
    build: buildPlane, center: [0.0, 0.0, 0], radius: 0.82, yaw: -30, pitch: 20,
    parts: {
      intro: { yaw: -40, pitch: 24 },
      motors: { nodes: {}, anchors: ['a_motor'], yaw: -30, pitch: 12, zoom: 1.3, focus: [0.25, 0, 0.18] },
      cabin: { nodes: {}, anchors: ['a_cabin'], yaw: -62, pitch: 62, zoom: 3.1, focus: [0.25, 0.0, 0], hatch: 1 },
      banner: { nodes: {}, anchors: ['a_banner'], yaw: -178, pitch: 12, zoom: 0.5, focus: [-0.75, -0.02, 0], banner: 1 },
    },
  },
  fgc: {
    build: buildFGC, center: [-0.1, 0.24, 0], radius: 0.52, yaw: -38, pitch: 16,
    parts: {
      intro: { yaw: -36, pitch: 14 },
      intake: { nodes: { intake: [0.06, 0, 0], ball: [0.11, 0, 0] }, anchors: ['a_intake'], yaw: -80, pitch: 14, zoom: 1.3, focus: [0.15, 0.17, 0.02] },
      hubs: { nodes: { hubL: [0, 0, -0.07], hubR: [0, 0, 0.07] }, anchors: ['a_hub'], yaw: -10, pitch: 14, zoom: 1.15, focus: [0.04, 0.27, 0.1] },
      arms: { nodes: { arms: [0, 0.05, 0] }, anchors: ['a_arms'], yaw: 50, pitch: 26, zoom: 1.0, focus: [-0.26, 0.3, 0] },
    },
  },
  duck: {
    build: buildDuck, center: [0.0, 0.13, 0], radius: 0.2, yaw: -34, pitch: 14,
    parts: {
      intro: { yaw: -40, pitch: 12 },
      gray: { nodes: { gray: [0.0, -0.012, 0] }, anchors: ['a_gray'], yaw: -70, pitch: -24, zoom: 1.15, focus: [0.05, 0.07, 0] },
      sonar: { nodes: { sonar: [0.02, 0, 0] }, anchors: ['a_sonar'], yaw: -94, pitch: 6, zoom: 1.15, focus: [0.05, 0.1, 0] },
      brain: { nodes: { canopy: [0, 0.09, 0], chest: [0, 0.07, 0] }, anchors: ['a_brain', 'a_leds'], yaw: -132, pitch: 44, zoom: 1.0, focus: [0, 0.15, 0] },
      duck: { nodes: {}, anchors: ['a_duck'], yaw: -222, pitch: 28, zoom: 1.12, focus: [-0.03, 0.15, 0] },
    },
  },
  lunar: {
    build: buildLunar, center: [0, 0.085, 0], radius: 0.19, yaw: -36, pitch: 14,
    parts: {
      intro: { yaw: -40, pitch: 12 },
      eyes: { nodes: { eyes: [0.03, 0, 0] }, anchors: ['a_eyes'], yaw: -88, pitch: 8, zoom: 1.15, focus: [0.05, 0.1, 0] },
      wheels: { nodes: { wheel1: [0, 0, -0.03], wheel3: [0, 0, -0.03] }, anchors: ['a_wheelR'], yaw: -170, pitch: 10, zoom: 1.05 },
      lid: { nodes: { lid: [0, 0.07, 0], inside: [0, 0.015, 0] }, anchors: ['a_lid'], yaw: -225, pitch: 40, zoom: 1.05 },
    },
  },
  ace: { build: buildACE, center: [0, 0.18, 0], radius: 0.55 },
};

export function buildModel(key, lod = 'hi') {
  const def = DEFS[key];
  materials();
  // same seed per model, so the parade copy and the close up copy match leaf for leaf
  seed = ([...key].reduce((a, c) => (a * 31 + c.charCodeAt(0)) % 2147483646, 7) || 1);
  const model = def.build(lod);
  model.traverse((o) => { if (o.isMesh) o.frustumCulled = true; });
  return model;
}

/* Per instance rig: references to moving parts, and their rest positions. */
export function rig(key, model) {
  const r = { key, model, wheels: [], rest: new Map(), nodes: new Map(), anchors: {}, t: 0 };
  model.traverse((o) => {
    if (/^wheel\d$/.test(o.name)) r.wheels.push(o);
    if (!o.name) return;
    if (o.name.startsWith('a_')) { r.anchors[o.name] = o; return; }
    if (!r.nodes.has(o.name)) { r.nodes.set(o.name, o); r.rest.set(o.name, o.position.clone()); }
  });
  r.get = (n) => r.nodes.get(n) || r.anchors[n] || null;
  return r;
}

// offsets: { nodeName: [dx, dy, dz] } already scaled by how far each part is pulled out
export function applyPose(r, offsets) {
  for (const [name, rest] of r.rest) {
    const o = r.nodes.get(name);
    const off = offsets[name];
    if (off) o.position.set(rest.x + off[0], rest.y + off[1], rest.z + off[2]);
    else o.position.copy(rest);
  }
}

export function animateModel(r, dt, s) {
  const { key } = r;
  r.t += dt;
  const t = r.t;
  const roll = s.roll || 0;
  r.wheels.forEach((w) => { w.rotation.z -= roll * dt; });
  if (key === 'scout') {
    const flag = r.get('flag');
    if (flag) {
      const p = flag.geometry.attributes.position, b = flag.userData.base;
      for (let i = 0; i < p.count; i++) {
        const x = b[i * 3];
        p.setZ(i, Math.sin(x * 28 + t * 7) * 0.012 * (-x / 0.17));
      }
      p.needsUpdate = true;
    }
  }
  if (key === 'qkrt') {
    const y = r.get('yaw');
    if (y) y.rotation.y = Math.sin(t * 0.7) * 0.25 * (s.idle ?? 1);
    const p = r.get('pitch');
    if (p) p.rotation.z = Math.sin(t * 0.9 + 1) * 0.06 * (s.idle ?? 1);
  }
  if (key === 'plane') {
    const spin = (s.prop ?? 1) * dt * 60;
    ['propA', 'propB'].forEach((n, i) => { const p = r.get(n); if (p) p.rotation.x += (i ? -spin : spin); });
    const hatch = r.get('hatch');
    if (hatch) hatch.rotation.x = -(s.hatch || 0) * 1.8;
    const deploy = s.banner || 0, release = s.release || 0;
    const banner = r.get('banner'), cloth = r.get('bannerCloth'), tow = r.get('tow'), rollObj = r.get('roll');
    if (banner && cloth) {
      const on = deploy > 0.001;
      banner.visible = on && release < 0.999;
      tow.visible = on && release < 0.02;
      rollObj.visible = deploy < 0.05;
      const len = Math.max(0.02, deploy);
      const towLen = 0.45 * deploy;
      banner.position.set(-0.5 - towLen - release * 0.6, -0.02 - release * 0.5, 0);
      banner.rotation.z = release * 0.5;
      cloth.material.opacity = 1 - release;
      const p = cloth.geometry.attributes.position, b = cloth.userData.base;
      for (let i = 0; i < p.count; i++) {
        const x = b[i * 3] * len, y = b[i * 3 + 1];
        p.setXYZ(i, x, y, Math.sin(x * 7 - t * 9) * 0.035 * Math.min(1, -x / 0.4));
      }
      p.needsUpdate = true;
      if (tow.visible) {
        const tp = tow.geometry.attributes.position;
        tp.setXYZ(0, -0.49, 0.02, 0); tp.setXYZ(1, banner.position.x, 0.13, 0);
        tp.setXYZ(2, -0.49, 0.0, 0); tp.setXYZ(3, banner.position.x, -0.17, 0);
        tp.needsUpdate = true;
      }
    }
  }
  if (key === 'fgc') {
    const intake = r.get('intake');
    if (intake) intake.rotation.z -= dt * 6 * (s.idle ?? 1);
    const lift = r.get('lift');
    if (lift) lift.position.y = (s.lift || 0) * 0.2;
  }
  if (key === 'duck') {
    const k = Math.floor(t * 1.2) % 3;
    for (let i = 0; i < 3; i++) {
      const led = r.get('led' + i);
      if (led) led.material.emissiveIntensity = i === k ? 1.5 : 0.12;
    }
    [0, 1].forEach((i) => { const w = r.wheels[i]; if (w) w.rotation.y = Math.sin(t * 0.8) * 0.18; });
  }
}

/* ACE cover: open is 0 (pulled shut over the box) to 1 (bunched up at the back). */
const _p = new THREE.Vector3();
export function setACE(model, open) {
  const { W } = ACE;
  const sheet = model.getObjectByName('sheet');
  const bunch = model.getObjectByName('bunch');
  const edge = model.getObjectByName('edge');
  const spools = model.getObjectByName('spools');
  const strings = model.getObjectByName('strings');
  const f = Math.min(1, Math.max(0, open));
  // front edge slides from the front of the rails up to the bar
  const zFront = ACE.zF - 0.02 + (ACE.zBar + 0.03 - (ACE.zF - 0.02)) * f;
  const z0 = ACE.zBar, z1 = zFront;
  const y0 = ACE.yAt(z0) + 0.016, y1 = ACE.yAt(z1) + 0.006;
  const len = Math.hypot(z1 - z0, y1 - y0);
  sheet.visible = len > 0.01;
  sheet.position.set(0, (y0 + y1) / 2, (z0 + z1) / 2);
  sheet.rotation.set(-PI / 2 + Math.atan2(y0 - y1, z1 - z0), 0, 0);
  sheet.scale.set(1, Math.max(len, 0.001), 1);
  edge.position.set(0, y1 + 0.004, z1);
  edge.rotation.x = Math.atan2(y0 - y1, z1 - z0);
  // the bunch grows as the sheet is let out at the back
  const hB = 0.02 + 0.13 * f;
  const p = bunch.geometry.attributes.position, base = bunch.geometry.userData.base;
  for (let i = 0; i < p.count; i++) {
    const x = base[i * 3], v = base[i * 3 + 1] + 0.5;
    const fold = Math.sin(v * PI * 5 + x * 9) * 0.018 + Math.sin(x * 23 + v * 7) * 0.006;
    p.setXYZ(i, x * (1 - 0.06 * v), y0 + v * hB, z0 - 0.02 - v * 0.03 + fold * (0.3 + v) * (0.4 + f));
  }
  p.needsUpdate = true;
  bunch.geometry.computeVertexNormals();
  bunch.visible = f > 0.02;
  bunch.scale.set(1, 1, 1);
  // spools wind as the cover moves, and the strings follow the edge
  spools.rotation.x = -f * 9;
  const tp = strings.geometry.attributes.position;
  spools.getWorldPosition(_p);
  const yr = spools.position.y, zr = spools.position.z;
  tp.setXYZ(0, -0.135, yr + 0.02, zr - 0.012); tp.setXYZ(1, -W / 2 + 0.02, y1 + 0.004, z1);
  tp.setXYZ(2, 0.135, yr + 0.02, zr - 0.012); tp.setXYZ(3, W / 2 - 0.02, y1 + 0.004, z1);
  tp.needsUpdate = true;
}

