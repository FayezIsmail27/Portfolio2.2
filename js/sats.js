import * as THREE from 'three';
import { twoline2satrec, json2satrec } from '../vendor/satellite/io.js';
import { propagate } from '../vendor/satellite/propagation.js';
import { gmst } from './util.js';

const KM = 6371;

export const GROUPS = [
  { key: 'gps', name: 'GPS', color: '#F5B83D', real: true },
  { key: 'gal', name: 'Galileo', color: '#4CC38A', real: true },
  { key: 'glo', name: 'GLONASS', color: '#E5604F', real: false },
  { key: 'bds', name: 'BeiDou', color: '#5B8DEF', real: false },
];

// TLE names carry dashes, which never reach the page.
export const cleanName = (s) => s.replace(/\s*\(.*?\)\s*/g, ' ').replace(/[-_]+/g, ' ').replace(/\s+/g, ' ').trim();
const prnOf = (s) => {
  const m = s.match(/PRN\s*(\d+)/i);
  return m ? m[1].replace(/^0/, '') : '';
};

function parseTLE(text, group) {
  const lines = text.split(/\r?\n/).map((s) => s.trimEnd()).filter((s) => s.trim().length);
  const out = [];
  for (let i = 0; i + 2 < lines.length; i += 3) {
    const name = lines[i] && lines[i].trim();
    const l1 = lines[i + 1], l2 = lines[i + 2];
    if (!l1 || !l2 || l1[0] !== '1' || l2[0] !== '2') continue;
    try {
      const rec = twoline2satrec(l1, l2);
      if (rec && !rec.error) out.push({ name, group, rec, real: true, prn: prnOf(name) });
    } catch (e) { /* skip a bad element set */ }
  }
  return out;
}

// Nominal orbits from each system's published design, as OMM records for satellite.js.
function omm(name, id, mm, inc, raan, ma, epoch, ecc = 0.0005, argp = 0) {
  return json2satrec({
    OBJECT_NAME: name,
    OBJECT_ID: '2026-000A',
    EPOCH: epoch,
    MEAN_MOTION: mm,
    ECCENTRICITY: ecc,
    INCLINATION: inc,
    RA_OF_ASC_NODE: ((raan % 360) + 360) % 360,
    ARG_OF_PERICENTER: argp,
    MEAN_ANOMALY: ((ma % 360) + 360) % 360,
    EPHEMERIS_TYPE: 0,
    CLASSIFICATION_TYPE: 'U',
    NORAD_CAT_ID: id,
    ELEMENT_SET_NO: 999,
    REV_AT_EPOCH: 1,
    BSTAR: 0,
    MEAN_MOTION_DOT: 0,
    MEAN_MOTION_DDOT: 0,
  });
}

function nominal(now) {
  const ep = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const epoch = ep.toISOString();
  const g0 = (gmst(ep) * 180) / Math.PI;
  const out = [];
  let id = 90001;
  // GLONASS: 24 slots, 3 planes 120 degrees apart, 64.8 degrees, period 11 h 15 min
  for (let p = 0; p < 3; p++)
    for (let s = 0; s < 8; s++)
      out.push({ name: `GLONASS slot ${p * 8 + s + 1}`, group: 2, real: false,
        rec: omm('GLONASS', id++, 2.13102, 64.8, 15 + p * 120, s * 45 + p * 15, epoch) });
  // BeiDou: 24 MEO in a Walker 24/3/1 pattern at 55 degrees
  for (let p = 0; p < 3; p++)
    for (let s = 0; s < 8; s++)
      out.push({ name: `BeiDou MEO ${p * 8 + s + 1}`, group: 3, real: false,
        rec: omm('BEIDOU', id++, 1.86231, 55, 40 + p * 120, s * 45 + p * 15, epoch) });
  // BeiDou: 3 geostationary over Asia
  [80, 110.5, 140].forEach((lon, k) =>
    out.push({ name: `BeiDou GEO ${k + 1}`, group: 3, real: false,
      rec: omm('BEIDOU', id++, 1.00273791, 0.05, 0, lon + g0, epoch, 0.0002) }));
  // BeiDou: 3 inclined geosynchronous, figure eights centred near 118 degrees east
  [0, 120, 240].forEach((ma, k) =>
    out.push({ name: `BeiDou IGSO ${k + 1}`, group: 3, real: false,
      rec: omm('BEIDOU', id++, 1.00273791, 55, 118 + g0 - ma, ma, epoch, 0.0002) }));
  return out;
}

