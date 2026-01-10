/* Kiosk SPA — 1 HTML, 3 views (Home / Capture / Send) */

const APP = {
    baseW: 1080,
    baseH: 1920,
    idleMs: 30_000,
    autoAdvanceMs: 220,
    apiEndpoint: "",
};

// Render / calidad
const CAM = {
    maxW: 2160,
    maxH: 3840,
    dprCap: 2, // 1 = estable en kiosko; 2 = más nítido (más CPU)
};

// UX / “cine” (no cambia tu layout; solo estados y rendimiento)
const UX = {
    targetFps: 30,
    cinematicCss: true,
    readyToastMs: 1200,
    enableProgressRing: true, // P2: si lo queréis, lo inyectamos sin tocar HTML
};

// Caretas (dejas esto como lo tenías)
const CARETAS = [
    { id: "aida", label: "Aida", src: "assets/caras/aida.png" },
    { id: "fidel", label: "Fidel", src: "assets/caras/fidel.png" },
    { id: "hija", label: "Hija de Aida", src: "assets/caras/hija_de_aida.png" },
    { id: "hijo", label: "Hijo de Aida", src: "assets/caras/hijo_de_aida.png" },
    { id: "machu", label: "Machupichu", src: "assets/caras/machupichu.png" },
    { id: "paz", label: "Paz", src: "assets/caras/paz.png" },
].map((x, i) => ({ ...x, num: i + 1, src: encodeURI(x.src) }));

/* =========================
   CHROMA + DESPILL (mejorado)
   - Auto key color desde esquinas
   - Unmix de color en bordes (elimina halo verde real)
   - Matte choke (reduce halo)
   - Limpieza RGB cuando alpha=0 (evita bleed por interpolación)
   - Light wrap hacia el rojo del fondo (integración “cine”)
========================= */

const CHROMA = {
    // Valor inicial (se auto-ajusta si auto.enabled = true)
    r: 0,
    g: 255,
    b: 0,

    // Matte
    tol: 80,
    soft: 140,
    edge: {
        gamma: 1.25, // más duro para comer halo
    },

    // Auto key (muestreo de esquinas)
    auto: {
        enabled: true,
        everyNFrames: 12,  // recalibra cada N frames
        patch: 54,         // tamaño del patch en px (canvas pixels)
        step: 2,           // muestreo (2 = rápido)
        minSamples: 260,   // mínimo píxeles “verdes” para aceptar calibración
        minDelta: 22       // g > r+delta && g > b+delta
    }
};

// Fondo rojo de la app (para light wrap y limpiar RGB en alpha 0)
const BG_RGB = [227, 50, 32];

/* =========================
   Pantalla 3 (Poster): recorte de cabeza + gafas
========================= */

const HEAD = {
    size: 900,
    preset: "normal", // "tight" | "normal" | "loose"
};


// Composición: “lo que ves es lo que sale” (la guía manda)
const COMPOSE = {
    pad: 1.18,        // cuánto aire alrededor de la guía de cara (1.10–1.45)
    maskScale: 1.0,  
    useCircleMask: false, // ✅ OFF: ya recortamos con MediaPipe (evita “círculo” alrededor)
// 1 = círculo perfecto; <1 come un poco el borde
    useGlassesGuide: true, // si existe #glassesGuide, se usa para posicionar las gafas
};

/* =========================
   MediaPipe (head-only): pelo + cara + orejas (skin)
   Objetivo: en Pantalla 3 te quedas SOLO con cabeza (sin cuerpo) sin usar máscara circular cutre.
   Nota: ejecutamos el matting SOLO en el freeze-frame (capture), no en tiempo real.
========================= */

// Pin de versión para que NO te cambie el bundle/wasm por sorpresa en producción.
// Si mañana Google rompe algo, tu kiosko sigue funcionando.
const MP = {
    version: "0.10.22-rc.20250304",
    bundleUrl() {
        return `https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@${this.version}/vision_bundle.mjs`;
    },
    wasmBase() {
        return `https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@${this.version}/wasm`;
    },
};

const HEAD_SEG = {
    enabled: true,

    // ✅ Recomendado: servir local para modo “offline”.
    // Si no existe el archivo, verás un warning claro en consola.
    modelAssetPath: "assets/models/selfie_multiclass_256x256.tflite",

    wasmPath: MP.wasmBase(),
    delegate: "GPU", // "GPU" | "CPU"

    // Mejor pelo/borde → confidence masks.
    useConfidenceMasks: true,

    // Gating geométrico: elimina hombros aunque el modelo tenga dudas.
    ellipse: {
        enabled: true,
        rx: 1.05,
        ry: 1.55,
        yUp: 0.08,
    },

    // Suavizado del borde (en la máscara 256x256)
    featherPx: 2,

    // Halo rojo (Broadcast) en pelo: decontaminación contra BG_RGB usando el alpha de MediaPipe
    haloFix: {
        enabled: true,
        strength: 0.92, // 0..1 (sube si aún ves rojo en pelo)
        alphaMin: 8,    // solo toca el borde (alpha entre alphaMin y 254)
    },


    // Qué clases se quedan (labels dinámicos).
    keep: {
        hair: true,
        face: true,
        skin: true,          // piel/orejas (pero NO body-skin)
        accessories: false,  // no te mantiene gafas reales; las virtuales las pintamos después
    },
};

let mpSeg = {
    ready: false,
    imageSegmenter: null,
    labels: [],
    keepIdx: [],
    FilesetResolver: null,
    ImageSegmenter: null,
};

// Reusable mask canvas (evita allocs cada captura)
const _maskCanvas = document.createElement("canvas");
const _maskCtx = _maskCanvas.getContext("2d", { willReadFrequently: true });

const clamp01 = (v) => (v < 0 ? 0 : (v > 1 ? 1 : v));

// Box blur barato (Float32 alpha). Suficiente para feather.
function boxBlurFloat(src, w, h, r = 2) {
    if (!r || r < 1) return src;
    const tmp = new Float32Array(src.length);
    const dst = new Float32Array(src.length);
    const win = r * 2 + 1;

    // horizontal
    for (let y = 0; y < h; y++) {
        let sum = 0;
        const row = y * w;
        for (let x = -r; x <= r; x++) {
            const xx = Math.min(w - 1, Math.max(0, x));
            sum += src[row + xx];
        }
        for (let x = 0; x < w; x++) {
            tmp[row + x] = sum / win;
            const xOut = x - r;
            const xIn = x + r + 1;
            if (xOut >= 0) sum -= src[row + xOut];
            if (xIn < w) sum += src[row + xIn];
            else sum += src[row + (w - 1)];
        }
    }

    // vertical
    for (let x = 0; x < w; x++) {
        let sum = 0;
        for (let y = -r; y <= r; y++) {
            const yy = Math.min(h - 1, Math.max(0, y));
            sum += tmp[yy * w + x];
        }
        for (let y = 0; y < h; y++) {
            dst[y * w + x] = sum / win;
            const yOut = y - r;
            const yIn = y + r + 1;
            if (yOut >= 0) sum -= tmp[yOut * w + x];
            if (yIn < h) sum += tmp[yIn * w + x];
            else sum += tmp[(h - 1) * w + x];
        }
    }
    return dst;
}

function resolveKeepIndices(labels) {
    const keepIdx = [];
    const L = (labels || []).map((s) => String(s || "").toLowerCase());

    const wantHair = !!HEAD_SEG.keep.hair;
    const wantFace = !!HEAD_SEG.keep.face;
    const wantSkin = !!HEAD_SEG.keep.skin;
    const wantAcc = !!HEAD_SEG.keep.accessories;

    for (let i = 0; i < L.length; i++) {
        const name = L[i];
        const isHair = wantHair && name.includes("hair");
        const isFace = wantFace && (name.includes("face") || name.includes("facial"));
        // Mantén skin excepto “body-skin”
        const isSkin = wantSkin && name.includes("skin") && !name.includes("body");
        const isAcc = wantAcc && name.includes("accessor");
        if (isHair || isFace || isSkin || isAcc) keepIdx.push(i);
    }

    // fallback (selfie_multiclass típico)
    // 0 background | 1 hair | 2 body-skin | 3 face-skin | 4 clothes | 5 accessories
    if (!keepIdx.length) {
        if (HEAD_SEG.keep.hair) keepIdx.push(1);
        if (HEAD_SEG.keep.face || HEAD_SEG.keep.skin) keepIdx.push(3);
        if (HEAD_SEG.keep.accessories) keepIdx.push(5);
    }
    return keepIdx;
}

