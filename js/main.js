import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { createStars, createEarth, createMarker, createArcs, loadTextures } from './sky.js';
import { createSats, cleanName } from './sats.js';
import { buildModel, DEFS, rig, applyPose, animateModel, setACE, materials, loadCAD } from './models.js';
import * as U from './util.js';
import * as UI from './ui.js';

const { clamp, lerp, smooth, ease, band } = U;
const OTTAWA = { lat: 45.4215, lon: -75.6972 };
const KINGSTON = { lat: 44.2312, lon: -76.486 };
// stops on the flight, in order. Each one needs a matching <li> in #stops,
// and adds 0.46 to the global chapter's --len and its step's data-until.
const CITIES = [
  { name: 'Geneva', year: 2022, lat: 46.2044, lon: 6.1432 },
  { name: 'Singapore', year: 2023, lat: 1.3521, lon: 103.8198 },
  { name: 'Athens', year: 2024, lat: 37.9838, lon: 23.7275 },
  { name: 'Panama City', year: 2025, lat: 8.9824, lon: -79.5199 },
  { name: 'Michigan', year: 2026, lat: 44.3148, lon: -85.6024, left: true }, // label on the left, clear of Ottawa's
  { name: 'Ottawa', year: 2026, ...OTTAWA },
];
const PARADE = ['scout', 'qkrt', 'plane', 'fgc', 'duck', 'lunar'];
const NAMES = { scout: 'Scout Mini', qkrt: 'Knights Robotics', plane: 'Banner plane', fgc: 'FIRST Global robot', duck: 'Line follower', lunar: 'Lunar rover' };
const GAP = 7; // degrees between robots in the parade
const PHI = (i) => -i * GAP;
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/* ---------------------------------------------------------------- */
/* Page parts that work with or without WebGL                        */
/* ---------------------------------------------------------------- */
const html = document.documentElement;
const chapters = UI.collectChapters();
const CH = Object.fromEntries(chapters.map((c) => [c.id, c]));
const flows = ['projects', 'skills', 'work'].map((id) => ({ id, el: document.getElementById(id), top: 0, unit: 1, span: 1 }));
flows.forEach((f) => (CH[f.id] = f));
UI.createTimeline();
UI.createSRC();
const graph = UI.createGraph();
UI.initBits();
const labels = UI.createLabels();

// distances between stops, for the counter that runs during the flight
const LEG_KM = CITIES.slice(1).map((c, i) => U.greatCircleKm(CITIES[i].lat, CITIES[i].lon, c.lat, c.lon));
const SUM_KM = LEG_KM.reduce((a, km) => [...a, a[a.length - 1] + km], [0]);

function measureAll() {
  UI.measure(chapters);
  const vh = window.innerHeight, sy = window.scrollY;
  flows.forEach((f) => {
    const r = f.el.getBoundingClientRect();
    f.unit = vh;
    f.top = r.top + sy - vh;
    f.span = (r.height + vh) / vh;
  });
}

/* ---------------------------------------------------------------- */
/* WebGL                                                             */
/* ---------------------------------------------------------------- */
let renderer;
try {
  renderer = new THREE.WebGLRenderer({ canvas: document.getElementById('gl'), antialias: true, powerPreference: 'high-performance' });
  if (!renderer.getContext()) throw new Error('no context');
} catch (e) {
  renderer = null;
}

if (!renderer) {
  html.classList.add('no-webgl');
  html.classList.remove('js');
} else {
  start().catch((e) => {
    console.error(e);
    html.classList.add('no-webgl');
    html.classList.remove('js');
  });
}

