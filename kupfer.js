// Kupferstich-Effekt: macht aus dem SVG eines Wesens einen Stich (reiner SVG-Filter).
// Ein Effekt = eine Zahl (Seed). Gespeichert als params.fxSeed (0/fehlt = kein Effekt).
export const PAL = [
  { n: 'Tinte', ink: '#1b1a17', paper: '#ece4d2' },
  { n: 'Kupfer', ink: '#4a2414', paper: '#efe2c8' },
  { n: 'Sepia', ink: '#3a281a', paper: '#e4cfa8' },
  { n: 'Preußischblau', ink: '#16294a', paper: '#e9e6dc' },
  { n: 'Rot', ink: '#b3200f', paper: '#f3f2f2' },
  { n: 'Gold', ink: '#e0bd6a', paper: '#16130f' },
  { n: 'Moos', ink: '#1f3a2b', paper: '#e7e8d9' },
  { n: 'Weiß auf Rot', ink: '#f6efe6', paper: '#c4260f' },
];
export const MODES = ['Kupferstich', 'Kreuzschraffur', 'Punktstich', 'Banknote', 'Holzschnitt', 'Kolorierter Stich'];
function rng(seed) {
  let a = (seed >>> 0) || 1;
  return () => { a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; };
}
export function randomSeed() { return 1 + Math.floor(Math.random() * 999998); }
export function fxOf(seed) {
  const r = rng(seed), R = (a, b) => a + (b - a) * r(), pick = a => a[Math.floor(r() * a.length)];
  const mode = pick([0, 0, 0, 1, 1, 2, 3, 3, 4, 5, 5]);
  const pal = mode === 5 ? pick([0, 1, 2, 3]) : pick([0, 0, 1, 1, 2, 3, 4, 5, 6, 7]);
  const f = {
    seed, mode, pal, ang: R(20, 160), sp: R(6.5, 10), S: R(5, 8), cov: R(1.15, 1.55), amb: R(0.04, 0.2), gam: R(0.8, 1.3),
    az: R(35, 145), el: R(22, 50), blur: R(16, 38), surf: R(4, 10), warp: R(14, 46), wob: R(0, 5), wf: R(0.008, 0.03),
    brk: R(0, 0.22), cross: R(55, 90) * (r() < 0.5 ? 1 : -1), plate: r() < 0.6, grain: R(0.05, 0.2), bgl: r() < 0.45,
  };
  if (mode === 1) f.sp = R(7, 11);
  if (mode === 2) f.sp = R(7, 10);
  if (mode === 3) { f.wob = R(14, 34); f.wf = R(0.003, 0.008); f.sp = R(5.5, 8); }
  if (mode === 4) { f.sp = R(13, 20); f.S = R(9, 14); f.cov = R(1.1, 1.3); f.brk = 0; }
  f.name = MODES[mode] + ' · ' + PAL[pal].n;
  return f;
}
export function fxName(seed) { return seed ? fxOf(seed).name : ''; }

const n2 = v => Math.round(v * 1000) / 1000;
const rgb = h => [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16) / 255);
function hatchUri(W, H, ang, sp, dots) {
  const h = n2(sp / 2);
  const body = dots
    ? `<defs><radialGradient id="d"><stop offset="0" stop-color="#000"/><stop offset="1" stop-color="#fff"/></radialGradient><pattern id="p" width="${n2(sp)}" height="${n2(sp)}" patternUnits="userSpaceOnUse" patternTransform="rotate(${n2(ang)})"><rect width="${n2(sp)}" height="${n2(sp)}" fill="#fff"/><circle cx="${h}" cy="${h}" r="${n2(h * 1.42)}" fill="url(#d)"/></pattern></defs><rect width="${W}" height="${H}" fill="url(#p)"/>`
    : `<defs><linearGradient id="g" gradientUnits="userSpaceOnUse" x1="0" y1="0" x2="${h}" y2="0" spreadMethod="reflect" gradientTransform="rotate(${n2(ang)})"><stop offset="0" stop-color="#000"/><stop offset="1" stop-color="#fff"/></linearGradient></defs><rect width="${W}" height="${H}" fill="url(#g)"/>`;
  return 'data:image/svg+xml,' + encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">${body}</svg>`);
}

