/* Formgenerator · Mono-Design: Hintergrund-Effekte als Web Component.
   <mono-fx effect="orb|waves|vwaves|grid|aurora|burst|threads|topo|pixel" ox="0" oy="0" level="1"></mono-fx>
   ox/oy = Kamera-Versatz in px (Effekt wandert mit der Karte), level = Stärke. */
(() => {
  if (window.customElements && customElements.get('mono-fx')) return;
  const mq = q => { try { return matchMedia(q).matches; } catch (e) { return false; } };
  const COARSE = mq('(pointer: coarse)');
  const REDUCED = mq('(prefers-reduced-motion: reduce)');

  // ---------- Zeiger (global, ein Listener für alle Effekte)
  const P = { x: -1e5, y: -1e5, t: 0, on: false, down: [] };
  const opt = { passive: true, capture: true };
  addEventListener('pointermove', e => { P.x = e.clientX; P.y = e.clientY; P.t = performance.now(); P.on = true; }, opt);
  addEventListener('pointerdown', e => { P.x = e.clientX; P.y = e.clientY; P.t = performance.now(); P.on = true; P.down.push({ x: e.clientX, y: e.clientY, t: P.t }); if (P.down.length > 12) P.down.shift(); }, opt);
  document.addEventListener('mouseleave', () => { P.on = false; });
  addEventListener('blur', () => { P.on = false; });

  // ---------- Perlin-Rauschen (für Canvas-Effekte)
  const perm = new Uint8Array(512);
  { const p = []; for (let i = 0; i < 256; i++) p[i] = i; let s = 1337; for (let i = 255; i > 0; i--) { s = (s * 16807) % 2147483647; const j = s % (i + 1); [p[i], p[j]] = [p[j], p[i]]; } for (let i = 0; i < 512; i++) perm[i] = p[i & 255]; }
  const fade = t => t * t * t * (t * (t * 6 - 15) + 10);
  const lerp = (a, b, t) => a + (b - a) * t;
  const grad = (h, x, y, z) => { h &= 15; const u = h < 8 ? x : y, v = h < 4 ? y : (h === 12 || h === 14 ? x : z); return ((h & 1) ? -u : u) + ((h & 2) ? -v : v); };
  function noise3(x, y, z) {
    let X = Math.floor(x), Y = Math.floor(y), Z = Math.floor(z);
    x -= X; y -= Y; z -= Z; X &= 255; Y &= 255; Z &= 255;
    const u = fade(x), v = fade(y), w = fade(z);
    const A = perm[X] + Y, AA = perm[A] + Z, AB = perm[A + 1] + Z, B = perm[X + 1] + Y, BA = perm[B] + Z, BB = perm[B + 1] + Z;
    return lerp(lerp(lerp(grad(perm[AA], x, y, z), grad(perm[BA], x - 1, y, z), u), lerp(grad(perm[AB], x, y - 1, z), grad(perm[BB], x - 1, y - 1, z), u), v),
      lerp(lerp(grad(perm[AA + 1], x, y, z - 1), grad(perm[BA + 1], x - 1, y, z - 1), u), lerp(grad(perm[AB + 1], x, y - 1, z - 1), grad(perm[BB + 1], x - 1, y - 1, z - 1), u), v), w);
  }

  // ---------- WebGL-Grundgerüst
  const VS = 'attribute vec2 p;void main(){gl_Position=vec4(p,0.,1.);}';
  const HEAD = '#ifdef GL_FRAGMENT_PRECISION_HIGH\nprecision highp float;\n#else\nprecision mediump float;\n#endif\nuniform vec2 uRes;uniform float uTime;uniform vec2 uMouse;uniform float uHover;uniform float uLv;\n';
  const NOISE = `
vec3 m289(vec3 x){return x-floor(x*(1./289.))*289.;}vec4 m289(vec4 x){return x-floor(x*(1./289.))*289.;}
vec4 perm4(vec4 x){return m289(((x*34.)+1.)*x);}vec4 tis(vec4 r){return 1.79284291400159-.85373472095314*r;}
float snoise(vec3 v){const vec2 C=vec2(1./6.,1./3.);const vec4 D=vec4(0.,.5,1.,2.);
vec3 i=floor(v+dot(v,C.yyy));vec3 x0=v-i+dot(i,C.xxx);vec3 g=step(x0.yzx,x0.xyz);vec3 l=1.-g;vec3 i1=min(g.xyz,l.zxy);vec3 i2=max(g.xyz,l.zxy);
vec3 x1=x0-i1+C.xxx;vec3 x2=x0-i2+C.yyy;vec3 x3=x0-D.yyy;i=m289(i);
vec4 p=perm4(perm4(perm4(i.z+vec4(0.,i1.z,i2.z,1.))+i.y+vec4(0.,i1.y,i2.y,1.))+i.x+vec4(0.,i1.x,i2.x,1.));
float n_=.142857142857;vec3 ns=n_*D.wyz-D.xzx;vec4 j=p-49.*floor(p*ns.z*ns.z);vec4 x_=floor(j*ns.z);vec4 y_=floor(j-7.*x_);
vec4 x=x_*ns.x+ns.yyyy;vec4 y=y_*ns.x+ns.yyyy;vec4 h=1.-abs(x)-abs(y);vec4 b0=vec4(x.xy,y.xy);vec4 b1=vec4(x.zw,y.zw);
vec4 s0=floor(b0)*2.+1.;vec4 s1=floor(b1)*2.+1.;vec4 sh=-step(h,vec4(0.));vec4 a0=b0.xzyw+s0.xzyw*sh.xxyy;vec4 a1=b1.xzyw+s1.xzyw*sh.zzww;
vec3 p0=vec3(a0.xy,h.x);vec3 p1=vec3(a0.zw,h.y);vec3 p2=vec3(a1.xy,h.z);vec3 p3=vec3(a1.zw,h.w);
vec4 nr=tis(vec4(dot(p0,p0),dot(p1,p1),dot(p2,p2),dot(p3,p3)));p0*=nr.x;p1*=nr.y;p2*=nr.z;p3*=nr.w;
vec4 m=max(.6-vec4(dot(x0,x0),dot(x1,x1),dot(x2,x2),dot(x3,x3)),0.);m=m*m;return 42.*dot(m*m,vec4(dot(p0,x0),dot(p1,x1),dot(p2,x2),dot(p3,x3)));}
float dith(){return (fract(sin(dot(gl_FragCoord.xy,vec2(12.9898,78.233)))*43758.5453)-.5)/255.;}
vec4 outc(vec3 c){c=max(c+dith(),0.);float a=clamp(max(c.r,max(c.g,c.b)),0.,1.);return vec4(min(c,vec3(a)),a);}
`;
  function glMake(cv, fs) {
    const gl = cv.getContext('webgl', { alpha: true, premultipliedAlpha: true, antialias: false, depth: false, stencil: false, powerPreference: 'low-power' });
    if (!gl) return null;
    const sh = (t, src) => { const o = gl.createShader(t); gl.shaderSource(o, src); gl.compileShader(o); if (!gl.getShaderParameter(o, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(o)); return o; };
    const pr = gl.createProgram();
    gl.attachShader(pr, sh(gl.VERTEX_SHADER, VS)); gl.attachShader(pr, sh(gl.FRAGMENT_SHADER, HEAD + NOISE + fs)); gl.linkProgram(pr);
    if (!gl.getProgramParameter(pr, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(pr));
    gl.useProgram(pr);
    gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer());
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
    const loc = gl.getAttribLocation(pr, 'p'); gl.enableVertexAttribArray(loc); gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
    const U = {}, n = gl.getProgramParameter(pr, gl.ACTIVE_UNIFORMS);
    for (let i = 0; i < n; i++) { const a = gl.getActiveUniform(pr, i); U[a.name.replace(/\[0\]$/, '')] = gl.getUniformLocation(pr, a.name); }
    const st = { gl, U, lost: false };
    cv.addEventListener('webglcontextlost', e => { e.preventDefault(); st.lost = true; });
    return st;
  }
  function glRun(s, el, t, m) {
    const gl = s.gl, cv = el._cv, U = s.U, d = el._dpr;
    if (s.lost) return;
    gl.viewport(0, 0, cv.width, cv.height);
    if (U.uRes) gl.uniform2f(U.uRes, cv.width, cv.height);
    if (U.uTime) gl.uniform1f(U.uTime, t);
    if (U.uMouse) gl.uniform2f(U.uMouse, m.x * d, (el._h - m.y) * d);
    if (U.uHover) gl.uniform1f(U.uHover, m.hover);
    if (U.uLv) gl.uniform1f(U.uLv, el._lv);
    gl.clearColor(0, 0, 0, 0); gl.clear(gl.COLOR_BUFFER_BIT);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  }
  function glFree(s) { try { const x = s && s.gl && s.gl.getExtension('WEBGL_lose_context'); if (x) x.loseContext(); } catch (e) {} }
  const shader = (fs, extra) => Object.assign({
    scale: () => COARSE ? 0.5 : 0.75,
    init: cv => glMake(cv, fs),
    frame(s, el, t, dt, m) { glRun(s, el, t, m); },
    dispose: glFree,
  }, extra || {});

  // ---------- Effekte
  const FX = {};

  // Orb: leuchtender Ring, wabert beim Darüberfahren
  FX.orb = shader(`
uniform float uSpin;
void main(){
  float s=min(uRes.x,uRes.y);
  vec2 uv=(gl_FragCoord.xy-.5*uRes)/s;
  float t=uTime;
  uv+=uHover*.024*vec2(sin(uv.y*9.+t*2.3),cos(uv.x*9.+t*2.1));
  float r=length(uv);
  vec2 dir=uv/max(r,1e-4);
  float cs=cos(uSpin),sn=sin(uSpin);
  vec2 rd=vec2(cs*dir.x-sn*dir.y,sn*dir.x+cs*dir.y);
  float n=snoise(vec3(rd*1.35,t*.22));
  float n2=snoise(vec3(rd*3.1+7.,t*.35));
  float R=.285+.022*n+.004*n2;
  float d=r-R;
  float core=exp(-d*d/.00008);
  float halo=d<0.?exp(d*15.):exp(-d*7.);
  float bands=.5+.5*sin(atan(rd.y,rd.x)*2.+n*3.);
  float lum=core*(.6+.6*bands)+halo*(.13+.32*bands*bands);
  float inner=smoothstep(R,R-.24,r);
  lum+=inner*(.03+.05*smoothstep(-.35,.35,uv.y+.3*n2));
  lum+=.045*exp(-r*3.2);
  lum*=(.85+.35*uHover)*uLv;
  vec3 col=mix(vec3(.6,.61,.64),vec3(1.),clamp(core*1.2+bands*.25,0.,1.))*lum;
  gl_FragColor=outc(col);
}`, {
    frame(s, el, t, dt, m) { s.spin = (s.spin || 0) + dt * (0.12 + m.hover * 0.9); if (s.U.uSpin) s.gl.uniform1f(s.U.uSpin, s.spin); glRun(s, el, t, m); },
  });

  // Soft Aurora: weiche Lichtbänder
  FX.aurora = shader(`
void main(){
  vec2 uv=gl_FragCoord.xy/uRes;
  float asp=uRes.x/uRes.y;
  float px=uv.x*asp;
  float t=uTime*.07;
  vec2 m=uMouse/uRes;
  float lum=0.;
  for(int i=0;i<3;i++){
    float fi=float(i);
    float h=.64-fi*.14+.11*snoise(vec3(px*.8+fi*3.1,fi*1.7,t*(1.+fi*.35)))+.05*snoise(vec3(px*2.2-t*1.5,fi+4.,t));
    h+=(m.y-.5)*.07*uHover*(1.-fi*.3);
    float w=.035+.03*(.5+.5*snoise(vec3(px*1.3,fi*4.,t*.7)));
    float d=uv.y-h;
    float band=exp(-d*d/(w*w));
    float streak=.5+.5*snoise(vec3(px*7.+fi*10.,uv.y*.4,t*2.2));
    streak*=streak;
    float up=d>0.?exp(-d*3.2):exp(d*30.);
    lum+=(band*.55+up*.45*streak)*(.6-fi*.14);
  }
  lum*=(.35+.65*smoothstep(0.,.5,uv.y))*uLv;
  vec3 col=mix(vec3(.5,.52,.56),vec3(.97),clamp(lum*1.1,0.,1.))*lum*.8;
  gl_FragColor=outc(col);
}`);

  // Prismatic Burst (Perlmutt): Strahlen aus der Mitte
  FX.burst = shader(`
void main(){
  float s=min(uRes.x,uRes.y);
  vec2 c=.5*uRes+(uMouse-.5*uRes)*.05*uHover;
  c.y+=s*.06;
  vec2 p=(gl_FragCoord.xy-c)/s;
  float r=length(p);
  float a=atan(p.y,p.x);
  vec2 q=p/max(r,1e-4);
  float t=uTime;
  float n=snoise(vec3(q*1.6,t*.15));
  float ray=pow(.5+.5*sin(a*11.+t*.25+n*2.5),8.);
  ray+=pow(.5+.5*sin(a*17.-t*.18+n*3.5),10.)*.8;
  ray+=pow(.5+.5*sin(a*5.+t*.1),4.)*.35;
  float fall=exp(-r*2.3)*smoothstep(0.,.06,r);
  float flick=.8+.2*snoise(vec3(q*4.,t*.8-r*3.));
  float lum=(ray*fall*flick*.5+exp(-r*r*38.)*.45)*uLv+exp(-r*3.5)*.07;
  vec3 pearl=.5+.5*cos(6.2831*(vec3(0.,.33,.67)+q.x*.22+q.y*.14+r*1.2-t*.04));
  vec3 col=mix(vec3(1.),pearl,.16)*lum;
  gl_FragColor=outc(col);
}`);

  // Pixel Blast: gerasterte Pixel, Klick = Welle
  FX.pixel = shader(`
uniform float uPx;uniform vec4 uR[8];
float b2(vec2 a){a=floor(a);return fract(a.x/2.+a.y*a.y*.75);}
float b4(vec2 a){return b2(.5*a)*.25+b2(a);}
float b8(vec2 a){return b4(.5*a)*.25+b2(a);}
void main(){
  float s=min(uRes.x,uRes.y);
  vec2 cell=floor(gl_FragCoord.xy/uPx);
  vec2 cc=(cell+.5)*uPx;
  vec2 uv=cc/s;
  float t=uTime*.12;
  float f=snoise(vec3(uv*2.1,t))*.5+snoise(vec3(uv*4.6+3.,t*1.4))*.25+snoise(vec3(uv*9.4,t*2.))*.125;
  f=f*.7+.3;
  f*=.55+.45*smoothstep(.0,.9,gl_FragCoord.y/uRes.y);
  for(int i=0;i<8;i++){
    vec4 R=uR[i];
    if(R.w>.5){
      float age=uTime-R.z;
      float d=distance(cc,R.xy)/s;
      f+=exp(-pow((d-age*.5)*13.,2.))*exp(-age*1.3)*.95;
    }
  }
  float hd=distance(cc,uMouse)/s;
  f+=uHover*.22*exp(-hd*hd*28.);
  float on=step(b8(cell),f);
  vec2 lp=fract(gl_FragCoord.xy/uPx)-.5;
  float sq=step(max(abs(lp.x),abs(lp.y)),.36);
  float a=on*sq*.42*uLv;
  gl_FragColor=vec4(vec3(.93)*a,a);
}`, {
    scale: () => 1,
    frame(s, el, t, dt, m) {
      const d = el._dpr, gl = s.gl;
      s.rip = s.rip || [];
      for (const c of m.clicks) s.rip.push({ x: c.x * d, y: (el._h - c.y) * d, t });
      if (!s.auto || t > s.auto) { s.auto = t + 2.6 + Math.random() * 2.4; s.rip.push({ x: Math.random() * el._cv.width, y: el._cv.height * (0.45 + Math.random() * 0.5), t }); }
      s.rip = s.rip.filter(r => t - r.t < 3).slice(-8);
      const a = new Float32Array(32);
      s.rip.forEach((r, i) => { a.set([r.x, r.y, r.t, 1], i * 4); });
      if (s.U.uR) gl.uniform4fv(s.U.uR, a);
      if (s.U.uPx) gl.uniform1f(s.U.uPx, Math.max(3, Math.round(4 * d)));
      glRun(s, el, t, m);
    },
  });

  // Shape Grid: wanderndes Raster, Zelle unter dem Zeiger leuchtet, ab und zu ein rotes Feld
  FX.grid = {
    init: cv => ({ ctx: cv.getContext('2d'), cells: new Map(), red: [], next: 1 }),
    frame(s, el, t, dt, m) {
      const ctx = s.ctx, d = el._dpr, W = el._w, H = el._h, S = COARSE ? 46 : 42, D = t * 8;
      ctx.setTransform(d, 0, 0, d, 0, 0); ctx.clearRect(0, 0, W, H);
      if (m.in) { const k = Math.floor((m.x + D) / S) + ',' + Math.floor((m.y + D) / S); s.cells.set(k, 1); }
      if (t > s.next) {
        s.next = t + 1.1 + Math.random() * 1.6;
        s.red.push({ kx: Math.floor((Math.random() * W + D) / S), ky: Math.floor((Math.random() * H + D) / S), t0: t });
      }
      for (const [k, v] of s.cells) {
        const nv = v - dt * 1.4; if (nv <= 0) { s.cells.delete(k); continue; } s.cells.set(k, nv);
        const [kx, ky] = k.split(',').map(Number);
        ctx.fillStyle = `rgba(255,255,255,${(0.085 * nv).toFixed(3)})`; ctx.fillRect(kx * S - D, ky * S - D, S, S);
      }
      s.red = s.red.filter(r => t - r.t0 < 2.2);
      for (const r of s.red) { const e = Math.sin(Math.min(1, (t - r.t0) / 2.2) * Math.PI); ctx.fillStyle = `rgba(236,48,19,${(0.2 * e).toFixed(3)})`; ctx.fillRect(r.kx * S - D, r.ky * S - D, S, S); }
      ctx.beginPath();
      const o = 0.5 / d;
      for (let x = Math.ceil(D / S) * S - D; x <= W; x += S) { ctx.moveTo(x + o, 0); ctx.lineTo(x + o, H); }
      for (let y = Math.ceil(D / S) * S - D; y <= H; y += S) { ctx.moveTo(0, y + o); ctx.lineTo(W, y + o); }
      ctx.strokeStyle = 'rgba(255,255,255,.075)'; ctx.lineWidth = 1; ctx.stroke();
      const R = Math.hypot(W, H) / 2, g = ctx.createRadialGradient(W / 2, H / 2, R * 0.2, W / 2, H / 2, R);
      g.addColorStop(0, 'rgba(8,8,8,0)'); g.addColorStop(1, 'rgba(8,8,8,.92)');
      ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
    },
  };

  // Waves: Linienfeld, Zeiger schiebt die Linien (horizontal = Meer, vertikal = Fläche)
  const waves = vertical => ({
    init: cv => ({ ctx: cv.getContext('2d'), pts: null, mA: 0, mB: 0, lA: null, lB: null }),
    frame(s, el, t, dt, m) {
      const ctx = s.ctx, d = el._dpr, W = el._w, H = el._h;
      const A = vertical ? H : W, B = vertical ? W : H;
      const gap = COARSE ? 18 : 13, step = COARSE ? 18 : 12;
      const oA = vertical ? el._oy : el._ox, oB = vertical ? el._ox : el._oy;
      const rows = Math.ceil(B / gap) + 3, cols = Math.ceil(A / step) + 3;
      if (!s.pts || s.rows !== rows || s.cols !== cols) { s.rows = rows; s.cols = cols; s.pts = new Float32Array(rows * cols * 4); }
      const pA = vertical ? m.y : m.x, pB = vertical ? m.x : m.y;
      if (s.lA == null || !m.in) { s.lA = pA; s.lB = pB; }
      s.mA += (pA - s.lA - s.mA) * 0.25; s.mB += (pB - s.lB - s.mB) * 0.25; s.lA = pA; s.lB = pB;
      const k = Math.min(3, dt * 60), Pt = s.pts, R2 = 160 * 160, tt = t;
      const r0 = Math.floor(oB / gap) - 1, c0 = Math.floor(oA / step) - 1;
      ctx.setTransform(d, 0, 0, d, 0, 0); ctx.clearRect(0, 0, W, H); ctx.lineWidth = 1;
      for (let r = 0; r < rows; r++) {
        const wB = (r0 + r) * gap, sB = wB - oB;
        const ra = 0.06 + 0.14 * (0.5 + 0.5 * noise3(wB * 0.004, tt * 0.05, 3.1));
        ctx.beginPath();
        for (let c = 0; c < cols; c++) {
          const wA = (c0 + c) * step, sA = wA - oA;
          const n = noise3(wA * 0.0034 + tt * 0.05, wB * 0.009, tt * 0.08);
          const n2 = noise3(wA * 0.011 - tt * 0.09, wB * 0.021, tt * 0.12 + 5);
          const i = (r * cols + c) * 4;
          if (m.in) { const dA = sA - pA, dB = sB - pB, q = dA * dA + dB * dB; if (q < R2) { const f = 1 - q / R2; Pt[i + 2] += s.mA * f * 0.09 * k; Pt[i + 3] += s.mB * f * 0.09 * k; } }
          Pt[i + 2] -= Pt[i] * 0.012 * k; Pt[i + 3] -= Pt[i + 1] * 0.012 * k;
          const fr = Math.pow(0.92, k); Pt[i + 2] *= fr; Pt[i + 3] *= fr;
          Pt[i] = Math.max(-70, Math.min(70, Pt[i] + Pt[i + 2] * k)); Pt[i + 1] = Math.max(-70, Math.min(70, Pt[i + 1] + Pt[i + 3] * k));
          const x = sA + n2 * 3 + Pt[i], y = sB + n * 15 + n2 * 4 + Pt[i + 1];
          if (vertical) { c ? ctx.lineTo(y, x) : ctx.moveTo(y, x); } else { c ? ctx.lineTo(x, y) : ctx.moveTo(x, y); }
        }
        ctx.strokeStyle = `rgba(236,236,236,${(ra * el._lv).toFixed(3)})`; ctx.stroke();
      }
    },
  });
  FX.waves = waves(false);
  FX.vwaves = waves(true);

  // Threads: feine Fäden, die sich zum Zeiger biegen
  FX.threads = {
    init: cv => ({ ctx: cv.getContext('2d'), mx: 0.5, my: 0.5 }),
    frame(s, el, t, dt, m) {
      const ctx = s.ctx, d = el._dpr, W = el._w, H = el._h, N = COARSE ? 22 : 36, SEG = COARSE ? 60 : 120;
      const e = 1 - Math.exp(-dt / 0.45);
      s.mx += ((m.in ? m.x / W : 0.5) - s.mx) * e; s.my += ((m.in ? m.y / H : 0.5) - s.my) * e;
      ctx.setTransform(d, 0, 0, d, 0, 0); ctx.clearRect(0, 0, W, H); ctx.lineWidth = 1;
      for (let i = 0; i < N; i++) {
        const f = i / (N - 1), center = 1 - Math.abs(f - 0.5) * 2;
        ctx.beginPath();
        for (let j = 0; j <= SEG; j++) {
          const u = j / SEG, x = u * W;
          const spread = 0.06 + 0.66 * Math.pow(u, 1.35);
          const amp = (0.015 + 0.07 * u) * (0.6 + 0.4 * Math.sin(f * 6 + t * 0.3));
          const wv = Math.sin(u * 5.5 + t * 0.55 + f * 2.4) * amp + noise3(u * 2.2 + f * 0.9, f * 3, t * 0.15) * 0.07 * u;
          const dx = u - s.mx, pull = Math.exp(-dx * dx / 0.03) * (s.my - 0.5) * 0.3 * m.hover * (1 - Math.abs(f - 0.5));
          const y = (0.5 + (f - 0.5) * spread + wv + pull) * H;
          j ? ctx.lineTo(x, y) : ctx.moveTo(x, y);
        }
        ctx.strokeStyle = `rgba(240,240,240,${((0.06 + 0.24 * center) * el._lv).toFixed(3)})`; ctx.stroke();
      }
    },
  };

  // Topography: Höhenlinien, der Zeiger hebt einen Hügel an
  const MS = [null, [3, 2], [2, 1], [3, 1], [0, 1], [0, 1, 3, 2], [0, 2], [0, 3], [0, 3], [0, 2], [0, 3, 1, 2], [0, 1], [3, 1], [1, 2], [3, 2], null];
  FX.topo = {
    fps: 30,
    init: cv => ({ ctx: cv.getContext('2d'), f: null, bx: 0, by: 0, bump: 0 }),
    frame(s, el, t, dt, m) {
      const ctx = s.ctx, d = el._dpr, W = el._w, H = el._h, cs = COARSE ? 18 : 12;
      const nx = Math.ceil(W / cs) + 1, ny = Math.ceil(H / cs) + 1;
      if (!s.f || s.nx !== nx || s.ny !== ny) { s.f = new Float32Array(nx * ny); s.nx = nx; s.ny = ny; }
      if (m.in) { if (s.bump < 0.02) { s.bx = m.x; s.by = m.y; } s.bx += (m.x - s.bx) * 0.15; s.by += (m.y - s.by) * 0.15; }
      s.bump += ((m.in ? 1 : 0) - s.bump) * (1 - Math.exp(-dt / 0.6));
      const F = s.f, tt = t * 0.035, sc = 0.0042, ox = el._ox, oy = el._oy;
      for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
        const x = i * cs, y = j * cs;
        let v = noise3((x + ox) * sc, (y + oy) * sc, tt) * 0.7 + noise3((x + ox) * sc * 2.3 + 11, (y + oy) * sc * 2.3, tt * 1.6) * 0.25;
        if (s.bump > 0.01) { const dx = x - s.bx, dy = y - s.by; v += s.bump * 0.5 * Math.exp(-(dx * dx + dy * dy) / 16000); }
        F[j * nx + i] = v;
      }
      ctx.setTransform(d, 0, 0, d, 0, 0); ctx.clearRect(0, 0, W, H);
      const L = 18, lo = -0.55, hi = 0.6;
      for (let l = 0; l < L; l++) {
        const iso = lo + (hi - lo) * (l + 0.5) / L, major = l % 5 === 2;
        ctx.beginPath();
        for (let j = 0; j < ny - 1; j++) for (let i = 0; i < nx - 1; i++) {
          const a = F[j * nx + i], b = F[j * nx + i + 1], c = F[(j + 1) * nx + i + 1], e = F[(j + 1) * nx + i];
          const idx = (a > iso ? 8 : 0) | (b > iso ? 4 : 0) | (c > iso ? 2 : 0) | (e > iso ? 1 : 0), seg = MS[idx];
          if (!seg) continue;
          const x = i * cs, y = j * cs;
          const pt = k => k === 0 ? [x + cs * (iso - a) / (b - a), y] : k === 1 ? [x + cs, y + cs * (iso - b) / (c - b)] : k === 2 ? [x + cs * (iso - e) / (c - e), y + cs] : [x, y + cs * (iso - a) / (e - a)];
          for (let q = 0; q < seg.length; q += 2) { const p1 = pt(seg[q]), p2 = pt(seg[q + 1]); ctx.moveTo(p1[0], p1[1]); ctx.lineTo(p2[0], p2[1]); }
        }
        ctx.strokeStyle = major ? `rgba(240,240,240,${(0.24 * el._lv).toFixed(3)})` : `rgba(240,240,240,${(0.095 * el._lv).toFixed(3)})`;
        ctx.lineWidth = major ? 1.3 : 1; ctx.stroke();
      }
    },
  };

  // ---------- Element
  class MonoFx extends HTMLElement {
    static get observedAttributes() { return ['effect', 'ox', 'oy', 'level']; }
    constructor() { super(); this._tox = 0; this._toy = 0; this._ox = 0; this._oy = 0; this._lv = 1; this._hov = 0; this._time = 0; this._cam = false; this._loop = this._loop.bind(this); }
    get effect() { return this.getAttribute('effect'); } set effect(v) { this.setAttribute('effect', v); }
    get ox() { return this._tox; } set ox(v) { this.setAttribute('ox', v); }
    get oy() { return this._toy; } set oy(v) { this.setAttribute('oy', v); }
    get level() { return this._lv; } set level(v) { this.setAttribute('level', v); }
    attributeChangedCallback(n, o, v) {
      if (n === 'ox') this._tox = +v || 0;
      else if (n === 'oy') this._toy = +v || 0;
      else if (n === 'level') this._lv = v == null || v === '' ? 1 : +v;
      else if (n === 'effect' && this._live && o !== v) this._start();
    }
    connectedCallback() {
      Object.assign(this.style, { display: 'block', position: 'absolute', left: '0', top: '0', width: '100%', height: '100%', overflow: 'hidden', pointerEvents: 'none' });
      this.setAttribute('aria-hidden', 'true');
      this._live = true; this._vis = true; this._clickT = performance.now();
      this._ro = new ResizeObserver(() => this._resize()); this._ro.observe(this);
      if (window.IntersectionObserver) { this._io = new IntersectionObserver(es => { this._vis = es[es.length - 1].isIntersecting; }); this._io.observe(this); }
      this._start();
      this._raf = requestAnimationFrame(this._loop);
    }
    disconnectedCallback() {
      this._live = false; cancelAnimationFrame(this._raf);
      if (this._ro) this._ro.disconnect(); if (this._io) this._io.disconnect();
      this._stop();
    }
    _stop() {
      if (this._fx && this._fx.dispose && this._st) { try { this._fx.dispose(this._st); } catch (e) {} }
      if (this._cv) this._cv.remove();
      this._cv = this._st = this._fx = null;
    }
    _start() {
      this._stop();
      const want = FX[this.getAttribute('effect')] ? this.getAttribute('effect') : 'grid';
      for (const k of [want, 'grid']) {
        const cv = document.createElement('canvas');
        Object.assign(cv.style, { position: 'absolute', left: '0', top: '0', width: '100%', height: '100%', display: 'block' });
        this.appendChild(cv);
        try { const st = FX[k].init(cv); if (st) { this._cv = cv; this._fx = FX[k]; this._st = st; break; } } catch (e) { console.warn('[mono-fx]', k, e); }
        cv.remove();
      }
      this._resize();
    }
    _resize() {
      if (!this._cv) return;
      const r = this.getBoundingClientRect();
      this._w = Math.max(1, r.width); this._h = Math.max(1, r.height);
      const sc = this._fx.scale ? this._fx.scale() : 1;
      this._dpr = Math.min(window.devicePixelRatio || 1, COARSE ? 1.5 : 2) * sc;
      this._cv.width = Math.max(1, Math.round(this._w * this._dpr)); this._cv.height = Math.max(1, Math.round(this._h * this._dpr));
    }
    _loop(now) {
      this._raf = requestAnimationFrame(this._loop);
      if (!this._st || !this._vis || document.hidden) { this._last = now; return; }
      const fps = COARSE ? 30 : (this._fx.fps || 60);
      if (this._last && now - this._last < 1000 / fps - 2) return;
      const dt = Math.min(0.05, Math.max(0, (now - (this._last || now)) / 1000)); this._last = now;
      this._time += dt * (REDUCED ? 0.3 : 1);
      if (!this._cam || Math.abs(this._tox - this._ox) > 1500 || Math.abs(this._toy - this._oy) > 1500) { this._ox = this._tox; this._oy = this._toy; this._cam = true; }
      const e = 1 - Math.exp(-dt / 0.07); this._ox += (this._tox - this._ox) * e; this._oy += (this._toy - this._oy) * e;
      const r = this.getBoundingClientRect();
      if (Math.abs(r.width - this._w) > 0.5 || Math.abs(r.height - this._h) > 0.5) this._resize();
      const x = P.x - r.left, y = P.y - r.top;
      const inside = P.on && x >= 0 && y >= 0 && x <= r.width && y <= r.height && (!COARSE || now - P.t < 900);
      this._hov += ((inside ? 1 : 0) - this._hov) * (1 - Math.exp(-dt / 0.25));
      const clicks = [];
      for (const c of P.down) if (c.t > this._clickT) { const cx = c.x - r.left, cy = c.y - r.top; if (cx >= 0 && cy >= 0 && cx <= r.width && cy <= r.height) clicks.push({ x: cx, y: cy }); }
      this._clickT = now;
      try { this._fx.frame(this._st, this, this._time, dt, { x, y, in: inside, hover: this._hov, clicks }); } catch (err) { console.warn('[mono-fx]', err); this._st = null; }
    }
  }
  customElements.define('mono-fx', MonoFx);

  // ---------- Metall-Schrift <mono-metal text="…" size="56" tone="steel|red">
  // Material angepasst aus Shaders.com von Shader Effects Inc., MIT-Lizenz, https://github.com/shader-effects-inc/shaders
  const MVS = '#version 300 es\nin vec2 aPosition;void main(){gl_Position=vec4(aPosition,0.,1.);}';
  const MFS = `#version 300 es
precision highp float;
uniform sampler2D uField;uniform vec2 uFieldScale;uniform vec2 uResolution;uniform float uTime;uniform vec4 uMatP[3];uniform vec4 uMatC[2];
out vec4 outColor;
#define C_light uMatC[0]
#define C_dark uMatC[1]
#define P_bevel uMatP[0].x
#define P_angle uMatP[0].y
#define P_streaks uMatP[0].z
#define P_grain uMatP[0].w
#define P_density uMatP[1].x
#define P_roughness uMatP[1].y
#define P_reflections uMatP[1].z
#define P_lightAngle uMatP[1].w
#define P_speed uMatP[2].x
struct Surface{vec2 p;float d;float aa;float cov;vec2 n;float slope;float time;};
float shapeAt(vec2 q){return texture(uField,q*uFieldScale+.5).r;}
float m_ss(float a,float b,float x){float t=clamp((x-a)/(b-a),0.,1.);return t*t*(3.-2.*t);}
vec3 m_lin(vec3 c){return mix(c/12.92,pow((c+.055)/1.055,vec3(2.4)),step(.04045,c));}
vec3 m_srgb(vec3 c){c=max(c,0.);return mix(c*12.92,1.055*pow(c,vec3(1./2.4))-.055,step(.0031308,c));}
uint m_rotl(uint x,uint k){return (x<<k)|(x>>(32u-k));}
uint m_hash(int x,int y){uint seed=0xdeadbeefu+21u;uint a=seed+uint(x);uint b=seed+uint(y);uint c=seed;
c^=b;c-=m_rotl(b,14u);a^=c;a-=m_rotl(c,11u);b^=a;b-=m_rotl(a,25u);c^=b;c-=m_rotl(b,16u);a^=c;a-=m_rotl(c,4u);b^=a;b-=m_rotl(a,14u);c^=b;c-=m_rotl(b,24u);return c;}
float m_grad(uint h,float x,float y){h&=7u;float u=h<4u?x:y;float v=2.*(h<4u?y:x);return ((h&1u)!=0u?-u:u)+((h&2u)!=0u?-v:v);}
float m_noise(vec2 p){vec2 fl=floor(p);ivec2 i=ivec2(fl);vec2 f=p-fl;vec2 u=f*f*f*(f*(f*6.-15.)+10.);
float v0=m_grad(m_hash(i.x,i.y),f.x,f.y);float v1=m_grad(m_hash(i.x+1,i.y),f.x-1.,f.y);float v2=m_grad(m_hash(i.x,i.y+1),f.x,f.y-1.);float v3=m_grad(m_hash(i.x+1,i.y+1),f.x-1.,f.y-1.);
return .6616*mix(mix(v0,v1,u.x),mix(v2,v3,u.x),u.y);}
float m_width(Surface s,float bevel){float depth=max(-s.d,0.);float k=bevel-depth;float w=bevel;if(k<=0.)return w;
for(int i=0;i<4;i++){float g=shapeAt(s.p-s.n*k)+depth+k;float c=smoothstep(0.,.5*k,g);if(c<=0.)break;w=mix(w,depth+k-.5*g,c);k*=.5;}return min(bevel,w);}
vec2 m_dome(Surface s,float bevel){float depth=max(-s.d,0.);float we=m_width(s,bevel);float band=min(.02,.2*we);
float x=min(1.-clamp((depth-band)/max(we-band,1e-4),0.,1.),.98);return vec2(x*smoothstep(0.,.2,s.slope),we*sqrt(1.-x*x));}
float m_studio5(vec2 r,vec2 rot,float keyRad,float drift,float str,float skyGain){vec2 e=vec2(r.x*rot.x-r.y*rot.y,r.x*rot.y+r.y*rot.x);
float sky=smoothstep(-.7,.85,e.y);float lum=sky*sky*skyGain;
lum+=m_ss(keyRad,keyRad*.2,length(e-vec2(drift,.55)))*1.7*str;
lum+=m_ss(keyRad*1.15,keyRad*.23,length(e-vec2(-.55+drift,.18)))*1.05*str;
lum+=m_ss(keyRad,keyRad*.2,length(e-vec2(.55+drift,.1)))*str;
lum+=m_ss(keyRad*1.3,keyRad*.26,length(e-vec2(.2+drift,-.5)))*.7*str;
lum+=m_ss(keyRad*1.1,keyRad*.22,length(e-vec2(-.35+drift,-.25)))*.85*str;return lum;}
float m_ward(vec3 n,vec3 dir,vec3 L,vec3 V,float aT,float aB){vec3 T=normalize(dir-n*dot(n,dir));vec3 B=cross(n,T);vec3 H=normalize(L-V);
float hT=dot(H,T)/max(aT,.0001);float hB=dot(H,B)/max(aB,.0001);float hN=clamp(abs(dot(H,n)),.0001,1.);return exp(-(hT*hT+hB*hB)/((hN+1.)*.5));}
vec4 material(Surface s){
  if(s.d>max(.02,2.*s.aa))return vec4(0.);
  float t=s.time*P_speed;vec2 dome=m_dome(s,P_bevel);vec3 n=vec3(s.n*dome.x,-sqrt(1.-dome.x*dome.x));
  float ba=radians(P_angle);vec2 T=vec2(cos(ba),sin(ba));vec2 B=vec2(-T.y,T.x);
  vec2 pat=(s.p+vec2(-.7,.5)*dome.y)*.5;float along=dot(pat,T);float across=dot(pat,B);
  float aniso=P_streaks;float dens=P_density*150.;float driftA=sin(t*.05)*.35;float sheenAmt=aniso*.5+.08;
  float sheen=m_noise(vec2(along*1.3+driftA,across*6.5));
  float lines=m_noise(vec2(along*4.5,across*dens))+.5*m_noise(vec2(along*8.+3.1,across*dens*2.3+7.7));
  float rAcross=sheen*sheenAmt+lines*P_grain*.16;float rAlong=m_noise(vec2(along*1.3+15.21+driftA,across*6.5))*sheenAmt*.12;
  n=normalize(vec3(n.xy+B*rAcross+T*rAlong,n.z));
  vec3 view=normalize(vec3(s.p*.3,1.));float rough=clamp(P_roughness,0.,1.);vec3 R=reflect(view,n);
  float keyRad=mix(.42,.16,1.-rough);float drift=sin(t*.07)*.05;float stepv=aniso*(rough*.6+.25)*.105;float env=0.;
  for(int i=0;i<9;i++){float o=float(i-4);env+=m_studio5(R.xy+T*(stepv*o),vec2(1.,0.),keyRad,drift,P_reflections,.38)*exp(-o*o/8.82);}
  env/=5.1032;
  float la=radians(P_lightAngle);vec3 L=normalize(vec3(cos(la),sin(la),-.7));float baseA=mix(.05,.45,rough);
  float spec=m_ward(n,vec3(T,0.),L,view,baseA*(1.+aniso*7.),max(baseA*(1.-aniso*.55),.02))*mix(.45,1.1,1.-rough);
  float grazing=1.-clamp(-dot(n,view),0.,1.);float lit=clamp((env+spec)*(1.+grazing*grazing*grazing*.6),0.,1.7);
  vec3 rgb=mix(m_lin(C_dark.rgb),m_lin(C_light.rgb),lit);return vec4(m_srgb(rgb),1.);
}
void main(){
  float unit=min(uResolution.x,uResolution.y)*.5;vec2 frag=vec2(gl_FragCoord.x,uResolution.y-gl_FragCoord.y);
  vec2 p=(frag-uResolution*.5)/unit;float px=1./unit;float bw=max(.15,px);float e=clamp(bw*.2,px*1.5,max(bw*.5,px*1.5));
  float d=shapeAt(p);float aa=clamp(length(vec2(dFdx(d),dFdy(d))),px*.5,px*1.5);
  vec2 g=vec2(shapeAt(p+vec2(e,0.))-shapeAt(p-vec2(e,0.)),shapeAt(p+vec2(0.,e))-shapeAt(p-vec2(0.,e)))/(2.*e);
  Surface s;s.p=p;s.d=d;s.aa=aa;s.cov=clamp(.5-d/aa,0.,1.);s.slope=length(g);s.n=s.slope>1e-5?g/s.slope:vec2(0.);s.time=uTime;
  vec4 m=material(s);float a=clamp(m.a*s.cov,0.,1.);outColor=vec4(clamp(m.rgb,0.,1.)*a,a);
}`;
  const edtSolve = (grid, off, stride, len, f, v, z) => {
    for (let i = 0; i < len; i++) f[i] = grid[off + i * stride];
    let k = 0; v[0] = 0; z[0] = -1e20; z[1] = 1e20;
    for (let q = 1; q < len; q++) {
      let s = (f[q] + q * q - (f[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k]);
      while (s <= z[k]) { k--; s = (f[q] + q * q - (f[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k]); }
      k++; v[k] = q; z[k] = s; z[k + 1] = 1e20;
    }
    k = 0;
    for (let q = 0; q < len; q++) { while (z[k + 1] < q) k++; grid[off + q * stride] = (q - v[k]) * (q - v[k]) + f[v[k]]; }
  };
  const edt = (grid, w, h) => {
    const n = Math.max(w, h), f = new Float64Array(n), v = new Int32Array(n), z = new Float64Array(n + 1);
    for (let x = 0; x < w; x++) edtSolve(grid, x, w, h, f, v, z);
    for (let y = 0; y < h; y++) edtSolve(grid, y * w, 1, w, f, v, z);
  };
  function textField(text, size, dpr) {
    const fs = size * dpr, font = `800 ${fs}px Archivo, system-ui, sans-serif`;
    const c = document.createElement('canvas'), x = c.getContext('2d', { willReadFrequently: true });
    const setup = () => { x.font = font; if ('letterSpacing' in x) x.letterSpacing = (-0.02 * fs).toFixed(1) + 'px'; x.textBaseline = 'alphabetic'; };
    setup();
    const mt = x.measureText(text);
    const asc = Math.max(mt.actualBoundingBoxAscent || 0, fs * 0.72), desc = Math.max(0, mt.actualBoundingBoxDescent || 0);
    const left = Math.max(0, mt.actualBoundingBoxLeft || 0), right = Math.max(mt.actualBoundingBoxRight || 0, 1);
    const pad = Math.ceil(3 * dpr), w = Math.ceil(left + right + pad * 2), h = Math.ceil(asc + desc + pad * 2);
    c.width = w; c.height = h; setup(); x.fillStyle = '#000'; x.fillText(text, pad + left, pad + asc);
    const px = x.getImageData(0, 0, w, h).data, N = w * h, outer = new Float64Array(N), inner = new Float64Array(N);
    for (let i = 0; i < N; i++) {
      const a = px[i * 4 + 3] / 255, e = 0.5 - a;
      outer[i] = a >= 1 ? 0 : a <= 0 ? 1e20 : e > 0 ? e * e : 0;
      inner[i] = a <= 0 ? 0 : a >= 1 ? 1e20 : e < 0 ? e * e : 0;
    }
    edt(outer, w, h); edt(inner, w, h);
    const unit = Math.min(w, h) / 2, data = new Float32Array(N);
    for (let i = 0; i < N; i++) data[i] = (Math.sqrt(outer[i]) - Math.sqrt(inner[i])) / unit;
    return { data, w, h };
  }
  const TONES = { steel: ['#e9ebef', '#26282d'], red: ['#ffb4a4', '#6a1203'] };
  const rgba = hex => { const h = hex.replace('#', ''); return [0, 2, 4].map(i => parseInt(h.slice(i, i + 2), 16) / 255).concat(1); };
  class MonoMetal extends HTMLElement {
    static get observedAttributes() { return ['text', 'size', 'tone']; }
    constructor() { super(); this._loop = this._loop.bind(this); }
    connectedCallback() {
      Object.assign(this.style, { display: 'inline-block', position: 'relative', lineHeight: '0', verticalAlign: 'baseline', maxWidth: '100%' });
      this.setAttribute('role', 'img');
      this._live = true; this._vis = true; this._t0 = performance.now();
      if (window.IntersectionObserver) { this._io = new IntersectionObserver(es => { this._vis = es[es.length - 1].isIntersecting; }); this._io.observe(this); }
      this._build();
      const sz = +this.getAttribute('size') || 32;
      if (document.fonts && document.fonts.load) document.fonts.load(`800 ${sz}px Archivo`).then(() => { if (this._live) { this._key = ''; this._build(); } }).catch(() => {});
      this._raf = requestAnimationFrame(this._loop);
    }
    disconnectedCallback() {
      this._live = false; cancelAnimationFrame(this._raf); if (this._io) this._io.disconnect();
      try { const x = this._gl && this._gl.getExtension('WEBGL_lose_context'); if (x) x.loseContext(); } catch (e) {}
      if (this._cv) this._cv.remove(); this._gl = this._cv = null; this._key = '';
    }
    attributeChangedCallback() { if (this._live) this._build(); }
    _fallback(text, size) {
      if (this._cv) { this._cv.remove(); this._cv = null; }
      Object.assign(this.style, { lineHeight: '1', font: `800 ${size}px var(--font-heading)`, letterSpacing: '-0.02em' });
      this.textContent = text;
    }
    _initGl() {
      const cv = document.createElement('canvas');
      Object.assign(cv.style, { display: 'block' });
      const gl = cv.getContext('webgl2', { alpha: true, premultipliedAlpha: true, antialias: false });
      if (!gl) return false;
      const sh = (t, s) => { const o = gl.createShader(t); gl.shaderSource(o, s); gl.compileShader(o); if (!gl.getShaderParameter(o, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(o)); return o; };
      const pr = gl.createProgram();
      gl.attachShader(pr, sh(gl.VERTEX_SHADER, MVS)); gl.attachShader(pr, sh(gl.FRAGMENT_SHADER, MFS));
      gl.bindAttribLocation(pr, 0, 'aPosition'); gl.linkProgram(pr);
      if (!gl.getProgramParameter(pr, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(pr));
      gl.useProgram(pr);
      gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer());
      gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
      gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
      this._tex = gl.createTexture();
      const u = n => gl.getUniformLocation(pr, n);
      this._U = { field: u('uField'), scale: u('uFieldScale'), res: u('uResolution'), time: u('uTime'), p: u('uMatP'), c: u('uMatC') };
      this._gl = gl; this._cv = cv;
      this.textContent = ''; this.appendChild(cv);
      return true;
    }
    _build() {
      const text = String(this.getAttribute('text') || ''), size = +this.getAttribute('size') || 32;
      const dpr = Math.min(window.devicePixelRatio || 1, 2), key = text + '|' + size + '|' + dpr;
      this.setAttribute('aria-label', text);
      if (key === this._key) return; this._key = key;
      if (!text.trim()) { if (this._cv) { this._cv.style.width = '0px'; this._cv.style.height = '0px'; } return; }
      try {
        if (!this._gl && !this._initGl()) return this._fallback(text, size);
        const f = textField(text, size, dpr), gl = this._gl;
        this._cv.width = f.w; this._cv.height = f.h;
        this._cv.style.width = (f.w / dpr) + 'px'; this._cv.style.height = (f.h / dpr) + 'px';
        gl.bindTexture(gl.TEXTURE_2D, this._tex); gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.R16F, f.w, f.h, 0, gl.RED, gl.FLOAT, f.data);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
        const un = Math.min(f.w, f.h) / 2; this._fs = [un / f.w, un / f.h];
        this._draw(performance.now());
      } catch (e) { console.warn('[mono-metal]', e); this._gl = null; this._fallback(text, size); }
    }
    _draw(now) {
      const gl = this._gl, U = this._U; if (!gl || !this._fs || gl.isContextLost()) return;
      const tone = TONES[this.getAttribute('tone')] || TONES.steel, mx = P.on ? P.x / Math.max(1, innerWidth) - 0.5 : 0;
      const fl = new Float32Array(12); fl.set([0.5, 0, 0.8, 0.4, 2, 0.4, 1.4, 215 + mx * 70, 0.4]);
      const cl = new Float32Array(8); cl.set(rgba(tone[0]), 0); cl.set(rgba(tone[1]), 4);
      gl.viewport(0, 0, this._cv.width, this._cv.height);
      gl.uniform2f(U.res, this._cv.width, this._cv.height); gl.uniform2f(U.scale, this._fs[0], this._fs[1]);
      gl.uniform1f(U.time, (now - this._t0) / 1000 * (REDUCED ? 0.3 : 1));
      gl.uniform4fv(U.p, fl); gl.uniform4fv(U.c, cl); gl.uniform1i(U.field, 0);
      gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, this._tex);
      gl.clearColor(0, 0, 0, 0); gl.clear(gl.COLOR_BUFFER_BIT); gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    }
    _loop(now) {
      this._raf = requestAnimationFrame(this._loop);
      if (!this._vis || document.hidden || (this._last && now - this._last < 32)) return;
      this._last = now; this._draw(now);
    }
  }
  customElements.define('mono-metal', MonoMetal);

  // ---------- Metall-Rahmen <mono-frame thick="18"> – ruhender, gebürsteter Stahlrahmen mit Profil und Gehrung (füllt sein Elternelement)
  const FRS = `precision highp float;
uniform vec2 uRes;uniform float uT;uniform vec3 uHi;uniform vec3 uLo;
float hash(vec2 p){p=fract(p*vec2(123.34,456.21));p+=dot(p,p+45.32);return fract(p.x*p.y);}
float vn(vec2 p){vec2 i=floor(p),f=fract(p);f=f*f*(3.-2.*f);return mix(mix(hash(i),hash(i+vec2(1.,0.)),f.x),mix(hash(i+vec2(0.,1.)),hash(i+vec2(1.,1.)),f.x),f.y);}
float bead(float u,float c,float r){float x=clamp((u-c)/r,-.98,.98);return -x/sqrt(1.-x*x);}
void main(){
  vec2 q=vec2(gl_FragCoord.x,uRes.y-gl_FragCoord.y);
  float dl=q.x,dr=uRes.x-q.x,dt=q.y,db=uRes.y-q.y;
  float d=min(min(dl,dr),min(dt,db));
  if(d>uT+1.){gl_FragColor=vec4(0.);return;}
  vec2 n;float al;
  if(d==dl){n=vec2(-1.,0.);al=q.y;}else if(d==dr){n=vec2(1.,0.);al=q.y;}else if(d==dt){n=vec2(0.,-1.);al=q.x;}else{n=vec2(0.,1.);al=q.x;}
  vec2 tg=vec2(-n.y,n.x);
  float d2=1e9;
  if(d!=dl)d2=min(d2,dl);if(d!=dr)d2=min(d2,dr);if(d!=dt)d2=min(d2,dt);if(d!=db)d2=min(d2,db);
  float u=clamp(d/uT,0.,1.);
  float s;
  if(u<.07)s=3.;
  else if(u<.93)s=bead(u,.5,.45)*.75;
  else s=-3.;
  vec3 N=normalize(vec3(n*s*.9,1.));
  float br=vn(vec2(al*.02,d*2.2))*.6+vn(vec2(al*.004,d*.6+9.))*.4;
  float fine=hash(vec2(floor(al*.5),floor(d*4.)));
  N=normalize(N+vec3(tg*(br-.5)*.18+n*(fine-.5)*.025,0.));
  vec3 L=normalize(vec3(-.5,-.8,.75));
  vec3 R=vec3(2.*N.z*N.xy,2.*N.z*N.z-1.);
  vec2 ld=normalize(vec2(-.45,-.9));
  float rd=dot(R.xy,ld);
  float sky=smoothstep(-.55,.9,rd);
  float box=smoothstep(.16,.02,abs(rd-.42))*1.1+smoothstep(.1,.0,abs(rd+.32))*.35;
  float key=pow(max(dot(R,L),0.),26.);
  float lit=.05+sky*.55+box*.75+key*1.1;
  lit*=.84+.32*br;
  lit=pow(clamp(lit,0.,1.4),1.25);
  vec3 col=mix(uLo,uHi,clamp(lit,0.,1.))+vec3(max(lit-1.,0.)*.4);
  float seam=1.-smoothstep(.4,1.4,(d2-d)*.7071);
  col*=1.-seam*.55;
  col*=1.-.55*(1.-smoothstep(0.,1.2,d));
  col*=1.-.6*(1.-smoothstep(0.,1.4,uT-d));
  col+=(hash(q)-.5)/255.;
  float a=clamp(uT-d+.5,0.,1.);
  gl_FragColor=vec4(clamp(col,0.,1.)*a,a);
}`;
  class MonoFrame extends HTMLElement {
    connectedCallback() {
      Object.assign(this.style, { display: 'block', position: 'absolute', left: '0', top: '0', width: '100%', height: '100%', pointerEvents: 'none' });
      this.setAttribute('aria-hidden', 'true');
      try { this._init(); } catch (e) { console.warn('[mono-frame]', e); this._gl = null; }
      this._ro = new ResizeObserver(() => this._draw()); this._ro.observe(this);
      this._draw();
    }
    disconnectedCallback() {
      if (this._ro) this._ro.disconnect();
      try { const x = this._gl && this._gl.getExtension('WEBGL_lose_context'); if (x) x.loseContext(); } catch (e) {}
      if (this._cv) this._cv.remove(); this._gl = this._cv = null;
    }
    _init() {
      const cv = document.createElement('canvas');
      Object.assign(cv.style, { position: 'absolute', left: '0', top: '0', width: '100%', height: '100%', display: 'block' });
      const gl = cv.getContext('webgl', { alpha: true, premultipliedAlpha: true, antialias: false, preserveDrawingBuffer: true });
      if (!gl) { Object.assign(this.style, { border: '3px solid #c9ccd2', boxSizing: 'border-box' }); return; }
      const sh = (t, src) => { const o = gl.createShader(t); gl.shaderSource(o, src); gl.compileShader(o); if (!gl.getShaderParameter(o, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(o)); return o; };
      const pr = gl.createProgram();
      gl.attachShader(pr, sh(gl.VERTEX_SHADER, VS)); gl.attachShader(pr, sh(gl.FRAGMENT_SHADER, FRS)); gl.linkProgram(pr);
      if (!gl.getProgramParameter(pr, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(pr));
      gl.useProgram(pr);
      gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer());
      gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
      const loc = gl.getAttribLocation(pr, 'p'); gl.enableVertexAttribArray(loc); gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
      const u = k => gl.getUniformLocation(pr, k);
      this._U = { res: u('uRes'), t: u('uT'), hi: u('uHi'), lo: u('uLo') };
      cv.addEventListener('webglcontextrestored', () => { this._init(); this._draw(); });
      this._gl = gl; this._cv = cv; this.appendChild(cv);
    }
    _draw() {
      const gl = this._gl; if (!gl || !this._cv || gl.isContextLost()) return;
      const r = this.getBoundingClientRect(), dpr = Math.min(window.devicePixelRatio || 1, 2);
      const w = Math.max(1, Math.round(r.width * dpr)), h = Math.max(1, Math.round(r.height * dpr));
      if (this._cv.width !== w || this._cv.height !== h) { this._cv.width = w; this._cv.height = h; }
      const U = this._U, t = (+this.getAttribute('thick') || 18) * dpr;
      gl.viewport(0, 0, w, h);
      gl.uniform2f(U.res, w, h); gl.uniform1f(U.t, t);
      gl.uniform3f(U.hi, 0.96, 0.97, 0.98); gl.uniform3f(U.lo, 0.07, 0.075, 0.085);
      gl.clearColor(0, 0, 0, 0); gl.clear(gl.COLOR_BUFFER_BIT); gl.drawArrays(gl.TRIANGLES, 0, 3);
    }
  }
  customElements.define('mono-frame', MonoFrame);
})();
