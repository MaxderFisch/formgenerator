import * as THREE from 'https://cdn.jsdelivr.net/npm/three@0.160.0/build/three.module.js';

// 2D frame (3:4) and silhouette mask settings
const FW = 600, FH = 800, ASPECT = FW / FH;
const SCALE = 1.6;          // mask frustum is wider than the visible frame, so cropped bodies keep a closed contour
const MW = 480, MH = 640, SS = 2;
const D2R = Math.PI / 180;
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

function erf(x) {
  const s = Math.sign(x); x = Math.abs(x);
  const t = 1 / (1 + 0.3275911 * x);
  return s * (1 - (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-x * x));
}
function mulberry32(a) { return function () { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }

// ---------- spine: curvature-integrated centre line, constant length ----------
function buildSpine(p, M = 200) {
  const L = p.length, bw = Math.max(0.03, p.bendWidth);
  const Phi = s => 0.5 * (1 + erf((s - p.bendPos) / (bw * Math.SQRT2)));
  const g0 = Phi(0), gd = Math.max(1e-6, Phi(1) - g0);
  const pos = [], tan = [], cur = new THREE.Vector3();
  for (let i = 0; i <= M; i++) {
    const s = i / M, G = (Phi(s) - g0) / gd;
    const th = p.bend * Math.PI * G + p.sCurve * (Math.PI / 2.2) * Math.cos(2 * Math.PI * s);
    const ph = p.bendZ * Math.PI * 0.5 * G;
    const t = new THREE.Vector3(Math.sin(th) * Math.cos(ph), Math.cos(th) * Math.cos(ph), Math.sin(ph));
    if (i > 0) cur.addScaledVector(tan[i - 1].clone().add(t).normalize(), L / M);
    pos.push(cur.clone()); tan.push(t);
  }
  const chord = pos[M].clone().sub(pos[0]);
  if (chord.length() > 0.05 * L) {
    const q = new THREE.Quaternion().setFromUnitVectors(chord.normalize(), new THREE.Vector3(0, 1, 0));
    pos.forEach(v => v.applyQuaternion(q)); tan.forEach(v => v.applyQuaternion(q));
  }
  const c = new THREE.Box3().setFromPoints(pos).getCenter(new THREE.Vector3());
  pos.forEach(v => v.sub(c));
  const N = [], B = [];
  const b = new THREE.Vector3(0, 0, 1).addScaledVector(tan[0], -tan[0].z);
  if (b.lengthSq() < 1e-6) b.set(1, 0, 0).addScaledVector(tan[0], -tan[0].x);
  b.normalize();
  B.push(b); N.push(new THREE.Vector3().crossVectors(tan[0], b).normalize());
  const q = new THREE.Quaternion();
  for (let i = 1; i <= M; i++) {
    q.setFromUnitVectors(tan[i - 1], tan[i]);
    N.push(N[i - 1].clone().applyQuaternion(q)); B.push(B[i - 1].clone().applyQuaternion(q));
  }
  return { M, pos, N, B };
}

// ---------- analytic surface ----------
function makeShape(p) {
  const sp = buildSpine(p), L = p.length;
  const cfB = clamp(p.rBot * p.capLen * (0.5 + p.capBot) / L, 0.02, 0.48);
  const cfT = clamp(p.rTop * p.capLen * (0.5 + p.capTop) / L, 0.02, 0.48);
  const rnd = mulberry32((p.seed | 0) * 9973 + 17);
  const waves = [];
  for (let k = 0; k < 5; k++) waves.push({ m: 1 + Math.floor(rnd() * 4), f: 0.5 + rnd() * 1.5, p1: rnd() * 6.283, p2: rnd() * 6.283, a: 0.4 + rnd() * 0.6 });
  const wsum = waves.reduce((s, w) => s + w.a, 0);
  const e = 2 / Math.max(0.3, p.sqExp);
  const se = t => Math.sign(t) * Math.pow(Math.abs(t), e);
  const tw = p.twist * D2R, fr = p.facetRot * D2R;
  const radius = s => {
    let r = p.rBot + (p.rTop - p.rBot) * s;
    r *= 1 - p.waist * Math.exp(-Math.pow((s - p.waistPos) / 0.22, 2));
    if (p.ribs > 0) r *= 1 - p.ribs * Math.pow(1 - Math.abs(Math.sin(Math.PI * p.ribN * s)), 2);
    if (s < cfB) { const u = s / cfB; r *= Math.pow(Math.max(0, 1 - (1 - u) * (1 - u)), p.capBot); }
    if (s > 1 - cfT) { const u = (1 - s) / cfT; r *= Math.pow(Math.max(0, 1 - (1 - u) * (1 - u)), p.capTop); }
    return Math.max(0, r);
  };
  const P = new THREE.Vector3(), N = new THREE.Vector3(), Bv = new THREE.Vector3();
  function surf(s, a, out) {
    const x = clamp(s, 0, 1) * sp.M, i = Math.min(sp.M - 1, Math.floor(x)), f = x - i;
    P.lerpVectors(sp.pos[i], sp.pos[i + 1], f); N.lerpVectors(sp.N[i], sp.N[i + 1], f); Bv.lerpVectors(sp.B[i], sp.B[i + 1], f);
    let r = radius(s);
    if (p.noise > 0) {
      let n = 0;
      for (const w of waves) n += w.a * Math.sin(6.283 * w.f * p.noiseScale * s + w.p1) * Math.cos(w.m * a + w.p2);
      r *= 1 + p.noise * n / wsum;
    }
    const aa = a + tw * (s - 0.5) + fr, sa = Math.sin(aa), ca = Math.cos(aa);
    const px = r * (sa > 0 ? 1 + p.asym : 1 - p.asym) * se(sa), pz = r * p.depth * se(ca);
    return out.copy(P).addScaledVector(N, px).addScaledVector(Bv, pz);
  }
  return { surf };
}

// ---------- mesh grid + exact point-on-mesh lookup ----------
function buildGrid(p, shape) {
  const nL = Math.max(1, Math.round(p.segL)), nR = Math.max(3, Math.round(p.segR));
  const rows = nL + 1, sRow = new Float32Array(rows);
  for (let i = 0; i < rows; i++) sRow[i] = (1 - Math.cos(Math.PI * i / nL)) / 2;
  const pos = new Float32Array(rows * nR * 3), v = new THREE.Vector3();
  for (let i = 0; i < rows; i++) for (let j = 0; j < nR; j++) {
    shape.surf(sRow[i], 2 * Math.PI * j / nR, v);
    const o = (i * nR + j) * 3; pos[o] = v.x; pos[o + 1] = v.y; pos[o + 2] = v.z;
  }
  const idx = [];
  for (let i = 0; i < nL; i++) for (let j = 0; j < nR; j++) {
    const a = i * nR + j, b = i * nR + (j + 1) % nR, c = (i + 1) * nR + (j + 1) % nR, d = (i + 1) * nR + j;
    idx.push(a, b, c, a, c, d);
  }
  const geom = new THREE.BufferGeometry();
  geom.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geom.setIndex(idx); geom.computeVertexNormals(); geom.computeBoundingSphere();
  const A = new THREE.Vector3(), Bq = new THREE.Vector3(), C = new THREE.Vector3(), D = new THREE.Vector3(), e1 = new THREE.Vector3(), e2 = new THREE.Vector3();
  const vtx = (i, j, out) => out.fromArray(pos, (i * nR + ((j % nR) + nR) % nR) * 3);
  function onMesh(s, a, out, nOut, bil) {
    s = clamp(s, 0, 1);
    let i = 0; while (i < nL - 1 && sRow[i + 1] < s) i++;
    const u = clamp((s - sRow[i]) / Math.max(1e-9, sRow[i + 1] - sRow[i]), 0, 1);
    let t = (a / (2 * Math.PI)) * nR; t = ((t % nR) + nR) % nR;
    const j = Math.floor(t), w = t - j;
    vtx(i, j, A); vtx(i, j + 1, Bq); vtx(i + 1, j + 1, C); vtx(i + 1, j, D);
    let n1, n2;
    if (u <= w) {
      out.copy(A).addScaledVector(e1.subVectors(Bq, A), w).addScaledVector(e2.subVectors(C, Bq), u);
      n1 = [A, Bq, C]; n2 = [A, C, D];
    } else {
      out.copy(A).addScaledVector(e1.subVectors(D, A), u).addScaledVector(e2.subVectors(C, D), w);
      n1 = [A, C, D]; n2 = [A, Bq, C];
    }
    if (bil) bil.set(0, 0, 0).addScaledVector(A, (1 - w) * (1 - u)).addScaledVector(Bq, w * (1 - u)).addScaledVector(D, (1 - w) * u).addScaledVector(C, w * u);
    if (nOut) {
      nOut.crossVectors(e1.subVectors(n1[1], n1[0]), e2.subVectors(n1[2], n1[0]));
      if (nOut.lengthSq() < 1e-14) nOut.crossVectors(e1.subVectors(n2[1], n2[0]), e2.subVectors(n2[2], n2[0]));
      nOut.normalize();
    }
    return out;
  }
  return { geom, onMesh };
}

// ---------- 2D helpers ----------
const TABLE = [[], [3, 0], [0, 1], [3, 1], [1, 2], [3, 0, 1, 2], [0, 2], [3, 2], [2, 3], [0, 2], [0, 1, 2, 3], [1, 2], [1, 3], [0, 1], [3, 0], []];
function marchingSquares(cov, W, H, iso) {
  const at = (x, y) => (x < 0 || y < 0 || x >= W || y >= H) ? 0 : cov[y * W + x];
  const W2 = W + 2, key = (x, y, vt) => (((y + 1) * W2 + (x + 1)) * 2) + vt;
  const pts = new Map(), adj = new Map();
  const link = (a, b) => { let l = adj.get(a); if (!l) adj.set(a, l = []); l.push(b); l = adj.get(b); if (!l) adj.set(b, l = []); l.push(a); };
  const v = [0, 0, 0, 0];
  const ep = (x, y, e) => {
    let k, x0, y0, x1, y1, v0, v1;
    if (e === 0) { k = key(x, y, 0); x0 = x; y0 = y; x1 = x + 1; y1 = y; v0 = v[0]; v1 = v[1]; }
    else if (e === 1) { k = key(x + 1, y, 1); x0 = x + 1; y0 = y; x1 = x + 1; y1 = y + 1; v0 = v[1]; v1 = v[2]; }
    else if (e === 2) { k = key(x, y + 1, 0); x0 = x; y0 = y + 1; x1 = x + 1; y1 = y + 1; v0 = v[3]; v1 = v[2]; }
    else { k = key(x, y, 1); x0 = x; y0 = y; x1 = x; y1 = y + 1; v0 = v[0]; v1 = v[3]; }
    if (!pts.has(k)) { const t = (iso - v0) / (v1 - v0); pts.set(k, [x0 + (x1 - x0) * t, y0 + (y1 - y0) * t]); }
    return k;
  };
  for (let y = -1; y < H; y++) for (let x = -1; x < W; x++) {
    v[0] = at(x, y); v[1] = at(x + 1, y); v[2] = at(x + 1, y + 1); v[3] = at(x, y + 1);
    const c = (v[0] > iso ? 1 : 0) | (v[1] > iso ? 2 : 0) | (v[2] > iso ? 4 : 0) | (v[3] > iso ? 8 : 0);
    if (c === 0 || c === 15) continue;
    const tb = TABLE[c];
    for (let q = 0; q < tb.length; q += 2) link(ep(x, y, tb[q]), ep(x, y, tb[q + 1]));
  }
  const seen = new Set(), loops = [];
  for (const start of adj.keys()) {
    if (seen.has(start)) continue;
    const loop = []; let prev = -1, cur = start;
    while (cur !== undefined && !seen.has(cur)) {
      seen.add(cur); loop.push(pts.get(cur));
      const nb = adj.get(cur), nx = nb[0] !== prev ? nb[0] : nb[1];
      prev = cur; cur = nx;
    }
    if (loop.length > 6) loops.push(loop);
  }
  return loops;
}
function smoothClosed(pts, passes) {
  for (let k = 0; k < passes; k++) {
    const n = pts.length;
    pts = pts.map((p, i) => { const a = pts[(i - 1 + n) % n], b = pts[(i + 1) % n]; return [(a[0] + 2 * p[0] + b[0]) / 4, (a[1] + 2 * p[1] + b[1]) / 4]; });
  }
  return pts;
}
function dp(pts, tol) {
  if (pts.length < 3 || tol <= 0) return pts.slice();
  const keep = new Uint8Array(pts.length); keep[0] = keep[pts.length - 1] = 1;
  const stack = [[0, pts.length - 1]];
  while (stack.length) {
    const [a, b] = stack.pop();
    const [ax, ay] = pts[a], [bx, by] = pts[b], dx = bx - ax, dy = by - ay, len = Math.hypot(dx, dy) || 1e-9;
    let md = 0, mi = -1;
    for (let i = a + 1; i < b; i++) { const d = Math.abs((pts[i][0] - ax) * dy - (pts[i][1] - ay) * dx) / len; if (d > md) { md = d; mi = i; } }
    if (md > tol && mi > 0) { keep[mi] = 1; stack.push([a, mi], [mi, b]); }
  }
  return pts.filter((_, i) => keep[i]);
}
function dpClosed(pts, tol) {
  if (tol <= 0 || pts.length < 4) return pts;
  let fi = 0, fd = 0;
  for (let i = 1; i < pts.length; i++) { const d = Math.hypot(pts[i][0] - pts[0][0], pts[i][1] - pts[0][1]); if (d > fd) { fd = d; fi = i; } }
  const a = dp(pts.slice(0, fi + 1), tol), b = dp(pts.slice(fi).concat([pts[0]]), tol);
  return a.slice(0, -1).concat(b.slice(0, -1));
}
function chaikin(pts, it, closed) {
  for (let k = 0; k < it; k++) {
    const n = pts.length; if (n < 3) break;
    const out = []; if (!closed) out.push(pts[0]);
    const m = closed ? n : n - 1;
    for (let i = 0; i < m; i++) {
      const p = pts[i], q = pts[(i + 1) % n];
      out.push([p[0] * 0.75 + q[0] * 0.25, p[1] * 0.75 + q[1] * 0.25], [p[0] * 0.25 + q[0] * 0.75, p[1] * 0.25 + q[1] * 0.75]);
    }
    if (!closed) out.push(pts[n - 1]);
    pts = out;
  }
  return pts;
}
const area = pts => { let a = 0; for (let i = 0, n = pts.length; i < n; i++) { const p = pts[i], q = pts[(i + 1) % n]; a += p[0] * q[1] - q[0] * p[1]; } return Math.abs(a / 2); };
const f1 = n => (Math.round(n * 10) / 10).toString();
const toD = (pts, closed) => pts.length ? 'M' + pts.map(p => f1(p[0]) + ' ' + f1(p[1])).join('L') + (closed ? 'Z' : '') : '';


function chainGraph(adj) {
  const seen = new Set(), out = [];
  const walk = (start) => {
    const line = [start]; seen.add(start);
    let prev = null, cur = start;
    for (;;) {
      const nb = adj.get(cur) || [];
      const nx = nb.find(k => k !== prev && !seen.has(k));
      if (nx === undefined) { if (nb.length === 2 && nb.includes(start) && line.length > 2 && prev !== start) line.closed = true; break; }
      seen.add(nx); line.push(nx); prev = cur; cur = nx;
    }
    return line;
  };
  for (const [k, nb] of adj) if (nb.length === 1 && !seen.has(k)) out.push(walk(k));
  for (const k of adj.keys()) if (!seen.has(k)) out.push(walk(k));
  return out;
}
function runsOf(vis, n, closed) {
  if (closed && vis.every(Boolean)) return [{ idx: [...Array(n).keys()], closed: true }];
  const out = [], start = closed ? vis.indexOf(false) : 0;
  let cur = null;
  for (let k = 0; k < n; k++) {
    const i = (start + k) % n;
    if (vis[i]) {
      if (!cur) { cur = []; const pi = closed ? (i - 1 + n) % n : i - 1; if (pi >= 0) cur.push(pi); }
      cur.push(i);
    } else if (cur) { cur.push(i); out.push({ idx: cur, closed: false }); cur = null; }
  }
  if (cur) { if (closed) cur.push(start); out.push({ idx: cur, closed: false }); }
  return out.filter(r => r.idx.length > 1);
}
const polyLen = pts => { let l = 0; for (let i = 1; i < pts.length; i++) l += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]); return l; };