async function initHeadSegmenter() {
    if (!HEAD_SEG.enabled) return false;
    if (mpSeg.ready && mpSeg.imageSegmenter) return true;

    try {
        // Import ESM desde CDN (por eso index.js va como type="module")
        if (!mpSeg.FilesetResolver || !mpSeg.ImageSegmenter) {
            const mod = await import(MP.bundleUrl());
            mpSeg.FilesetResolver = mod.FilesetResolver;
            mpSeg.ImageSegmenter = mod.ImageSegmenter;
        }

        const vision = await mpSeg.FilesetResolver.forVisionTasks(HEAD_SEG.wasmPath);

        mpSeg.imageSegmenter = await mpSeg.ImageSegmenter.createFromOptions(vision, {
            baseOptions: {
                modelAssetPath: HEAD_SEG.modelAssetPath,
                delegate: HEAD_SEG.delegate,
            },
            runningMode: "IMAGE",
            outputCategoryMask: !HEAD_SEG.useConfidenceMasks,
            outputConfidenceMasks: !!HEAD_SEG.useConfidenceMasks,
        });

        mpSeg.labels = mpSeg.imageSegmenter.getLabels?.() || [];
        mpSeg.keepIdx = resolveKeepIndices(mpSeg.labels);
        mpSeg.ready = true;
        console.log("[HEAD_SEG] Ready", { labels: mpSeg.labels, keepIdx: mpSeg.keepIdx });
        return true;
    } catch (e) {
        console.warn("[HEAD_SEG] No se pudo inicializar (seguimos sin recorte de cabeza)", e);
        mpSeg.ready = false;
        mpSeg.imageSegmenter = null;
        return false;
    }
}

function buildAlphaMaskFromResult(result, keepIdx) {
    // Confidence masks (float 0..1)
    if (result?.confidenceMasks?.length) {
        const masks = result.confidenceMasks;
        const w = masks[0]?.width ?? masks[0]?.getWidth?.();
        const h = masks[0]?.height ?? masks[0]?.getHeight?.();
        if (!w || !h) return null;

        const alpha = new Float32Array(w * h);
        for (const k of keepIdx) {
            const m = masks[k];
            if (!m) continue;
            const arr = m.getAsFloat32Array?.();
            if (!arr || arr.length !== alpha.length) continue;
            for (let i = 0; i < alpha.length; i++) {
                const v = arr[i];
                if (v > alpha[i]) alpha[i] = v;
            }
        }

        // cleanup
        masks.forEach((m) => m?.close?.());
        return { w, h, alpha };
    }

    // Category mask (uint8 label per pixel)
    if (result?.categoryMask) {
        const m = result.categoryMask;
        const w = m.width ?? m.getWidth?.();
        const h = m.height ?? m.getHeight?.();
        const arr = m.getAsUint8Array?.();
        if (!w || !h || !arr) return null;

        const keepSet = new Set(keepIdx);
        const alpha = new Float32Array(w * h);
        for (let i = 0; i < alpha.length; i++) {
            alpha[i] = keepSet.has(arr[i]) ? 1 : 0;
        }

        m.close?.();
        return { w, h, alpha };
    }

    return null;
}

function applyEllipseGate(alpha, mw, mh, guide, outW, outH) {
    if (!HEAD_SEG.ellipse.enabled || !guide) return;
    const cx = (guide.cx / outW) * mw;
    const cy = ((guide.cy - guide.r * HEAD_SEG.ellipse.yUp) / outH) * mh;
    const rx = (guide.r * HEAD_SEG.ellipse.rx / outW) * mw;
    const ry = (guide.r * HEAD_SEG.ellipse.ry / outH) * mh;

    const invRx2 = 1 / Math.max(1e-6, rx * rx);
    const invRy2 = 1 / Math.max(1e-6, ry * ry);

    for (let y = 0; y < mh; y++) {
        for (let x = 0; x < mw; x++) {
            const dx = x - cx;
            const dy = y - cy;
            if ((dx * dx) * invRx2 + (dy * dy) * invRy2 > 1) {
                alpha[y * mw + x] = 0;
            }
        }
    }
}

function alphaToMaskCanvas(alpha, mw, mh) {
    _maskCanvas.width = mw;
    _maskCanvas.height = mh;
    const img = _maskCtx.createImageData(mw, mh);
    const d = img.data;
    for (let i = 0; i < alpha.length; i++) {
        const a = Math.round(clamp01(alpha[i]) * 255);
        const o = i * 4;
        d[o] = 255;
        d[o + 1] = 255;
        d[o + 2] = 255;
        d[o + 3] = a;
    }
    _maskCtx.putImageData(img, 0, 0);
    return _maskCanvas;
}

async function applyHeadSegmentationToCanvas(canvasEl, guideCirclePx) {
    const ok = await initHeadSegmenter();
    if (!ok || !mpSeg.imageSegmenter) return false;

    const result = await mpSeg.imageSegmenter.segment(canvasEl);
    const mask = buildAlphaMaskFromResult(result, mpSeg.keepIdx);
    if (!mask) return false;

    // gate + feather
    applyEllipseGate(mask.alpha, mask.w, mask.h, guideCirclePx, canvasEl.width, canvasEl.height);
    if (HEAD_SEG.featherPx > 1) {
        mask.alpha = boxBlurFloat(mask.alpha, mask.w, mask.h, HEAD_SEG.featherPx);
    }

    const maskCanvas = alphaToMaskCanvas(mask.alpha, mask.w, mask.h);

    const ctx = canvasEl.getContext("2d", { alpha: true });
    ctx.save();
    ctx.globalCompositeOperation = "destination-in";
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(maskCanvas, 0, 0, canvasEl.width, canvasEl.height);
    ctx.restore();

    // =========================
    // POST-HALO FIX (red decontam)
    // Quita contaminación del fondo rojo en el borde (pelo) usando el alpha.
    // =========================
    if (HEAD_SEG.haloFix?.enabled) {
        const img = ctx.getImageData(0, 0, canvasEl.width, canvasEl.height);
        const d = img.data;
        const bgR = BG_RGB[0], bgG = BG_RGB[1], bgB = BG_RGB[2];
        const k = clamp01(HEAD_SEG.haloFix.strength ?? 0.92);
        const aMin = Math.max(1, (HEAD_SEG.haloFix.alphaMin ?? 8) | 0);

        for (let i = 0; i < d.length; i += 4) {
            const a = d[i + 3];
            if (a >= aMin && a < 255) {
                const out = decontaminateAgainstBg(d[i], d[i + 1], d[i + 2], a, bgR, bgG, bgB, k);
                d[i] = out[0]; d[i + 1] = out[1]; d[i + 2] = out[2];
            }
        }
        cleanRgbWhenTransparent(d, bgR, bgG, bgB);
        ctx.putImageData(img, 0, 0);
    }
    return true;
}


const HEAD_PRESETS = {
    tight: { cropW: 2.10, cropH: 2.35, yUp: 1.08, maskY: 0.48, maskRX: 0.47, maskRY: 0.52 },
    normal: { cropW: 2.25, cropH: 2.55, yUp: 1.05, maskY: 0.48, maskRX: 0.47, maskRY: 0.55 },
    loose: { cropW: 2.45, cropH: 2.85, yUp: 1.10, maskY: 0.46, maskRX: 0.48, maskRY: 0.60 },
};

const GLASSES = {
    dir: "assets/Gafas",
    exts: ["png", "webp", "svg"],
};

const GLASSES_FIT = {
    aida: { x: 0.50, y: 0.44, s: 0.78, r: 0 },
    fidel: { x: 0.50, y: 0.44, s: 0.80, r: 0 },
    hija: { x: 0.50, y: 0.44, s: 0.78, r: 0 },
    hijo: { x: 0.50, y: 0.44, s: 0.80, r: 0 },
    machu: { x: 0.50, y: 0.44, s: 0.82, r: 0 },
    paz: { x: 0.50, y: 0.44, s: 0.78, r: 0 },
};

const glassesCache = new Map();

function loadImg(src) {
    return new Promise((resolve, reject) => {
        const im = new Image();
        im.decoding = "async";
        im.onload = () => resolve(im);
        im.onerror = () => reject(new Error(`No se pudo cargar: ${src}`));
        im.src = src;
    });
}

