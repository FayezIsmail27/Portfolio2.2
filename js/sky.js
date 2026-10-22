import * as THREE from 'three';
import { ll, slerpDir, DEG } from './util.js';

/* Stars: points on a unit sphere, drawn at infinity (the group follows the camera). */
export function createStars(count = 9000) {
  const pos = new Float32Array(count * 3);
  const col = new Float32Array(count * 3);
  const size = new Float32Array(count);
  const phase = new Float32Array(count);
  const band = new THREE.Vector3(0.32, 0.82, 0.47).normalize();
  const v = new THREE.Vector3();
  let seed = 7;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  for (let i = 0; i < count; i++) {
    // uniform direction
    const u = rnd() * 2 - 1, th = rnd() * Math.PI * 2, s = Math.sqrt(1 - u * u);
    v.set(s * Math.cos(th), u, s * Math.sin(th));
    // a share of the stars crowd toward a band, like the Milky Way
    if (rnd() < 0.38) {
      const k = 0.72 + rnd() * 0.26;
      v.addScaledVector(band, -v.dot(band) * k).normalize();
    }
    pos.set([v.x, v.y, v.z], i * 3);
    const m = Math.pow(rnd(), 5.2);
    size[i] = 0.75 + m * 3.4;
    phase[i] = rnd();
    const t = rnd();
    let c;
    if (t < 0.1) c = [1.0, 0.82, 0.62];
    else if (t < 0.3) c = [1.0, 0.93, 0.82];
    else if (t < 0.82) c = [1.0, 1.0, 1.0];
    else c = [0.78, 0.86, 1.0];
    col.set(c, i * 3);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  geo.setAttribute('size', new THREE.BufferAttribute(size, 1));
  geo.setAttribute('phase', new THREE.BufferAttribute(phase, 1));
  const mat = new THREE.ShaderMaterial({
    uniforms: { uTime: { value: 0 }, uPR: { value: 1 }, uTwinkle: { value: 1 }, uFade: { value: 1 } },
    vertexShader: /* glsl */`
      attribute float size; attribute float phase; attribute vec3 color;
      uniform float uTime; uniform float uPR; uniform float uTwinkle;
      varying vec3 vColor; varying float vAlpha;
      void main() {
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        gl_Position = projectionMatrix * mv;
        float bright = step(1.55, size);
        float sp = 0.5 + fract(phase * 7.31) * 1.9;
        float tw = 1.0 + uTwinkle * bright * 0.38 * sin(uTime * sp + phase * 6.2831);
        gl_PointSize = size * uPR * (0.9 + 0.1 * tw);
        vColor = color;
        vAlpha = clamp((size - 0.45) / 2.3, 0.16, 1.0) * tw;
      }`,
    fragmentShader: /* glsl */`
      uniform float uFade;
      varying vec3 vColor; varying float vAlpha;
      void main() {
        float d = length(gl_PointCoord - 0.5);
        float a = 1.0 - smoothstep(0.28, 0.5, d);
        if (a <= 0.0) discard;
        gl_FragColor = vec4(vColor, a * vAlpha * uFade);
      }`,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });
  const pts = new THREE.Points(geo, mat);
  pts.scale.setScalar(400);
  pts.frustumCulled = false;
  pts.renderOrder = -10;
  return pts;
}

/* Earth: day map, night lights by sun angle, water glint, a thin atmosphere. */
export function createEarth(tex) {
  const group = new THREE.Group();
  const uniforms = {
    dayMap: { value: tex.day },
    nightMap: { value: tex.night },
    specMap: { value: tex.water },
    cloudMap: { value: tex.clouds },
    sunDir: { value: new THREE.Vector3(1, 0, 0) },
    cloudShift: { value: 0 },
  };
  const earthMat = new THREE.ShaderMaterial({
    uniforms,
    vertexShader: /* glsl */`
      varying vec2 vUv; varying vec3 vN; varying vec3 vW;
      void main() {
        vUv = uv;
        vN = normalize(mat3(modelMatrix) * normal);
        vec4 w = modelMatrix * vec4(position, 1.0);
        vW = w.xyz;
        gl_Position = projectionMatrix * viewMatrix * w;
      }`,
    fragmentShader: /* glsl */`
      uniform sampler2D dayMap, nightMap, specMap, cloudMap;
      uniform vec3 sunDir; uniform float cloudShift;
      varying vec2 vUv; varying vec3 vN; varying vec3 vW;
      void main() {
        vec3 N = normalize(vN);
        vec3 V = normalize(cameraPosition - vW);
        float ndl = dot(N, sunDir);
        vec3 day = texture2D(dayMap, vUv).rgb;
        vec3 night = texture2D(nightMap, vUv).rgb;
        float water = texture2D(specMap, vUv).r;
        float cs = texture2D(cloudMap, vec2(vUv.x + cloudShift, vUv.y)).r;
        float diff = max(ndl, 0.0);
        float dayMix = smoothstep(-0.06, 0.25, ndl);
        vec3 col = day * (diff * 1.25 + 0.012) * (1.0 - cs * 0.3);
        vec3 H = normalize(sunDir + V);
        float spec = pow(max(dot(N, H), 0.0), 160.0) * water * dayMix;
        col += vec3(1.0, 0.94, 0.86) * spec * 0.16;
        // city lights, baked over a very dim moonlit terrain
        vec3 nightCol = night * 1.3;
        float nightMix = 1.0 - smoothstep(-0.14, 0.04, ndl);
        col += nightCol * nightMix * (1.0 - cs * 0.6);
        float fres = pow(1.0 - max(dot(N, V), 0.0), 3.0);
        col = mix(col, vec3(0.3, 0.52, 0.95) * (0.15 + diff * 0.9), fres * 0.55 * smoothstep(-0.2, 0.35, ndl));
        gl_FragColor = vec4(col, 1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
  });
  const earth = new THREE.Mesh(new THREE.SphereGeometry(1, 192, 96), earthMat);
  group.add(earth);

  const cloudMat = new THREE.ShaderMaterial({
    uniforms: { cloudMap: { value: tex.clouds }, sunDir: uniforms.sunDir, uOpacity: { value: 0.92 } },
    vertexShader: earthMat.vertexShader,
    fragmentShader: /* glsl */`
      uniform sampler2D cloudMap; uniform vec3 sunDir; uniform float uOpacity;
      varying vec2 vUv; varying vec3 vN; varying vec3 vW;
      void main() {
        vec3 N = normalize(vN);
        float c = texture2D(cloudMap, vUv).r;
        float ndl = dot(N, sunDir);
        float lit = smoothstep(-0.1, 0.25, ndl);
        vec3 col = vec3(1.0) * (max(ndl, 0.0) * 1.05 + 0.025);
        float tw = smoothstep(-0.1, 0.0, ndl) * (1.0 - smoothstep(0.0, 0.14, ndl));
        col = mix(col, vec3(1.0, 0.72, 0.5) * 0.5, tw * 0.22);
        float a = c * uOpacity * (0.3 + 0.7 * lit);
        gl_FragColor = vec4(col, a);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
    transparent: true,
    depthWrite: false,
  });
  const clouds = new THREE.Mesh(new THREE.SphereGeometry(1.006, 160, 80), cloudMat);
  clouds.renderOrder = 1;
  group.add(clouds);

  // A thin limb of atmosphere: brightness depends on how close the view ray passes to the surface.
  const atmoMat = new THREE.ShaderMaterial({
    uniforms: { sunDir: uniforms.sunDir, uStrength: { value: 0.55 } },
    vertexShader: /* glsl */`
      varying vec3 vW;
      void main() { vec4 w = modelMatrix * vec4(position, 1.0); vW = w.xyz; gl_Position = projectionMatrix * viewMatrix * w; }`,
    fragmentShader: /* glsl */`
      uniform vec3 sunDir; uniform float uStrength;
      varying vec3 vW;
      void main() {
        vec3 dir = normalize(vW - cameraPosition);
        float h = length(cross(dir, -cameraPosition));
        float thick = 0.03;
        float a = 1.0 - smoothstep(1.0, 1.0 + thick, h);
        a *= smoothstep(0.985, 1.0, h);
        float lit = smoothstep(-0.3, 0.4, dot(normalize(vW), sunDir));
        gl_FragColor = vec4(vec3(0.42, 0.62, 1.0) * a * lit * uStrength, 1.0);
        #include <colorspace_fragment>
      }`,
    side: THREE.BackSide,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });
  const atmo = new THREE.Mesh(new THREE.SphereGeometry(1.05, 128, 64), atmoMat);
  atmo.renderOrder = 2;
  group.add(atmo);

  return { group, earth, clouds, atmo, uniforms };
}

/* A small marker that sits flat on the surface: a dot and a ring. Child of the Earth mesh. */
export function createMarker(lat, lon, color = 0xf5b83d, size = 0.012) {
  const g = new THREE.Group();
  const dot = new THREE.Mesh(
    new THREE.CircleGeometry(size, 32),
    new THREE.MeshBasicMaterial({ color, transparent: true, depthWrite: false })
  );
  const ring = new THREE.Mesh(
    new THREE.RingGeometry(size * 1.9, size * 2.25, 48),
    new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.8, depthWrite: false, side: THREE.DoubleSide })
  );
  g.add(dot, ring);
  const p = ll(lat, lon, 1.0015);
  g.position.copy(p);
  g.lookAt(p.clone().multiplyScalar(2));
  g.userData = { dot, ring, lat, lon };
  g.renderOrder = 3;
  return g;
}