// ---------- engine ----------
let uidN = 0;
function darken(hex, t) {
  const n = parseInt(String(hex).slice(1), 16); if (!Number.isFinite(n)) return hex;
  const ch = sh => { const v = (n >> sh) & 255; return Math.round(v * (1 - t) * (1 - t * 0.15) + 0); };
  const r = ch(16), g = ch(8), b = ch(0), mx = Math.max(r, g, b), sat = 1 + t * 0.6;
  const f = v => clamp(Math.round(mx - (mx - v) * sat), 0, 255);
  return '#' + ((1 << 24) | (f(r) << 16) | (f(g) << 8) | f(b)).toString(16).slice(1);
}
export const LG_VERSION = 2;
export function createEngine(canvas) {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, preserveDrawingBuffer: true });
  renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.setClearColor(0x000000, 1);

  const scene = new THREE.Scene();
  scene.background = new THREE.Color('#2d2b2b');
  scene.add(new THREE.HemisphereLight(0xffffff, 0x3a3a3a, 1.5));
  const camera = new THREE.PerspectiveCamera(30, ASPECT, 0.01, 200);
  const sun = new THREE.DirectionalLight(0xffffff, 2.2); sun.position.set(-2, 3, 2);
  camera.add(sun); scene.add(camera);

  const mat = new THREE.MeshStandardMaterial({ color: 0xc4c4c4, roughness: 0.6, metalness: 0 });
  const mesh = new THREE.Mesh(new THREE.BufferGeometry(), mat); scene.add(mesh);
  const wire = new THREE.LineSegments(new THREE.BufferGeometry(), new THREE.LineBasicMaterial({ color: 0x111111, transparent: true, opacity: 0.4 }));
  scene.add(wire);
  const innerLines = new THREE.LineSegments(new THREE.BufferGeometry(), new THREE.LineBasicMaterial({ color: 0xec3013 }));
  const patLines = new THREE.LineSegments(new THREE.BufferGeometry(), new THREE.LineBasicMaterial({ color: 0xff9783 }));
  scene.add(innerLines, patLines);
  const eye3d = new THREE.Group();
  const eyeDisc = new THREE.Mesh(new THREE.CircleGeometry(1, 48), new THREE.MeshBasicMaterial({ color: 0xffffff, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 }));
  const eyeRing = new THREE.Mesh(new THREE.RingGeometry(0.82, 1, 48), new THREE.MeshBasicMaterial({ color: 0x111111, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -3 }));
  eye3d.add(eyeDisc, eyeRing); scene.add(eye3d);

  const depthMat = new THREE.ShaderMaterial({
    uniforms: { uNear: { value: 0 }, uFar: { value: 1 }, uL: { value: new THREE.Vector3(0, 0, 1) } },
    vertexShader: 'varying float vD; varying vec3 vN; void main(){ vec4 mv = modelViewMatrix * vec4(position,1.0); vD = -mv.z; vN = normalize(normalMatrix * normal); gl_Position = projectionMatrix * mv; }',
    fragmentShader: 'uniform float uNear; uniform float uFar; uniform vec3 uL; varying float vD; varying vec3 vN; void main(){ vec3 n = normalize(vN); if (!gl_FrontFacing) n = -n; gl_FragColor = vec4(clamp((vD-uNear)/(uFar-uNear),0.0,1.0), 1.0, clamp(dot(n, uL)*0.5+0.5,0.0,1.0), 1.0); }',
    side: THREE.DoubleSide,
  });
  const maskScene = new THREE.Scene();
  const maskMesh = new THREE.Mesh(mesh.geometry, depthMat); maskScene.add(maskMesh);
  // Normalen-Bild (Ansichtsraum) für den Kupferstich-Effekt (kupfer.js), nur auf Wunsch (opt.normals)
  const NW = 150, NH = 200;
  const nrmMat = new THREE.ShaderMaterial({
    vertexShader: 'varying vec3 vN; void main(){ vN = normalize(normalMatrix * normal); gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
    fragmentShader: 'varying vec3 vN; void main(){ vec3 n = normalize(vN); if (!gl_FrontFacing) n = -n; gl_FragColor = vec4(n*0.5+0.5, 1.0); }',
    side: THREE.DoubleSide,
  });
  const nrmScene = new THREE.Scene(), nrmMesh = new THREE.Mesh(mesh.geometry, nrmMat); nrmScene.add(nrmMesh);
  const nrt = new THREE.WebGLRenderTarget(NW, NH), nbuf = new Uint8Array(NW * NH * 4);
  let ncv = null;
  const normalsUrl = () => {
    const oc = renderer.getClearColor(new THREE.Color()), oa = renderer.getClearAlpha();
    renderer.setClearColor(0x000000, 0);
    renderer.setRenderTarget(nrt); renderer.clear(true, true, true);
    renderer.render(nrmScene, camera);
    renderer.readRenderTargetPixels(nrt, 0, 0, NW, NH, nbuf);
    renderer.setRenderTarget(null); renderer.setClearColor(oc, oa);
    if (!ncv) { ncv = document.createElement('canvas'); ncv.width = NW; ncv.height = NH; }
    const cx = ncv.getContext('2d'), img = cx.createImageData(NW, NH);
    for (let y = 0; y < NH; y++) img.data.set(nbuf.subarray((NH - 1 - y) * NW * 4, (NH - y) * NW * 4), y * NW * 4);
    cx.putImageData(img, 0, 0);
    return ncv.toDataURL('image/png');
  };
  const maskCam = new THREE.PerspectiveCamera();
  const RW = MW * SS, RH = MH * SS;
  const rt = new THREE.WebGLRenderTarget(RW, RH);
  const buf = new Uint8Array(RW * RH * 4);
  const cov = new Float32Array(MW * MH), dep = new Float32Array(MW * MH), shd = new Float32Array(MW * MH);
  const bA = new Float32Array(MW * MH), bB = new Float32Array(MW * MH), bT = new Float32Array(MW * MH);
  const blur = (a, r) => {
    const W = MW, H = MH, k = 1 / (2 * r + 1);
    for (let y = 0; y < H; y++) { const row = y * W; let acc = 0; for (let x = -r; x <= r; x++) acc += a[row + clamp(x, 0, W - 1)]; for (let x = 0; x < W; x++) { bT[row + x] = acc * k; acc += a[row + Math.min(W - 1, x + r + 1)] - a[row + Math.max(0, x - r)]; } }
    for (let x = 0; x < W; x++) { let acc = 0; for (let y = -r; y <= r; y++) acc += bT[clamp(y, 0, H - 1) * W + x]; for (let y = 0; y < H; y++) { a[y * W + x] = acc * k; acc += bT[Math.min(H - 1, y + r + 1) * W + x] - bT[Math.max(0, y - r) * W + x]; } }
  };
  const tmp = new THREE.Vector3(), tmp2 = new THREE.Vector3();

  const segGeom = (curves, lift) => {
    const arr = [];
    for (const c of curves) {
      const n = c.draw.length, m = c.closed ? n : n - 1;
      for (let i = 0; i < m; i++) {
        const a = c.draw[i], b = c.draw[(i + 1) % n], na = c.nrm[i], nb = c.nrm[(i + 1) % n];
        arr.push(a.x + na.x * lift, a.y + na.y * lift, a.z + na.z * lift, b.x + nb.x * lift, b.y + nb.y * lift, b.z + nb.z * lift);
      }
    }
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(arr, 3)); return g;
  };

  function update(p, opt = {}) {
    const shape = makeShape(p);
    const grid = buildGrid(p, shape);
    mesh.geometry.dispose(); mesh.geometry = grid.geom; maskMesh.geometry = grid.geom; nrmMesh.geometry = grid.geom;
    if (mat.flatShading !== !!p.flat) { mat.flatShading = !!p.flat; mat.needsUpdate = true; }
    wire.geometry.dispose();
    wire.geometry = opt.wire ? new THREE.WireframeGeometry(grid.geom) : new THREE.BufferGeometry();
    const sph = grid.geom.boundingSphere;

    // camera: distance from perspective only, zoom as image scale (never flies into the body)
    const th = Math.tan(p.fov * D2R / 2), base = 1.7 / th;
    const reach = sph.radius + sph.center.length();
    const dist = Math.max(base, reach + 0.4);
    const yaw = p.yaw * D2R, pit = p.pitch * D2R;
    camera.fov = p.fov; camera.aspect = ASPECT; camera.zoom = p.zoom * dist / base;
    camera.near = Math.max(0.01, dist - reach - 0.3); camera.far = dist + reach + 0.3;
    camera.position.set(dist * Math.cos(pit) * Math.sin(yaw), dist * Math.sin(pit), dist * Math.cos(pit) * Math.cos(yaw));
    camera.up.set(0, 1, 0); camera.lookAt(0, 0, 0); camera.rotateZ(p.roll * D2R);
    const halfH = 1.7 / p.zoom;
    camera.translateX(-p.panX * halfH * ASPECT); camera.translateY(-p.panY * halfH);
    camera.updateProjectionMatrix(); camera.updateMatrixWorld(true);

    // silhouette + depth mask
    maskCam.copy(camera, false);
    maskCam.fov = 2 * Math.atan(th * SCALE) / D2R;
    maskCam.updateProjectionMatrix(); maskCam.updateMatrixWorld(true);
    const zc = -sph.center.clone().applyMatrix4(camera.matrixWorldInverse).z;
    const near = zc - sph.radius - 0.02, far = zc + sph.radius + 0.02;
    depthMat.uniforms.uNear.value = near; depthMat.uniforms.uFar.value = far;
    { const la = (p.shadeAng ?? 40) * D2R, le = (p.shadeElev ?? 75) * D2R; depthMat.uniforms.uL.value.set(Math.cos(la) * Math.sin(le), Math.sin(la) * Math.sin(le), Math.cos(le)); }
    renderer.setRenderTarget(rt); renderer.clear(true, true, true);
    renderer.render(maskScene, maskCam);
    renderer.readRenderTargetPixels(rt, 0, 0, RW, RH, buf);
    renderer.setRenderTarget(null);
    for (let y = 0; y < MH; y++) for (let x = 0; x < MW; x++) {
      let c = 0, d = 1, l = 0;
      for (let sy = 0; sy < SS; sy++) {
        let o = ((y * SS + sy) * RW + x * SS) * 4;
        for (let sx = 0; sx < SS; sx++, o += 4) if (buf[o + 1] > 127) { c++; l += buf[o + 2]; const dv = buf[o] / 255; if (dv < d) d = dv; }
      }
      cov[y * MW + x] = c / (SS * SS); dep[y * MW + x] = d; shd[y * MW + x] = c ? l / (c * 255) : 1;
    }

    const toFrame = (gx, gy) => {
      const nx = (((gx + 0.5) / MW) * 2 - 1) * SCALE, ny = (((gy + 0.5) / MH) * 2 - 1) * SCALE;
      return [(nx + 1) / 2 * FW, (1 - ny) / 2 * FH];
    };
    const proj = v => { tmp.copy(v).project(camera); return [(tmp.x + 1) / 2 * FW, (1 - tmp.y) / 2 * FH]; };
    const gridXY = v => { tmp.copy(v).project(camera); return [Math.round(((tmp.x / SCALE) + 1) / 2 * MW - 0.5), Math.round(((tmp.y / SCALE) + 1) / 2 * MH - 0.5)]; };
    const depthOK = (v, gx, gy) => {
      const vz = -tmp2.copy(v).applyMatrix4(camera.matrixWorldInverse).z;
      const dn = (vz - near) / (far - near);
      let m = -1;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) { const i = (gy + dy) * MW + gx + dx; if (cov[i] > 0 && dep[i] > m) m = dep[i]; }
      return m < 0 || dn <= m + 0.02;
    };
    const visible = (v, n) => {
      if (n.dot(tmp2.copy(camera.position).sub(v)) <= 0) return false;
      const [gx, gy] = gridXY(v);
      if (gx < 1 || gy < 1 || gx >= MW - 1 || gy >= MH - 1) return true;
      return depthOK(v, gx, gy);
    };
    const NR = 3;
    const contourVis = v => {
      const [gx, gy] = gridXY(v);
      if (gx < NR || gy < NR || gx >= MW - NR || gy >= MH - NR) return false;
      for (let dy = -NR; dy <= NR; dy++) for (let dx = -NR; dx <= NR; dx++) if (cov[(gy + dy) * MW + gx + dx] < 0.5) return false;
      return depthOK(v, gx, gy);
    };

    // outline
    const simp = Math.max(0.25, p.simplify), rIt = Math.round(p.round);
    const loops = marchingSquares(cov, MW, MH, 0.5)
      .map(l => smoothClosed(l.map(q => toFrame(q[0], q[1])), 1))
      .filter(l => area(l) > 40)
      .map(l => chaikin(dpClosed(l, simp), rIt, true));
    const outlineD = loops.map(l => toD(l, true)).join(' ');


    // curves on the surface: exact point for visibility, bilinear point for drawing (straight across facets)
    const mkCurve = (n, closed, fn) => {
      const pts = [], nrm = [], draw = [];
      for (let k = 0; k < n; k++) {
        const [s, a] = fn(k);
        const P = new THREE.Vector3(), Nn = new THREE.Vector3(), Q = new THREE.Vector3();
        grid.onMesh(s, a, P, Nn, Q); pts.push(P); nrm.push(Nn); draw.push(Q);
      }
      return { pts, nrm, draw, closed };
    };
    const projRuns = (c, visFn) => {
      const vis = c.pts.map((v, i) => visFn(v, c.nrm && c.nrm[i]));
      const n = c.pts.length;
      return runsOf(vis, n, c.closed).map(r => ({
        pts: r.idx.map(i => proj(c.draw[i])), closed: r.closed,
        nodeA: !r.closed && r.idx[0] === 0 && !!vis[0], nodeB: !r.closed && r.idx[r.idx.length - 1] === n - 1 && !!vis[n - 1],
      }));
    };
    const finish = (r, tol, minLen) => {
      const pts = r.closed ? chaikin(dpClosed(r.pts, tol), rIt, true) : chaikin(dp(r.pts, tol), rIt, false);
      return polyLen(pts) >= minLen ? toD(pts, r.closed) : '';
    };

    // inner lines
    const inner = [];
    if (p.ring) inner.push(mkCurve(360, true, k => { const a = 2 * Math.PI * k / 360; return [clamp(p.ringPos + p.ringTilt * Math.cos(a), 0.001, 0.999), a]; }));
    if (p.meridian) { const s0 = Math.min(p.meridianFrom, p.meridianTo), s1 = Math.max(p.meridianFrom, p.meridianTo); inner.push(mkCurve(240, false, k => [s0 + (s1 - s0) * k / 239, p.meridianA * D2R])); }
    const innerKept = [], innerDs = [];
    for (const c of inner) for (const r of projRuns(c, visible)) { const d = finish(r, simp, 4); if (d) { innerDs.push(d); innerKept.push(r); } }

    // interior contours (where the body folds or overlaps itself)
    const contourDs = [], contourKept = [];
    if (p.contour) {
      const P = grid.geom.attributes.position.array, I = grid.geom.index.array, NV = P.length / 3;
      const cam = camera.position, V = (i, o) => o.fromArray(P, i * 3);
      const va = new THREE.Vector3(), vb = new THREE.Vector3(), vc = new THREE.Vector3(), e1 = new THREE.Vector3(), e2 = new THREE.Vector3();
      const adj = new Map(), pos = new Map();
      const link = (a, b) => { let l = adj.get(a); if (!l) adj.set(a, l = []); l.push(b); l = adj.get(b); if (!l) adj.set(b, l = []); l.push(a); };
      const ekey = (a, b) => a < b ? a * NV + b : b * NV + a;
      if (p.flat) {
        const nF = I.length / 3, face = new Int8Array(nF), edges = new Map();
        for (let f = 0; f < nF; f++) {
          V(I[f * 3], va); V(I[f * 3 + 1], vb); V(I[f * 3 + 2], vc);
          e1.subVectors(vb, va); e2.subVectors(vc, va); e1.cross(e2);
          face[f] = e1.lengthSq() < 1e-12 ? 0 : (e1.dot(tmp.copy(cam).sub(va)) > 0 ? 1 : -1);
          for (let q = 0; q < 3; q++) { const a = I[f * 3 + q], b = I[f * 3 + (q + 1) % 3], k = ekey(a, b), e = edges.get(k); if (e) e.push(f); else edges.set(k, [f]); }
        }
        for (const [k, fs] of edges) {
          if (fs.length !== 2 || !face[fs[0]] || !face[fs[1]] || face[fs[0]] === face[fs[1]]) continue;
          const a = Math.floor(k / NV), b = k % NV;
          if (!pos.has(a)) pos.set(a, V(a, new THREE.Vector3()));
          if (!pos.has(b)) pos.set(b, V(b, new THREE.Vector3()));
          link(a, b);
        }
      } else {
        const Nm = grid.geom.attributes.normal.array, g = new Float32Array(NV), nv = new THREE.Vector3();
        for (let i = 0; i < NV; i++) { V(i, va); nv.fromArray(Nm, i * 3); g[i] = nv.dot(tmp.copy(cam).sub(va)); }
        const cross = (a, b) => {
          const k = ekey(a, b);
          if (!pos.has(k)) { const t = g[a] / (g[a] - g[b]); pos.set(k, V(a, new THREE.Vector3()).lerp(V(b, vb), t)); }
          return k;
        };
        for (let f = 0; f < I.length / 3; f++) {
          const ids = [I[f * 3], I[f * 3 + 1], I[f * 3 + 2]], hit = [];
          for (let q = 0; q < 3; q++) { const a = ids[q], b = ids[(q + 1) % 3]; if ((g[a] > 0) !== (g[b] > 0)) hit.push(cross(a, b)); }
          if (hit.length === 2 && hit[0] !== hit[1]) link(hit[0], hit[1]);
        }
      }
      for (const line of chainGraph(adj)) {
        const pts = [];
        const n = line.length, m = line.closed ? n : n - 1;
        for (let i = 0; i < m; i++) {
          const a = pos.get(line[i]), b = pos.get(line[(i + 1) % n]);
          const steps = Math.max(1, Math.ceil(a.distanceTo(b) / 0.04));
          for (let t = 0; t < steps; t++) pts.push(a.clone().lerp(b, t / steps));
        }
        if (!line.closed) pts.push(pos.get(line[n - 1]).clone());
        if (pts.length < 2) continue;
        for (const r of projRuns({ pts, draw: pts, nrm: null, closed: !!line.closed }, contourVis)) {
          const d = finish(r, Math.max(simp, 1.2), 18);
          if (d) { contourDs.push(d); contourKept.push(r); }
        }
      }
    }

    // surface helpers
    const surfPt = (ss, a) => { const P = new THREE.Vector3(), Nn = new THREE.Vector3(); grid.onMesh(clamp(ss, 0.002, 0.998), a, P, Nn); return { P, N: Nn }; };
    const camRight = new THREE.Vector3(1, 0, 0).applyQuaternion(camera.quaternion);
    const pxPer = P => { const a = proj(P), b = proj(tmp2.copy(P).addScaledVector(camRight, 1)); return Math.hypot(b[0] - a[0], b[1] - a[1]); };
    const dS = (ss, a) => { const A = surfPt(ss - 0.01, a).P, B = surfPt(ss + 0.01, a).P; return B.sub(A).length() / 0.02 || 1; };
    const dA = (ss, a) => { const A = surfPt(ss, a - 0.02).P, B = surfPt(ss, a + 0.02).P; return B.sub(A).length() / 0.04 || 1; };
    const f2 = n => (Math.round(n * 100) / 100).toString();

    // eyes (1-5)
    const EYE_LAYOUT = [
      [[0, 0, 1]],
      [[-1, 0, 1], [1, 0, 1]],
      [[-1.1, -0.2, 0.9], [0, 0.45, 1.1], [1.1, -0.2, 0.9]],
      [[-1.6, -0.3, 0.85], [-0.55, 0.15, 1], [0.55, 0.15, 1], [1.6, -0.3, 0.85]],
      [[0, 0, 1.15], [-1.35, -0.35, 0.85], [1.35, -0.35, 0.85], [-0.8, 1.05, 0.7], [0.85, 1.0, 0.75]],
    ];
    const EYE_SHRINK = [1, 0.78, 0.68, 0.6, 0.55];
    const eyes = [];
    let eyeLow = 0;
    eye3d.visible = !!p.eye && opt.lines3d !== false;
    if (p.eye) {
      const n = clamp(Math.round(p.eyeCount ?? 1), 1, 5), lay = EYE_LAYOUT[n - 1];
      const size0 = p.eyeSize * EYE_SHRINK[n - 1], sp = size0 * (p.eyeSpread ?? 1.15);
      const a0 = p.eyeA * D2R, s0 = p.eyeS, rs = dS(s0, a0), ra = dA(s0, a0);
      const er = mulberry32((p.seed | 0) * 131 + n * 17 + 5);
      const base = surfPt(s0, a0);
      eye3d.position.copy(base.P).addScaledVector(base.N, 0.004); eye3d.lookAt(tmp.copy(base.P).add(base.N)); eye3d.scale.setScalar(size0);
      const bx = proj(base.P)[0];
      eyeLow = Math.min(0, ...lay.map(l => l[1])) * sp - size0;
      for (const [lx, ly, ls] of lay) {
        const size = size0 * ls * (n > 1 ? 1 + (p.eyeVar ?? 0.3) * (er() - 0.5) * 0.9 : 1);
        const { P, N } = surfPt(clamp(s0 + ly * sp / rs, 0.03, 0.97), a0 + lx * sp / ra);
        if (!visible(P, N)) continue;
        const [cx, cy] = proj(P);
        const [rx, ry] = proj(tmp2.copy(P).addScaledVector(camRight, size));
        const R = Math.hypot(rx - cx, ry - cy);
        const [nx, ny] = proj(tmp2.copy(P).addScaledVector(N, 0.1));
        const ang = Math.atan2(ny - cy, nx - cx) / D2R;
        const cosT = Math.max(0.12, N.dot(tmp2.copy(camera.position).sub(P).normalize()));
        const depth = -tmp.copy(P).applyMatrix4(camera.matrixWorldInverse).z;
        eyes.push({ cx, cy, R, ang, q: 1 + (cosT - 1) * p.eyePersp, side: n > 1 ? (Math.sign(cx - bx) || 1) : 0, depth });
      }
      eyes.sort((a, b) => b.depth - a.depth);
    }
    const insideEye = (x, y, grow = 0) => eyes.some(({ cx, cy, R, ang, q }) => {
      const c = Math.cos(-ang * D2R), sn = Math.sin(-ang * D2R), dx = x - cx, dy = y - cy, lx = dx * c - dy * sn, ly = dx * sn + dy * c;
      return (lx / (R * q + grow)) ** 2 + (ly / (R + grow)) ** 2 <= 1;
    });

    // mouth: affine frame on the surface (x = around the body, y = down the body)
    let mouth = null;
    if (p.mouth) {
      const a = (p.eyeA + (p.mouthA ?? 0)) * D2R, rs = dS(p.eyeS, a);
      const ss = clamp(p.eyeS + ((p.eye ? eyeLow : 0) - (p.mouthDist ?? 0.16)) / rs, 0.04, 0.96);
      const { P, N } = surfPt(ss, a);
      if (visible(P, N)) {
        const Ta = surfPt(ss, a + 0.02).P.sub(surfPt(ss, a - 0.02).P).normalize();
        const Ts = surfPt(ss + 0.01, a).P.sub(surfPt(ss - 0.01, a).P).normalize();
        const hw = p.mouthW ?? 0.17, hh = hw * (p.mouthH ?? 0.7);
        const o = proj(P);
        const px = proj(tmp2.copy(P).addScaledVector(Ta, hw)), mx = proj(tmp2.copy(P).addScaledVector(Ta, -hw));
        const py = proj(tmp2.copy(P).addScaledVector(Ts, -hh)), my = proj(tmp2.copy(P).addScaledVector(Ts, hh));
        const ex = [(px[0] - mx[0]) / 2, (px[1] - mx[1]) / 2], ey = [(py[0] - my[0]) / 2, (py[1] - my[1]) / 2];
        if (ex[0] < 0) { ex[0] = -ex[0]; ex[1] = -ex[1]; }
        mouth = { o, ex, ey, at: (lx, ly) => [o[0] + ex[0] * lx + ey[0] * ly, o[1] + ex[1] * lx + ey[1] * ly] };
      }
    }

    // keep-out zone around the mouth: pattern lines never touch or cross it
    const insideMouth = (x, y) => {
      if (!mouth) return false;
      const { o, ex, ey } = mouth, det = ex[0] * ey[1] - ex[1] * ey[0];
      if (Math.abs(det) < 1e-6) return false;
      const dx = x - o[0], dy = y - o[1], lx = (dx * ey[1] - dy * ey[0]) / det, ly = (ex[0] * dy - ex[1] * dx) / det;
      const m = Math.max(0.25, (p.patW * 0.8) / Math.max(1, Math.hypot(ex[0], ex[1])));
      return (lx / (1.2 + m)) ** 2 + ((ly - 0.15) / (0.85 + m)) ** 2 <= 1;
    };

    // pattern: grid on the surface, cleaned up in 2D (no dead ends, no lines hugging other lines)
    const patDs = [], patKept3 = [], dbg = {};
    if (p.pattern) {
      const gap = Math.max(p.patGap ?? 30, p.patW * 1.2), endX = Math.max(8, p.patW * 1.2), D = gap, HC = Math.max(12, gap);
      const maxLines = Math.round(p.patMax ?? 10), COS = 0.82;
      const mkHash = () => new Map();
      const hOther = mkHash(), hPat = mkHash();
      const hk = (x, y) => (Math.floor(x / HC) + 1000) * 4000 + (Math.floor(y / HC) + 1000);
      const addPts = (h, pts, closed, id = -1) => {
        const n = pts.length, m = closed ? n : n - 1;
        const put = (x, y, ux, uy) => { const k = hk(x, y); let l = h.get(k); if (!l) h.set(k, l = []); l.push(x, y, id, ux, uy); };
        if (n === 1) put(pts[0][0], pts[0][1], 0, 0);
        let ux = 0, uy = 0;
        for (let i = 0; i < m; i++) {
          const a = pts[i], b = pts[(i + 1) % n], L = Math.hypot(b[0] - a[0], b[1] - a[1]), st = Math.max(1, Math.ceil(L / 3));
          if (L > 1e-6) { ux = (b[0] - a[0]) / L; uy = (b[1] - a[1]) / L; }
          for (let t = 0; t < st; t++) put(a[0] + (b[0] - a[0]) * t / st, a[1] + (b[1] - a[1]) * t / st, ux, uy);
        }
        if (!closed && n > 1) put(pts[n - 1][0], pts[n - 1][1], ux, uy);
      };
      // near: any line within d; with a direction (vx,vy) only roughly parallel lines count
      const nearIn = (h, x, y, d, skip = -2, vx = 0, vy = 0) => {
        const gx = Math.floor(x / HC), gy = Math.floor(y / HC), d2 = d * d, R = Math.ceil(d / HC), dir = vx !== 0 || vy !== 0;
        for (let dy = -R; dy <= R; dy++) for (let dx = -R; dx <= R; dx++) {
          const l = h.get((gx + dx + 1000) * 4000 + (gy + dy + 1000)); if (!l) continue;
          for (let i = 0; i < l.length; i += 5) {
            if (l[i + 2] === skip) continue;
            const ex = l[i] - x, ey = l[i + 1] - y;
            if (ex * ex + ey * ey >= d2) continue;
            if (dir && Math.abs(l[i + 3] * vx + l[i + 4] * vy) < COS) continue;
            return true;
          }
        }
        return false;
      };
      for (const l of loops) addPts(hOther, l, true);
      for (const r of innerKept) addPts(hOther, r.pts, r.closed);
      for (const r of contourKept) addPts(hOther, r.pts, r.closed);
      for (const { cx, cy, R, ang, q } of eyes) {
        const c = Math.cos(ang * D2R), sn = Math.sin(ang * D2R), ep = [];
        for (let t = 0; t < 48; t++) { const lx = R * q * Math.cos(t / 48 * 2 * Math.PI), ly = R * Math.sin(t / 48 * 2 * Math.PI); ep.push([cx + lx * c - ly * sn, cy + lx * sn + ly * c]); }
        addPts(hOther, ep, true);
      }


      const rnd = mulberry32((p.patSeed | 0) * 7919 + 3);
      const s0 = clamp(Math.min(p.patFrom, p.patTo), 0.005, 0.995), s1 = clamp(Math.max(p.patFrom, p.patTo), 0.005, 0.995);
      const nS = Math.max(0, Math.round(p.patRings)), nA = Math.max(0, Math.round(p.patMer)), nC = nA > 0 ? nA : 8;
      const rows = nS + 2, ds = (s1 - s0) / (nS + 1), da = 2 * Math.PI / nC, rot = p.patRot * D2R, jit = p.patJitter * 0.9;
      const capB = s0 < 0.06, capT = s1 > 0.94;
      const isCap = k => (k === 0 && capB) || (k === rows - 1 && capT);
      const node = [];
      for (let k = 0; k < rows; k++) for (let j = 0; j < nC; j++) {
        const inside = k > 0 && k < rows - 1;
        node.push([s0 + ds * k + (inside ? jit * (rnd() - 0.5) * ds : 0), rot + da * j + (isCap(k) ? 0 : jit * (rnd() - 0.5) * da)]);
      }
      const nid = (k, j) => k * nC + ((j % nC) + nC) % nC;
      const at = (k, j) => { const q = node[nid(k, j)]; return [q[0], q[1] + Math.floor(j / nC) * 2 * Math.PI]; };
      const anchor = new Uint8Array(rows * nC);
      for (let j = 0; j < nC; j++) { if (capB) anchor[nid(0, j)] = 1; if (capT) anchor[nid(rows - 1, j)] = 1; }
      const edges = [];
      const E = (k1, j1, k2, j2) => edges.push({ a: nid(k1, j1), b: nid(k2, j2), A: at(k1, j1), B: at(k2, j2) });
      for (let k = 0; k < rows; k++) {
        if (isCap(k)) continue;
        if (nA === 0 && rnd() > p.patKeep) continue;
        for (let j = 0; j < nC; j++) E(k, j, k, j + 1);
      }
      if (nA > 0) for (let k = 0; k < rows - 1; k++) for (let j = 0; j < nC; j++) E(k, j, k + 1, j);
      for (let k = 0; k < rows - 1; k++) for (let j = 0; j < nC; j++) {
        if (rnd() < p.patDiag) { if (rnd() < 0.5) E(k, j, k + 1, j + 1); else E(k, j + 1, k + 1, j); }
      }
      if (nA > 0) {
        const deg = new Int32Array(rows * nC);
        for (const e of edges) { deg[e.a]++; deg[e.b]++; }
        const order = edges.map((_, i) => i);
        for (let i = order.length - 1; i > 0; i--) { const r = Math.floor(rnd() * (i + 1)); [order[i], order[r]] = [order[r], order[i]]; }
        for (const i of order) {
          const e = edges[i];
          if (rnd() >= 1 - p.patKeep) continue;
          if ((anchor[e.a] || deg[e.a] >= 3) && (anchor[e.b] || deg[e.b] >= 3)) { e.dead = true; deg[e.a]--; deg[e.b]--; }
        }
      }

      const minLen = Math.max(16, p.patW * 2.5, gap * 0.8);
      let runs = [];
      for (const e of edges) {
        if (e.dead) continue;
        const ds2 = e.B[0] - e.A[0], da2 = e.B[1] - e.A[1];
        e.curve = mkCurve(32, false, i => { const t = i / 31; return [e.A[0] + ds2 * t, e.A[1] + da2 * t]; });
        for (const r of projRuns(e.curve, visible)) {
          r.edge = e; r.na = r.nodeA ? e.a : -1; r.nb = r.nodeB ? e.b : -1; r.len = polyLen(r.pts);
          if (r.len >= minLen) runs.push(r);
        }
      }
      runs.sort((x, y) => y.len - x.len);
      const acc = [];
      for (const r of runs) {
        if (acc.length >= maxLines) break;
        const a0 = r.pts[0], a1 = r.pts[r.pts.length - 1];
        let tot = 0, nr = 0, mHit = false;
        for (let i = 0; i < r.pts.length - 1; i++) {
          const a = r.pts[i], b = r.pts[i + 1], L = Math.hypot(b[0] - a[0], b[1] - a[1]), st = Math.max(1, Math.ceil(L / 4));
          if (L < 1e-6) continue;
          const vx = (b[0] - a[0]) / L, vy = (b[1] - a[1]) / L;
          for (let t = 0; t < st; t++) {
            const x = a[0] + (b[0] - a[0]) * t / st, y = a[1] + (b[1] - a[1]) * t / st;
            if (insideMouth(x, y)) mHit = true;
            if (Math.hypot(x - a0[0], y - a0[1]) < endX || Math.hypot(x - a1[0], y - a1[1]) < endX) continue;
            tot++;
            if (nearIn(hOther, x, y, gap, -2, vx, vy) || nearIn(hPat, x, y, gap, -2, vx, vy)) nr++;
          }
        }
        if (mHit || (tot >= 2 && nr / tot > 0.3)) continue;
        const ad = Math.max(8, p.patW * 1.2);
        r.anchA = (r.na >= 0 && anchor[r.na]) || nearIn(hOther, a0[0], a0[1], r.na >= 0 ? ad : ad * 1.6) || insideEye(a0[0], a0[1]);
        r.anchB = (r.nb >= 0 && anchor[r.nb]) || nearIn(hOther, a1[0], a1[1], r.nb >= 0 ? ad : ad * 1.6) || insideEye(a1[0], a1[1]);
        acc.push(r); addPts(hPat, r.pts, false);
      }
      // dangling ends: extend the line straight on until it meets another line, otherwise drop it
      acc.forEach((r, i) => { r.id = i; });
      const hKept = mkHash();
      for (const r of acc) addPts(hKept, r.pts, false, r.id);
      const maxExt = Math.max(60, p.patW * 8), hitD = Math.max(4, p.patW * 0.6);
      const extend = (r, atEnd) => {
        const pts = r.pts, n = pts.length;
        const e = atEnd ? pts[n - 1] : pts[0];
        const back = atEnd ? pts[Math.max(0, n - 4)] : pts[Math.min(n - 1, 3)];
        let dx = e[0] - back[0], dy = e[1] - back[1]; const L = Math.hypot(dx, dy); if (L < 1e-6) return false;
        dx /= L; dy /= L;
        for (let t = hitD + 2; t <= maxExt; t += 2) {
          const x = e[0] + dx * t, y = e[1] + dy * t;
          if (insideMouth(x, y)) return false;
          if (nearIn(hOther, x, y, hitD) || nearIn(hKept, x, y, hitD, r.id) || insideEye(x, y)) {
            const hp = [x + dx * hitD * 0.5, y + dy * hitD * 0.5];
            if (atEnd) pts.push(hp); else pts.unshift(hp);
            addPts(hKept, [e, hp], false, r.id);
            return true;
          }
        }
        return false;
      };
      let kept = acc, changed = true;
      while (changed) {
        changed = false;
        const vd = new Int32Array(rows * nC);
        for (const r of kept) { if (r.na >= 0) vd[r.na]++; if (r.nb >= 0) vd[r.nb]++; }
        kept = kept.filter(r => {
          if (!r.anchA && (r.na < 0 || vd[r.na] < 2)) { if (extend(r, false)) r.anchA = true; else { changed = true; return false; } }
          if (!r.anchB && (r.nb < 0 || vd[r.nb] < 2)) { if (extend(r, true)) r.anchB = true; else { changed = true; return false; } }
          return true;
        });
        if (changed) { hKept.clear(); for (const r of kept) addPts(hKept, r.pts, false, r.id); }
      }
      dbg.edges = edges.length; dbg.dead = edges.filter(e => e.dead).length; dbg.runs = runs.length; dbg.acc = acc.length; dbg.kept = kept.length;
      const seenE = new Set();
      for (const r of kept) {
        const d = finish(r, simp, 0); if (d) patDs.push(d);
        if (!seenE.has(r.edge)) { seenE.add(r.edge); patKept3.push(r.edge.curve); }
      }
    }

    // 3D overlays
    innerLines.geometry.dispose(); innerLines.geometry = segGeom(inner, 0.006);
    patLines.geometry.dispose(); patLines.geometry = segGeom(patKept3, 0.006);
    innerLines.visible = patLines.visible = !!opt.lines3d;

    // eye svg
    let eyeSvg = '';
    eyes.forEach(({ cx, cy, R, ang, q, side }, i) => {
      const tilt = side ? p.lidTilt * (side < 0 ? -1 : 1) : p.lidTilt;
      const lidY = -R + 2 * R * p.lid, ew = p.eyeLineW, big = R * 3;
      const lid = p.lid > 0.005 ? `<g transform="rotate(${f1(tilt)})"><rect x="${f1(-big)}" y="${f1(-big)}" width="${f1(2 * big)}" height="${f1(big + lidY)}" fill="${p.cBody}"/><line x1="${f1(-big)}" y1="${f1(lidY)}" x2="${f1(big)}" y2="${f1(lidY)}" stroke="${p.cLine}" stroke-width="${f1(ew * 0.85)}"/></g>` : '';
      eyeSvg += `<defs><clipPath id="fgEye${i}"><ellipse rx="${f1(R * q)}" ry="${f1(R)}"/></clipPath></defs>` +
        `<g transform="translate(${f1(cx)} ${f1(cy)}) rotate(${f1(ang)})">` +
        `<ellipse rx="${f1(R * q)}" ry="${f1(R)}" fill="${p.cEye}"/>` +
        `<g clip-path="url(#fgEye${i})"><g transform="rotate(${f1(-ang)})">` +
        `<circle cx="${f1(p.pupilX * R * 0.6)}" cy="${f1(p.pupilY * R * 0.6)}" r="${f1(p.pupil * R)}" fill="${p.cLine}"/>${lid}</g></g>` +
        `<ellipse rx="${f1(R * q)}" ry="${f1(R)}" fill="none" stroke="${p.cLine}" stroke-width="${f1(ew)}"/></g>`;
    });
    if (eyeSvg && p.eyeClip) eyeSvg = `<g clip-path="url(#fgBody)">${eyeSvg}</g>`;

    // mouth svg
    let mouthSvg = '', mouthHalo = '';
    if (mouth) {
      const { o, ex, ey } = mouth, c = clamp(p.mouthCurve ?? 0.5, -1, 1), t = clamp(Math.round(p.mouthType ?? 0), 0, 4), cc = clamp(c, 0.1, 1);
      const VE = 'vector-effect="non-scaling-stroke"', mw = f1(p.eyeLineW);
      const open = `M-1 -0.2C-0.4 ${f2(-0.2 + 0.2 * cc)} 0.4 ${f2(-0.2 + 0.2 * cc)} 1 -0.2C0.9 ${f2(0.5 + 0.7 * cc)} -0.9 ${f2(0.5 + 0.7 * cc)} -1 -0.2Z`;
      let inner = '';
      if (t === 0) inner = `<path d="M-1 0Q0 ${f2(c * 0.9)} 1 0" fill="none" stroke="${p.cLine}" stroke-width="${mw}" stroke-linecap="round" ${VE}/>`;
      else if (t === 4) inner = `<path d="M-1 0.05C-0.4 ${f2(0.25 + 0.4 * cc)} 0.35 ${f2(0.2 + 0.3 * cc)} 1 -0.45M0.8 -0.62Q1.05 -0.48 1.08 -0.22" fill="none" stroke="${p.cLine}" stroke-width="${mw}" stroke-linecap="round" ${VE}/>`;
      else {
        let extra = '';
        if (t === 2) extra = `<rect x="-1.2" y="-0.4" width="2.4" height="0.55" fill="${p.cEye}"/><path d="M-0.33 -0.4V0.15M0.33 -0.4V0.15M-1.2 0.15H1.2" fill="none" stroke="${p.cLine}" stroke-width="${f1(p.eyeLineW * 0.7)}" ${VE}/>`;
        if (t === 3) extra = `<ellipse cx="0.15" cy="${f2(0.45 + 0.6 * cc)}" rx="0.6" ry="${f2(0.25 + 0.3 * cc)}" fill="#e8746a"/>`;
        inner = `<defs><clipPath id="fgMouth"><path d="${open}"/></clipPath></defs>` +
          `<path d="${open}" fill="${p.cLine}"/>` + (extra ? `<g clip-path="url(#fgMouth)">${extra}</g>` : '') +
          `<path d="${open}" fill="none" stroke="${p.cLine}" stroke-width="${mw}" stroke-linejoin="round" ${VE}/>`;
      }
      const halo = t === 0 || t === 4 ? `<ellipse cx="0" cy="0.1" rx="1.25" ry="0.8" fill="${p.cBody}"/>` : '';
      const mt = `<g clip-path="url(#fgBody)"><g transform="matrix(${f1(ex[0])} ${f1(ex[1])} ${f1(ey[0])} ${f1(ey[1])} ${f1(o[0])} ${f1(o[1])})">`;
      if (halo) mouthHalo = mt + halo + '</g></g>';
      mouthSvg = mt + inner + '</g></g>';
    }

    // hat: rests where the head is as wide as the hat's opening
    const ext = [];
    for (const l of loops) for (const q of l) ext.push(q);
    let hatSvg = '';
    if (p.hat) {
      const lw = p.lineW * 0.85, ht = clamp(Math.round(p.hatType ?? 0), 0, 3), size = p.hatSize ?? 1.1, F = n => f1(n);
      const ring = ss => { const pts = [], c = new THREE.Vector3(); for (let k = 0; k < 16; k++) { const q = surfPt(ss, 2 * Math.PI * k / 16).P; pts.push(q); c.add(q); } return { c: c.multiplyScalar(1 / 16), pts }; };
      const cTop = ring(0.97).c, t0 = proj(ring(0.8).c), t1 = proj(cTop);
      let ux = t1[0] - t0[0], uy = t1[1] - t0[1]; const ul = Math.hypot(ux, uy);
      if (ul < 6) { ux = 0; uy = -1; } else { ux /= ul; uy /= ul; }
      ux *= 0.7; uy = uy * 0.7 - 0.3; { const l2 = Math.hypot(ux, uy) || 1; ux /= l2; uy /= l2; }
      const qx = -uy, qy = ux, prof = [];
      for (let ss = 0.995; ss >= 0.45; ss -= 0.015) {
        const r = ring(ss), c = proj(r.c); let lo = Infinity, hi = -Infinity;
        for (const q of r.pts) { const pq = proj(q), d = (pq[0] - c[0]) * qx + (pq[1] - c[1]) * qy; if (d < lo) lo = d; if (d > hi) hi = d; }
        prof.push({ ss, cx: c[0] + qx * (lo + hi) / 2, cy: c[1] + qy * (lo + hi) / 2, hw: (hi - lo) / 2 });
      }
      const headHW = Math.max(...prof.filter(e => e.ss >= 0.6).map(e => e.hw));
      const b = Math.max(headHW * [0.72, 0.5, 0.8, 0.97][ht] * size, pxPer(cTop) * 0.08);
      // walk down from the tip; stop where the head is wide enough OR the hat would sit too deep
      const tipE = prof[0], maxDepth = b * [0.9, 0.7, 0.8, 0.75][ht];
      let base = prof[prof.length - 1];
      for (const e of prof) {
        const depth = (tipE.cx - e.cx) * ux + (tipE.cy - e.cy) * uy;
        if (e.hw >= b || depth >= maxDepth || e.ss < 0.8) { base = e; break; }
      }
      let tipH = 0;
      for (const e of prof) if (e.ss >= base.ss) tipH = Math.max(tipH, (e.cx - base.cx) * ux + (e.cy - base.cy) * uy);
      const th = Math.atan2(ux, -uy) / D2R + (p.hatTilt ?? 0), col = p.hatColor || '#e4572e';
      let body = '', H;
      if (ht === 0) {
        H = Math.max(2.2 * b, tipH + lw * 1.5);
        const crown = `M${F(-b)} 0L${F(-0.92 * b)} ${F(-H)}L${F(0.92 * b)} ${F(-H)}L${F(b)} 0Z`;
        body = `<defs><clipPath id="fgHat"><path d="${crown}"/></clipPath></defs><path d="${crown}"/>` +
          `<g clip-path="url(#fgHat)"><rect x="${F(-2 * b)}" y="${F(-0.5 * b)}" width="${F(4 * b)}" height="${F(0.28 * b)}" fill="${p.cLine}" stroke="none"/></g>` +
          `<rect x="${F(-1.7 * b)}" y="${F(-0.17 * b)}" width="${F(3.4 * b)}" height="${F(0.34 * b)}" rx="${F(0.17 * b)}"/>`;
      } else if (ht === 1) {
        H = Math.max(2.6 * b, tipH * 1.15 + lw * 2);
        const tri = `M${F(-b)} 0L0 ${F(-H)}L${F(b)} 0Z`;
        body = `<defs><clipPath id="fgHat"><path d="${tri}"/></clipPath></defs><path d="${tri}"/>` +
          `<g clip-path="url(#fgHat)" fill="none"><path d="M${F(-2 * b)} ${F(-0.25 * H)}L${F(2 * b)} ${F(-0.45 * H)}M${F(-2 * b)} ${F(-0.58 * H)}L${F(2 * b)} ${F(-0.78 * H)}"/></g>` +
          `<circle cx="0" cy="${F(-H)}" r="${F(0.28 * b)}" fill="${p.cEye}"/>`;
      } else if (ht === 2) {
        H = Math.max(1.15 * b, tipH * 0.7 + lw);
        body = `<path d="M${F(-b)} 0L${F(-1.08 * b)} ${F(-H)}L${F(-0.52 * b)} ${F(-0.55 * H)}L0 ${F(-1.08 * H)}L${F(0.52 * b)} ${F(-0.55 * H)}L${F(1.08 * b)} ${F(-H)}L${F(b)} 0Z"/>` +
          `<path d="M${F(-1.02 * b)} ${F(-0.22 * H)}L${F(1.02 * b)} ${F(-0.22 * H)}" fill="none"/>` +
          [[-1.08, -1], [0, -1.08], [1.08, -1]].map(([x, y]) => `<circle cx="${F(x * b)}" cy="${F(y * H)}" r="${F(0.13 * b)}" fill="${p.cEye}"/>`).join('');
      } else {
        H = Math.max(1.35 * b, tipH * 1.1 + lw * 1.5);
        body = `<path d="M${F(-b)} 0C${F(-b)} ${F(-1.3 * H)} ${F(b)} ${F(-1.3 * H)} ${F(b)} 0Z"/>` +
          `<circle cx="0" cy="${F(-0.975 * H - 0.15 * b)}" r="${F(0.3 * b)}" fill="${p.cEye}"/>` +
          `<rect x="${F(-1.07 * b)}" y="${F(-0.38 * b)}" width="${F(2.14 * b)}" height="${F(0.55 * b)}" rx="${F(0.15 * b)}"/>`;
      }
      const cs = Math.cos(th * D2R), sn = Math.sin(th * D2R);
      for (const [lx, ly] of [[-1.8 * b, 0.3 * b], [1.8 * b, 0.3 * b], [-1.8 * b, -H - 0.6 * b], [1.8 * b, -H - 0.6 * b]]) ext.push([base.cx + lx * cs - ly * sn, base.cy + lx * sn + ly * cs]);
      hatSvg = `<g transform="translate(${F(base.cx)} ${F(base.cy)}) rotate(${F(th)})" fill="${col}" stroke="${p.cLine}" stroke-width="${F(lw)}" stroke-linejoin="round" stroke-linecap="round">${body}</g>`;
    }

    // one arm with a hand (attached or floating)
    let armBack = '', armFront = '';
    if (p.arms) {
      const sA = clamp(p.armS ?? 0.45, 0.05, 0.95);
      const cen = ss => { const c = new THREE.Vector3(); for (let k = 0; k < 12; k++) c.add(surfPt(ss, 2 * Math.PI * k / 12).P); return c.multiplyScalar(1 / 12); };
      const Cw = cen(sA), c = proj(Cw), cu = proj(cen(Math.min(0.99, sA + 0.05))), cd = proj(cen(Math.max(0.01, sA - 0.05)));
      let Dx = cu[0] - cd[0], Dy = cu[1] - cd[1]; const Dl = Math.hypot(Dx, Dy);
      if (Dl < 2) { Dx = 0; Dy = -1; } else { Dx /= Dl; Dy /= Dl; }
      const side = (p.armSide ?? 1) >= 0 ? 1 : -1;
      let ox = -Dy, oy = Dx; if (ox < 0) { ox = -ox; oy = -oy; } ox *= side; oy *= side;
      const inside = (fx, fy) => { const nx = fx / FW * 2 - 1, ny = 1 - fy / FH * 2; const gx = Math.round((nx / SCALE + 1) / 2 * MW - 0.5), gy = Math.round((ny / SCALE + 1) / 2 * MH - 0.5); return gx >= 0 && gy >= 0 && gx < MW && gy < MH && cov[gy * MW + gx] >= 0.5; };
      let ex = c[0], ey = c[1], seen = false;
      for (let t = 0; t < 900; t += 1.5) { const x = c[0] + ox * t, y = c[1] + oy * t; if (inside(x, y)) { seen = true; ex = x; ey = y; } else if (seen) break; }
      const U = pxPer(Cw), lw = p.lineW * 0.85;
      const L = (p.armLen ?? 0.5) * U, thk = (p.armThick ?? 0.07) * U, hs = (p.handSize ?? 0.12) * U;
      const pose = clamp(p.armPose ?? 0.2, -1, 1) * 75 * D2R;
      const dx = ox * Math.cos(pose) + Dx * Math.sin(pose), dy = oy * Math.cos(pose) + Dy * Math.sin(pose);
      const E = [ex - ox * lw * 0.6, ey - oy * lw * 0.6];
      const hand = (hx, hy, vx, vy) => {
        const ang = Math.atan2(vy, vx) / D2R, flip = (vy * Dx - vx * Dy) < 0 ? -1 : 1, h = hs;
        const ht = clamp(Math.round(p.handType ?? 0), 0, 2);
        let sh;
        if (ht === 0) sh = `<ellipse cx="${F(0.75 * h)}" cy="0" rx="${F(0.85 * h)}" ry="${F(0.72 * h)}"/><circle cx="${F(0.45 * h)}" cy="${F(-0.68 * h)}" r="${F(0.32 * h)}"/>`;
        else if (ht === 1) sh = `<circle cx="${F(0.55 * h)}" cy="0" r="${F(0.6 * h)}"/>` + [[1.15, -0.42], [1.32, 0.02], [1.12, 0.45], [0.42, -0.72]].map(([x, y], i) => `<circle cx="${F(x * h)}" cy="${F(y * h)}" r="${F((i === 3 ? 0.27 : 0.3) * h)}"/>`).join('');
        else sh = `<circle cx="${F(0.6 * h)}" cy="0" r="${F(0.68 * h)}"/>`;
        const fill = p.handGlove ? p.cEye : p.cBody;
        return `<g transform="translate(${F(hx)} ${F(hy)}) rotate(${F(ang)}) scale(1 ${flip})"><g fill="${p.cLine}" stroke="${p.cLine}" stroke-width="${F(2 * lw)}" stroke-linejoin="round">${sh}</g><g fill="${fill}">${sh}</g></g>`;
      };
      const F = n => f1(n);
      if (Math.round(p.armMode ?? 0) === 0) {
        const end = [E[0] + dx * L, E[1] + dy * L];
        let px = -dy, py = dx; if (px * Dx + py * Dy > 0) { px = -px; py = -py; }
        const bend = p.armBend ?? 0.35, ctrl = [E[0] + dx * L * 0.5 + px * bend * L * 0.4, E[1] + dy * L * 0.5 + py * bend * L * 0.4];
        const d = `M${F(E[0])} ${F(E[1])}Q${F(ctrl[0])} ${F(ctrl[1])} ${F(end[0])} ${F(end[1])}`;
        armBack = `<path d="${d}" fill="none" stroke="${p.cLine}" stroke-width="${F(thk + 2 * lw)}" stroke-linecap="round"/><path d="${d}" fill="none" stroke="${p.cBody}" stroke-width="${F(thk)}" stroke-linecap="round"/>`;
        let vx = end[0] - ctrl[0], vy = end[1] - ctrl[1]; const vl = Math.hypot(vx, vy) || 1;
        armFront = hand(end[0], end[1], vx / vl, vy / vl);
        const rr = thk / 2 + lw; for (const q of [E, ctrl, end]) ext.push([q[0] - rr, q[1] - rr], [q[0] + rr, q[1] + rr]);
        for (const sg of [-1, 1]) ext.push([end[0] + vx / vl * 1.6 * hs + sg * 1.6 * hs, end[1] + vy / vl * 1.6 * hs + sg * 1.6 * hs]);
      } else {
        const gap = (p.armGap ?? 0.12) * U, hx = E[0] + ox * gap + dx * L * 0.55, hy = E[1] + oy * gap + dy * L * 0.55;
        armFront = hand(hx, hy, dx, dy);
        for (const sg of [-1, 1]) ext.push([hx + dx * 0.7 * hs + sg * 1.7 * hs, hy + dy * 0.7 * hs + sg * 1.7 * hs]);
      }
    }

    if (p.fit !== false && (opt._fit || 0) < 2 && ext.length) {
      let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
      for (const [x, y] of ext) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
      const pad = 0.05 * FW + p.lineW;
      if (x0 < pad || x1 > FW - pad || y0 < pad || y1 > FH - pad) {
        const mx = 1 - 2 * pad / FW, my = 1 - 2 * pad / FH, z = p.zoom;
        let px = p.panX, py = p.panY;
        const u0 = (x0 / FW * 2 - 1 - px) / z, u1 = (x1 / FW * 2 - 1 - px) / z;
        const v0 = (1 - y1 / FH * 2 - py) / z, v1 = (1 - y0 / FH * 2 - py) / z;
        const z2 = Math.min(z, 2 * mx / Math.max(1e-6, u1 - u0), 2 * my / Math.max(1e-6, v1 - v0)) * 0.98;
        let b0 = z2 * u0 + px, b1 = z2 * u1 + px; if (b0 < -mx) px += -mx - b0; else if (b1 > mx) px -= b1 - mx;
        b0 = z2 * v0 + py; b1 = z2 * v1 + py; if (b0 < -my) py += -my - b0; else if (b1 > my) py -= b1 - my;
        return update({ ...p, zoom: z2, panX: px, panY: py }, { ...opt, _fit: (opt._fit || 0) + 1 });
      }
    }

    renderer.render(scene, camera);

    const join = p.joinRound ? 'round' : 'miter';
    const grp = (ds, w) => ds.length && w > 0 ? `<g clip-path="url(#fgBody)" fill="none" stroke="${p.cLine}" stroke-width="${w}" stroke-linecap="round" stroke-linejoin="${join}" stroke-miterlimit="4">${ds.map(d => `<path d="${d}"/>`).join('')}</g>` : '';
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${FW} ${FH}" width="100%" height="100%" style="display:block">` +
      `<defs><clipPath id="fgBody"><path d="${outlineD}" clip-rule="evenodd"/></clipPath></defs>` +
      `<rect width="${FW}" height="${FH}" fill="${p.cBg}"/>` + armBack +
      (outlineD ? `<path d="${outlineD}" fill="${p.cBody}" fill-rule="evenodd"/>` : '') +
      grp(patDs, p.patW) + grp(innerDs.concat(contourDs), p.innerW) +
      mouthHalo + '<!--face-->' + mouthSvg + eyeSvg + '<!--/face-->' +
      (outlineD && p.lineW > 0 ? `<path d="${outlineD}" fill="none" stroke="${p.cLine}" stroke-width="${p.lineW}" stroke-linejoin="${join}" stroke-miterlimit="4"/>` : '') +
      armFront + hatSvg +
      `</svg>`;
    const uid = 'u' + (++uidN);
    let nrm = null;
    if (opt.normals) { try { nrm = normalsUrl(); } catch (e) { console.error(e); } }
    return { svg: svg.replace(/fg(Body|Eye\d+|Mouth|Hat)\b/g, m => m + uid), dbg, nrm };
  }

  function resize(w, h) { renderer.setSize(Math.max(1, Math.round(w)), Math.max(1, Math.round(h)), false); }
  function dispose() { mesh.geometry.dispose(); wire.geometry.dispose(); rt.dispose(); renderer.dispose(); }
  return { update, resize, dispose };
}