async function getGlassesImage(careta) {
    if (!careta) return null;
    if (glassesCache.has(careta.id)) return glassesCache.get(careta.id);

    const candidates = [];
    // Nombres nuevos: “<num>Gafas.png” (p.ej. 1Gafas.png)
    candidates.push(`${GLASSES.dir}/${careta.num}Gafas.png`);
    // Fallback por id con sufijo Gafas
    candidates.push(`${GLASSES.dir}/${careta.id}Gafas.png`);
    // Fallback antiguos: sin sufijo
    for (const ext of GLASSES.exts) candidates.push(`${GLASSES.dir}/${careta.num}.${ext}`);
    for (const ext of GLASSES.exts) candidates.push(`${GLASSES.dir}/${careta.id}.${ext}`);

    let img = null;
    for (const src of candidates) {
        try { img = await loadImg(src); break; } catch { }
    }

    glassesCache.set(careta.id, img);
    return img;
}


async function updateGlassesGuide() {
    const guideEl = el.glassesGuide;
    if (!guideEl) return;

    const careta = state.selectedCareta || CARETAS[0];
    try {
        const g = await getGlassesImage(careta);
        if (g && g.src) {
            guideEl.src = g.src;
            guideEl.classList.remove("is-hidden");
            // Link directo: la guía de gafas se posiciona a partir del círculo + GLASSES_FIT.
            requestAnimationFrame(() => syncGlassesGuideToCircle());
        } else {
            guideEl.removeAttribute("src");
            guideEl.classList.add("is-hidden");
        }
    } catch {
        guideEl.removeAttribute("src");
        guideEl.classList.add("is-hidden");
    }
}

// P0: “linkear” silueta de gafas con la guía del círculo (Pantalla 2)
// Resultado: lo que ves alineado en Pantalla 2 es exactamente lo que se compone en Pantalla 3.

// Lee variables CSS (px o número). Sirve para ajustar en vivo sin tocar JS.
function readCssVarNumber(scopeEl, varName, fallback) {
    try {
        const raw = getComputedStyle(scopeEl).getPropertyValue(varName).trim();
        if (!raw) return fallback;
        const n = parseFloat(raw);
        return Number.isFinite(n) ? n : fallback;
    } catch {
        return fallback;
    }
}

/* =========================
   CAPTURE TUNE (persistente) + Sync continuo
   - Evita el “me muevo y otro bloque me lo pisa”.
   - Permite calibrar en venue sin editar JS (persistencia en localStorage).
========================= */

const CAPTURE_TUNE = {
    storageKey: "kiosk_capture_tune_v1",
    syncEveryMs: 120, // 80–160ms = responde bien sin quemar CPU
};

const capSync = { raf: null, last: 0 };

function getCaptureTuneScope() {
    return document.querySelector('.view[data-view="capture"]') || document.documentElement;
}

function applyCaptureTune(tune = {}) {
    const scope = getCaptureTuneScope();
    if (!scope) return;

    const map = {
        capX: "--cap-x",
        capY: "--cap-y",
        capCircleW: "--cap-circle-w",

        counterX: "--cap-counter-x",
        counterY: "--cap-counter-y",
        counterW: "--cap-counter-w",

        // Aliases (más memorizable en consola)
        capCounterX: "--cap-counter-x",
        capCounterY: "--cap-counter-y",
        capCounterW: "--cap-counter-w",

        glassesNudgeX: "--cap-glasses-nudge-x",
        glassesNudgeY: "--cap-glasses-nudge-y",
        glassesNudgeS: "--cap-glasses-nudge-s",
    };

    for (const [k, cssVar] of Object.entries(map)) {
        if (tune[k] === undefined || tune[k] === null) continue;
        scope.style.setProperty(cssVar, String(tune[k]));
    }

    // Resync inmediato (si mueves variables “en caliente” quieres feedback ya)
    requestAnimationFrame(() => {
        syncGlassesGuideToCircle();
        positionProgressRing();
    });
}

function loadCaptureTune() {
    try {
        const raw = localStorage.getItem(CAPTURE_TUNE.storageKey);
        if (!raw) return {};
        const obj = JSON.parse(raw);
        return obj && typeof obj === "object" ? obj : {};
    } catch {
        return {};
    }
}

function saveCaptureTune(obj) {
    try {
        localStorage.setItem(CAPTURE_TUNE.storageKey, JSON.stringify(obj || {}));
    } catch { }
}

function startCaptureLayoutSync() {
    stopCaptureLayoutSync();
    capSync.last = 0;

    const tick = (t) => {
        if (state.view !== "capture") return;

        if (t - capSync.last >= CAPTURE_TUNE.syncEveryMs) {
            capSync.last = t;
            syncGlassesGuideToCircle();
            positionProgressRing();
        }
        capSync.raf = requestAnimationFrame(tick);
    };

    capSync.raf = requestAnimationFrame(tick);
}

function stopCaptureLayoutSync() {
    if (capSync.raf) cancelAnimationFrame(capSync.raf);
    capSync.raf = null;
}

// API de calibración rápida (DevTools-friendly)
function exposeTuneApi() {
    if (window.KIOSK_TUNE) return;

    window.KIOSK_TUNE = {
        get() {
            return loadCaptureTune();
        },
        set(patch = {}) {
            const cur = loadCaptureTune();
            const next = { ...cur, ...patch };
            saveCaptureTune(next);
            applyCaptureTune(next);
            return next;
        },
        reset() {
            try { localStorage.removeItem(CAPTURE_TUNE.storageKey); } catch { }

            // Volvemos a valores “de fábrica” (CSS) quitando solo lo que tocamos.
            const scope = getCaptureTuneScope();
            if (scope) {
                [
                    "--cap-x", "--cap-y", "--cap-circle-w",
                    "--cap-counter-x", "--cap-counter-y", "--cap-counter-w",
                    "--cap-glasses-nudge-x", "--cap-glasses-nudge-y", "--cap-glasses-nudge-s",
                ].forEach((v) => scope.style.removeProperty(v));
            }

            requestAnimationFrame(() => syncGlassesGuideToCircle());
            return {};
        },
    };
}



function syncGlassesGuideToCircle() {
    if (state.view !== "capture") return;
    const guideEl = el.glassesGuide;
    if (!guideEl || guideEl.classList.contains("is-hidden")) return;

    const circleEl = document.querySelector(".capture-circle");
    const shellEl = document.querySelector(".camera-shell");
    if (!circleEl || !shellEl) return;

    const cr = circleEl.getBoundingClientRect();
    const sr = shellEl.getBoundingClientRect();
    if (!cr.width || !cr.height || !sr.width || !sr.height) return;

    // La stage está escalada con transform. Convertimos de viewport px → px locales de la shell.
    const scaleX = sr.width / Math.max(1, shellEl.offsetWidth);
    const scaleY = sr.height / Math.max(1, shellEl.offsetHeight);

    const careta = state.selectedCareta || CARETAS[0];
    const fit = GLASSES_FIT[careta.id] || { x: 0.5, y: 0.47, s: 0.8, r: 0 };

    const diamLocal = Math.min(cr.width / scaleX, cr.height / scaleY);
    const cropSize = diamLocal * COMPOSE.pad;

    // Centro del crop en coords locales de la shell
    const cropCx = (cr.left + cr.width / 2 - sr.left) / scaleX;
    const cropCy = (cr.top + cr.height / 2 - sr.top) / scaleY;

    // Base (linkeada al círculo)
    let cx = cropCx + (fit.x - 0.5) * cropSize;
    let cy = cropCy + (fit.y - 0.5) * cropSize;
    let w = Math.max(10, fit.s * cropSize);

    // ✅ Nudges manuales desde CSS (CAPTURE TUNE)
    const capView = document.querySelector('.view[data-view="capture"]') || document.documentElement;
    const nudgeX = readCssVarNumber(capView, '--cap-glasses-nudge-x', 0);
    const nudgeY = readCssVarNumber(capView, '--cap-glasses-nudge-y', 0);
    const nudgeS = readCssVarNumber(capView, '--cap-glasses-nudge-s', 1);

    cx += nudgeX;
    cy += nudgeY;
    w = Math.max(10, w * (nudgeS || 1));

    guideEl.style.left = `${cx}px`;
    guideEl.style.top = `${cy}px`;
    guideEl.style.width = `${w}px`;
    // Importante: NO rotamos aquí para que el bounding rect sea fiable.
    // La rotación se aplica en la composición final.
    guideEl.style.transform = "translate(-50%, -50%)";
}

function waitVideoReady(v) {
    return new Promise((resolve) => {
        if (v?.readyState >= 2 && v.videoWidth) return resolve();
        v?.addEventListener("loadedmetadata", () => resolve(), { once: true });
    });
}

/* =========================
   Helpers (Chroma)
========================= */

function clamp255(x) {
    return x < 0 ? 0 : x > 255 ? 255 : x;
}



