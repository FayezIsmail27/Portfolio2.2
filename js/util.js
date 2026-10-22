import * as THREE from 'three';

export const DEG = Math.PI / 180;
export const EARTH_KM = 6371;

export const clamp = (v, a = 0, b = 1) => Math.min(b, Math.max(a, v));
export const lerp = (a, b, t) => a + (b - a) * t;
export const invLerp = (a, b, v) => clamp((v - a) / (b - a));
export const smooth = (t) => t * t * (3 - 2 * t);
export const ease = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
export const easeOut = (t) => 1 - Math.pow(1 - t, 3);
export const damp = (a, b, lambda, dt) => lerp(a, b, 1 - Math.exp(-lambda * dt));

// A soft window: 0 before a, ramps to 1 by b, holds, ramps down from c to 0 at d.
export function band(p, a, b, c, d) {
  if (p <= a || p >= d) return 0;
  if (p < b) return smooth((p - a) / (b - a));
  if (p > c) return smooth((d - p) / (d - c));
  return 1;
}

// Earth fixed latitude and longitude (degrees) to a point in three.js space.
// x = cos(lat) cos(lon), y = sin(lat), z = negative cos(lat) sin(lon)
export function ll(lat, lon, r = 1, out = new THREE.Vector3()) {
  const a = lat * DEG, b = lon * DEG;
  return out.set(Math.cos(a) * Math.cos(b) * r, Math.sin(a) * r, -Math.cos(a) * Math.sin(b) * r);
}

export function toLL(v) {
  const r = v.length();
  return { lat: Math.asin(v.y / r) / DEG, lon: Math.atan2(-v.z, v.x) / DEG, r };
}

const _a = new THREE.Vector3(), _b = new THREE.Vector3();
export function slerpDir(a, b, t, out = new THREE.Vector3()) {
  _a.copy(a).normalize(); _b.copy(b).normalize();
  let d = clamp(_a.dot(_b), -1, 1);
  const om = Math.acos(d);
  if (om < 1e-4) return out.copy(_a).lerp(_b, t).normalize();
  if (Math.PI - om < 1e-3) {
    // nearly opposite: go through a perpendicular so the path is defined
    const perp = Math.abs(_a.y) < 0.9 ? new THREE.Vector3(0, 1, 0) : new THREE.Vector3(1, 0, 0);
    perp.sub(_a.clone().multiplyScalar(perp.dot(_a))).normalize();
    if (t < 0.5) return slerpDir(_a, perp, t * 2, out);
    return slerpDir(perp, _b, t * 2 - 1, out);
  }
  const s = Math.sin(om);
  return out.copy(_a).multiplyScalar(Math.sin((1 - t) * om) / s).addScaledVector(_b, Math.sin(t * om) / s);
}

// Interpolate two points around the origin: direction on the sphere, radius in log space.
export function slerpPoint(a, b, t, out = new THREE.Vector3()) {
  const ra = Math.max(a.length(), 1e-6), rb = Math.max(b.length(), 1e-6);
  if (ra < 0.02 || rb < 0.02) return out.copy(a).lerp(b, t);
  slerpDir(a, b, t, out);
  return out.multiplyScalar(Math.exp(lerp(Math.log(ra), Math.log(rb), t)));
}

export function greatCircleKm(lat1, lon1, lat2, lon2) {
  const p1 = lat1 * DEG, p2 = lat2 * DEG, dl = (lon2 - lon1) * DEG;
  const c = Math.sin(p1) * Math.sin(p2) + Math.cos(p1) * Math.cos(p2) * Math.cos(dl);
  return Math.acos(clamp(c, -1, 1)) * EARTH_KM;
}

export const fmt = (n) => Math.round(n).toLocaleString('en-US');

// Sun direction in three.js inertial space for a date (low precision solar position).
export function sunDirection(date, out = new THREE.Vector3()) {
  const jd = date.getTime() / 86400000 + 2440587.5;
  const n = jd - 2451545.0;
  const L = (280.46 + 0.9856474 * n) * DEG;
  const g = (357.528 + 0.9856003 * n) * DEG;
  const lam = L + (1.915 * Math.sin(g) + 0.02 * Math.sin(2 * g)) * DEG;
  const eps = (23.439 - 0.0000004 * n) * DEG;
  const ra = Math.atan2(Math.cos(eps) * Math.sin(lam), Math.cos(lam));
  const dec = Math.asin(Math.sin(eps) * Math.sin(lam));
  // ECI (x, y, z) to three (x, z, negative y)
  return out.set(Math.cos(dec) * Math.cos(ra), Math.sin(dec), -Math.cos(dec) * Math.sin(ra));
}

// Greenwich sidereal angle in radians (same formula satellite.js uses).
export function gmst(date) {
  const jd = date.getTime() / 86400000 + 2440587.5;
  const t = (jd - 2451545.0) / 36525;
  let g = -6.2e-6 * t * t * t + 0.093104 * t * t + (876600.0 * 3600 + 8640184.812866) * t + 67310.54841;
  g = ((g * DEG) / 240.0) % (2 * Math.PI);
  return g < 0 ? g + 2 * Math.PI : g;
}

export function isNarrow() {
  return window.innerWidth < 760 || window.innerWidth / window.innerHeight < 0.8;
}

export const prefersReducedMotion = () =>
  window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