const eciToThree = (p, out) => out.set(p.x / KM, p.z / KM, -p.y / KM);

export async function createSats(now) {
  const fetchText = (u) => fetch(u).then((r) => (r.ok ? r.text() : '')).catch(() => '');
  const [gpsTxt, galTxt] = await Promise.all([fetchText('data/gps.txt'), fetchText('data/galileo.txt')]);
  const sats = [...parseTLE(gpsTxt, 0), ...parseTLE(galTxt, 1), ...nominal(now)];
  const N = sats.length;

  // points
  const pos = new Float32Array(N * 3);
  const grp = new Float32Array(N);
  const idx = new Float32Array(N);
  const vis = new Float32Array(N);
  sats.forEach((s, i) => { grp[i] = s.group; idx[i] = i; });
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3).setUsage(THREE.DynamicDrawUsage));
  geo.setAttribute('aGroup', new THREE.BufferAttribute(grp, 1));
  geo.setAttribute('aIndex', new THREE.BufferAttribute(idx, 1));
  geo.setAttribute('aVis', new THREE.BufferAttribute(vis, 1).setUsage(THREE.DynamicDrawUsage));
  geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 8);
  const colors = GROUPS.map((g) => new THREE.Color(g.color));
  const uniforms = {
    uColors: { value: colors },
    uAlpha: { value: new THREE.Vector4(1, 1, 1, 1) },
    uSize: { value: 6 },
    uPR: { value: 1 },
    uVisMode: { value: 0 },
    uHide: { value: -1 },
    uHideAlpha: { value: 1 },
  };
  const mat = new THREE.ShaderMaterial({
    uniforms,
    vertexShader: /* glsl */`
      attribute float aGroup; attribute float aIndex; attribute float aVis;
      uniform vec3 uColors[4]; uniform vec4 uAlpha;
      uniform float uSize, uPR, uVisMode, uHide, uHideAlpha;
      varying vec3 vCol; varying float vA;
      void main() {
        float g = aGroup;
        float a = g < 0.5 ? uAlpha.x : g < 1.5 ? uAlpha.y : g < 2.5 ? uAlpha.z : uAlpha.w;
        vCol = g < 0.5 ? uColors[0] : g < 1.5 ? uColors[1] : g < 2.5 ? uColors[2] : uColors[3];
        float seen = mix(1.0, mix(0.22, 1.0, aVis), uVisMode);
        float s = uSize * mix(1.0, mix(0.75, 1.3, aVis), uVisMode);
        if (abs(aIndex - uHide) < 0.5) a *= uHideAlpha;
        vA = a * seen;
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        gl_Position = projectionMatrix * mv;
        gl_PointSize = s * uPR;
      }`,
    fragmentShader: /* glsl */`
      varying vec3 vCol; varying float vA;
      void main() {
        float d = length(gl_PointCoord - 0.5);
        float a = 1.0 - smoothstep(0.34, 0.5, d);
        float core = 1.0 - smoothstep(0.0, 0.34, d) * 0.18;
        if (a * vA < 0.01) discard;
        gl_FragColor = vec4(vCol * core, a * vA);
        #include <colorspace_fragment>
      }`,
    transparent: true,
    depthWrite: false,
  });
  const points = new THREE.Points(geo, mat);
  points.renderOrder = 6;

  // orbit loops, one geometry per system
  const orbitGroup = new THREE.Group();
  const orbitMats = GROUPS.map((g) => new THREE.LineBasicMaterial({ color: g.color, transparent: true, opacity: 0, depthWrite: false }));
  const S = 180;
  const segs = GROUPS.map(() => []);
  const v = new THREE.Vector3();
  const t0 = now.getTime();
  sats.forEach((s) => {
    const periodMin = (2 * Math.PI) / s.rec.no;
    s.period = periodMin;
    const ring = [];
    for (let k = 0; k < S; k++) {
      const pv = propagate(s.rec, new Date(t0 + (k / S) * periodMin * 60000));
      if (!pv || !pv.position || !isFinite(pv.position.x)) { ring.length = 0; break; }
      ring.push(eciToThree(pv.position, v).clone());
    }
    if (ring.length < S) return;
    const arr = segs[s.group];
    for (let k = 0; k < S; k++) {
      const a = ring[k], b = ring[(k + 1) % S];
      arr.push(a.x, a.y, a.z, b.x, b.y, b.z);
    }
  });
  const orbitLines = segs.map((arr, gi) => {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(arr, 3));
    const l = new THREE.LineSegments(g, orbitMats[gi]);
    l.renderOrder = 5;
    l.frustumCulled = false;
    orbitGroup.add(l);
    return l;
  });

  // lines from an observer to every satellite above its horizon
  const lineGeo = new THREE.BufferGeometry();
  const linePos = new Float32Array(N * 6);
  const lineCol = new Float32Array(N * 6);
  lineGeo.setAttribute('position', new THREE.BufferAttribute(linePos, 3).setUsage(THREE.DynamicDrawUsage));
  lineGeo.setAttribute('color', new THREE.BufferAttribute(lineCol, 3).setUsage(THREE.DynamicDrawUsage));
  lineGeo.setDrawRange(0, 0);
  const lineMat = new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, opacity: 0, depthWrite: false });
  const sightLines = new THREE.LineSegments(lineGeo, lineMat);
  sightLines.frustumCulled = false;
  sightLines.renderOrder = 5;

  const world = sats.map(() => new THREE.Vector3());
  const counts = { total: GROUPS.map((_, g) => sats.filter((s) => s.group === g).length), visible: [0, 0, 0, 0] };
  const tmp = new THREE.Vector3(), up = new THREE.Vector3();
  const sinMask = Math.sin((10 * Math.PI) / 180);

  function update(date, observer, groupOn) {
    let n = 0;
    counts.visible.fill(0);
    up.copy(observer).normalize();
    for (let i = 0; i < N; i++) {
      const s = sats[i];
      const pv = propagate(s.rec, date);
      if (!pv || !pv.position || !isFinite(pv.position.x)) { pos[i * 3 + 1] = 1e4; continue; }
      eciToThree(pv.position, world[i]);
      pos[i * 3] = world[i].x; pos[i * 3 + 1] = world[i].y; pos[i * 3 + 2] = world[i].z;
      tmp.copy(world[i]).sub(observer).normalize();
      const seen = tmp.dot(up) > sinMask;
      vis[i] = seen ? 1 : 0;
      if (seen) {
        counts.visible[s.group]++;
        if (groupOn[s.group]) {
          const c = colors[s.group];
          linePos.set([observer.x, observer.y, observer.z, world[i].x, world[i].y, world[i].z], n * 6);
          lineCol.set([c.r, c.g, c.b, c.r, c.g, c.b], n * 6);
          n++;
        }
      }
    }
    geo.attributes.position.needsUpdate = true;
    geo.attributes.aVis.needsUpdate = true;
    lineGeo.attributes.position.needsUpdate = true;
    lineGeo.attributes.color.needsUpdate = true;
    lineGeo.setDrawRange(0, n * 2);
  }

  return { sats, points, orbitGroup, orbitLines, orbitMats, sightLines, lineMat, uniforms, world, counts, update };
}