function decontaminateAgainstBg(r, g, b, a255, bgR, bgG, bgB, strength = 1.0) {
    // Unmix / decontamination using alpha:
    // fg = (c - bg*(1-a))/a . Blended by strength to avoid harsh edges/noise.
    if (a255 <= 0 || a255 >= 255) return [r, g, b];
    const a = a255 / 255;
    const inv = 1 - a;

    let fr = (r - bgR * inv) / Math.max(1e-6, a);
    let fg = (g - bgG * inv) / Math.max(1e-6, a);
    let fb = (b - bgB * inv) / Math.max(1e-6, a);

    fr = r + (fr - r) * strength;
    fg = g + (fg - g) * strength;
    fb = b + (fb - b) * strength;

    return [clamp255(fr) | 0, clamp255(fg) | 0, clamp255(fb) | 0];
}

function cleanRgbWhenTransparent(data, bgR, bgG, bgB) {
    // Prevent color bleed on fully transparent pixels when scaling/interpolating.
    for (let i = 0; i < data.length; i += 4) {
        if (data[i + 3] === 0) {
            data[i] = bgR; data[i + 1] = bgG; data[i + 2] = bgB;
        }
    }
}

function smoothstep01(t) {
    t = t < 0 ? 0 : t > 1 ? 1 : t;
    return t * t * (3 - 2 * t);
}

// Pick key color manual (fija el key y desactiva auto-key)
function sampleKeyColorAtCanvasPoint(clientX, clientY, patch = 18) {
    if (!el.cameraCanvas || !el.cameraCtx) return;

    const rect = el.cameraCanvas.getBoundingClientRect();
    const x = Math.round(((clientX - rect.left) / rect.width) * el.cameraCanvas.width);
    const y = Math.round(((clientY - rect.top) / rect.height) * el.cameraCanvas.height);

    const x0 = Math.max(0, x - patch);
    const y0 = Math.max(0, y - patch);
    const w = Math.min(el.cameraCanvas.width - x0, patch * 2);
    const h = Math.min(el.cameraCanvas.height - y0, patch * 2);

    const img = el.cameraCtx.getImageData(x0, y0, w, h).data;

    let sr = 0, sg = 0, sb = 0, n = 0;
    for (let i = 0; i < img.length; i += 4) {
        sr += img[i];
        sg += img[i + 1];
        sb += img[i + 2];
        n++;
    }

    const key = { r: (sr / n) | 0, g: (sg / n) | 0, b: (sb / n) | 0 };

    CHROMA.auto.enabled = false; // congelamos auto-key
    state.keyRGB = key;

    if (el.cameraStatus) {
        el.cameraStatus.textContent = `Key fijado: rgb(${key.r}, ${key.g}, ${key.b})`;
    }
}

// Auto-key: calcula RGB del “verde real” muestreando esquinas
function autoKeyFromCorners(data, w, h, opts) {
    const p = opts.patch | 0;
    const step = opts.step | 0;

    const rects = [
        [0, 0, p, p],
        [w - p, 0, w, p],
        [0, h - p, p, h],
        [w - p, h - p, w, h],
    ];

    let sr = 0, sg = 0, sb = 0, n = 0;

    for (const [x0, y0, x1, y1] of rects) {
        for (let y = y0; y < y1; y += step) {
            for (let x = x0; x < x1; x += step) {
                const i = (y * w + x) * 4;
                const r = data[i], g = data[i + 1], b = data[i + 2];

                if (g > r + opts.minDelta && g > b + opts.minDelta && g > 40) {
                    sr += r; sg += g; sb += b; n++;
                }
            }
        }
    }

    if (n < opts.minSamples) return null;

    return { r: (sr / n) | 0, g: (sg / n) | 0, b: (sb / n) | 0 };
}

/* =========================
   DOM refs
========================= */

const el = {
    stage: document.getElementById("stage"),
    cameraCanvas: document.getElementById("cameraCanvas"),
    cameraCtx: document.getElementById("cameraCanvas")?.getContext("2d", { willReadFrequently: true }),
    camera: document.getElementById("camera"),
    cameraStatus: document.getElementById("cameraStatus"),
    photoPreview: document.getElementById("photoPreview"),
    captureCountdown: document.querySelector(".capture-countdown"),
    captureCountdownNum: document.querySelector(".capture-countdown-num"),
    captureProgress: document.querySelector(".capture-progress"),
    captureProgressFg: document.querySelector(".capture-progress-fg"),
    captureBtn: document.querySelector('[data-view="capture"] [data-action="capture"]'),
    externalModal: document.getElementById("externalModal"),
    externalFrame: document.getElementById("externalFrame"),
    qrOverlay: document.getElementById("qrOverlay"),
    glassesGuide: document.getElementById("glassesGuide"),
};

const EXTERNAL_URL = el.externalFrame?.getAttribute("src") || "";

const state = {
    view: "home",
    selectedCareta: CARETAS[0],

    stream: null,
    photoDataUrl: "",

    idleTimer: null,
    idlePaused: false,
    renderReq: null,
    lastRenderTs: 0,
    canvasDpr: 1,
    hasFrame: false,
    lastCrop: null, // { sx, sy, sw, sh, out }

    redirectTimer: null,

    qrReturnTimer: null,

    // 🔥 para auto-key
    frameIdx: 0,
    keyRGB: { r: CHROMA.r, g: CHROMA.g, b: CHROMA.b },

    // countdown
    isCounting: false,
    countdownTimer: null,
    progressReq: null,
    countdownToken: 0,
};


function setCaptureEnabled(enabled) {
    if (!el.captureBtn) return;
    el.captureBtn.disabled = !enabled;
    el.captureBtn.setAttribute("aria-disabled", String(!enabled));
    if (!enabled) el.captureBtn.classList.remove("is-pressed");
}

// Fix “botón pillado”: en kioskos táctiles algunos navegadores dejan :active pegado.
// Nos quitamos de encima esa incertidumbre: feedback por clase + reset en blur/cancel.
function initCaptureButtonUX() {
    const btn = el.captureBtn;
    if (!btn) return;

    const on = () => btn.classList.add("is-pressed");
    const off = () => btn.classList.remove("is-pressed");

    btn.addEventListener("pointerdown", on, { passive: true });
    btn.addEventListener("pointerup", off, { passive: true });
    btn.addEventListener("pointercancel", off, { passive: true });
    btn.addEventListener("pointerleave", off, { passive: true });
    btn.addEventListener("blur", off);

    // Seguridad extra: al hacer click, soltamos estado y quitamos foco.
    btn.addEventListener("click", () => {
        off();
        btn.blur?.();
    });
}

// UX QR: hover/click real + anti “pegado” en táctil.
// Nota: el QR se muestra para escanear, pero si lo tocáis con el ratón/touch
// debe responder como cualquier botón del kiosko.
function initQrButtonUX() {
    const img = el.qrOverlay?.querySelector(".qr-code");
    if (!img) return;

    const on = () => img.classList.add("is-pressed");
    const off = () => img.classList.remove("is-pressed");

    img.addEventListener("pointerdown", on, { passive: true });
    img.addEventListener("pointerup", off, { passive: true });
    img.addEventListener("pointercancel", off, { passive: true });
    img.addEventListener("pointerleave", off, { passive: true });
    img.addEventListener("blur", off);

    img.addEventListener("click", () => {
        off();
        img.blur?.();
    });
}


function showCameraStatus(msg, { kind = "info", pulse = false } = {}) {
    if (!el.cameraStatus) return;
    el.cameraStatus.textContent = msg || "";
    el.cameraStatus.classList.remove("is-hidden");
    el.cameraStatus.classList.toggle("is-error", kind === "error");
    el.cameraStatus.classList.toggle("is-ready", kind === "ready");
    el.cameraStatus.classList.toggle("is-info", kind === "info");
    if (pulse) {
        el.cameraStatus.classList.remove("is-pulse");
        void el.cameraStatus.offsetWidth; // reflow
        el.cameraStatus.classList.add("is-pulse");
    }
}

function hideCameraStatus() {
    if (!el.cameraStatus) return;
    el.cameraStatus.textContent = "";
    el.cameraStatus.classList.add("is-hidden");
    el.cameraStatus.classList.remove("is-error", "is-ready", "is-info", "is-pulse");
}

function pauseIdle() {
    state.idlePaused = true;
    clearTimeout(state.idleTimer);
    state.idleTimer = null;
}

function resumeIdle() {
    state.idlePaused = false;
    bumpIdle();
}

