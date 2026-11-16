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
    uniforms: { uNear: { value: 0 }, uFar: { value: 1 } },
    vertexShader: 'varying float vD; void main(){ vec4 mv = modelViewMatrix * vec4(position,1.0); vD = -mv.z; gl_Position = projectionMatrix * mv; }',
    fragmentShader: 'uniform float uNear; uniform float uFar; varying float vD; void main(){ gl_FragColor = vec4(clamp((vD-uNear)/(uFar-uNear),0.0,1.0), 1.0, 0.0, 1.0); }',
    side: THREE.DoubleSide,
  });
  const maskScene = new THREE.Scene();
  const maskMesh = new THREE.Mesh(mesh.geometry, depthMat); maskScene.add(maskMesh);
  const maskCam = new THREE.PerspectiveCamera();
  const RW = MW * SS, RH = MH * SS;
  const rt = new THREE.WebGLRenderTarget(RW, RH);
  const buf = new Uint8Array(RW * RH * 4);
  const cov = new Float32Array(MW * MH), dep = new Float32Array(MW * MH);
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
    mesh.geometry.dispose(); mesh.geometry = grid.geom; maskMesh.geometry = grid.geom;
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
    renderer.setRenderTarget(rt); renderer.clear(true, true, true);
    renderer.render(maskScene, maskCam);
    renderer.readRenderTargetPixels(rt, 0, 0, RW, RH, buf);
    renderer.setRenderTarget(null);
    for (let y = 0; y < MH; y++) for (let x = 0; x < MW; x++) {
      let c = 0, d = 1;
      for (let sy = 0; sy < SS; sy++) {
        let o = ((y * SS + sy) * RW + x * SS) * 4;
        for (let sx = 0; sx < SS; sx++, o += 4) if (buf[o + 1] > 127) { c++; const dv = buf[o] / 255; if (dv < d) d = dv; }
      }
      cov[y * MW + x] = c / (SS * SS); dep[y * MW + x] = d;
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

    // eye geometry
    let eyeInfo = null;
    eye3d.visible = !!p.eye && opt.lines3d !== false;
    if (p.eye) {
      const P = new THREE.Vector3(), Nn = new THREE.Vector3();
      grid.onMesh(p.eyeS, p.eyeA * D2R, P, Nn);
      eye3d.position.copy(P).addScaledVector(Nn, 0.004); eye3d.lookAt(tmp.copy(P).add(Nn)); eye3d.scale.setScalar(p.eyeSize);
      if (visible(P, Nn)) {
        const [cx, cy] = proj(P);
        const right = new THREE.Vector3(1, 0, 0).applyQuaternion(camera.quaternion);
        const [rx, ry] = proj(tmp2.copy(P).addScaledVector(right, p.eyeSize));
        const R = Math.hypot(rx - cx, ry - cy);
        const [nx, ny] = proj(tmp2.copy(P).addScaledVector(Nn, 0.1));
        const ang = Math.atan2(ny - cy, nx - cx) / D2R;
        const cosT = Math.max(0.12, Nn.dot(tmp2.copy(camera.position).sub(P).normalize()));
        eyeInfo = { cx, cy, R, ang, q: 1 + (cosT - 1) * p.eyePersp };
      }
    }
    const insideEye = (x, y, grow = 0) => {
      if (!eyeInfo) return false;
      const { cx, cy, R, ang, q } = eyeInfo, c = Math.cos(-ang * D2R), sn = Math.sin(-ang * D2R);
      const dx = x - cx, dy = y - cy, lx = dx * c - dy * sn, ly = dx * sn + dy * c;
      return (lx / (R * q + grow)) ** 2 + (ly / (R + grow)) ** 2 <= 1;
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
      if (eyeInfo) {
        const { cx, cy, R, ang, q } = eyeInfo, c = Math.cos(ang * D2R), sn = Math.sin(ang * D2R), ep = [];
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
        let tot = 0, nr = 0;
        for (let i = 0; i < r.pts.length - 1; i++) {
          const a = r.pts[i], b = r.pts[i + 1], L = Math.hypot(b[0] - a[0], b[1] - a[1]), st = Math.max(1, Math.ceil(L / 4));
          if (L < 1e-6) continue;
          const vx = (b[0] - a[0]) / L, vy = (b[1] - a[1]) / L;
          for (let t = 0; t < st; t++) {
            const x = a[0] + (b[0] - a[0]) * t / st, y = a[1] + (b[1] - a[1]) * t / st;
            if (Math.hypot(x - a0[0], y - a0[1]) < endX || Math.hypot(x - a1[0], y - a1[1]) < endX) continue;
            tot++;
            if (nearIn(hOther, x, y, gap, -2, vx, vy) || nearIn(hPat, x, y, gap, -2, vx, vy)) nr++;
          }
        }
        if (tot >= 2 && nr / tot > 0.3) continue;
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
    if (eyeInfo) {
      const { cx, cy, R, ang, q } = eyeInfo;
      const lidY = -R + 2 * R * p.lid, ew = p.eyeLineW, big = R * 3;
      const lid = p.lid > 0.005 ? `<g transform="rotate(${f1(p.lidTilt)})"><rect x="${f1(-big)}" y="${f1(-big)}" width="${f1(2 * big)}" height="${f1(big + lidY)}" fill="${p.cBody}"/><line x1="${f1(-big)}" y1="${f1(lidY)}" x2="${f1(big)}" y2="${f1(lidY)}" stroke="${p.cLine}" stroke-width="${f1(ew * 0.85)}"/></g>` : '';
      const eye = `<g transform="translate(${f1(cx)} ${f1(cy)}) rotate(${f1(ang)})">` +
        `<ellipse rx="${f1(R * q)}" ry="${f1(R)}" fill="${p.cEye}"/>` +
        `<g clip-path="url(#fgEye)"><g transform="rotate(${f1(-ang)})">` +
        `<circle cx="${f1(p.pupilX * R * 0.6)}" cy="${f1(p.pupilY * R * 0.6)}" r="${f1(p.pupil * R)}" fill="${p.cLine}"/>${lid}</g></g>` +
        `<ellipse rx="${f1(R * q)}" ry="${f1(R)}" fill="none" stroke="${p.cLine}" stroke-width="${f1(ew)}"/></g>`;
      eyeSvg = `<defs><clipPath id="fgEye"><ellipse rx="${f1(R * q)}" ry="${f1(R)}"/></clipPath></defs>` +
        (p.eyeClip ? `<g clip-path="url(#fgBody)">${eye}</g>` : eye);
    }

    renderer.render(scene, camera);

    const join = p.joinRound ? 'round' : 'miter';
    const grp = (ds, w) => ds.length && w > 0 ? `<g clip-path="url(#fgBody)" fill="none" stroke="${p.cLine}" stroke-width="${w}" stroke-linecap="round" stroke-linejoin="${join}" stroke-miterlimit="4">${ds.map(d => `<path d="${d}"/>`).join('')}</g>` : '';
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${FW} ${FH}" width="100%" height="100%" style="display:block">` +
      `<defs><clipPath id="fgBody"><path d="${outlineD}" clip-rule="evenodd"/></clipPath></defs>` +
      `<rect width="${FW}" height="${FH}" fill="${p.cBg}"/>` +
      (outlineD ? `<path d="${outlineD}" fill="${p.cBody}" fill-rule="evenodd"/>` : '') +
      grp(patDs, p.patW) + grp(innerDs.concat(contourDs), p.innerW) +
      eyeSvg +
      (outlineD && p.lineW > 0 ? `<path d="${outlineD}" fill="none" stroke="${p.cLine}" stroke-width="${p.lineW}" stroke-linejoin="${join}" stroke-miterlimit="4"/>` : '') +
      `</svg>`;
    return { svg, dbg };
  }

  function resize(w, h) { renderer.setSize(Math.max(1, Math.round(w)), Math.max(1, Math.round(h)), false); }
  function dispose() { mesh.geometry.dispose(); wire.geometry.dispose(); rt.dispose(); renderer.dispose(); }
  return { update, resize, dispose };
}