async function start() {
  const narrow0 = U.isNarrow();
  const reduced = U.prefersReducedMotion();
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, narrow0 ? 1.6 : 1.75));
  renderer.setSize(window.innerWidth, window.innerHeight, false);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.NeutralToneMapping;
  renderer.toneMappingExposure = 1.0;
  renderer.autoClear = false;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.setClearColor(0x06080b, 1);
  const canvas = renderer.domElement;
  canvas.style.opacity = '0';
  canvas.style.transition = 'opacity 1.2s ease';

  const pmrem = new THREE.PMREMGenerator(renderer);
  const envTex = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;

  /* scenes and cameras */
  const world = new THREE.Scene();
  world.environment = envTex;
  world.environmentIntensity = 0.45;
  const studio = new THREE.Scene();
  studio.environment = envTex;
  studio.environmentIntensity = 0.7;
  const aceScene = new THREE.Scene();
  aceScene.environment = envTex;
  aceScene.environmentIntensity = 0.85;

  const cam = new THREE.PerspectiveCamera(40, 1, 0.002, 1500);
  const scam = new THREE.PerspectiveCamera(40, 1, 0.01, 6000);
  const acam = new THREE.PerspectiveCamera(30, 4 / 3, 0.01, 50);

  const sunLight = new THREE.DirectionalLight(0xffffff, 2.4);
  world.add(sunLight, sunLight.target);
  world.add(new THREE.HemisphereLight(0x8aa2c8, 0x101418, 0.25));
  const key = new THREE.DirectionalLight(0xfff4e6, 2.6);
  // the close up robot shades itself, which is most of what makes CAD detail read
  key.shadow.mapSize.set(narrow0 ? 1024 : 2048, narrow0 ? 1024 : 2048);
  key.shadow.bias = -0.0004;
  key.shadow.normalBias = 0.0025;
  const rim = new THREE.DirectionalLight(0xbfd4ff, 1.1);
  const fill = new THREE.HemisphereLight(0xdbe6ff, 0x1a1d22, 0.35);
  studio.add(key, key.target, rim, rim.target, fill);
  const aKey = new THREE.DirectionalLight(0xfff1df, 2.4);
  aKey.position.set(-1.2, 2.2, 1.6);
  aceScene.add(aKey, new THREE.HemisphereLight(0xdce8ff, 0x22262c, 0.5));

  /* the sky */
  const stars = createStars(narrow0 ? 5200 : 9000);
  world.add(stars);
  const [tex, sats] = await Promise.all([loadTextures(renderer, narrow0), createSats(new Date()), loadCAD()]);
  const E = createEarth(tex);
  world.add(E.group);
  const earth = E.earth;
  const ottawa = createMarker(OTTAWA.lat, OTTAWA.lon, 0xf5b83d, 0.011);
  earth.add(ottawa);
  const arcs = createArcs(CITIES);
  earth.add(arcs.group);
  world.add(sats.orbitGroup, sats.sightLines, sats.points);


  /* the parade: a frame on the surface through Kingston, heading north east */
  const paradeBase = new THREE.Object3D();
  earth.add(paradeBase);
  {
    const lat = KINGSTON.lat * U.DEG, lon = KINGSTON.lon * U.DEG;
    const p0 = U.ll(KINGSTON.lat, KINGSTON.lon).normalize();
    const east = new THREE.Vector3(-Math.sin(lon), 0, -Math.cos(lon));
    const north = new THREE.Vector3(-Math.sin(lat) * Math.cos(lon), Math.cos(lat), Math.sin(lat) * Math.sin(lon));
    const heading = north.clone().multiplyScalar(Math.cos(0.8)).addScaledVector(east, Math.sin(0.8)).normalize();
    const Z = heading.clone().negate();
    const Y = new THREE.Vector3().crossVectors(Z, p0).normalize();
    paradeBase.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(p0, Y, Z));
  }
  const paradeSpin = new THREE.Object3D();
  paradeBase.add(paradeSpin);
  const _f = new THREE.Vector3(), _u = new THREE.Vector3(), _sd = new THREE.Vector3(), _m = new THREE.Matrix4();
  // stand a robot on the track at a parade longitude, facing the way the parade drives
  function placeOnTrack(obj, lonDeg, alt) {
    const phi = lonDeg * U.DEG;
    obj.position.set(Math.cos(phi) * alt, 0, -Math.sin(phi) * alt);
    _f.set(-Math.sin(phi), 0, -Math.cos(phi));
    _u.copy(obj.position).normalize();
    _sd.crossVectors(_f, _u);
    obj.quaternion.setFromRotationMatrix(_m.makeBasis(_f, _u, _sd));
  }

  const robots = {};
  function shadows(model) {
    model.traverse((o) => { if (o.isMesh) { o.castShadow = !o.material.transparent; o.receiveShadow = true; } });
    return model;
  }
  // swap in the full detail CAD copy once it has loaded, while the robot is off stage
  function upgrade(R) {
    const m = shadows(buildModel(R.key, 'hi'));
    R.inner.remove(R.smodel);
    R.inner.add(m);
    R.smodel = m;
    R.sr = rig(R.key, m);
    R.wantHi = false;
  }
  PARADE.forEach((k, i) => {
    const def = DEFS[k];
    const model = buildModel(k, 'lo');
    const holder = new THREE.Group();
    holder.add(model);
    const s = 0.042 / def.radius;
    holder.scale.setScalar(s);
    const alt = k === 'plane' ? 1.04 : 1.0004;
    placeOnTrack(holder, PHI(i), alt);
    paradeSpin.add(holder);
    // the close up copy lives in the studio scene, inside a pivot at the model's focus point
    const smodel = shadows(buildModel(k, 'hi'));
    const pivot = new THREE.Group();
    const inner = new THREE.Group();
    inner.add(smodel);
    pivot.add(inner);
    pivot.visible = false;
    studio.add(pivot);
    robots[k] = { key: k, i, def, holder, model, s, alt, off: 0, r: rig(k, model), pivot, inner, smodel, sr: rig(k, smodel) };
  });

  /* the hero satellite */
  const gps = buildModel('gps');
  const gpsPivot = new THREE.Group();
  gpsPivot.add(gps);
  gpsPivot.visible = false;
  studio.add(gpsPivot);
  let heroSat = -1, heroName = '';

  /* ACE */
  const ace = buildModel('ace');
  aceScene.add(ace);
  const aceView = document.getElementById('ace-view');

  /* ---------------------------------------------------------------- */
  /* Director: keyframes tied to scroll positions inside chapters      */
  /* ---------------------------------------------------------------- */
  const O = OTTAWA;
  const CAM = {
    hero: { f: 'sun', lat: 14, lon: 64, d: 5.3, px: 0.655, py: 0.54, mpy: 0.3 },
    sys: { f: 'sun', lat: 6, lon: 84, d: 16.5, px: 0.64, py: 0.5, mpy: 0.29 },
    ott: { f: 'earth', lat: O.lat - 26, lon: O.lon + 44, d: 10.8, tlat: O.lat, tlon: O.lon, tr: 2.3, px: 0.63, py: 0.5, mpy: 0.3 },
    ab0: { f: 'earth', lat: 20, lon: -82, d: 3.6, px: 0.66, py: 0.52, mpy: 0.3 },
    ab1: { f: 'earth', lat: 24, lon: -22, d: 3.6, px: 0.66, py: 0.52, mpy: 0.3 },
    gl0: { f: 'earth', lat: 30, lon: 28, d: 3.3, px: 0.65, py: 0.5, mpy: 0.3 },
    parade: { f: 'parade', lat: 27, lon: -19.5, d: 1.8, tlat: -2, tlon: -19.5, tr: 1.0, up: 'r', px: 0.715, py: 0.5, mpy: 0.3, fov: 40 },
    show: (i, drift = 0) => ({ f: 'parade', lat: 10 + drift * 1.0, lon: PHI(i) + 1.5 - drift * 1.8, d: 1.12, tlat: 0, tlon: PHI(i), tr: 1.03, up: 'r', px: () => freeX(PARADE[i]), py: 0.5, mpy: 0.3 }),
    space: { f: 'sun', lat: 24, lon: 210, d: 24, tlat: 34, tlon: 236, tr: 80, px: 0.5, py: 0.5 },
    contact: { f: 'sun', lat: 14, lon: 62, d: 5.4, px: 0.68, py: 0.5, mpy: 0.3 },
  };
  const KEYS = [];
  const k = (id, u, o) => KEYS.push({ id, u, ...o });
  // sky
  // one step for the sky: out to the whole constellation, then straight down to Ottawa
  k('sky', 0, { cam: CAM.hero, rate: 240, gA: [1, 1, 1, 1], orb: 0, size: 5.5, vis: 0, lines: 0, ott: 0, hero: 0, lit: 0 });
  k('sky', 0.22, { cam: CAM.hero, hero: 0 });
  k('sky', 0.9, { hero: 1 });
  k('sky', 1.12, { cam: CAM.sys, rate: 480, gA: [1, 1, 1, 1], orb: 0.16, size: 6.5, vis: 0, lines: 0, ott: 0 });
  k('sky', 1.35, { cam: CAM.sys, orb: 0.16, vis: 0, lines: 0, ott: 0 });
  k('sky', 1.85, { cam: CAM.ott, rate: 90, orb: 0.04, vis: 1, lines: 0.6, ott: 1, size: 7.5 });
  k('sky', 2.3, { cam: CAM.ott, lines: 0.5, lit: 0 });
  // about
  k('about', 0, { cam: CAM.ab0, rate: 200, lines: 0, ott: 0, vis: 0, gA: [0.35, 0.35, 0.35, 0.35], size: 5, orb: 0, arcA: 0, lit: 0.75 });
  k('about', 2.4, { cam: CAM.ab1 });
  // FIRST Global: one flight, city to city, pulling up between them and coming down on arrival
  const hop = (c, d) => ({ f: 'earth', lat: c.lat - 12, lon: c.lon + 3, d, tlat: c.lat, tlon: c.lon, tr: 1, px: 0.65, py: 0.5, mpy: 0.3 });
  const midLL = (a, b) => U.toLL(U.ll(a.lat, a.lon).add(U.ll(b.lat, b.lon)));
  const T0 = 0.32, LEG = 0.46;
  k('global', 0, { cam: CAM.gl0, rate: 60, gA: [0, 0, 0, 0], arcA: 0, arc: 0, lit: 1 });
  k('global', T0, { cam: hop(CITIES[0], 2.5), arcA: 1, arc: 0 });
  for (let i = 1; i < CITIES.length; i++) {
    // pull up less on the short legs, so a hop next door doesn't bounce
    k('global', T0 + (i - 0.5) * LEG, { cam: hop(midLL(CITIES[i - 1], CITIES[i]), 2.5 + 0.8 * clamp(LEG_KM[i - 1] / 8000)) });
    k('global', T0 + i * LEG, { cam: hop(CITIES[i], 2.5), arc: i });
  }
  k('global', T0 + (CITIES.length - 1) * LEG + 0.2, { cam: hop(CITIES[CITIES.length - 1], 2.6) });
  // robots
  k('robots', -0.15, { arcA: 1, parade: 0, tags: 0 });
  k('robots', 0.25, { cam: CAM.parade, rate: 12, arcA: 0, parade: 1, tags: 1 });
  k('robots', 0.85, { cam: CAM.parade, tags: 1 });
  k('robots', 1.0, { tags: 0 });
  PARADE.forEach((key, i) => {
    const c = CH[key];
    k(key, 0.25, { cam: CAM.show(i, 0) });
    k(key, c.span - 0.15, { cam: CAM.show(i, 1) });
  });
  // projects, skills and work look out at the stars, then back home for contact
  k('projects', 0.1, { cam: CAM.show(5, 1), parade: 1, rate: 12 });
  k('projects', 0.95, { cam: CAM.space, parade: 0, rate: 120, gA: [0, 0, 0, 0], lit: 1 });
  k('contact', -0.85, { cam: CAM.space, rate: 120, gA: [0, 0, 0, 0], ott: 0 });
  k('contact', 0, { cam: CAM.contact, rate: 240, gA: [0.6, 0.6, 0.6, 0.6], size: 5, ott: 1, lit: 0 });

  let tracks = null;
  function buildTracks() {
    const resolved = KEYS.filter((kk) => CH[kk.id]).map((kk) => ({ ...kk, y: CH[kk.id].top + kk.u * CH[kk.id].unit })).sort((a, b) => a.y - b.y);
    tracks = {};
    for (const kk of resolved)
      for (const name of Object.keys(kk)) {
        if (name === 'id' || name === 'u' || name === 'y') continue;
        (tracks[name] = tracks[name] || []).push({ y: kk.y, v: kk[name] });
      }
  }
  function sampleIdx(tr, y) {
    if (y <= tr[0].y) return [0, 0, 0];
    const n = tr.length - 1;
    if (y >= tr[n].y) return [n, n, 0];
    let i = 0;
    while (i < n && tr[i + 1].y < y) i++;
    return [i, i + 1, (y - tr[i].y) / Math.max(1e-6, tr[i + 1].y - tr[i].y)];
  }
  function num(name, y, def = 0) {
    const tr = tracks[name];
    if (!tr) return def;
    const [a, b, t] = sampleIdx(tr, y);
    const A = tr[a].v, B = tr[b].v, e = smooth(t);
    if (Array.isArray(A)) return A.map((x, i) => lerp(x, B[i], e));
    return lerp(A, B, e);
  }

  /* camera rig */
  const sunDir = new THREE.Vector3(1, 0, 0);
  const mkCS = () => ({ pos: new THREE.Vector3(), target: new THREE.Vector3(), up: new THREE.Vector3(0, 1, 0), fov: 40, px: 0.5, py: 0.5, mpx: 0.5, mpy: 0.32 });
  const csA = mkCS(), csB = mkCS(), cs = mkCS();
  const tv = new THREE.Vector3();
  function framePoint(f, lat, lon, r, out) {
    if (f === 'earth') return earth.localToWorld(U.ll(lat, lon, r, out));
    if (f === 'parade') return paradeSpin.localToWorld(U.ll(lat, lon, r, out));
    if (f === 'sun') {
      const sl = Math.atan2(-sunDir.z, sunDir.x) / U.DEG;
      return U.ll(lat, lon + sl, r, out);
    }
    return U.ll(lat, lon, r, out);
  }
  function resolve(kf, out) {
    framePoint(kf.f, kf.lat, kf.lon, kf.d, out.pos);
    if (kf.tr && kf.tr > 0.001) framePoint(kf.f, kf.tlat ?? kf.lat, kf.tlon ?? kf.lon, kf.tr, out.target);
    else out.target.set(0, 0, 0);
    if (kf.up === 'r') out.up.copy(out.pos).normalize();
    else out.up.set(0, 1, 0);
    out.fov = kf.fov ?? 40;
    out.px = typeof kf.px === 'function' ? kf.px() : kf.px ?? 0.5; out.py = kf.py ?? 0.5;
    out.mpx = kf.mpx ?? 0.5; out.mpy = kf.mpy ?? 0.32;
    return out;
  }
  function cameraAt(y) {
    const tr = tracks.cam;
    const [a, b, t] = sampleIdx(tr, y);
    resolve(tr[a].v, csA);
    resolve(tr[b].v, csB);
    const e = a === b ? 0 : ease(t);
    U.slerpPoint(csA.pos, csB.pos, e, cs.pos);
    U.slerpPoint(csA.target, csB.target, e, cs.target);
    U.slerpDir(csA.up, csB.up, e, cs.up);
    cs.fov = lerp(csA.fov, csB.fov, e);
    cs.px = lerp(csA.px, csB.px, e); cs.py = lerp(csA.py, csB.py, e);
    cs.mpx = lerp(csA.mpx, csB.mpx, e); cs.mpy = lerp(csA.mpy, csB.mpy, e);
    return cs;
  }
  const place = { x: 0.5, y: 0.5 };
  function applyCamera(c) {
    const w = S.w, h = S.h, aspect = w / h;
    const narrow = S.narrow;
    const minH = narrow ? 36 : 30;
    const fov = Math.max(c.fov, (2 * Math.atan(Math.tan((minH * U.DEG) / 2) / aspect)) / U.DEG);
    place.x = narrow ? c.mpx : c.px;
    place.y = narrow ? c.mpy : c.py;
    for (const cm of [cam, scam]) {
      cm.fov = fov;
      cm.aspect = aspect;
      cm.setViewOffset(w, h, (0.5 - place.x) * w, (0.5 - place.y) * h, w, h);
      cm.updateProjectionMatrix();
    }
    cam.position.copy(c.pos);
    cam.up.copy(c.up);
    cam.lookAt(c.target);
    cam.updateMatrixWorld();
  }

  /* ---------------------------------------------------------------- */
  /* Studio poses                                                      */
  /* ---------------------------------------------------------------- */
  const qCamInv = new THREE.Quaternion();
  const tmpQ = new THREE.Quaternion(), tmpQ2 = new THREE.Quaternion();
  const vA = new THREE.Vector3(), vB = new THREE.Vector3(), vC = new THREE.Vector3();
  const qYaw = new THREE.Quaternion(), qPitch = new THREE.Quaternion();
  const X = new THREE.Vector3(1, 0, 0), Y = new THREE.Vector3(0, 1, 0);
  // distance that fits radius r into the free part of the screen
  function fitDistance(r, fill = 1, key = null) {
    const T = Math.tan((scam.fov * U.DEG) / 2);
    const h = S.h, w = S.w;
    const regionW = S.narrow ? w * 0.92 : key ? freeW(key) : w * 0.5, regionH = S.narrow ? h * 0.48 : h * 0.72;
    return (r * h) / (T * Math.min(regionW, regionH) * fill);
  }
  // pose of a world object as seen by the world camera, scaled into studio units
  function matchPose(worldObj, localCenter, radiusWorld, radiusStudio, outPos, outQ) {
    vA.copy(localCenter);
    worldObj.localToWorld(vA);
    vA.applyMatrix4(cam.matrixWorldInverse);
    outPos.copy(vA).multiplyScalar(radiusStudio / radiusWorld);
    worldObj.getWorldQuaternion(tmpQ);
    qCamInv.copy(cam.quaternion).invert();
    outQ.copy(qCamInv).multiply(tmpQ);
  }
  function viewQuat(yaw, pitch, out) {
    qYaw.setFromAxisAngle(Y, yaw * U.DEG);
    qPitch.setFromAxisAngle(X, pitch * U.DEG);
    return out.copy(qPitch).multiply(qYaw);
  }

  /* showcase state for one chapter */
  const centerV = new THREE.Vector3();
  const p0 = new THREE.Vector3(), p1 = new THREE.Vector3(), q0 = new THREE.Quaternion(), q1 = new THREE.Quaternion();
  function showcase(c, u, dt) {
    const R = robots[c.model];
    const def = R.def;
    const parts = c.steps.filter((s) => s.part);
    // view keys: intro, then the middle of each part's window
    const views = [{ u: 0.45, v: def.parts.intro }];
    parts.forEach((s) => views.push({ u: (s.at + s.until) / 2, v: def.parts[s.part] }));
    let vi = 0;
    while (vi < views.length - 1 && views[vi + 1].u < u) vi++;
    const va = views[vi], vb = views[Math.min(vi + 1, views.length - 1)];
    const tt = vb === va ? 0 : smooth(clamp((u - va.u) / (vb.u - va.u)));
    const yaw = lerp(va.v.yaw ?? def.yaw, vb.v.yaw ?? def.yaw, tt);
    const pitch = lerp(va.v.pitch ?? def.pitch, vb.v.pitch ?? def.pitch, tt);
    const zoom = lerp(va.v.zoom ?? 1, vb.v.zoom ?? 1, tt);
    const fa = va.v.focus || def.center, fb = vb.v.focus || def.center;
    centerV.set(lerp(fa[0], fb[0], tt), lerp(fa[1], fb[1], tt), lerp(fa[2], fb[2], tt));
    // exploded parts
    const offsets = {};
    let extra = { roll: 0, idle: 1 };
    const weights = {};
    parts.forEach((s) => {
      const w = band(u, s.at - 0.28, s.at + 0.02, s.until - 0.02, s.until + 0.28);
      weights[s.part] = w;
      const P = def.parts[s.part];
      if (P.nodes) for (const [n, off] of Object.entries(P.nodes)) {
        const o = offsets[n] || [0, 0, 0];
        offsets[n] = [o[0] + off[0] * w, o[1] + off[1] * w, o[2] + off[2] * w];
      }
      if (P.lift) extra.lift = Math.max(extra.lift || 0, w);
      if (P.hatch) extra.hatch = Math.max(extra.hatch || 0, w);
      if (P.banner) {
        extra.banner = smooth(clamp((u - (s.at - 0.25)) / 0.4));
        extra.release = smooth(clamp((u - (s.until - 0.05)) / 0.32));
      }
    });
    if (c.model === 'plane' && extra.banner == null) extra.banner = 0;
    applyPose(R.sr, offsets);
    // entering from the parade and leaving back to it
    const eIn = smooth(clamp(u / 0.5));
    const eOut = smooth(clamp((u - (c.span - 0.38)) / 0.38));
    const m = eIn * (1 - eOut);
    const rs = def.radius;
    R.inner.position.set(-centerV.x, -centerV.y, -centerV.z);
    // studio rest pose
    const D = fitDistance(rs, 0.84, c.model) / zoom;
    p1.set(0, 0, -D);
    viewQuat(yaw, pitch, q1);
    // parade pose
    vC.set(def.center[0], def.center[1], def.center[2]);
    matchPose(R.model, vC, rs * R.s, rs, p0, q0);
    // the studio pivot sits at the focus point, so shift the parade match to match
    vB.copy(centerV).sub(vC).applyQuaternion(q0);
    p0.add(vB);
    U.slerpPoint(p0, p1, m, R.pivot.position);
    R.pivot.quaternion.copy(q0).slerp(q1, m);
    const visible = m > 0.002;
    R.pivot.visible = visible;
    R.holder.visible = !visible;
    extra.roll = visible ? 2.2 * (1 - m) + 0.6 : 0;
    extra.prop = 1;
    animateModel(R.sr, dt, extra);
    return { R, weights, parts, m };
  }

  /* ---------------------------------------------------------------- */
  /* Frame loop                                                        */
  /* ---------------------------------------------------------------- */
  const cards = [...document.querySelectorAll('.ocard')];
  const S = {
    y: window.scrollY, yd: window.scrollY, w: window.innerWidth, h: window.innerHeight, narrow: narrow0,
    t: 0, sim: Date.now(), rate: 240, groupOn: [true, true, true, true], paradePhase: 0, ready: false, cueA: -1,
  };
  // test hooks, only with ?debug in the address
  if (/[?&]debug\b/.test(location.search)) Object.assign(window, { __S: S, __CH: CH, __R: robots });

  /* photos of the real thing beside each close up */
  const rails = {};
  PARADE.forEach((k2) => {
    const el = document.querySelector(`#${k2} .shots`);
    if (!el) return;
    const figs = [...el.querySelectorAll('.shot')].map((f) => {
      const img = f.querySelector('img');
      const ar = parseFloat(f.dataset.ar) || 4 / 3;
      img.style.aspectRatio = String(ar);
      if (f.dataset.pos) img.style.objectPosition = f.dataset.pos;
      return { el: f, part: f.dataset.part || null, ar, a: -1, x: -1, on: false };
    });
    rails[k2] = { el, figs, left: 0, idle: false };
  });
  let panelRight = 0;
  // as wide as fits the height, so a column of photos never runs off the screen
  function sizeRails() {
    const room = S.h - 210;
    const maxW = clamp(S.w * 0.15, 150, 236);
    for (const r of Object.values(rails)) {
      const n = r.figs.length;
      const inv = r.figs.reduce((a, f) => a + 1 / f.ar, 0);
      const w = clamp((room - n * 30 - (n - 1) * 12) / inv, 112, n === 1 ? maxW * 1.3 : maxW);
      r.el.style.width = w.toFixed(0) + 'px';
      r.left = S.w - (parseFloat(getComputedStyle(r.el).right) || 0) - w;
    }
    const pr = document.querySelector('.show .panel');
    panelRight = pr ? pr.getBoundingClientRect().right + 24 : S.w * 0.4;
  }
  const freeRight = (key) => (rails[key] && !S.narrow ? rails[key].left - 18 : S.w - 40);
  // middle of the space between the words and the photos, and how wide it is
  function freeX(key) { return clamp((panelRight + freeRight(key)) / 2 / S.w, 0.42, 0.74); }
  function freeW(key) { return Math.max(S.w * 0.28, freeRight(key) - panelRight); }
  function updateRail(key, c, u, sh) {
    const r = rails[key];
    if (!r) return;
    const near = !S.narrow && u > -0.3 && u < c.span + 0.3;
    if (!near && r.idle) return;
    r.idle = !near;
    const m = r.figs.map((f) => (f.part && sh ? sh.weights[f.part] || 0 : 0));
    const any = Math.max(0, ...m);
    r.figs.forEach((f, j) => {
      let a = 0, x = 0;
      if (near) {
        const enter = smooth(clamp((u - (0.2 + j * 0.08)) / 0.32));
        const exit = smooth(clamp((u - (c.span - 0.36 + j * 0.04)) / 0.24));
        a = enter * (1 - exit) * (1 - 0.5 * any * (1 - m[j]));
        x = (1 - enter) * 28 + exit * 16;
      }
      if (Math.abs(a - f.a) > 0.004 || Math.abs(x - f.x) > 0.3) {
        f.a = a; f.x = x;
        f.el.style.opacity = a.toFixed(3);
        f.el.style.transform = x > 0.3 ? `translate3d(${x.toFixed(1)}px, 0, 0)` : '';
        const live = a > 0.25;
        if (live !== f.el.classList.contains('live')) f.el.classList.toggle('live', live);
      }
      const on = m[j] > 0.5;
      if (on !== f.on) { f.on = on; f.el.classList.toggle('on', on); }
    });
  }
  let aboutPanelRight = 0;
  let navTops = [];
  let flowRange = [0, 0];
  function remeasure() {
    sizeRails();
    measureAll();
    buildTracks();
    graph.layout();
    const sy = window.scrollY;
    const topOf = (id) => { const el = document.getElementById(id); return el ? el.getBoundingClientRect().top + sy : 1e9; };
    navTops = ['about', 'global', 'robots', 'projects', 'work', 'contact'].map((id) => [id, topOf(id)]);
    flowRange = [topOf('projects'), topOf('contact')];
    const ap = document.querySelector('#about .panel');
    aboutPanelRight = ap ? ap.getBoundingClientRect().right + 24 : 0;
    cards.forEach((c) => { c._w = 0; c._h = 0; });
  }
  function resize() {
    S.w = window.innerWidth; S.h = window.innerHeight; S.narrow = U.isNarrow();
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, S.narrow ? 1.6 : 1.75));
    renderer.setSize(S.w, S.h, false);
    stars.material.uniforms.uPR.value = renderer.getPixelRatio();
    sats.uniforms.uPR.value = renderer.getPixelRatio();
    remeasure();
  }
  window.addEventListener('resize', resize);
  window.addEventListener('scroll', () => { S.y = window.scrollY; }, { passive: true });
  resize();
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(remeasure);
  window.addEventListener('load', remeasure);

  const ottW = new THREE.Vector3();
  const proj = new THREE.Vector3();
  const toScreen = (v, camera, out = { x: 0, y: 0, z: 0 }) => {
    proj.copy(v).project(camera);
    out.x = (proj.x * 0.5 + 0.5) * S.w;
    out.y = (-proj.y * 0.5 + 0.5) * S.h;
    out.z = proj.z;
    return out;
  };
  // is a world point hidden behind the Earth from the camera?
  const behindEarth = (p) => {
    const c = cam.position;
    vA.copy(p).sub(c);
    const L = vA.length();
    vA.divideScalar(L);
    const b = c.dot(vA);
    const disc = b * b - (c.lengthSq() - 0.995 * 0.995);
    if (disc < 0) return false;
    const t1 = -b - Math.sqrt(disc);
    return t1 > 0 && t1 < L - 1e-4;
  };
  const sc = { x: 0, y: 0, z: 0 };

  // pick the hero satellite: a GPS satellite in front of the Earth, toward the right of the hero view
  function pickHero() {
    let best = -1, bestScore = -1e9;
    sats.sats.forEach((s, i) => {
      if (s.group !== 0) return;
      const p = sats.world[i];
      if (behindEarth(p)) return;
      toScreen(p, cam, sc);
      if (sc.z > 1) return;
      const score = -Math.hypot(sc.x / S.w - 0.8, sc.y / S.h - 0.36) + cam.position.distanceTo(p) * -0.01;
      if (score > bestScore) { bestScore = score; best = i; }
    });
    return best;
  }

  let last = performance.now();
  let navId = '';
  let firstFrame = true;
  const cardAnchors = {
    edu: U.ll(30, -88, 1.4),
    now: U.ll(-8, -76, 1.46),
    night: U.ll(12, -64, 1.45),
    clubs: U.ll(34, -48, 1.42),
    athens: U.ll(6, -30, 1.45),
  };
  const clock = document.getElementById('clock');
  // stops light up as the flight reaches them, and the distance counts up along the way
  const stopEls = [...document.querySelectorAll('#stops li')];
  const kmEl = document.getElementById('fgc-km');
  let stopKey = '', kmText = '';
  function updateStops(p) {
    p = clamp(p, 0, LEG_KM.length);
    const i = Math.min(LEG_KM.length - 1, Math.floor(p));
    const km = SUM_KM[i] + LEG_KM[i] * (p - i);
    const t = U.fmt(Math.round(km / 10) * 10);
    if (kmEl && t !== kmText) { kmEl.textContent = t; kmText = t; }
    const st = stopEls.map((li, j) => (p + 0.02 < j ? 0 : Math.abs(p - j) < 0.3 ? 2 : 1));
    const key2 = st.join('');
    if (key2 === stopKey) return;
    stopKey = key2;
    stopEls.forEach((li, j) => { li.classList.toggle('on', st[j] > 0); li.classList.toggle('now', st[j] === 2); });
  }
  const cueEl = document.getElementById('cue');
  const bar = document.getElementById('bar');
  let clockText = '';

  function frame(now) {
    requestAnimationFrame(frame);
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    S.t += dt;
    // smooth the scroll a little so the camera glides
    S.yd = Math.abs(S.y - S.yd) > S.h * 6 || S.snap ? S.y : U.damp(S.yd, S.y, reduced ? 30 : 7.5, dt);
    const y = S.yd;

    // simulated time and the Earth
    const rate = num('rate', y, 200) * (reduced ? 0.25 : 1);
    S.rate = U.damp(S.rate, rate, 3, dt);
    S.sim += dt * 1000 * S.rate;
    const simDate = new Date(S.sim);
    U.sunDirection(simDate, sunDir);
    E.uniforms.sunDir.value.copy(sunDir);
    sunLight.position.copy(sunDir).multiplyScalar(10);
    const g = U.gmst(simDate);
    earth.rotation.y = g;
    E.clouds.rotation.y = g + S.t * 0.0025;
    E.uniforms.cloudShift.value = -(S.t * 0.0025) / (2 * Math.PI);
    S.paradePhase += dt * (reduced ? 0.03 : 0.12);
    paradeSpin.rotation.y = S.paradePhase * U.DEG;
    E.group.updateMatrixWorld(true);

    // camera
    applyCamera(cameraAt(y));
    // away from the satellite chapters the globe is lit from over the viewer's shoulder, so the story stays in daylight
    const lit = num('lit', y, 0);
    if (lit > 0.001) {
      vA.copy(cam.position).normalize();
      vB.setFromMatrixColumn(cam.matrixWorld, 0);
      vC.setFromMatrixColumn(cam.matrixWorld, 1);
      vA.multiplyScalar(0.72).addScaledVector(vB, -0.55).addScaledVector(vC, 0.42).normalize();
      U.slerpDir(sunDir, vA, lit, sunDir);
      E.uniforms.sunDir.value.copy(sunDir);
      sunLight.position.copy(sunDir).multiplyScalar(10);
    }
    stars.position.copy(cam.position);
    stars.material.uniforms.uTime.value = S.t;
    stars.material.uniforms.uTwinkle.value = reduced ? 0 : 1;

    // satellites
    ottawa.getWorldPosition(ottW);
    sats.update(simDate, ottW, S.groupOn);
    const gA = num('gA', y, [1, 1, 1, 1]);
    const onA = S.groupOn.map((on) => (on ? 1 : 0.0));
    sats.uniforms.uAlpha.value.set(gA[0] * onA[0], gA[1] * onA[1], gA[2] * onA[2], gA[3] * onA[3]);
    sats.uniforms.uSize.value = num('size', y, 6) * (S.narrow ? 0.85 : 1);
    sats.uniforms.uVisMode.value = num('vis', y, 0);
    const orb = num('orb', y, 0);
    sats.orbitMats.forEach((m, i) => { m.opacity = orb * gA[i] * onA[i]; m.visible = m.opacity > 0.004; });
    const lines = num('lines', y, 0);
    sats.lineMat.opacity = lines;
    sats.sightLines.visible = lines > 0.01;

    // Ottawa marker
    const ottA = num('ott', y, 0);
    ottawa.visible = ottA > 0.01;
    ottawa.userData.dot.material.opacity = ottA;
    ottawa.userData.ring.material.opacity = ottA * (0.45 + 0.35 * Math.sin(S.t * 2.2));
    ottawa.userData.ring.scale.setScalar(1 + 0.25 * (0.5 + 0.5 * Math.sin(S.t * 2.2)));

    // FIRST Global arcs, and the list of stops beside them
    const arcA = num('arcA', y, 0);
    const arcP = num('arc', y, 0);
    arcs.group.visible = arcA > 0.01;
    arcs.setProgress(arcP, arcA);
    const uG = UI.localU(CH.global, y);
    if (uG > -1 && uG < CH.global.span + 1) updateStops(arcP);

    // parade
    const paradeA = num('parade', y, 0);
    paradeSpin.visible = paradeA > 0.01;
    // during a close up the rest of the parade drives off to give it the stage, tied to the scroll
    const feat = PARADE.map((k2) => {
      const c = CH[k2], u = UI.localU(c, y);
      // the rest come back only once the photos beside this one have faded
      return band(u, -0.05, 0.25, c.span - 0.3, c.span + 0.15);
    });
    for (const k2 of PARADE) {
      const R = robots[k2];
      R.holder.visible = paradeSpin.visible;
      let off = 0;
      feat.forEach((f, i) => { if (i !== R.i) off += f * (R.i < i ? 16 : -16); });
      const moving = Math.abs(off - R.off) / Math.max(dt, 1e-3);
      R.off = off;
      const bob = k2 === 'plane' ? Math.sin(S.t * 0.8) * 0.004 : 0;
      placeOnTrack(R.holder, PHI(R.i) + R.off, R.alt + bob);
      animateModel(R.r, dt, { roll: 7.0 + Math.min(moving, 30) * 0.6, idle: 1, prop: 1, banner: 0 });
    }

    // studio: hero satellite or a robot
    let studioOn = false;
    let show = null;
    const sky = CH.sky;
    const uSky = UI.localU(sky, y);
    const heroK = num('hero', y, 0);
    labels.begin();
    if (uSky < 1.3 && heroK < 0.999) {
      studioOn = true;
      gpsPivot.visible = true;
      if (heroSat < 0 || firstFrame) {
        heroSat = pickHero();
        const s = sats.sats[heroSat];
        heroName = s ? `GPS satellite, PRN ${s.prn || cleanName(s.name)}` : 'GPS satellite';
      }
      // rest pose: right of the Earth, a little toward the camera
      const r = DEFS.gps.radius;
      const D = fitDistance(r, S.narrow ? 0.62 : 0.66);
      const T = Math.tan((scam.fov * U.DEG) / 2);
      const sx = S.narrow ? 0.66 : 0.82, sy = S.narrow ? 0.18 : 0.36;
      p1.set((sx - place.x) * 2 * D * T * (S.w / S.h), (place.y - sy) * 2 * D * T, -D);
      // nadir toward where the Earth sits on screen and a little into the scene, wings across the sun line
      toScreen(vA.set(0, 0, 0), cam, sc);
      const upv = vB.set(sx - sc.x / S.w, (sc.y / S.h - sy) * (S.h / S.w), 0).normalize().multiplyScalar(0.75);
      upv.z = 0.55;
      upv.normalize();
      const sunCam = vC.copy(sunDir).transformDirection(cam.matrixWorldInverse);
      const xAxis = new THREE.Vector3().crossVectors(upv, sunCam).normalize();
      const zAxis = new THREE.Vector3().crossVectors(xAxis, upv).normalize();
      q1.setFromRotationMatrix(new THREE.Matrix4().makeBasis(xAxis, upv, zAxis));
      tmpQ2.setFromAxisAngle(upv, Math.sin(S.t * 0.15) * 0.15);
      q1.premultiply(tmpQ2);
      // target: the dot of that satellite
      const sp = heroSat >= 0 ? sats.world[heroSat] : vA.set(0, 0, 0);
      p0.copy(sp).applyMatrix4(cam.matrixWorldInverse).multiplyScalar(r / 0.02);
      const m = smooth(heroK);
      U.slerpPoint(p1, p0, m, gpsPivot.position);
      gpsPivot.quaternion.copy(q1);
      gpsPivot.position.y += Math.sin(S.t * 0.6) * 0.02 * D * (1 - m);
      // panels face the sun
      const sunModel = vA.copy(sunCam).applyQuaternion(tmpQ.copy(q1).invert());
      const ang = Math.atan2(sunModel.z, sunModel.y);
      const wa = gps.getObjectByName('wingA'), wb = gps.getObjectByName('wingB');
      if (wa) wa.rotation.x = ang;
      if (wb) wb.rotation.x = ang;
      key.position.copy(sunCam).multiplyScalar(10);
      key.intensity = 3.0;
      rim.intensity = 0.25;
      fill.intensity = 0.12;
      studio.environmentIntensity = 0.14;
      sats.uniforms.uHide.value = heroSat;
      sats.uniforms.uHideAlpha.value = smooth(clamp((heroK - 0.75) / 0.25));
      // label next to the satellite
      const a = gps.getObjectByName('a_body');
      a.getWorldPosition(vA);
      toScreen(vA, scam, sc);
      const la = (1 - smooth(clamp(heroK * 3))) * (S.ready ? 1 : 0);
      labels.place('hero', heroName, 'dim', sc.x, sc.y, la, S.narrow ? -30 : 34, S.narrow ? 46 : 40);
    } else {
      gpsPivot.visible = false;
      sats.uniforms.uHide.value = -1;
    }

    for (const k2 of PARADE) {
      const c = CH[k2];
      const u = UI.localU(c, y);
      const R = robots[k2];
      if (R.wantHi && !R.pivot.visible) upgrade(R);
      let mine = null;
      if (u > -0.05 && u < c.span + 0.05) {
        show = mine = showcase(c, u, dt);
        studioOn = studioOn || show.R.pivot.visible;
      } else {
        R.pivot.visible = false;
      }
      updateRail(k2, c, u, mine);
    }
    key.castShadow = !!show;
    if (show) {
      const P = show.R.pivot.position, r = show.R.def.radius;
      key.target.position.copy(P);
      key.position.set(-4, 7, 6).normalize().multiplyScalar(r * 6).add(P);
      const shc = key.shadow.camera;
      shc.left = shc.bottom = -r * 1.3; shc.right = shc.top = r * 1.3;
      shc.near = r * 2; shc.far = r * 10;
      shc.updateProjectionMatrix();
      key.intensity = 2.6;
      rim.position.set(6, 3, -7);
      rim.intensity = 1.2;
      fill.intensity = 0.35;
      studio.environmentIntensity = 0.7;
    }

    // labels in the world
    if (ottA > 0.01) {
      toScreen(ottW, cam, sc);
      const facing = vA.copy(ottW).normalize().dot(vB.copy(cam.position).sub(ottW).normalize());
      labels.place('ottawa', 'Ottawa', '', sc.x, sc.y, ottA * smooth(clamp(facing * 6)), 14, -18, { pin: false });
    }
    if (arcA > 0.01) {
      const ap = num('arc', y, 0);
      arcs.dots.forEach((d, i) => {
        const on = clamp(ap - i + 1) * arcA;
        d.getWorldPosition(vC);
        toScreen(vC, cam, sc);
        const facing = vA.copy(vC).normalize().dot(vB.copy(cam.position).sub(vC).normalize());
        // on phones the words sit in a sheet over the bottom of the screen, so labels behind it fade out
        const under = S.narrow ? smooth(clamp((S.h * 0.5 - sc.y) / 50)) : 1;
        // and any label fades before reaching the edge of the screen instead of getting cut off
        const left = CITIES[i].left;
        const edge = smooth(clamp((left ? sc.x - 150 : S.w - 150 - sc.x) / 60)) * smooth(clamp((S.h - sc.y) / 60)) * smooth(clamp((sc.y - 90) / 50));
        labels.place('city' + i, `<b>${CITIES[i].year}</b>${CITIES[i].name}`, 'city', sc.x, sc.y, on * smooth(clamp(facing * 5)) * under * edge, left ? -14 : 14, -20, { pin: false });
      });
    }
    const tagsA = num('tags', y, 0);
    if (tagsA > 0.01 && paradeSpin.visible) {
      PARADE.forEach((k2, i) => {
        const R = robots[k2];
        vC.set(0, R.def.center[1] * 2.0 + R.def.radius * 0.35, 0);
        R.model.localToWorld(vC);
        toScreen(vC, cam, sc);
        const hidden = behindEarth(vC) || sc.z > 1;
        labels.place('robot' + i, NAMES[k2], 'link', sc.x, sc.y, hidden ? 0 : tagsA, 0, -22, { href: '#' + k2 });
      });
    }
    // callouts on the close up robot
    if (show && show.m > 0.6) {
      show.parts.forEach((s) => {
        const w = show.weights[s.part] * smooth(clamp((show.m - 0.6) / 0.4));
        if (w < 0.01) return;
        const P = show.R.def.parts[s.part];
        (P.anchors || []).forEach((an, j) => {
          const o = show.R.sr.anchors[an] || show.R.smodel.getObjectByName(an);
          if (!o) return;
          o.getWorldPosition(vA);
          toScreen(vA, scam, sc);
          const cxs = place.x * S.w;
          const dx = sc.x >= cxs ? 46 : -46;
          if (j === 0) labels.place(`call${s.part}`, s.title || (s.title = s.el.querySelector('h3').textContent), '', sc.x, sc.y, w, dx, -34, { maxX: S.narrow ? S.w - 8 : freeRight(show.R.key) + 8, minX: S.narrow ? 8 : panelRight });
          else labels.dot(`call${s.part}${j}`, sc.x, sc.y, w);
        });
      });
    }
    // About: cards orbiting the planet
    const uA = UI.localU(CH.about, y);
    if (uA > -0.9 && uA < CH.about.span + 0.9) {
      const panelRight = S.narrow ? -1 : aboutPanelRight;
      cards.forEach((el) => {
        const p = cardAnchors[el.dataset.card];
        vC.copy(p);
        earth.localToWorld(vC);
        toScreen(vC, cam, sc);
        const hidden = behindEarth(vC) || sc.z > 1;
        const w = el._w || (el._w = el.offsetWidth), h = el._h || (el._h = el.offsetHeight);
        let x = sc.x - w / 2, yy = sc.y - h / 2;
        const enter = smooth(clamp((uA + 0.6) / 0.6)) * (1 - smooth(clamp((uA - CH.about.span + 0.1) / 0.5)));
        let a = hidden ? 0 : enter;
        if (!S.narrow) a *= smooth(clamp((x - panelRight) / 90));
        else a *= smooth(clamp((S.h * 0.58 - (yy + h)) / 60));
        // fade before reaching an edge instead of getting cut off
        a *= smooth(clamp((S.h - 14 - (yy + h)) / 70)) * smooth(clamp((yy - 66) / 50)) * smooth(clamp((S.w - 14 - (x + w)) / 70)) * smooth(clamp((x - 10) / 50));
        const depth = clamp(1.25 - cam.position.distanceTo(vC) / 6, 0.75, 1.1);
        el.style.opacity = a.toFixed(3);
        el.style.transform = `translate3d(${x.toFixed(1)}px, ${yy.toFixed(1)}px, 0) scale(${depth.toFixed(3)})`;
        el.style.visibility = a > 0.01 ? 'visible' : 'hidden';
      });
    }

    labels.end();

    const cueA = (1 - smooth(clamp(uSky / 0.25))) * (S.ready ? 1 : 0);
    if (Math.abs(cueA - S.cueA) > 0.003) { cueEl.style.opacity = cueA.toFixed(3); S.cueA = cueA; }

    // text steps
    UI.updateSteps(chapters, y, S.h);

    // clock
    const clockOn = (uSky < CH.sky.span + 0.5 || UI.localU(CH.contact, y) > -0.5) && lit < 0.2;
    const d = simDate;
    const r2 = S.rate;
    const t = `${MONTHS[d.getUTCMonth()]} ${d.getUTCDate()}, ${String(d.getUTCHours()).padStart(2, '0')}:${String(d.getUTCMinutes()).padStart(2, '0')} UTC, ${r2 < 1.5 ? 'real time' : `time running ${Math.round(r2)} times faster`}`;
    if (t !== clockText) { clock.textContent = t; clockText = t; }
    clock.style.opacity = clockOn && S.ready ? 1 : 0;

    // header and nav
    const mid = window.scrollY + S.h * 0.4;
    let id = 'sky';
    for (const [cid, top] of navTops) if (top <= mid) id = cid;
    if (id !== navId) { UI.setNav(id); navId = id; }
    const sy0 = window.scrollY + 60;
    const inFlow = sy0 > flowRange[0] && sy0 < flowRange[1];
    if (inFlow !== bar.classList.contains('solid')) bar.classList.toggle('solid', inFlow);

    // render
    renderer.setScissorTest(false);
    renderer.setViewport(0, 0, S.w, S.h);
    renderer.clear();
    renderer.render(world, cam);
    if (studioOn) {
      renderer.clearDepth();
      renderer.render(studio, scam);
    }
    // ACE in its box
    const ar = aceView.getBoundingClientRect();
    if (ar.bottom > 0 && ar.top < S.h && ar.width > 20) {
      const open = smooth(clamp((S.h * 0.75 - (ar.top + ar.height * 0.5)) / (S.h * 0.5)));
      setACE(ace, open);
      acam.aspect = ar.width / ar.height;
      acam.updateProjectionMatrix();
      // a little like the photo: from the front, above, turning slowly as the cover moves
      const yaw = lerp(0.52, 0.22, open), pitch = lerp(0.7, 0.64, open);
      const dist = 1.68 / Math.min(1, acam.aspect / 1.2);
      acam.position.set(Math.sin(yaw) * Math.cos(pitch) * dist, 0.11 + Math.sin(pitch) * dist, Math.cos(yaw) * Math.cos(pitch) * dist);
      acam.lookAt(0, 0.12, 0.0);
      const vx = ar.left, vy = S.h - ar.bottom;
      renderer.setScissorTest(true);
      renderer.setScissor(vx, vy, ar.width, ar.height);
      renderer.setViewport(vx, vy, ar.width, ar.height);
      renderer.setClearColor(0x0b0e12, 1);
      renderer.clear(true, true, false);
      renderer.setClearColor(0x06080b, 1);
      renderer.render(aceScene, acam);
      renderer.setScissorTest(false);
      renderer.setViewport(0, 0, S.w, S.h);
      if (!html.classList.contains('has-ace')) html.classList.add('has-ace');
    }

    if (firstFrame) {
      firstFrame = false;
      setTimeout(() => loadCAD('hi').then((names) => { names.forEach((n) => { if (robots[n]) robots[n].wantHi = true; }); S.hiReady = true; }), 600);
      canvas.style.opacity = '1';
      S.ready = true;
    }
  }
  requestAnimationFrame((t) => { last = t; frame(t); });
}