// P2 opcional: progreso circular real sin tocar el HTML del concepto
function ensureProgressRing() {
    if (!UX.enableProgressRing) return;
    const captureView = document.querySelector('[data-view="capture"]');
    if (!captureView) return;
    if (captureView.querySelector(".capture-progress")) return;

    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.setAttribute("class", "capture-progress");
    svg.setAttribute("viewBox", "0 0 120 120");
    svg.setAttribute("aria-hidden", "true");

    const bg = document.createElementNS("http://www.w3.org/2000/svg", "circle");
    bg.setAttribute("class", "capture-progress-bg");
    bg.setAttribute("cx", "60");
    bg.setAttribute("cy", "60");
    bg.setAttribute("r", "54");

    const fg = document.createElementNS("http://www.w3.org/2000/svg", "circle");
    fg.setAttribute("class", "capture-progress-fg");
    fg.setAttribute("cx", "60");
    fg.setAttribute("cy", "60");
    fg.setAttribute("r", "54");

    svg.append(bg, fg);

    // Lo colgamos del overlay, para que siga tu jerarquía visual
    const overlay = captureView.querySelector(".capture-overlay") || captureView;
    overlay.appendChild(svg);

    // refresca references
    el.captureProgress = svg;
    el.captureProgressFg = fg;

    // Mantén el anillo pegado al número (tuneable)
    positionProgressRing();
}
function ensureCountdownDom() {
    const captureView = document.querySelector('[data-view="capture"]');
    if (!captureView) return;

    // Si existe el nuevo contenedor, refrescamos refs y listo.
    let cd = captureView.querySelector(".capture-countdown");
    if (!cd) {
        cd = document.createElement("div");
        cd.className = "capture-countdown is-hidden";
        cd.setAttribute("aria-hidden", "true");

        const num = document.createElement("div");
        num.className = "capture-countdown-num";
        num.textContent = "5";
        cd.appendChild(num);

        // Lo colgamos del mismo nivel que el anillo (overlay/view), para que siga la jerarquía actual.
        const overlay = captureView.querySelector(".capture-overlay") || captureView;
        overlay.appendChild(cd);
    }

    el.captureCountdown = cd;
    el.captureCountdownNum = cd.querySelector(".capture-countdown-num");

    // Legacy: si alguien dejó el <img class="capture-counter">, lo escondemos para que no “pise”.
    const legacy = captureView.querySelector(".capture-counter");
    if (legacy) legacy.classList.add("is-hidden");
}


/* =========================
   Stage scaling
========================= */

function scaleStage() {
    const vw = window.innerWidth;
    const vh = window.innerHeight;

    const scale = Math.min(vw / APP.baseW, vh / APP.baseH);
    const x = Math.floor((vw - APP.baseW * scale) / 2);
    const y = Math.floor((vh - APP.baseH * scale) / 2);

    el.stage.style.transform = `translate(${x}px, ${y}px) scale(${scale})`;

    // ✅ para el modal responsive al marco
    document.documentElement.style.setProperty("--stage-px-w", `${APP.baseW * scale}px`);
    document.documentElement.style.setProperty("--stage-px-h", `${APP.baseH * scale}px`);

    
    document.documentElement.style.setProperty("--stage-px-x", `${x}px`);
    document.documentElement.style.setProperty("--stage-px-y", `${y}px`);
    document.documentElement.style.setProperty("--stage-scale", `${scale}`);
// Si estamos en la pantalla de captura, re-sincronizamos la guía de gafas tras el reflow.
    if (state.view === "capture") requestAnimationFrame(() => {
        syncGlassesGuideToCircle();
        positionProgressRing();
    });
}

function bumpIdle() {
    if (state.idlePaused) return;
    clearTimeout(state.idleTimer);
    
    // Si ya estás en home, no hagas nada (evita parpadeo innecesario)
    if (state.view === "home") return;
    
    state.idleTimer = setTimeout(() => location.reload(), APP.idleMs);
}

function stopRedirect() {
    clearTimeout(state.redirectTimer);
    state.redirectTimer = null;
}

function stopQrReturn() {
    clearTimeout(state.qrReturnTimer);
    state.qrReturnTimer = null;
}

function stopCountdown() {
    // Invalida cualquier countdown en curso (evita botones “pillados” si se cancela el timer).
    state.countdownToken++;
    clearTimeout(state.countdownTimer);
    state.countdownTimer = null;
    state.isCounting = false;
    if (el.captureCountdown) {
        el.captureCountdown.classList.add("is-hidden");
        el.captureCountdown.classList.remove("is-pulse");
    }
    // Legacy: si aún existe el <img class="capture-counter">, lo escondemos para no depender de assets.
    const legacyCounter = document.querySelector(".capture-counter");
    if (legacyCounter) legacyCounter.classList.add("is-hidden");
    if (state.progressReq) cancelAnimationFrame(state.progressReq);
    state.progressReq = null;
    if (el.captureProgress) el.captureProgress.classList.remove("is-active");
}



function positionProgressRing() {
    if (!el.captureProgress) return;

    const scope = getCaptureTuneScope();
    if (!scope) return;

    const cs = getComputedStyle(scope);
    const cx = cs.getPropertyValue("--cap-counter-x").trim() || "50%";
    const cy = cs.getPropertyValue("--cap-counter-y").trim() || "250px";
    const cwRaw = cs.getPropertyValue("--cap-counter-w").trim() || "150px";

    const cw = parseFloat(cwRaw) || 150;
    const pad = Math.round(cw * 0.22); // margen del anillo respecto al número

    el.captureProgress.style.left = `calc(${cx} - ${pad}px)`;
    el.captureProgress.style.top = `calc(${cy} - ${pad}px)`;
    el.captureProgress.style.right = "auto";
    el.captureProgress.style.width = `${cw + pad * 2}px`;
    el.captureProgress.style.height = `${cw + pad * 2}px`;
}
function setCountdownNumber(n) {
    // Aseguramos DOM (por si entraste en capture antes de actualizar el HTML)
    ensureCountdownDom();

    const cd = el.captureCountdown;
    const numEl = el.captureCountdownNum;
    if (!cd || !numEl) return;

    if (n === null || n === undefined) {
        cd.classList.add("is-hidden");
        cd.setAttribute("aria-hidden", "true");
        cd.classList.remove("is-pulse");
        return;
    }

    numEl.textContent = String(n);
    cd.classList.remove("is-hidden");
    cd.setAttribute("aria-hidden", "false");

    // Mantén el anillo pegado al número (si se tunea counterX/Y/W en caliente)
    positionProgressRing();

    cd.classList.remove("is-pulse");
    // reflow para reiniciar animación
    void cd.offsetWidth;
    cd.classList.add("is-pulse");
}

function startProgress(durationMs) {
    if (!el.captureProgress || !el.captureProgressFg) return;
    const circumference = 339.292; // stroke-dasharray set in CSS
    el.captureProgress.classList.add("is-active");
    el.captureProgressFg.style.strokeDasharray = `${circumference}`;
    const start = performance.now();
    const tick = (now) => {
        const t = Math.min(1, (now - start) / durationMs);
        const offset = circumference * (1 - t);
        el.captureProgressFg.style.strokeDashoffset = `${offset}`;
        if (t < 1) {
            state.progressReq = requestAnimationFrame(tick);
        }
    };
    state.progressReq = requestAnimationFrame(tick);
}

function runCountdown() {
    const steps = [5, 4, 3, 2, 1, 0];
    const stepMs = 1000;
    const lastMs = 250; // el 0 se ve un instante y dispara captura
    const total = (steps.length - 1) * stepMs + lastMs;

    startProgress(total);

    // Token para poder cancelar sin dejar Promises colgadas.
    const token = ++state.countdownToken;

    return new Promise((resolve) => {
        let idx = 0;
        const tick = () => {
            if (state.countdownToken !== token) {
                setCountdownNumber(null);
                return resolve(false);
            }

            if (idx >= steps.length) {
                setCountdownNumber(null);
                return resolve(true);
            }

            setCountdownNumber(steps[idx]);

            const wait = (idx === steps.length - 1) ? lastMs : stepMs;
            idx += 1;
            state.countdownTimer = setTimeout(tick, wait);
        };
        tick();
    });
}


function closeModal(opts = {}) {
    const { keepQR = false, keepDim = false } = opts || {};
    stopRedirect();
    stopQrReturn();

    if (!keepDim) el.stage.classList.remove("dim-out");

    if (el.externalModal) el.externalModal.classList.add("is-hidden");
    if (el.qrOverlay) el.qrOverlay.classList.toggle("is-hidden", !keepQR);

    // Siempre reactivamos el idle: si no hay interacción, vuelve a Home solo.
    resumeIdle();
    bumpIdle();

    // Si dejamos el QR, damos una ventana corta para escanear y luego volvemos a Home.
    if (keepQR) {
        state.qrReturnTimer = setTimeout(() => setView("home"), 22_000);
    }
}

