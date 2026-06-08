/**
 * NullMade hero shader — slow drifting warm aurora + film grain
 *
 * Renders a full-bleed TSL shader behind the hero section.
 * Loads only when WebGPU is supported (the inline loader in index.html
 * checks navigator.gpu before importing this file).
 * Auto-pauses the render loop when the hero scrolls offscreen.
 *
 * Uses Three.js WebGPURenderer with TSL (no GLSL strings, all JS).
 */
import * as THREE from 'three/webgpu';
import {
  uv, vec2, vec3, vec4, time, float,
  sin, cos, length, exp, fract, dot, Fn,
} from 'three/tsl';

(async function initHeroShader() {
  const hero = document.querySelector('section.hero');
  if (!hero) return;

  // ── TSL shader: 3 slow-drifting warm blobs + animated film grain ─────────
  // Brand orange dominates; amber adds depth; a hint of violet keeps the
  // palette from going flat. All motion is on a >25s cycle so it reads as
  // "ambient" not "active animation."
  const aurora = Fn(() => {
    const p = uv().toVar();
    const t = time.mul(0.04);                  // very slow drift

    // Three blob centers, each on a slightly different cycle
    const b1 = vec2(
      sin(t).mul(0.25).add(0.25),
      cos(t.mul(0.7)).mul(0.20).add(0.50),
    );
    const b2 = vec2(
      cos(t.mul(0.5).add(1.5)).mul(0.30).add(0.75),
      sin(t.mul(0.6).add(2.0)).mul(0.20).add(0.40),
    );
    const b3 = vec2(
      sin(t.mul(0.3).add(3.0)).mul(0.35).add(0.50),
      cos(t.mul(0.4).add(1.0)).mul(0.30).add(0.60),
    );

    // Soft radial falloff per blob
    const f1 = exp(length(p.sub(b1)).mul(-3.5));
    const f2 = exp(length(p.sub(b2)).mul(-4.0));
    const f3 = exp(length(p.sub(b3)).mul(-3.2));

    // Brand-led tints
    const cBrand  = vec3(0.95, 0.42, 0.20);    // #ff6b35
    const cAmber  = vec3(0.85, 0.55, 0.25);    // warm tertiary
    const cViolet = vec3(0.30, 0.20, 0.50);    // cool counter-weight

    const colorOut = cBrand .mul(f1.mul(0.18))
                .add(cAmber .mul(f2.mul(0.13)))
                .add(cViolet.mul(f3.mul(0.07)));

    // Film grain — animated random noise, centered around 0 so it adds
    // subtle texture without raising overall brightness.
    // Dialed to ±0.004 (half of v1) — barely-there analog warmth, not visible static.
    const grain = fract(
      sin(dot(p.add(t.mul(0.5)), vec2(12.9898, 78.233))).mul(43758.5453),
    );
    const grainContribution = grain.mul(0.008).sub(0.004);

    return vec4(colorOut.add(grainContribution), 1.0);
  });

  // ── Renderer setup ───────────────────────────────────────────────────────
  let renderer;
  try {
    renderer = new THREE.WebGPURenderer({
      antialias: false,                        // not needed for soft full-bleed
      alpha: true,
      premultipliedAlpha: false,
    });
    await renderer.init();
  } catch (e) {
    console.warn('[hero-shader] WebGPU init failed — falling back to CSS ambient:', e);
    return;
  }

  // ── Canvas mounting (behind hero text via z-index: -1) ───────────────────
  const canvas = renderer.domElement;
  canvas.style.cssText = `
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
    z-index: -1;
    pointer-events: none;
    opacity: 0;
    transition: opacity 1200ms ease;
  `;
  // .hero already has position:relative + z-index:1 in the page CSS,
  // so it creates its own stacking context. isolation:isolate confirms it.
  hero.style.isolation = 'isolate';
  hero.prepend(canvas);

  // ── Scene: orthographic camera + fullscreen quad ─────────────────────────
  const scene  = new THREE.Scene();
  const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);

  const geo = new THREE.PlaneGeometry(2, 2);
  const mat = new THREE.MeshBasicNodeMaterial();
  mat.colorNode  = aurora();
  mat.depthWrite = false;
  mat.depthTest  = false;

  const quad = new THREE.Mesh(geo, mat);
  scene.add(quad);

  // ── Sizing — render at half resolution for performance ───────────────────
  // The slight softness of half-res actually serves the aesthetic.
  function resize() {
    const rect = hero.getBoundingClientRect();
    const dpr  = Math.min(window.devicePixelRatio, 1.5);
    renderer.setPixelRatio(dpr * 0.5);
    renderer.setSize(rect.width, rect.height, false);
  }
  resize();
  window.addEventListener('resize', resize, { passive: true });

  // ── Pause when offscreen — saves GPU + battery ───────────────────────────
  let active = true;
  const io = new IntersectionObserver(([entry]) => {
    active = entry.isIntersecting;
  }, { threshold: 0 });
  io.observe(hero);

  // ── Reduced-motion respect ───────────────────────────────────────────────
  // If the user has set prefers-reduced-motion, render ONE static frame and
  // stop. The aurora stays visible but no longer drifts.
  const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;

  // ── Animation loop ───────────────────────────────────────────────────────
  if (reduceMotion) {
    await renderer.renderAsync(scene, camera);
  } else {
    renderer.setAnimationLoop(() => {
      if (!active) return;
      renderer.render(scene, camera);
    });
  }

  // Fade in after first frame is in the buffer
  requestAnimationFrame(() => { canvas.style.opacity = '1'; });
})().catch(e => console.warn('[hero-shader] error:', e));
