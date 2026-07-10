import * as THREE from "three";

/*
  The ClipForge "forge" hero animation — a real-time WebGL scene.
  A YouTube video is struck white-hot on an anvil and pulled out as vertical clips.
  Ported from the standalone preview (verified frame-by-frame headlessly).

  buildForge(canvas, container, opts) builds the scene into `canvas`, sizes to
  `container`, starts the loop, and returns imperative controls. It throws if
  WebGL is unavailable (caller should catch and fall back to the text hero).

  opts:
    skin      : "modern" | "retro"     initial accent skin
    onReady() : called once after the first frame renders (assets loaded enough to show)
    onLabel(shown) : edge-triggered when the "N shorts ready" label should show/hide
    onCycle() : called once per loop (advance the fake URL id in the overlay)
*/
export function buildForge(canvas, container, opts = {}) {
  const onReady = opts.onReady || (() => {});
  const onLabel = opts.onLabel || (() => {});
  const onCycle = opts.onCycle || (() => {});
  const THUMBS = { video: "/forge/video.jpg", clips: ["/forge/clip1.jpg", "/forge/clip2.jpg", "/forge/clip3.jpg"] };

  let skin = opts.skin === "retro" ? "retro" : "modern";
  const ACCENTS = { modern: 0xe0521a, retro: 0xd4669a };

  // WebGLRenderer throws if there's no GL context — let it propagate to the caller.
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, powerPreference: "high-performance" });
  const MOBILE = Math.min(window.innerWidth, window.innerHeight) < 620;
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, MOBILE ? 1.4 : 1.75));
  renderer.outputEncoding = THREE.sRGBEncoding;
  renderer.toneMapping = THREE.NoToneMapping; // we tone-map in the final pass
  renderer.setClearColor(0x000000, 0);
  renderer.autoClear = false;

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(34, 16 / 9, 0.1, 100);
  const camBase = new THREE.Vector3(0.15, 1.55, 5.6);
  const camLook = new THREE.Vector3(0, 0.62, 0);

  // ── procedural environment (warm forge reflections, no HDR file) ──
  function makeEnv() {
    const c = document.createElement("canvas"); c.width = 512; c.height = 256;
    const x = c.getContext("2d");
    const g = x.createLinearGradient(0, 0, 0, 256);
    g.addColorStop(0, "#2a2f3a"); g.addColorStop(0.5, "#40291f"); g.addColorStop(0.72, "#743a18"); g.addColorStop(1, "#0b0708");
    x.fillStyle = g; x.fillRect(0, 0, 512, 256);
    const r = x.createRadialGradient(256, 196, 4, 256, 196, 150);
    r.addColorStop(0, "#ffd0a2"); r.addColorStop(0.5, "rgba(255,150,70,.5)"); r.addColorStop(1, "rgba(255,120,50,0)");
    x.fillStyle = r; x.fillRect(0, 0, 512, 256);
    const t = new THREE.CanvasTexture(c);
    t.mapping = THREE.EquirectangularReflectionMapping;
    const pmrem = new THREE.PMREMGenerator(renderer);
    const rt = pmrem.fromEquirectangular(t);
    t.dispose(); pmrem.dispose();
    return rt.texture;
  }
  scene.environment = makeEnv();

  // ── lights ──
  scene.add(new THREE.HemisphereLight(0x5a6580, 0x1a0e0a, 0.55));
  const key = new THREE.DirectionalLight(0xfff1e0, 1.7); key.position.set(-3.5, 5, 3.5); scene.add(key);
  const fill = new THREE.DirectionalLight(0x88a0c0, 0.5); fill.position.set(3, 2, 4); scene.add(fill);
  const rim = new THREE.DirectionalLight(ACCENTS[skin], 0.9); rim.position.set(4, 1.5, -3); scene.add(rim);
  const molten = new THREE.PointLight(0xff7a1e, 0.0, 9, 2.0); molten.position.set(0, 0.88, 0.2); scene.add(molten);

  // ── materials ──
  const steel = new THREE.MeshStandardMaterial({ color: 0x9a97a4, metalness: 0.95, roughness: 0.3, envMapIntensity: 1.2 });
  const darkSteel = new THREE.MeshStandardMaterial({ color: 0x54515c, metalness: 0.9, roughness: 0.4, envMapIntensity: 1.0 });
  const iron = new THREE.MeshStandardMaterial({ color: 0x30303a, metalness: 0.8, roughness: 0.34, envMapIntensity: 0.8 });
  const wood = new THREE.MeshStandardMaterial({ color: 0x7a4a24, metalness: 0.15, roughness: 0.65 });

  function roundedSlab(w, h, depth, rad, bevel) {
    const s = new THREE.Shape(); const x = -w / 2, y = -h / 2;
    s.moveTo(x + rad, y); s.lineTo(x + w - rad, y); s.quadraticCurveTo(x + w, y, x + w, y + rad);
    s.lineTo(x + w, y + h - rad); s.quadraticCurveTo(x + w, y + h, x + w - rad, y + h);
    s.lineTo(x + rad, y + h); s.quadraticCurveTo(x, y + h, x, y + h - rad);
    s.lineTo(x, y + rad); s.quadraticCurveTo(x, y, x + rad, y);
    const geo = new THREE.ExtrudeGeometry(s, { depth, bevelEnabled: true, bevelThickness: bevel, bevelSize: bevel, bevelSegments: 2, steps: 1 });
    geo.translate(0, 0, -depth / 2); geo.computeVertexNormals(); return geo;
  }

  // ── anvil (dark iron, sits low so clips are the hero) ──
  const anvil = new THREE.Group();
  const topSlab = new THREE.Mesh(roundedSlab(1.5, 0.3, 0.62, 0.06, 0.045), iron);
  topSlab.rotation.x = -Math.PI / 2; topSlab.position.y = 0.85; anvil.add(topSlab);
  const waist = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.3, 0.34, 10), iron); waist.position.y = 0.52; anvil.add(waist);
  const base = new THREE.Mesh(roundedSlab(0.86, 0.36, 0.74, 0.05, 0.03), iron);
  base.rotation.x = -Math.PI / 2; base.position.y = 0.17; anvil.add(base);
  const horn = new THREE.Mesh(new THREE.ConeGeometry(0.16, 0.5, 14), iron);
  horn.rotation.z = -Math.PI / 2; horn.position.set(0.92, 0.85, 0); anvil.add(horn);
  anvil.position.y = -0.2; scene.add(anvil); // top surface world Y ≈ 0.80

  const heatBar = new THREE.Mesh(new THREE.PlaneGeometry(1.5, 0.16),
    new THREE.MeshBasicMaterial({ color: 0xffb060, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false }));
  heatBar.rotation.x = -Math.PI / 2; heatBar.position.set(0, 0.815, 0); scene.add(heatBar);

  // warm forge glow pooled on the ground — grounds the scene, pulses on the strike
  function radialGlow(inner) {
    const c = document.createElement("canvas"); c.width = c.height = 256; const x = c.getContext("2d");
    const g = x.createRadialGradient(128, 128, 0, 128, 128, 128);
    g.addColorStop(0, inner); g.addColorStop(0.4, "rgba(255,120,45,0.34)"); g.addColorStop(1, "rgba(255,90,30,0)");
    x.fillStyle = g; x.beginPath(); x.arc(128, 128, 128, 0, 7); x.fill(); return new THREE.CanvasTexture(c);
  }
  const groundGlow = new THREE.Mesh(new THREE.PlaneGeometry(7.5, 7.5),
    new THREE.MeshBasicMaterial({ map: radialGlow("rgba(255,180,110,0.9)"), transparent: true, opacity: 0.3, blending: THREE.AdditiveBlending, depthWrite: false }));
  groundGlow.rotation.x = -Math.PI / 2; groundGlow.position.set(0, -0.24, 0); scene.add(groundGlow);

  // track when the 4 thumbnail images are decoded, so we only report "ready" once they'll render
  let assetsLoaded = 0; const totalAssets = 4;
  const markLoaded = () => { assetsLoaded++; };

  // ── the video ingot (metal frame + lit "screen" showing a real video frame) ──
  const videoTex = new THREE.TextureLoader().load(THUMBS.video, markLoaded); videoTex.encoding = THREE.sRGBEncoding;
  const ingot = new THREE.Group();
  const ingotFrame = new THREE.Mesh(roundedSlab(1.2, 0.7, 0.15, 0.05, 0.03),
    new THREE.MeshStandardMaterial({ color: 0x1b1b22, metalness: 0.7, roughness: 0.38, envMapIntensity: 0.9 }));
  const ingotScreen = new THREE.Mesh(new THREE.PlaneGeometry(1.06, 0.58), new THREE.MeshBasicMaterial({ map: videoTex }));
  ingotScreen.position.z = 0.13;
  const ingotFlash = new THREE.Mesh(new THREE.PlaneGeometry(1.2, 0.7),
    new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false }));
  ingotFlash.position.z = 0.14;
  ingot.add(ingotFrame, ingotScreen, ingotFlash);
  ingot.visible = false; scene.add(ingot);

  // ── hammer (grip = handle end, lower-right; head up-right; swings down onto anvil top) ──
  const hammer = new THREE.Group();
  const hHead = new THREE.Mesh(roundedSlab(0.6, 0.46, 0.54, 0.06, 0.045), darkSteel); hHead.position.y = 1.5; hammer.add(hHead);
  const hStrike = new THREE.Mesh(new THREE.BoxGeometry(0.62, 0.09, 0.56), steel); hStrike.position.y = 1.74; hammer.add(hStrike);
  const hHandle = new THREE.Mesh(new THREE.CylinderGeometry(0.072, 0.082, 1.42, 10), wood); hHandle.position.y = 0.72; hammer.add(hHandle);
  hammer.position.set(1.5, 0.5, 0.15); scene.add(hammer);

  // ── clip cards (real clip frame + caption bar + score) ──
  const clips = [];
  const clipFrameMat = () => new THREE.MeshStandardMaterial({ color: 0x24242c, metalness: 0.45, roughness: 0.5, envMapIntensity: 0.7, transparent: true });
  function clipThumbTexture(url, score, accentHex) {
    const c = document.createElement("canvas"); c.width = 180; c.height = 320; const x = c.getContext("2d");
    x.fillStyle = "#141018"; x.fillRect(0, 0, 180, 320);
    const tex = new THREE.CanvasTexture(c); tex.encoding = THREE.sRGBEncoding;
    const img = new Image();
    img.onload = () => {
      const ir = img.width / img.height, cr = 180 / 320; let dw, dh, dx, dy;
      if (ir > cr) { dh = 320; dw = dh * ir; dx = (180 - dw) / 2; dy = 0; } else { dw = 180; dh = dw / ir; dx = 0; dy = (320 - dh) / 2; }
      x.drawImage(img, dx, dy, dw, dh);
      const g = x.createLinearGradient(0, 220, 0, 320); g.addColorStop(0, "rgba(10,7,12,0)"); g.addColorStop(1, "rgba(10,7,12,.7)");
      x.fillStyle = g; x.fillRect(0, 220, 180, 100);
      x.fillStyle = "#fff"; x.fillRect(14, 252, 152, 15);
      x.fillStyle = accentHex; x.fillRect(14, 252, 74, 15);
      x.fillStyle = "rgba(255,255,255,.62)"; x.fillRect(14, 275, 106, 9);
      x.fillStyle = "#25c274"; x.fillRect(126, 14, 40, 26);
      x.fillStyle = "#fff"; x.font = "bold 17px monospace"; x.textAlign = "center"; x.textBaseline = "middle"; x.fillText(score, 146, 27);
      tex.needsUpdate = true; markLoaded();
    };
    img.src = url;
    return tex;
  }
  const SCORES = ["96", "92", "89"];
  for (let i = 0; i < 3; i++) {
    const m = clipFrameMat();
    const mesh = new THREE.Mesh(roundedSlab(0.64, 1.12, 0.05, 0.05, 0.02), m);
    mesh.visible = false; scene.add(mesh);
    const face = new THREE.Mesh(new THREE.PlaneGeometry(0.6, 1.06),
      new THREE.MeshBasicMaterial({ map: clipThumbTexture(THUMBS.clips[i], SCORES[i], "#e0521a"), transparent: true }));
    face.position.z = 0.06; mesh.add(face);
    const hot = new THREE.Mesh(new THREE.PlaneGeometry(0.64, 1.12),
      new THREE.MeshBasicMaterial({ color: 0xffcf9a, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false }));
    hot.position.z = 0.07; mesh.add(hot);
    clips.push({ mesh, mat: m, face, hot, score: SCORES[i] });
  }
  function applySkin() {
    const hex = "#" + ACCENTS[skin].toString(16).padStart(6, "0");
    rim.color.setHex(ACCENTS[skin]);
    clips.forEach((c, i) => { const old = c.face.material.map; if (old) old.dispose();
      c.face.material.map = clipThumbTexture(THUMBS.clips[i], c.score, hex); c.face.material.needsUpdate = true; });
  }

  // ── particles (sparks + embers), additive, routed through bloom ──
  function sprite() {
    const c = document.createElement("canvas"); c.width = c.height = 64; const x = c.getContext("2d");
    const g = x.createRadialGradient(32, 32, 0, 32, 32, 32); g.addColorStop(0, "#fff"); g.addColorStop(0.3, "rgba(255,230,180,.9)"); g.addColorStop(1, "rgba(255,150,60,0)");
    x.fillStyle = g; x.beginPath(); x.arc(32, 32, 32, 0, 7); x.fill(); return new THREE.CanvasTexture(c);
  }
  const MAXP = MOBILE ? 90 : 220;
  const pPos = new Float32Array(MAXP * 3), pCol = new Float32Array(MAXP * 3), pSize = new Float32Array(MAXP);
  const pData = []; for (let i = 0; i < MAXP; i++) { pData.push({ life: 0, vx: 0, vy: 0, vz: 0, ember: false }); pSize[i] = 0; }
  const pGeo = new THREE.BufferGeometry();
  pGeo.setAttribute("position", new THREE.BufferAttribute(pPos, 3));
  pGeo.setAttribute("color", new THREE.BufferAttribute(pCol, 3));
  pGeo.setAttribute("psize", new THREE.BufferAttribute(pSize, 1));
  const pMat = new THREE.ShaderMaterial({
    uniforms: { map: { value: sprite() }, dpr: { value: renderer.getPixelRatio() } },
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    vertexShader: `attribute float psize; attribute vec3 color; varying vec3 vC;
      void main(){ vC=color; vec4 mv=modelViewMatrix*vec4(position,1.0);
      gl_PointSize=psize*300.0/max(-mv.z,0.001); gl_Position=projectionMatrix*mv; }`,
    fragmentShader: `uniform sampler2D map; varying vec3 vC;
      void main(){ vec4 t=texture2D(map,gl_PointCoord); gl_FragColor=vec4(vC,1.0)*t; }`,
  });
  const points = new THREE.Points(pGeo, pMat); points.frustumCulled = false; scene.add(points);
  let embTimer = 0, pCursor = 0;
  function spawn(i, x, y, z, vx, vy, vz, life, r, g, b, size, ember) {
    const d = pData[i]; d.life = life; d.max = life; d.vx = vx; d.vy = vy; d.vz = vz; d.ember = ember;
    pPos[i * 3] = x; pPos[i * 3 + 1] = y; pPos[i * 3 + 2] = z; pCol[i * 3] = r; pCol[i * 3 + 1] = g; pCol[i * 3 + 2] = b; pSize[i] = size;
  }
  function burst() {
    const n = MOBILE ? 54 : 135;
    for (let k = 0; k < n; k++) { const i = pCursor % MAXP; pCursor++;
      const a = Math.random() * 6.28, el = Math.random() * 1.1 + 0.35, sp = Math.random() * 4.0 + 1.4;
      const big = Math.random() < 0.18;
      spawn(i, (Math.random() - 0.5) * 0.3, 0.85, (Math.random() - 0.5) * 0.2,
        Math.cos(a) * Math.cos(el) * sp, Math.sin(el) * sp * 1.5 + 1.9, Math.sin(a) * Math.cos(el) * sp * 0.6,
        (big ? 0.9 : 0.45) + Math.random() * 0.7, 1.0, 0.95, 0.7, (big ? 0.24 : 0.13) + Math.random() * 0.12, false);
    }
  }
  function updateParticles(dt) {
    embTimer -= dt;
    if (embTimer <= 0) { embTimer = 0.085; const i = pCursor % MAXP; pCursor++;
      spawn(i, (Math.random() - 0.5) * 1.8, 0.3 + Math.random() * 0.25, (Math.random() - 0.5) * 0.6,
        (Math.random() - 0.5) * 0.22, 0.45 + Math.random() * 0.55, (Math.random() - 0.5) * 0.1,
        1.5 + Math.random() * 1.1, 1.0, 0.55, 0.2, 0.05 + Math.random() * 0.04, true);
    }
    for (let i = 0; i < MAXP; i++) { const d = pData[i]; if (d.life <= 0) { pSize[i] = 0; continue; }
      d.life -= dt; if (d.life <= 0) { pSize[i] = 0; continue; }
      if (d.ember) { d.vy += 0.16 * dt; } else { d.vy -= 5.4 * dt; d.vx *= 0.985; d.vz *= 0.985; }
      pPos[i * 3] += d.vx * dt; pPos[i * 3 + 1] += d.vy * dt; pPos[i * 3 + 2] += d.vz * dt;
      const f = Math.max(0, d.life / d.max);
      pSize[i] = (d.ember ? 0.06 : 0.17) * f + 0.012;
      pCol[i * 3 + 1] = d.ember ? 0.55 : 0.42 + 0.5 * f; pCol[i * 3 + 2] = d.ember ? 0.18 : 0.08 + 0.42 * f;
    }
    pGeo.attributes.position.needsUpdate = true; pGeo.attributes.color.needsUpdate = true; pGeo.attributes.psize.needsUpdate = true;
  }

  // ── shockwave ring ──
  const ring = new THREE.Mesh(new THREE.RingGeometry(0.2, 0.28, 48),
    new THREE.MeshBasicMaterial({ color: 0xffb060, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, side: THREE.DoubleSide, depthWrite: false }));
  ring.rotation.x = -Math.PI / 2; ring.position.set(0, 0.815, 0); ring.scale.setScalar(0.001); scene.add(ring);
  let ringT = -1;

  // ── bloom + composite pipeline ──
  let W = 16, H = 9, sceneRT, brightRT, blurA, blurB;
  const rtOpts = { type: THREE.HalfFloatType, minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter, encoding: THREE.LinearEncoding };
  const fsScene = new THREE.Scene(); const fsCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  const fsQuad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2)); fsScene.add(fsQuad);

  const brightMat = new THREE.ShaderMaterial({ uniforms: { tex: { value: null }, thr: { value: 0.72 }, knee: { value: 0.35 } },
    vertexShader: `varying vec2 v; void main(){v=uv; gl_Position=vec4(position.xy,0.,1.);}`,
    fragmentShader: `uniform sampler2D tex; uniform float thr,knee; varying vec2 v;
      void main(){ vec3 c=texture2D(tex,v).rgb; float br=max(c.r,max(c.g,c.b));
      float s=clamp((br-thr+knee)/(2.0*knee),0.,1.); s=s*s*(3.-2.*s);
      float w=max(br-thr,0.0)+s*knee; gl_FragColor=vec4(c*(w/max(br,1e-4)),1.0); }` });
  const blurMat = new THREE.ShaderMaterial({ uniforms: { tex: { value: null }, dir: { value: new THREE.Vector2() }, res: { value: new THREE.Vector2() } },
    vertexShader: `varying vec2 v; void main(){v=uv; gl_Position=vec4(position.xy,0.,1.);}`,
    fragmentShader: `uniform sampler2D tex; uniform vec2 dir,res; varying vec2 v;
      void main(){ vec2 o=dir/res; vec3 s=texture2D(tex,v).rgb*0.227;
      s+=texture2D(tex,v+o*1.38).rgb*0.316; s+=texture2D(tex,v-o*1.38).rgb*0.316;
      s+=texture2D(tex,v+o*3.23).rgb*0.070; s+=texture2D(tex,v-o*3.23).rgb*0.070;
      gl_FragColor=vec4(s,1.0); }` });
  const compMat = new THREE.ShaderMaterial({ uniforms: {
      scn: { value: null }, blm: { value: null }, bloom: { value: 1.15 }, time: { value: 0 },
      vig: { value: 0.26 }, ca: { value: 0.0018 }, grain: { value: 0.045 }, pixel: { value: 0.0 }, res: { value: new THREE.Vector2() } },
    vertexShader: `varying vec2 v; void main(){v=uv; gl_Position=vec4(position.xy,0.,1.);}`,
    fragmentShader: `
      uniform sampler2D scn,blm; uniform float bloom,time,vig,ca,grain,pixel; uniform vec2 res; varying vec2 v;
      vec3 aces(vec3 x){ return clamp((x*(2.51*x+0.03))/(x*(2.43*x+0.59)+0.14),0.0,1.0); }
      float hash(vec2 p){ return fract(sin(dot(p,vec2(41.3,289.1)))*43758.5453); }
      void main(){
        vec2 uv=v;
        if(pixel>0.5){ vec2 g=res/6.0; uv=(floor(uv*g)+0.5)/g; }
        vec2 d=uv-0.5;
        vec3 col;
        col.r=texture2D(scn,uv+d*ca).r; col.g=texture2D(scn,uv).g; col.b=texture2D(scn,uv-d*ca).b;
        float cov=texture2D(scn,uv).a;                 // scene coverage (solid objects → 1, empty → 0)
        vec3 b=texture2D(blm,uv).rgb;
        col+=b*bloom;
        col=aces(col*1.75);
        float vg=smoothstep(1.25,0.4,length(d)*1.7); col*=mix(1.0,vg,vig);
        // Transparent background (no black box): opaque where the scene drew geometry,
        // plus a soft contribution from the bloom so glow/sparks are still visible.
        float bmax=max(b.r,max(b.g,b.b));
        float a=clamp(max(cov, smoothstep(0.05,0.55,bmax)),0.0,1.0);
        col+=(hash(uv*res+time)-0.5)*grain;
        gl_FragColor=vec4(col*a,a);   // premultiplied (renderer alpha is premultiplied)
      }` });

  function resize() {
    const r = container.getBoundingClientRect(); W = Math.max(2, r.width); H = Math.max(2, r.height);
    renderer.setSize(W, H, false); camera.aspect = W / H; camera.updateProjectionMatrix();
    const pr = renderer.getPixelRatio(); const fw = Math.floor(W * pr), fh = Math.floor(H * pr);
    const hw = Math.max(2, Math.floor(fw / 2)), hh = Math.max(2, Math.floor(fh / 2));
    [sceneRT, brightRT, blurA, blurB].forEach((t) => t && t.dispose());
    sceneRT = new THREE.WebGLRenderTarget(fw, fh, rtOpts);
    brightRT = new THREE.WebGLRenderTarget(hw, hh, rtOpts);
    blurA = new THREE.WebGLRenderTarget(hw, hh, rtOpts);
    blurB = new THREE.WebGLRenderTarget(hw, hh, rtOpts);
    compMat.uniforms.res.value.set(fw, fh); blurMat.uniforms.res.value.set(hw, hh);
    pMat.uniforms.dpr.value = pr;
  }
  const ro = new ResizeObserver(resize); ro.observe(container);

  function blit(mat, target) { fsQuad.material = mat; renderer.setRenderTarget(target || null); renderer.clear(); renderer.render(fsScene, fsCam); }
  function renderPipeline() {
    renderer.setRenderTarget(sceneRT); renderer.clear(); renderer.render(scene, camera);
    brightMat.uniforms.tex.value = sceneRT.texture; blit(brightMat, brightRT);
    blurMat.uniforms.tex.value = brightRT.texture; blurMat.uniforms.dir.value.set(1, 0); blit(blurMat, blurA);
    blurMat.uniforms.tex.value = blurA.texture; blurMat.uniforms.dir.value.set(0, 1); blit(blurMat, blurB);
    blurMat.uniforms.tex.value = blurB.texture; blurMat.uniforms.dir.value.set(1.6, 0); blit(blurMat, blurA);
    blurMat.uniforms.tex.value = blurA.texture; blurMat.uniforms.dir.value.set(0, 1.6); blit(blurMat, blurB);
    compMat.uniforms.scn.value = sceneRT.texture; compMat.uniforms.blm.value = blurB.texture;
    compMat.uniforms.pixel.value = skin === "retro" ? 1.0 : 0.0;
    blit(compMat, null);
  }

  // ── easing + timeline ──
  const clamp = (a, b, t) => Math.max(0, Math.min(1, (t - a) / (b - a)));
  const eOutCubic = (t) => 1 - Math.pow(1 - t, 3);
  const eInExpo = (t) => (t <= 0 ? 0 : Math.pow(2, 10 * (t - 1)));
  const eOutBack = (t, s = 1.9) => { t -= 1; return 1 + (s + 1) * t * t * t + s * t * t; };
  const eInOut = (t) => (t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2);
  const lerp = (a, b, t) => a + (b - a) * t;

  const LOOP = 7.2, STRIKE = 0.415;
  const clock = new THREE.Clock();
  let lastU = 1, shake = 0, labelShown = false;

  function frame(u, dt) {
    const t = clock.elapsedTime;
    let cx = camBase.x + Math.sin(t * 0.35) * 0.12, cy = camBase.y + Math.sin(t * 0.5) * 0.05, cz = camBase.z + Math.sin(t * 0.27) * 0.14;
    if (shake > 0) { cx += (Math.random() - 0.5) * shake; cy += (Math.random() - 0.5) * shake; cz += (Math.random() - 0.5) * shake * 0.6; shake *= Math.pow(0.001, dt); if (shake < 0.001) shake = 0; }
    camera.position.set(cx, cy, cz); camera.lookAt(camLook);

    let ang; const rest = -0.16;
    if (u < 0.30) ang = rest;
    else if (u < 0.40) ang = lerp(rest, -0.42, eInOut(clamp(0.30, 0.40, u)));
    else if (u < STRIKE) ang = lerp(-0.42, 1.34, eInExpo(clamp(0.40, STRIKE, u)));
    else if (u < 0.58) ang = lerp(1.34, rest, eOutCubic(clamp(STRIKE, 0.58, u)));
    else ang = rest;
    hammer.rotation.z = ang;

    let stage = 0;
    if (u >= 0.5 && u < 0.90) stage = eInOut(clamp(0.5, 0.66, u));
    else if (u >= 0.90) stage = 1 - eOutCubic(clamp(0.90, 1.0, u));
    anvil.position.y = lerp(-0.2, -1.7, stage);
    hammer.position.set(lerp(1.5, 3.4, stage), lerp(0.5, 2.4, stage), 0.15);

    if (u < 0.10) { ingot.visible = false; }
    else if (u < 0.40) {
      ingot.visible = true; const p = eOutCubic(clamp(0.10, 0.36, u));
      ingot.position.set(lerp(-3.4, 0, p), lerp(1.9, 0.9, p) + Math.sin(p * 3.14) * 0.25, lerp(0.6, 0, p));
      ingot.rotation.set(lerp(-0.5, 0, p), lerp(0.8, 0, p), lerp(-0.3, 0, p));
      ingot.scale.setScalar(lerp(0.6, 1, p));
      ingotFlash.material.opacity = 0;
    } else if (u < 0.50) {
      const p = clamp(0.40, 0.47, u);
      ingot.visible = true; ingot.position.set(0, 0.9, 0); ingot.rotation.set(0, 0, 0);
      ingot.scale.set(1 + p * 0.1, lerp(1, 0.30, p), 1 + p * 0.1);
      ingotFlash.material.opacity = Math.min(1, eInExpo(p) * 1.25);
      if (u > 0.47) { const q = clamp(0.47, 0.50, u); ingot.scale.multiplyScalar(1 - q * 0.5); }
      if (u > 0.495) ingot.visible = false;
    } else ingot.visible = false;

    const hb = Math.max(0, 1 - Math.abs(u - STRIKE) / 0.09);
    heatBar.material.opacity = hb * 0.9;
    molten.intensity = hb * hb * 6.0;
    groundGlow.material.opacity = 0.28 + hb * 0.6;
    groundGlow.scale.setScalar(1 + hb * 0.18);

    const fan = [[-1.75, 0.95, -9], [-0.05, 1.4, 0], [1.7, 0.95, 9]];
    for (let i = 0; i < 3; i++) { const c = clips[i], born = 0.455 + i * 0.022, out = born + 0.16, hold = 0.9;
      if (u < born) { c.mesh.visible = false; continue; }
      c.mesh.visible = true;
      const fx = fan[i][0], fy = fan[i][1], rz = (fan[i][2] * Math.PI) / 180;
      if (u < out) { const p = eOutBack(clamp(born, out, u));
        c.mesh.position.set(lerp(0, fx, p), lerp(0.9, fy, p) + (1 - p) * 0.6, lerp(0.1, 1.5, p));
        c.mesh.rotation.set(0, lerp(2.4, 0, p) * (i - 1 || 1), lerp(0, rz, p));
        c.mesh.scale.setScalar(lerp(0.2, 1, Math.min(1, p)));
        c.hot.material.opacity = lerp(1.0, 0.0, clamp(born, out + 0.06, u));
      } else if (u < hold) {
        c.mesh.position.set(fx, fy, 1.5); c.mesh.rotation.set(0, 0, rz); c.mesh.scale.setScalar(1);
        c.hot.material.opacity = Math.max(0, lerp(0.4, 0, clamp(out, out + 0.1, u)));
      } else { const q = clamp(hold, 1.0, u);
        c.mesh.position.set(fx, fy + q * 0.5, 1.5); c.mesh.scale.setScalar(1 - q * 0.06);
        c.face.material.opacity = 1 - q; c.mesh.material.opacity = 1 - q;
      }
      if (u < hold) { c.face.material.opacity = 1; c.mesh.material.opacity = 1; }
    }

    const wantLabel = u > 0.6 && u < 0.92;
    if (wantLabel !== labelShown) { labelShown = wantLabel; onLabel(wantLabel); }
  }

  function triggers(u) {
    if (u < lastU) onCycle();                         // wrapped → advance the fake URL id
    if (lastU < STRIKE && u >= STRIKE) { burst(); shake = 0.16; ringT = 0; }
    lastU = u;
  }

  // ── main loop / lifecycle ──
  let running = true, rafId = 0, reported = false;
  function loop() {
    if (!running || document.hidden) return;
    const dt = Math.min(0.05, clock.getDelta());
    const u = (clock.elapsedTime % LOOP) / LOOP;
    triggers(u);
    if (ringT >= 0) { ringT += dt; const p = ringT / 0.5; ring.scale.setScalar(0.2 + p * 4.5); ring.material.opacity = Math.max(0, 1 - p) * 0.6; if (p >= 1) ringT = -1; }
    frame(u, dt);
    updateParticles(dt);
    compMat.uniforms.time.value = clock.elapsedTime;
    renderPipeline();
    if (!reported && assetsLoaded >= totalAssets) { reported = true; onReady(); }
    rafId = requestAnimationFrame(loop);
  }
  function onVis() { if (!document.hidden && running) { clock.getDelta(); loop(); } }
  document.addEventListener("visibilitychange", onVis);

  resize(); applySkin(); clock.start();
  // safety net: if assets are slow, still report ready after ~4.5s so the reveal can proceed
  const readyFallback = setTimeout(() => { if (!reported) { reported = true; onReady(); } }, 4500);
  loop();

  return {
    setSkin(s) { skin = s === "retro" ? "retro" : "modern"; applySkin(); },
    setRunning(r) { if (r === running) return; running = r; if (r) { clock.getDelta(); loop(); } },
    // Restart the timeline from frame 0 (call at reveal so the loop plays from the beginning).
    restart() {
      lastU = 1; shake = 0; ringT = -1; ring.material.opacity = 0; embTimer = 0;
      for (let i = 0; i < MAXP; i++) { pData[i].life = 0; pSize[i] = 0; }
      labelShown = false; onLabel(false);
      clock.start();
    },
    dispose() {
      running = false; cancelAnimationFrame(rafId); clearTimeout(readyFallback);
      ro.disconnect(); document.removeEventListener("visibilitychange", onVis);
      [sceneRT, brightRT, blurA, blurB].forEach((t) => t && t.dispose());
      scene.traverse((o) => {
        if (o.geometry) o.geometry.dispose();
        const mats = o.material ? (Array.isArray(o.material) ? o.material : [o.material]) : [];
        mats.forEach((m) => { for (const k in m) { const val = m[k]; if (val && val.isTexture) val.dispose(); } if (m.dispose) m.dispose(); });
      });
      fsQuad.geometry.dispose(); brightMat.dispose(); blurMat.dispose(); compMat.dispose();
      if (scene.environment) scene.environment.dispose();
      renderer.dispose();
    },
  };
}