/* =========================
   Camera canvas sizing
========================= */

function resizeCameraCanvas() {
    if (!el.cameraCanvas) return 1;

    const rect = el.cameraCanvas.getBoundingClientRect();

    // DPR "deseado" (según dispositivo), pero OJO:
    // si CAM.maxW/maxH capan el canvas, NO podemos aplicar ese DPR.
    // Si lo aplicas igualmente, acabas dibujando a la mitad de resolución y re-escalando → imagen blanda.
    const targetDpr = Math.min(CAM.dprCap, window.devicePixelRatio || 1);

    const w = Math.min(CAM.maxW, Math.max(1, Math.floor(rect.width * targetDpr)));
    const h = Math.min(CAM.maxH, Math.max(1, Math.floor(rect.height * targetDpr)));

    if (el.cameraCanvas.width !== w || el.cameraCanvas.height !== h) {
        el.cameraCanvas.width = w;
        el.cameraCanvas.height = h;
    }

    // DPR efectivo REAL (el que de verdad tiene el canvas ahora mismo)
    const effDprX = rect.width ? (el.cameraCanvas.width / rect.width) : 1;
    const effDprY = rect.height ? (el.cameraCanvas.height / rect.height) : 1;
    const effDpr = Math.max(1, Math.min(targetDpr, effDprX, effDprY));

    state.canvasDpr = effDpr;
    return effDpr;
}


function stopRenderLoop() {
    if (state.renderReq) cancelAnimationFrame(state.renderReq);
    state.renderReq = null;
}

/* =========================
   Chroma render loop
========================= */

function renderFrame(now = performance.now()) {
    const v = el.camera;
    const c = el.cameraCanvas;
    if (!v || !c) return;

    const ctx = el.cameraCtx || c.getContext("2d", { willReadFrequently: true });
    const vw = v.videoWidth;
    const vh = v.videoHeight;

    // “Cine” 30fps: baja CPU sin cambiar tu UI
    const interval = 1000 / (UX.targetFps || 60);
    if (UX.targetFps && now - state.lastRenderTs < interval) {
        state.renderReq = requestAnimationFrame(renderFrame);
        return;
    }
    state.lastRenderTs = now;

    // Sin frame aún: pinta rojo y reintenta
    if (!vw || !vh) {
        ctx.save();
        ctx.clearRect(0, 0, c.width, c.height);
        ctx.fillStyle = `rgb(${BG_RGB[0]}, ${BG_RGB[1]}, ${BG_RGB[2]})`;
        ctx.fillRect(0, 0, c.width, c.height);
        ctx.restore();
        state.renderReq = requestAnimationFrame(renderFrame);
        return;
    }

    const dpr = resizeCameraCanvas();

    // ✅ DPR efectivo (evita downsample+upscale cuando el canvas está capado por CAM.maxW/maxH)

    // object-fit: cover manual
    const cw = c.width / dpr;
    const ch = c.height / dpr;
    const scale = Math.max(cw / vw, ch / vh);
    const sw = cw / scale;
    const sh = ch / scale;
    const sx = Math.floor((vw - sw) / 2);
    const sy = Math.floor((vh - sh) / 2);

    ctx.save();
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = "high";
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, cw, ch);
    ctx.drawImage(v, sx, sy, sw, sh, 0, 0, cw, ch);
    ctx.restore();

    if (!state.hasFrame) {
        state.hasFrame = true;
        if (el.cameraCanvas) el.cameraCanvas.style.visibility = "visible";
        setCaptureEnabled(true);
        showCameraStatus("Cámara lista", { kind: "ready", pulse: true });
        setTimeout(() => {
            if (state.view === "capture" && !state.isCounting) hideCameraStatus();
        }, UX.readyToastMs);
    }

    // =========================
    // CHROMA + DESPILL (NEW)
    // =========================
    const imageData = ctx.getImageData(0, 0, c.width, c.height);
    const data = imageData.data;

    // Auto-key (cada N frames)
    state.frameIdx++;
    if (CHROMA.auto?.enabled && (state.frameIdx % CHROMA.auto.everyNFrames === 0)) {
        const k = autoKeyFromCorners(data, c.width, c.height, CHROMA.auto);
        if (k) state.keyRGB = k;
    }

    const keyR = state.keyRGB?.r ?? CHROMA.r;
    const keyG = state.keyRGB?.g ?? CHROMA.g;
    const keyB = state.keyRGB?.b ?? CHROMA.b;

    const tol2 = CHROMA.tol * CHROMA.tol;
    const soft2 = CHROMA.soft * CHROMA.soft;
    const range = Math.max(1, soft2 - tol2);

    // Knobs (ajusta si quieres)
    const UNMIX_MIN_A = 20;
    const MATTE_CHOKE = 32;    // sigue mordiendo halo
    const SPILL_THR = 5;       // más sensible al verde
    const SPILL_KEEP = 0.015;  // aún menos verde residual
    const NEUTRAL_BLEND = 0.45; // empuja borde a gris suave (quita tinte)
    const WRAP = 0.22;         // integra con fondo rojo
    const ALPHA_CUT = 14;      // corta fringe fino post-choke (sube a 16–20 si aún queda halo)
    const SPILL_KEEP_CORE = 0.08; // despill suave en núcleo (alpha=255) cuando hay verde dominante
    const SPILL_MAX = 120;        // normaliza fuerza del spill para tint (no afecta el matte)
    const EDGE_GRAY = 0.55;       // cuánto empujar a gris cuando hay spill residual en borde
    const EDGE_DARKEN = 0.18;     // oscurece un pelín el borde (negro suave) para matar halo
    const CORE_GRAY = 0.22;       // gris suave en núcleo si hay spill (muy conservador)
    const CORE_DARKEN = 0.10;     // oscurece ligeramente en núcleo si hay spill

    const bgR = BG_RGB[0], bgG = BG_RGB[1], bgB = BG_RGB[2];

    for (let i = 0; i < data.length; i += 4) {
        let r = data[i];
        let g = data[i + 1];
        let b = data[i + 2];

        // Matte por distancia al verde
        const dr = r - keyR;
        const dg = g - keyG;
        const db = b - keyB;
        const dist2 = dr * dr + dg * dg + db * db;

        let a = 255;
        if (dist2 <= tol2) a = 0;
        else if (dist2 <= soft2) {
            const t = (dist2 - tol2) / range;
            let tt = smoothstep01(t);
            tt = Math.pow(tt, CHROMA.edge?.gamma ?? 1);
            a = (255 * tt) | 0;
        }

        // ✅ CRÍTICO: si alpha 0, limpia RGB para evitar bleed verde por interpolación
        if (a === 0) {
            data[i] = bgR; data[i + 1] = bgG; data[i + 2] = bgB; data[i + 3] = 0;
            continue;
        }

        // Solo borde
        if (a > 0 && a < 255) {
            // 1) choke (reduce halo)
            a = Math.max(0, a - MATTE_CHOKE);


            // corte duro de alpha: mata fringe fino antes de tocar color
            if (a < ALPHA_CUT) {
                data[i] = bgR; data[i + 1] = bgG; data[i + 2] = bgB; data[i + 3] = 0;
                continue;
            }
            // 2) unmix (quita verde mezclado)
            if (a >= UNMIX_MIN_A) {
                const an = a / 255;
                const inv = 1 - an;
                r = (r - keyR * inv) / an;
                g = (g - keyG * inv) / an;
                b = (b - keyB * inv) / an;
            }

            // 3) despill
            const maxRB = Math.max(r, b);
            const spill = g - maxRB;
            if (spill > SPILL_THR) g = maxRB + spill * SPILL_KEEP;


            // 3b) si aún queda verde residual, empuja a gris/negro suave (solo borde)
            const spill2 = g - Math.max(r, b);
            if (spill2 > 0) {
                const t = Math.min(1, spill2 / SPILL_MAX);
                const mix = t * EDGE_GRAY;
                const neutral2 = (r + b) * 0.5;
                r = r * (1 - mix) + neutral2 * mix;
                g = g * (1 - mix) + neutral2 * mix;
                b = b * (1 - mix) + neutral2 * mix;

                const dark = 1 - mix * EDGE_DARKEN;
                r *= dark; g *= dark; b *= dark;
            }
            // 4) neutraliza borde hacia gris suave
            const neutral = (r + b) * 0.5;
            r = r * (1 - NEUTRAL_BLEND) + neutral * NEUTRAL_BLEND;
            g = g * (1 - NEUTRAL_BLEND) + neutral * NEUTRAL_BLEND;
            b = b * (1 - NEUTRAL_BLEND) + neutral * NEUTRAL_BLEND;

            // 5) light wrap hacia el rojo del fondo
            const an2 = a / 255;
            const wrap = (1 - an2) * WRAP;
            r = r * (1 - wrap) + bgR * wrap;
            g = g * (1 - wrap) + bgG * wrap;
            b = b * (1 - wrap) + bgB * wrap;
        }

        // Núcleo (alpha=255): despill + gris/negro suave si hay verde dominante (conservador)
        if (a === 255) {
            const maxRBc = Math.max(r, b);
            const spillc = g - maxRBc;
            // condición extra: verde claramente dominante (evita tocar tonos normales)
            if (spillc > SPILL_THR && g > r + 2 && g > b + 2) {
                g = maxRBc + spillc * SPILL_KEEP_CORE;

                const t = Math.min(1, spillc / SPILL_MAX);
                const mix = t * CORE_GRAY;
                const neutralc = (r + b) * 0.5;

                r = r * (1 - mix) + neutralc * mix;
                g = g * (1 - mix) + neutralc * mix;
                b = b * (1 - mix) + neutralc * mix;

                const dark = 1 - mix * CORE_DARKEN;
                r *= dark; g *= dark; b *= dark;
            }
        }

        data[i] = clamp255(r) | 0;
        data[i + 1] = clamp255(g) | 0;
        data[i + 2] = clamp255(b) | 0;
        data[i + 3] = a;
    }

    ctx.putImageData(imageData, 0, 0);

    state.renderReq = requestAnimationFrame(renderFrame);
}