/* Great circle arcs lifted off the surface, drawn progressively. */
export function createArcs(cities, color = 0xf5b83d) {
  const group = new THREE.Group();
  const mat = new THREE.MeshBasicMaterial({ color, transparent: true, depthWrite: false });
  const arcs = [];
  for (let i = 0; i < cities.length - 1; i++) {
    const a = ll(cities[i].lat, cities[i].lon), b = ll(cities[i + 1].lat, cities[i + 1].lon);
    const ang = a.angleTo(b);
    const pts = [];
    const N = 96;
    for (let k = 0; k <= N; k++) {
      const t = k / N;
      const d = slerpDir(a, b, t, new THREE.Vector3());
      const lift = 1.004 + Math.sin(Math.PI * t) * (0.04 + ang * 0.07);
      pts.push(d.multiplyScalar(lift));
    }
    const curve = new THREE.CatmullRomCurve3(pts);
    const geo = new THREE.TubeGeometry(curve, N, 0.0032, 8, false);
    const mesh = new THREE.Mesh(geo, mat);
    mesh.renderOrder = 4;
    geo.setDrawRange(0, 0);
    group.add(mesh);
    arcs.push({ mesh, geo, total: geo.index.count, curve });
  }
  const dots = cities.map((c) => {
    const m = createMarker(c.lat, c.lon, color, 0.009);
    group.add(m);
    return m;
  });
  // the traveler at the front of the arc being drawn
  const headMat = new THREE.MeshBasicMaterial({ color: 0xfff1cc, transparent: true, depthWrite: false });
  const headMesh = new THREE.Mesh(new THREE.SphereGeometry(0.0085, 16, 12), headMat);
  headMesh.renderOrder = 5;
  group.add(headMesh);
  function setProgress(p, alpha = 1) {
    mat.opacity = alpha;
    const hi = Math.floor(Math.max(0, p)), hf = Math.max(0, p) - hi;
    headMesh.visible = alpha > 0.01 && hi < arcs.length && hf > 0.005 && hf < 0.995;
    if (headMesh.visible) { arcs[hi].curve.getPointAt(hf, headMesh.position); headMat.opacity = alpha; }
    arcs.forEach((a, i) => {
      const f = Math.min(1, Math.max(0, p - i));
      const segs = Math.floor(f * 96);
      a.geo.setDrawRange(0, segs * 8 * 6);
      a.mesh.visible = segs > 0 && alpha > 0.01;
    });
    dots.forEach((d, i) => {
      const on = Math.min(1, Math.max(0, p - i + 1)) * alpha;
      d.visible = on > 0.01;
      d.userData.dot.material.opacity = on;
      d.userData.ring.material.opacity = on * 0.7;
    });
  }
  // head of the arc currently drawing, for a moving point
  function head(p, out = new THREE.Vector3()) {
    const i = Math.min(arcs.length - 1, Math.max(0, Math.floor(p)));
    const f = Math.min(1, Math.max(0, p - i));
    return arcs[i].curve.getPoint(f, out);
  }
  return { group, setProgress, head, dots };
}

export function loadTextures(renderer, narrow) {
  const loader = new THREE.TextureLoader();
  const aniso = Math.min(8, renderer.capabilities.getMaxAnisotropy());
  const load = (url, srgb) =>
    new Promise((res) => {
      loader.load(
        url,
        (t) => {
          t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
          t.anisotropy = aniso;
          t.wrapS = THREE.RepeatWrapping;
          res(t);
        },
        undefined,
        () => {
          // fall back to a flat texture so the scene still renders
          const d = new THREE.DataTexture(new Uint8Array([20, 40, 70, 255]), 1, 1);
          d.needsUpdate = true;
          res(d);
        }
      );
    });
  return Promise.all([
    load(narrow ? 'textures/earth-day-2k.jpg' : 'textures/earth-day.jpg', true),
    load('textures/earth-night.jpg', true),
    load('textures/earth-water.jpg', false),
    load('textures/earth-clouds.jpg', false),
  ]).then(([day, night, water, clouds]) => ({ day, night, water, clouds }));
}

export { DEG };