export function applyFx(svg, seed, nrm, flat) {
  if (flat) nrm = null;
  if (!svg || !seed) return svg;
  const f = typeof seed === 'object' ? seed : fxOf(seed), P = PAL[f.pal];
  const vb = svg.match(/viewBox="0 0 ([\d.]+) ([\d.]+)"/), end = svg.lastIndexOf('</svg>');
  if (!vb || end < 0) return svg;
  const W = +vb[1], H = +vb[2], M = 60, FW = W + 2 * M, FH = H + 2 * M, id = 'kp' + f.seed;
  const bgM = svg.match(/<rect width="[\d.]+" height="[\d.]+" fill="([^"]*)"\/>/);
  let before, after;
  if (bgM) { before = svg.slice(0, bgM.index); after = svg.slice(bgM.index + bgM[0].length, end); }
  else { const o = svg.indexOf('>') + 1; before = svg.slice(0, o); after = svg.slice(o, end); }
  const clear = !bgM || bgM[1] === 'none';
  let face = '', after2 = '';
  { const fa = after.indexOf('<!--face-->'), fb = after.indexOf('<!--/face-->');
    if (fa >= 0 && fb > fa) { face = after.slice(fa + 11, fb); after2 = after.slice(fb + 12); after = after.slice(0, fa); } }
  const [ir, ig, ib] = rgb(P.ink), [pr, pg, pb] = rgb(P.paper);
  const L = '0.299 0.587 0.114 0 0', sd = f.seed % 997, D = Math.PI / 180;
  const lx = Math.cos(f.az * D) * Math.cos(f.el * D), ly = Math.sin(f.az * D) * Math.cos(f.el * D), lz = Math.sin(f.el * D), q = 1 - f.amb;
  const dotRow = `${n2(2 * lx * q)} ${n2(2 * ly * q)} ${n2(2 * lz * q)} 0 ${n2(f.amb - (lx + ly + lz) * q)}`;
  let fl = `<feFlood flood-color="#fff" result="w"/><feComposite in="SourceGraphic" in2="w" operator="over" result="s"/>` +
    `<feColorMatrix in="s" type="matrix" values="${L} ${L} ${L} 0 0 0 1 0" result="g"/>` +
    `<feComponentTransfer in="g" result="g2">${['R', 'G', 'B'].map(c => `<feFunc${c} type="table" tableValues="0 0 0.5 0.9 1 1"/>`).join('')}</feComponentTransfer>` +
    `<feGaussianBlur in="SourceAlpha" stdDeviation="${n2(f.blur)}" result="ab"/>` +
    `<feDiffuseLighting in="ab" surfaceScale="${n2(f.surf)}" diffuseConstant="1.1" lighting-color="#fff" result="li"><feDistantLight azimuth="${n2(360 - f.az)}" elevation="${n2(f.el)}"/></feDiffuseLighting>` +
    `<feColorMatrix in="ab" type="matrix" values="0 0 0 1 0 0 0 0 0.6 0.2 0 0 0 0 0 0 0 0 0 1" result="dm"/>`;
  if (nrm) fl += `<feImage href="${nrm}" x="0" y="0" width="${W}" height="${H}" preserveAspectRatio="none" result="nm"/>` +
    `<feColorMatrix in="nm" type="matrix" values="${dotRow} ${dotRow} ${dotRow} 0 0 0 1 0" result="dl"/>` +
    `<feComposite in="dl" in2="li" operator="over" result="lit"/><feComposite in="nm" in2="dm" operator="over" result="dmap"/>`;
  const sh = 0.45 + 0.4 * ((f.seed * 9301 + 49297) % 233280) / 233280;
  fl += (flat
    ? `<feComposite in="g" in2="li" operator="arithmetic" k1="${n2(sh)}" k2="${n2(1 - sh)}" k3="0" k4="0" result="t0"/>`
    : `<feComposite in="g2" in2="${nrm ? 'lit' : 'li'}" operator="arithmetic" k1="${n2(f.cov)}" k2="0" k3="0" k4="0" result="t0"/>`) +
    `<feTurbulence type="fractalNoise" baseFrequency="0.35" numOctaves="1" seed="${sd}" result="n0"/>` +
    `<feColorMatrix in="n0" type="matrix" values="1 0 0 0 0 1 0 0 0 0 1 0 0 0 0 0 0 0 0 1" result="n1"/>` +
    `<feComposite in="t0" in2="n1" operator="arithmetic" k1="0" k2="1" k3="${n2(f.brk)}" k4="${n2(-f.brk / 2)}" result="t1"/>` +
    `<feComponentTransfer in="t1" result="t">${['R', 'G', 'B'].map(c => `<feFunc${c} type="gamma" amplitude="1" exponent="${n2(f.gam)}" offset="0"/>`).join('')}</feComponentTransfer>` +
    `<feTurbulence type="fractalNoise" baseFrequency="${n2(f.wf)}" numOctaves="2" seed="${sd + 7}" result="wn"/>`;
  const dmap = nrm ? 'dmap' : 'dm';
  const T = flat ? [1, 0.62, 0.36, 0.42] : [0.92, 0.55, 0.3, 0.38];
  const layers = f.mode === 1 ? [[f.ang, T[0]], [f.ang + f.cross, T[1]], [f.ang - f.cross / 2, T[2]]]
    : f.mode === 2 || f.mode === 4 ? [[f.ang, T[0]]] : [[f.ang, T[0]], [f.ang + f.cross, T[3]]];
  layers.forEach(([a, thr], k) => {
    fl += `<feImage href="${hatchUri(FW, FH, a, f.sp, f.mode === 2)}" x="${-M}" y="${-M}" width="${FW}" height="${FH}" preserveAspectRatio="none" result="h${k}a"/>` +
      `<feDisplacementMap in="h${k}a" in2="wn" scale="${n2(f.wob)}" xChannelSelector="R" yChannelSelector="G" result="h${k}b"/>` +
      `<feDisplacementMap in="h${k}b" in2="${dmap}" scale="${n2(f.warp)}" xChannelSelector="R" yChannelSelector="G" result="h${k}"/>` +
      `<feComposite in="t" in2="h${k}" operator="arithmetic" k1="0" k2="${n2(f.S)}" k3="${n2(f.S)}" k4="${n2(0.5 - f.S * thr)}" result="l${k}"/>`;
    if (k) fl += `<feComposite in="l${k}" in2="m${k - 1}" operator="arithmetic" k1="1" k2="0" k3="0" k4="0" result="m${k}"/>`;
    else fl += `<feComposite in="l0" in2="l0" operator="arithmetic" k1="0" k2="1" k3="0" k4="0" result="m0"/>`;
  });
  const m = 'm' + (layers.length - 1);
  if (f.mode === 5) {
    fl += `<feColorMatrix in="${m}" type="matrix" values="${n2(1 - ir)} 0 0 0 ${n2(ir)} ${n2(1 - ig)} 0 0 0 ${n2(ig)} ${n2(1 - ib)} 0 0 0 ${n2(ib)} 0 0 0 0 1" result="c0"/>` +
      `<feComponentTransfer in="s" result="col">${['R', 'G', 'B'].map(c => `<feFunc${c} type="linear" slope="0.55" intercept="0.45"/>`).join('')}</feComponentTransfer>` +
      `<feComposite in="c0" in2="col" operator="arithmetic" k1="1" k2="0" k3="0" k4="0" result="c"/>`;
  } else {
    fl += `<feColorMatrix in="${m}" type="matrix" values="${n2(pr - ir)} 0 0 0 ${n2(ir)} ${n2(pg - ig)} 0 0 0 ${n2(ig)} ${n2(pb - ib)} 0 0 0 ${n2(ib)} 0 0 0 0 1" result="c"/>`;
  }
  fl += `<feComposite in="c" in2="SourceAlpha" operator="in"/>`;
  let defs = `<filter id="${id}" filterUnits="userSpaceOnUse" x="${-M}" y="${-M}" width="${FW}" height="${FH}" color-interpolation-filters="sRGB">${fl}</filter>`;
  if (face && f.mode !== 5) defs += `<filter id="${id}f" color-interpolation-filters="sRGB"><feColorMatrix type="matrix" values="${L} ${L} ${L} 0 0 0 1 0"/><feComponentTransfer>${['R', 'G', 'B'].map(c => `<feFunc${c} type="linear" slope="8" intercept="-1.74"/>`).join('')}</feComponentTransfer><feColorMatrix type="matrix" values="${n2(pr - ir)} 0 0 0 ${n2(ir)} ${n2(pg - ig)} 0 0 0 ${n2(ig)} ${n2(pb - ib)} 0 0 0 ${n2(ib)} 0 0 0 1 0"/></filter>`;
  let bg = '', top = '';
  if (!clear) {
    bg = `<rect width="${W}" height="${H}" fill="${P.paper}"/>`;
    if (f.bgl) {
      const ps = n2(f.sp * 1.7);
      defs += `<pattern id="${id}b" width="${ps}" height="${ps}" patternUnits="userSpaceOnUse" patternTransform="rotate(${n2(f.ang)})"><path d="M0 ${n2(ps / 2)}H${ps}" stroke="${P.ink}" stroke-width="0.8"/></pattern>`;
      bg += `<rect width="${W}" height="${H}" fill="url(#${id}b)" opacity="0.35"/>`;
    }
    if (f.plate) bg += `<rect x="16" y="16" width="${W - 32}" height="${H - 32}" rx="10" fill="none" stroke="${P.ink}" stroke-opacity="0.28" stroke-width="2.5"/>`;
    const a = n2(f.grain * 10);
    defs += `<filter id="${id}g" filterUnits="userSpaceOnUse" x="0" y="0" width="${W}" height="${H}"><feTurbulence type="fractalNoise" baseFrequency="0.8" numOctaves="2" seed="${sd + 3}"/><feColorMatrix type="matrix" values="0 0 0 0 ${n2(ir)} 0 0 0 0 ${n2(ig)} 0 0 0 0 ${n2(ib)} ${a} 0 0 0 ${n2(-0.56 * a)}"/></filter>`;
    top = `<rect width="${W}" height="${H}" filter="url(#${id}g)"/>`;
  }
  const faceOut = face ? (f.mode === 5 ? face : `<g filter="url(#${id}f)">${face}</g>`) : '';
  return before + `<defs>${defs}</defs>` + bg + `<g filter="url(#${id})">` + after + `</g>` + faceOut + (after2.trim() ? `<g filter="url(#${id})">${after2}</g>` : '') + top + '</svg>';
}