/* =========================
   Camera start/stop
========================= */

async function startCamera() {
    try {
        setCaptureEnabled(false);
        showCameraStatus("Activando cámara…", { kind: "info" });

        const stream = await navigator.mediaDevices.getUserMedia({
            video: {
                facingMode: "user",
                width: { ideal: 1920, max: 1920 },  // tu cámara es 1080p: pedimos 1920×1080 para evitar fallback a 640×480
                height: { ideal: 1080, max: 1080 },
                frameRate: { ideal: 30, max: 30 },
            },
            audio: false,
        })

        state.stream = stream;
        el.camera.srcObject = stream;
        el.camera.play?.();

        state.hasFrame = false;
        state.frameIdx = 0;
        state.keyRGB = { r: CHROMA.r, g: CHROMA.g, b: CHROMA.b };

        if (el.cameraCanvas) el.cameraCanvas.style.visibility = "hidden";
        hideCameraStatus();

        return true;
    } catch (err) {
        console.error(err);
        showCameraStatus("No se pudo abrir la cámara. Revisa permisos.", { kind: "error", pulse: true });
        setCaptureEnabled(false);
        return false;
    }
}

function stopCamera() {
    const s = state.stream;
    if (!s) return;

    s.getTracks().forEach((t) => t.stop());
    state.stream = null;
    state.hasFrame = false;

    if (el.cameraCanvas) el.cameraCanvas.style.visibility = "hidden";
    if (el.camera) el.camera.srcObject = null;

    stopRenderLoop();
}

/* =========================
   Views
========================= */

async function setView(next) {
    if (state.view === "capture" && next !== "capture") { stopCamera(); stopCaptureLayoutSync(); }
    if (state.view === "send" && next !== "send") { stopRedirect(); stopQrReturn(); }

    const activeEl = document.activeElement;
    if (activeEl && activeEl !== document.body) activeEl.blur?.();

    document.querySelectorAll(".view").forEach((v) => {
        const isActive = v.dataset.view === next;
        v.classList.toggle("is-active", isActive);
        v.setAttribute("aria-hidden", String(!isActive));
        v.setAttribute("tabindex", "-1");
    });

    state.view = next;

    if (next === "home") {
        closeModal();
        stopRenderLoop();
        stopCamera();
        stopCountdown();
        state.photoDataUrl = "";
        if (el.photoPreview) el.photoPreview.src = "data:,";
        if (el.qrOverlay) el.qrOverlay.classList.add("is-hidden");
        hideCameraStatus();
    }

    if (next === "capture") {
        ensureProgressRing();
        ensureCountdownDom();

        // ✅ Capa de tuning persistente (venue-ready)
        applyCaptureTune(loadCaptureTune());
        exposeTuneApi();

        updateGlassesGuide();
        startCaptureLayoutSync();

        if (UX.cinematicCss && el.cameraCanvas) el.cameraCanvas.classList.add("is-cinematic");

        const ok = await startCamera();
        if (!ok) {
            stopRenderLoop();
            stopCountdown();
            return; // evita deadlock si no hay permisos/stream
        }

        await waitVideoReady(el.camera);

        // Warm-up MediaPipe (no bloquea la UI). Si falla, seguimos igual.
        // Esto evita que la primera captura tenga “lag” por cargar wasm/model.
        initHeadSegmenter();

        state.hasFrame = false;
        setCaptureEnabled(false);
        if (el.cameraCanvas) el.cameraCanvas.style.visibility = "hidden";
        showCameraStatus("Alinea tu cara con el círculo.", { kind: "info" });

        stopRenderLoop();
        state.lastRenderTs = 0;
        state.renderReq = requestAnimationFrame(renderFrame);

        stopCountdown();

        if (el.qrOverlay) el.qrOverlay.classList.add("is-hidden");
    }

    if (next === "send") {
        el.photoPreview.src = state.photoDataUrl || "";
        stopRedirect();
        state.redirectTimer = setTimeout(() => {
            el.stage.classList.add("dim-out");
            setTimeout(() => {
                pauseIdle(); // P1: dentro del iframe no hay bumpIdle()

                if (el.externalFrame && EXTERNAL_URL) {
                    const cur = el.externalFrame.getAttribute("src") || "";
                    if (!cur || cur === "about:blank") el.externalFrame.src = EXTERNAL_URL;
                }

                if (el.externalModal) el.externalModal.classList.remove("is-hidden");
                if (el.qrOverlay) el.qrOverlay.classList.remove("is-hidden"); // mostrar QR mientras está el iframe
            }, 700);
        }, 5000);
    }

    document.querySelector(".view.is-active")?.focus?.({ preventScroll: true });
}

/* =========================
   Pantalla 3: recorte cabeza + gafas
========================= */


function getElemRectPx(elem, canvasEl) {
    if (!elem || !canvasEl) return null;
    // si está oculto por clase o no tiene tamaño, ignoramos
    if (elem.classList.contains("is-hidden")) return null;

    const er = elem.getBoundingClientRect();
    const vr = canvasEl.getBoundingClientRect();
    if (!vr.width || !vr.height || !er.width || !er.height) return null;

    const x = ((er.left - vr.left) / vr.width) * canvasEl.width;
    const y = ((er.top - vr.top) / vr.height) * canvasEl.height;
    const w = (er.width / vr.width) * canvasEl.width;
    const h = (er.height / vr.height) * canvasEl.height;

    return { x, y, w, h, cx: x + w / 2, cy: y + h / 2 };
}

function getGuideCirclePx() {
    const circle = document.querySelector(".capture-circle");
    const canvas = el.cameraCanvas;
    if (!circle || !canvas) return null;

    const rect = getElemRectPx(circle, canvas);
    if (!rect) return null;

    // usamos el diámetro visual del círculo como referencia (en px de canvas)
    const r = Math.min(rect.w, rect.h) / 2;
    return { cx: rect.cx, cy: rect.cy, r };
}

function getGlassesGuidePx() {
    // guía opcional: si no existe, usamos GLASSES_FIT como fallback
    const canvas = el.cameraCanvas;
    const g = el.glassesGuide;
    if (!g || !canvas) return null;
    return getElemRectPx(g, canvas);
}

function extractHeadCanvas(previewCanvas) {
    const guide = getGuideCirclePx();

    const cut = document.createElement("canvas");
    cut.width = HEAD.size;
    cut.height = HEAD.size;

    const ctx = cut.getContext("2d", { alpha: true });
    ctx.clearRect(0, 0, cut.width, cut.height);
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = "high";

    // Fallback si por lo que sea no medimos la guía (DOM no listo)
    const fallbackR = Math.min(previewCanvas.width, previewCanvas.height) * 0.18;
    const cx = guide ? guide.cx : previewCanvas.width * 0.5;
    const cy = guide ? guide.cy : previewCanvas.height * 0.40;
    const r = guide ? guide.r : fallbackR;

    // Crop cuadrado que respeta la guía: lo que el usuario ve = lo que se compone
    let crop = Math.round(r * 2 * COMPOSE.pad);
    crop = Math.max(2, Math.min(crop, previewCanvas.width, previewCanvas.height));

    let sx = Math.round(cx - crop / 2);
    let sy = Math.round(cy - crop / 2);

    // clamp sin recortar (mueve la ventana dentro del frame)
    sx = Math.max(0, Math.min(sx, previewCanvas.width - crop));
    sy = Math.max(0, Math.min(sy, previewCanvas.height - crop));

    ctx.drawImage(previewCanvas, sx, sy, crop, crop, 0, 0, cut.width, cut.height);
    // Máscara circular (opcional). Si usas MediaPipe, déjalo OFF.
    if (COMPOSE.useCircleMask) {
    
    
        // Máscara circular (poster actual ya lo trata como círculo)
        ctx.save();
        ctx.globalCompositeOperation = "destination-in";
        ctx.beginPath();
        ctx.arc(cut.width / 2, cut.height / 2, (cut.width / 2) * COMPOSE.maskScale, 0, Math.PI * 2);
        ctx.closePath();
        ctx.fill();
        ctx.restore();
    }

    // guardamos mapping para mapear la guía de gafas a esta composición
    state.lastCrop = { sx, sy, sw: crop, sh: crop, out: cut.width };

    return cut;
}


function mapRectToHeadCrop(rect, crop) {
    if (!rect || !crop || !Number.isFinite(crop.sx) || !Number.isFinite(crop.sw) || !Number.isFinite(crop.out)) return null;
    const s = crop.out / crop.sw;
    const x = (rect.x - crop.sx) * s;
    const y = (rect.y - crop.sy) * s;
    const w = rect.w * s;
    const h = rect.h * s;
    const cx = (rect.cx - crop.sx) * s;
    const cy = (rect.cy - crop.sy) * s;
    if (![x,y,w,h,cx,cy].every(Number.isFinite)) return null;
    return { x, y, w, h, cx, cy };
}

function guideCircleForHeadCanvas(headCanvas) {
    // Guía “virtual” en el headCanvas: centro + radio ~ tamaño del recorte
    const r = Math.min(headCanvas.width, headCanvas.height) * 0.48;
    return { cx: headCanvas.width * 0.5, cy: headCanvas.height * 0.5, r };
}


function drawGlassesOnHead(headCanvas, caretaId, glassesImg, guideInHead = null) {
    if (!headCanvas || !glassesImg) return;

    const ctx = headCanvas.getContext("2d", { alpha: true });

    const aspect = (glassesImg.width && glassesImg.height) ? (glassesImg.width / glassesImg.height) : 2;

    // Si tenemos guía real en Pantalla 2, mandamos con eso (P0: guía que impacta de verdad)
    if (COMPOSE.useGlassesGuide && guideInHead && Number.isFinite(guideInHead.cx) && Number.isFinite(guideInHead.cy) && Number.isFinite(guideInHead.w) && guideInHead.w > 4) {
        const targetW = guideInHead.w;
        const targetH = targetW / aspect;

        // opcional: pequeña rotación por careta (si algún día lo necesitáis)
        const fit = GLASSES_FIT[caretaId] || { r: 0 };
        ctx.save();
        ctx.translate(guideInHead.cx, guideInHead.cy);
        ctx.rotate(((fit.r || 0) * Math.PI) / 180);
        ctx.drawImage(glassesImg, -targetW / 2, -targetH / 2, targetW, targetH);
        ctx.restore();
        return;
    }

    // Fallback: comportamiento antiguo (por si no existe guía o falla el DOM)
    const fit = GLASSES_FIT[caretaId] || { x: 0.5, y: 0.47, s: 0.8, r: 0 };
    const targetW = headCanvas.width * fit.s;
    const targetH = targetW / aspect;

    const x = headCanvas.width * fit.x;
    const y = headCanvas.height * fit.y;

    ctx.save();
    ctx.translate(x, y);
    ctx.rotate((fit.r * Math.PI) / 180);
    ctx.drawImage(glassesImg, -targetW / 2, -targetH / 2, targetW, targetH);
    ctx.restore();
}


async function capturePhoto() {
    const preview = el.cameraCanvas;
    if (!preview || !preview.width || !preview.height || !state.hasFrame) {
        showCameraStatus("Aún no hay señal… espera 1s.", { kind: "error", pulse: true });
        throw new Error("NO_CAMERA_FRAME");
    }

    // P0: Pantalla 3 = “head-only” (grande, centrado) usando la guía de la Pantalla 2.
// Objetivo: que #photoPreview sea SOLO la cabeza (sin “lienzo” gigante transparente).
const headCanvas = extractHeadCanvas(preview);

// ✅ Segmentación (pelo/cara/orejas) sobre el headCanvas.
// Nota: el modelo es 256×256 internamente, pero lo escalamos a un headCanvas grande para que la salida sea nítida.
if (HEAD_SEG.enabled) {
    try {
        const headGuide = guideCircleForHeadCanvas(headCanvas);
        const ok = await applyHeadSegmentationToCanvas(headCanvas, headGuide);
        if (!ok) console.warn("[HEAD_SEG] Máscara no aplicada (sin resultados).");
    } catch (e) {
        console.warn("[HEAD_SEG] Falló la máscara; seguimos con el recorte.", e);
    }
}

const careta = state.selectedCareta || CARETAS[0];
const glassesImg = await getGlassesImage(careta);

// Guía DOM → preview px → head px (lo que alineas es lo que exportas).
const gpx = getGlassesGuidePx();
const guideInHead = (gpx && state.lastCrop) ? mapRectToHeadCrop(gpx, state.lastCrop) : null;

if (glassesImg) {
    drawGlassesOnHead(headCanvas, careta.id, glassesImg, guideInHead);
}

state.photoDataUrl = headCanvas.toDataURL("image/png");
    setView("send");
}

async function startCaptureSequence() {
    if (state.isCounting) return;

    // Reset visual del botón (evita quedarse “hundido” en algunos touchscreens)
    if (el.captureBtn) {
        el.captureBtn.classList.remove("is-pressed");
        el.captureBtn.blur?.();
    }

// P0 UX: no iniciar si aún no hay frame
    if (!state.hasFrame) {
        showCameraStatus("Esperando señal de cámara…", { kind: "info", pulse: true });
        setCaptureEnabled(false);
        return;
    }

    state.isCounting = true;
    setCaptureEnabled(false);

    try {
        const ok = await runCountdown();
        if (!ok) return; // cancelado (p.ej. cambio de vista)
        await capturePhoto();
    } catch (err) {
        console.error(err);
    } finally {
        stopCountdown();
        state.isCounting = false;
        if (state.view === "capture" && state.hasFrame) setCaptureEnabled(true);
    }
}

/* =========================
   Events
========================= */

document.addEventListener("click", (e) => {
    const btn = e.target.closest("[data-action]");
    if (!btn) return;

    bumpIdle();

    const a = btn.dataset.action;

    if (a === "start") {
        const id = btn.dataset.caretaId;
        const found = CARETAS.find((c) => c.id === id);
        if (found) state.selectedCareta = found;
        setView("capture");
    }

    if (a === "home") setView("home");
    if (a === "capture") startCaptureSequence().catch(console.error);
    if (a === "retake") setView("capture");

    if (a === "close-modal") {
        closeModal({ keepQR: true, keepDim: true });
    }
});

// Click en el canvas (solo captura) para fijar key color manual
el.cameraCanvas?.addEventListener("pointerdown", (e) => {
    if (state.view !== "capture") return;
    // Exige Alt para evitar fijar key por accidente
    if (!e.altKey) return;
    sampleKeyColorAtCanvasPoint(e.clientX, e.clientY);
});

document.addEventListener("pointerdown", bumpIdle, { passive: true });
document.addEventListener("keydown", bumpIdle);

document.addEventListener("contextmenu", (e) => e.preventDefault());

document.addEventListener("visibilitychange", () => {
    if (document.hidden) stopRenderLoop();
    else if (state.view === "capture") state.renderReq = requestAnimationFrame(renderFrame);
});

/* =========================
   Init
========================= */

window.addEventListener("resize", scaleStage);
initCaptureButtonUX();
initQrButtonUX();
exposeTuneApi();
applyCaptureTune(loadCaptureTune());
scaleStage();
bumpIdle();
