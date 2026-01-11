/* Kiosk SPA — 1 HTML, 3 views (Home / Capture / Send) */

// Build stamp (para evitar “estoy editando el archivo equivocado”)
const BUILD_ID = "KIOSK_noScale_v2";
console.info("[KIOSK] build:", BUILD_ID);

const APP = {
    baseW: 1080,
    baseH: 1920,
    idleMs: 30_000,
    autoAdvanceMs: 220,
    apiEndpoint: "http://localhost:8001",
};

// Render / calidad
const CAM = {
    maxW: 2160,
    maxH: 3840,
    dprCap: 1,        // 1 = estable; 2 = más nítido (más CPU)
    forceDpr: null    // ✅ si quieres forzar (ej: 2). null = usa devicePixelRatio
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
    size: 1400,
    preset: "normal", // "tight" | "normal" | "loose"
};


// Composición: “lo que ves es lo que sale” (la guía manda)
const COMPOSE = {
    pad: 1.18,          // preview/guías (Pantalla 2) — NO tocar en venue salvo necesidad

    // ✅ SOLO export (Pantalla 3): controla “zoom” del recorte final.
    // + = cara/gafas más pequeñas (más aire) ⇒ más nitidez percibida (menos upscale).
    exportPad: 1.34,

    // ✅ SOLO export: reduce tamaño de las gafas en Pantalla 3 (no toca tu guía)
    glassesScale: 0.90,

    maskScale: 1.0,     // (solo si activas useCircleMask)
    useCircleMask: false,
    useGlassesGuide: true // si existe #glassesGuide, se usa para posicionar las gafas
};

/* =========================
   Recorte por SILUETA (sin MediaPipe)
   - Eliminamos completamente MediaPipe/256×256/segmentación.
   - La máscara final se genera SOLO desde la guía de posicionamiento (Pantalla 2).
   - Importante: la silueta NO debe “verse” en el PNG final.
     Por eso NO usamos el PNG de la guía como máscara; usamos su rect (tamaño/posición)
     y construimos una máscara geométrica (elipse rellena).
========================= */

const GUIDE_MASK = {
    enabled: true,
    // Selector del elemento que define la guía en Pantalla 2 (solo usamos su rect)
    selector: ".capture-circle",

    // ✅ Feather real del borde (en px de canvas del recorte).
    // 0 = borde duro, 8–16 = recomendado (según look).
    featherPx: 8,  // ✅ Reducido de 14 a 8 (menos difuminado)

    // ✅ Tamaño/forma del óvalo (ajustes finos)
    inset: 0.94,  // ✅ Reducido de 1.00 a 0.94 (óvalo MÁS GRANDE, recorta menos)
    grow: 1.40,   // ✅ Aumentado de 1.18 a 1.22 (expande aún más el óvalo)
    yShift: 0     // px (por si quieres subir/bajar la máscara en el póster)
};

function applyGuideMaskToHeadCanvas(headCanvas, previewCanvas) {
    if (!GUIDE_MASK.enabled) return false;
    if (!headCanvas || !previewCanvas) return false;

    const elGuide = document.querySelector(GUIDE_MASK.selector);
    if (!elGuide) return false;

    // Rect de la guía medido en px de canvas (preview)
    const rectPx = getElemRectPx(elGuide, previewCanvas);
    if (!rectPx || !state.lastCrop) return false;

    // Rect de guía remapeado al headCanvas (crop exportado)
    const rectInHead = mapRectToHeadCrop(rectPx, state.lastCrop);
    if (!rectInHead) return false;

    const w = headCanvas.width;
    const h = headCanvas.height;

    // Centro + radios “base” (oval)
    let cx = rectInHead.cx;
    let cy = rectInHead.cy + (GUIDE_MASK.yShift || 0);

    const inset = (GUIDE_MASK.inset || 1);
    const grow = (GUIDE_MASK.grow || 1);

    let rx = (rectInHead.w * 0.5) * inset * grow;
    let ry = (rectInHead.h * 0.5) * inset * grow;

    // ✅ Anti-clipping: si la elipse se sale del canvas, se vería “corte recto” abajo/arriba.
    // Dejamos margen extra para que el blur (feather) no se recorte.
    const feather = Math.max(0, GUIDE_MASK.featherPx | 0);
    const margin = feather * 2 + 4;

    const maxRx = Math.max(2, Math.min(cx - margin, (w - cx) - margin));
    const maxRy = Math.max(2, Math.min(cy - margin, (h - cy) - margin));

    const sx = maxRx / Math.max(1e-6, rx);
    const sy = maxRy / Math.max(1e-6, ry);
    const s = Math.min(1, sx, sy);

    rx *= s;
    ry *= s;

    // 1) Creamos máscara en un canvas aparte (solo alpha)
    const mask = document.createElement("canvas");
    mask.width = w;
    mask.height = h;
    const mctx = mask.getContext("2d", { alpha: true });

    mctx.clearRect(0, 0, w, h);
    mctx.imageSmoothingEnabled = true;
    mctx.imageSmoothingQuality = "high";

    // Elipse sólida
    mctx.fillStyle = "#000";
    mctx.beginPath();
    mctx.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2);
    mctx.closePath();
    mctx.fill();

    // 2) Feather: blur SOLO la máscara (no la foto)
    let maskToUse = mask;
    if (feather > 0) {
        const tmp = document.createElement("canvas");
        tmp.width = w;
        tmp.height = h;
        const tctx = tmp.getContext("2d", { alpha: true });

        tctx.clearRect(0, 0, w, h);
        tctx.filter = `blur(${feather}px)`;
        tctx.drawImage(mask, 0, 0);
        tctx.filter = "none";

        maskToUse = tmp;
    }

    // 3) Aplicamos la máscara al headCanvas
    const ctx = headCanvas.getContext("2d", { alpha: true });
    ctx.save();
    ctx.globalCompositeOperation = "destination-in";
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(maskToUse, 0, 0);
    ctx.restore();

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

function getSendTuneScope() {
    return document.querySelector('.view[data-view="send"]') || document.documentElement;
}

function applyCaptureTune(tune = {}) {
    const capScope = getCaptureTuneScope();
    const sendScope = getSendTuneScope();
    const fallback = document.documentElement;
    if (!capScope && !sendScope) return;

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

        // Cámara (preview) — mover/escala sin tocar código (NO-SCALE por defecto: camS=1)
        camX: "--cam-x",
        camY: "--cam-y",
        camS: "--cam-s",

        // Marco del preview (solo visual)
        camFrameR: "--cam-frame-r",


        // ✅ Cámara (preview) — mover/zoom del “cuadro” sin tocar código
        camX: "--cam-x",
        camY: "--cam-y",
        camS: "--cam-s",

        // Aliases “humanos”
        cameraX: "--cam-x",
        cameraY: "--cam-y",
        cameraS: "--cam-s",
        camScale: "--cam-s",

        // ✅ Pantalla 3 (Poster) — mover/escala del recorte final
        sendX: "--send-x",
        sendY: "--send-y",
        sendS: "--send-s",

        // Aliases
        posterX: "--send-x",
        posterY: "--send-y",
        posterS: "--send-s",
        headX: "--send-x",
        headY: "--send-y",
        headS: "--send-s",
    };

    for (const [k, cssVar] of Object.entries(map)) {
        if (tune[k] === undefined) continue;

        const target =
            cssVar.startsWith("--send-")
                ? (sendScope || capScope || fallback)
                : (capScope || fallback);

        if (tune[k] === null) {
            target.style.removeProperty(cssVar);
        } else {
            target.style.setProperty(cssVar, String(tune[k]));
        }
    }

    // Resync inmediato (si mueves variables “en caliente” quieres feedback ya)
    requestAnimationFrame(() => {
        if (capScope) {
            syncGlassesGuideToCircle();
            positionProgressRing();
        }
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
        // Helpers “rápidos” para la cámara (preview)
        cam(patch = {}) {
            const out = {};
            if (patch.x !== undefined) out.camX = (typeof patch.x === "number") ? `${patch.x}px` : String(patch.x);
            if (patch.y !== undefined) out.camY = (typeof patch.y === "number") ? `${patch.y}px` : String(patch.y);
            if (patch.s !== undefined) out.camS = (typeof patch.s === "number") ? patch.s : parseFloat(patch.s);
            if (patch.r !== undefined) out.camFrameR = (typeof patch.r === "number") ? `${patch.r}px` : String(patch.r);
            return this.set(out);
        },
        camNudge(dx = 0, dy = 0, ds = 0) {
            const cur = this.get();
            const px = (v) => (v == null) ? 0 : parseFloat(String(v)) || 0;
            const next = {
                camX: `${px(cur.camX) + dx}px`,
                camY: `${px(cur.camY) + dy}px`,
                camS: Math.max(0.1, (parseFloat(cur.camS) || 1) + ds),
            };
            return this.set(next);
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
                    "--cam-x", "--cam-y", "--cam-s",
                    "--cam-frame-r",
                ].forEach((v) => scope.style.removeProperty(v));
            }

            const sendScope = getSendTuneScope();
            if (sendScope) {
                ["--send-x", "--send-y", "--send-s"].forEach((v) => sendScope.style.removeProperty(v));
            }

            requestAnimationFrame(() => syncGlassesGuideToCircle());
            return {};
        },
        // Atajos “tipo producción” para calibrar rápido desde consola
        cam({ x, y, s } = {}) {
            const patch = {};
            if (x !== undefined) patch.camX = x;
            if (y !== undefined) patch.camY = y;
            if (s !== undefined) patch.camS = s;
            return this.set(patch);
        },
        poster({ x, y, s } = {}) {
            const patch = {};
            if (x !== undefined) patch.sendX = x;
            if (y !== undefined) patch.sendY = y;
            if (s !== undefined) patch.sendS = s;
            return this.set(patch);
        },
        // Debug rápido: valores efectivos (CSS vars) ya resueltos
        read() {
            const cap = getCaptureTuneScope() || document.documentElement;
            const send = getSendTuneScope() || cap;
            const r = (el, v) => getComputedStyle(el).getPropertyValue(v).trim();
            return {
                capX: r(cap, "--cap-x"),
                capY: r(cap, "--cap-y"),
                capCircleW: r(cap, "--cap-circle-w"),
                camX: r(cap, "--cam-x"),
                camY: r(cap, "--cam-y"),
                camS: r(cap, "--cam-s"),
                sendX: r(send, "--send-x"),
                sendY: r(send, "--send-y"),
                sendS: r(send, "--send-s"),
            };
        },
        help() {
            console.info(
                "[KIOSK_TUNE] Ejemplos:\n" +
                "KIOSK_TUNE.cam({ x: '0px', y: '0px', s: 1 })\n" +
                "KIOSK_TUNE.poster({ x: '0px', y: '0px', s: 1 })\n" +
                "KIOSK_TUNE.set({ capCircleW: '320px' })\n" +
                "KIOSK_TUNE.reset()"
            );
            return this.read();
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
    qrOverlay: document.getElementById("qrOverlay"),
    qrImage: document.getElementById("qrImage"),
    glassesGuide: document.getElementById("glassesGuide"),
    captureBtn: document.querySelector(".capture-btn"),
};

const state = {
    view: "home",
    selectedCareta: CARETAS[0],

    stream: null,
    photoDataUrl: "",
    shareUrl: "",
    uploadInFlight: null,

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

    // auto-capture
    autoCaptureTimer: null,
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

function stopAutoCapture() {
    clearTimeout(state.autoCaptureTimer);
    state.autoCaptureTimer = null;
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

/* =========================
   Share (Upload CDN) + QR
   - La app es 100% front (HTML/JS). Las credenciales NO van aquí.
   - Este módulo asume un backend (Python) en /api/upload_snapshot que:
       POST { image_data: "data:image/png;base64,...", folder?: "snapshots-aida", filename?: "..." }
       -> { success: true, url: "https://<cdn>/snapshots-aida/xxx.png" }
========================= */

// QR: usamos qrserver (simple y sin SDKs)
function generateQRUrl(url, size = 420) {
    return `https://api.qrserver.com/v1/create-qr-code/?size=${size}x${size}&data=${encodeURIComponent(url)}`;
}

function makeQrFallbackSvg(message = "UPLOAD FAILED") {
    const safe = String(message).replace(/[<>&"]/g, (m) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", '"': "&quot;" }[m]));
    const svg = `
<svg xmlns="http://www.w3.org/2000/svg" width="800" height="800">
  <rect width="100%" height="100%" fill="white"/>
  <rect x="40" y="40" width="720" height="720" fill="none" stroke="black" stroke-width="18"/>
  <text x="50%" y="46%" text-anchor="middle" font-family="system-ui, -apple-system, Segoe UI, Roboto, Arial" font-size="52" font-weight="800" fill="black">${safe}</text>
  <text x="50%" y="56%" text-anchor="middle" font-family="system-ui, -apple-system, Segoe UI, Roboto, Arial" font-size="28" font-weight="600" fill="black">Reinicia y prueba de nuevo</text>
</svg>`;
    return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}

function apiUrl(path) {
    const base = (APP.apiEndpoint || "").trim().replace(/\/$/, "");
    if (!path.startsWith("/")) path = `/${path}`;
    return base ? `${base}${path}` : path; // relative por defecto
}

async function uploadSnapshotToBackend(dataUrl, { folder = "snapshots-aida", filename = null } = {}) {
    // Evitamos doble upload si el usuario toca "reiniciar" rápido o si entra/sale.
    if (!dataUrl) throw new Error("NO_IMAGE_DATAURL");

    const res = await fetch(apiUrl("/api/snapshot"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ data_url: dataUrl, filename }),
    });

    if (!res.ok) {
        const t = await res.text().catch(() => "");
        throw new Error(`UPLOAD_HTTP_${res.status}: ${t.slice(0, 140)}`);
    }

    const json = await res.json().catch(() => null);
    if (!json || json.success !== true || !json.url) {
        throw new Error("UPLOAD_BAD_RESPONSE");
    }
    return json.url;
}

// =========================
// Fullscreen Poster Export (Pantalla 3)
// - Genera un PNG 1080x1920 con: Fondo + elementos del póster + foto recortada + Marco
// - Esto es lo que se sube al CDN para que el QR descargue "la pantalla entera".
// =========================

function _cssBgToUrl(bgValue) {
    // bgValue: url("...") o none
    const m = /url\((['"]?)(.*?)\1\)/.exec(bgValue || "");
    return m ? m[2] : null;
}

function _waitImgLoaded(imgEl) {
    if (!imgEl) return Promise.reject(new Error("IMG_MISSING"));
    if (imgEl.complete && imgEl.naturalWidth > 0) return Promise.resolve(imgEl);
    return new Promise((resolve, reject) => {
        imgEl.addEventListener("load", () => resolve(imgEl), { once: true });
        imgEl.addEventListener("error", () => reject(new Error("IMG_LOAD_FAIL")), { once: true });
    });
}

function _loadImage(src) {
    return new Promise((resolve, reject) => {
        const img = new Image();
        // Si alguna vez mueves assets a otro dominio, esto evita taint (si el server da CORS).
        img.crossOrigin = "anonymous";
        img.onload = () => resolve(img);
        img.onerror = () => reject(new Error(`IMG_LOAD_FAIL: ${src}`));
        img.src = src;
    });
}

function _getStageScaleFromDOM() {
    // stage está escalado con transform; sacamos scale real desde su tamaño renderizado
    const stage = el.stage;
    if (!stage) return 1;
    const r = stage.getBoundingClientRect();
    // baseW es 1080 fijo
    const s = r.width / APP.baseW;
    return s && isFinite(s) && s > 0 ? s : 1;
}

function _rectToStagePx(domEl) {
    const stage = el.stage;
    if (!stage || !domEl) return null;

    const s = _getStageScaleFromDOM();
    const sr = stage.getBoundingClientRect();
    const r = domEl.getBoundingClientRect();

    return {
        x: (r.left - sr.left) / s,
        y: (r.top - sr.top) / s,
        w: r.width / s,
        h: r.height / s,
    };
}

function _applyElementFilter(ctx, domEl) {
    // Replica filtros tipo drop-shadow
    const cs = getComputedStyle(domEl);
    const f = (cs.filter || "none").trim();
    ctx.filter = f && f !== "none" ? f : "none";
}

function _clipEllipse(ctx, x, y, w, h) {
    ctx.beginPath();
    ctx.ellipse(x + w / 2, y + h / 2, w / 2, h / 2, 0, 0, Math.PI * 2);
    ctx.clip();
}

async function renderSendPosterToDataUrl() {
    // Genera PNG full-screen SOLO cuando estamos en SEND
    if (state.view !== "send") throw new Error("NOT_IN_SEND_VIEW");
    if (!state.photoDataUrl) throw new Error("NO_PHOTO_DATAURL");

    const stage = el.stage;
    if (!stage) throw new Error("NO_STAGE");

    const sendView = document.querySelector('.view[data-view="send"]');
    if (!sendView) throw new Error("NO_SEND_VIEW");

    // Canvas final: 1080x1920 (base)
    const out = document.createElement("canvas");
    out.width = APP.baseW;
    out.height = APP.baseH;

    const ctx = out.getContext("2d", { alpha: true });
    if (!ctx) throw new Error("NO_2D_CTX");

    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = "high";

    // 1) Fondo del stage (Fondo.png desde CSS)
    const stageBg = _cssBgToUrl(getComputedStyle(stage).backgroundImage);
    if (stageBg) {
        const bgImg = await _loadImage(stageBg);
        ctx.filter = "none";
        ctx.drawImage(bgImg, 0, 0, APP.baseW, APP.baseH);
    }

    // 2) Elementos del póster (orden = como se ve)
    const elements = [
        sendView.querySelector(".poster-cines"),
        el.photoPreview, // #photoPreview (recorte)
        sendView.querySelector(".poster-logo"),
        sendView.querySelector(".poster-paco"),
        sendView.querySelector(".poster-logos"),
    ].filter(Boolean);

    for (const domEl of elements) {
        const rect = _rectToStagePx(domEl);
        if (!rect || rect.w <= 0 || rect.h <= 0) continue;

        // Si es <img>, esperamos carga. Si no lo es, skip.
        if (domEl.tagName !== "IMG") continue;

        await _waitImgLoaded(domEl);

        ctx.save();
        _applyElementFilter(ctx, domEl);

        // Para el recorte (photoPreview) replicamos el óvalo (border-radius 999px)
        if (domEl === el.photoPreview) {
            _clipEllipse(ctx, rect.x, rect.y, rect.w, rect.h);
        }

        try {
            ctx.drawImage(domEl, rect.x, rect.y, rect.w, rect.h);
        } catch (e) {
            // Si algún SVG diera guerra, no tiramos la app. Solo lo saltamos.
            console.warn("[POSTER] draw skip:", domEl.src || domEl, e);
        }
        ctx.restore();
    }

    // 3) Marco superior (Marco.png desde CSS)
    const frame = document.querySelector(".frame-overlay");
    if (frame) {
        const frameBg = _cssBgToUrl(getComputedStyle(frame).backgroundImage);
        if (frameBg) {
            const frameImg = await _loadImage(frameBg);
            ctx.filter = "none";
            ctx.drawImage(frameImg, 0, 0, APP.baseW, APP.baseH);
        }
    }

    // PNG final (coherente con tu backend que sube ContentType=image/png)
    return out.toDataURL("image/png");
}

async function ensureShareUrlAndQr() {
    // Solo aplica en pantalla SEND, con foto disponible.
    if (state.view !== "send") return null;
    if (!state.photoDataUrl) return null;

    // Si ya lo tenemos, solo pinta QR.
    if (state.shareUrl) {
        if (el.qrImage) el.qrImage.src = generateQRUrl(state.shareUrl, 520);
        return state.shareUrl;
    }

    // Si hay un upload en curso, lo esperamos.
    if (state.uploadInFlight) {
        try {
            const url = await state.uploadInFlight;
            if (state.view === "send" && el.qrImage) el.qrImage.src = generateQRUrl(url, 520);
            return url;
        } catch (e) {
            // cae a fallback más abajo
        }
    }

    // Disparamos upload.
    state.uploadInFlight = (async () => {
        let payloadDataUrl = state.photoDataUrl;
        try {
            payloadDataUrl = await renderSendPosterToDataUrl(); // ✅ póster full-screen
        } catch (e) {
            console.warn("[POSTER] fallback to head crop:", e);
        }
        const url = await uploadSnapshotToBackend(payloadDataUrl, { folder: "snapshots-aida" });

        state.shareUrl = url;
        return url;
    })();

    try {
        const url = await state.uploadInFlight;
        if (state.view === "send" && el.qrImage) el.qrImage.src = generateQRUrl(url, 520);
        return url;
    } catch (err) {
        console.error("[UPLOAD] fail:", err);
        if (state.view === "send" && el.qrImage) el.qrImage.src = makeQrFallbackSvg("UPLOAD FAILED");
        return null;
    } finally {
        state.uploadInFlight = null;
    }
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


/* =========================
   Camera canvas sizing
========================= */

function resizeCameraCanvas() {
    if (!el.cameraCanvas) return 1;

    // IMPORTANT:
    // - El stage se escala con transform (scaleStage()).
    // - getBoundingClientRect() devuelve tamaño ya escalado (viewport px) y puede bajar a 540×960.
    // - Para calidad, el buffer interno debe respetar el layout 1080×1920 (o más con DPR).
    const cssW = el.cameraCanvas.offsetWidth || el.cameraCanvas.clientWidth || APP.baseW;
    const cssH = el.cameraCanvas.offsetHeight || el.cameraCanvas.clientHeight || APP.baseH;

    const dprNative = window.devicePixelRatio || 1;
    const targetDpr = (CAM.forceDpr != null)
        ? CAM.forceDpr
        : Math.min(CAM.dprCap, dprNative);

    // Nunca permitimos que el buffer sea menor que el layout (evita downsample+upscale → blur)
    let w = Math.round(cssW * targetDpr);
    let h = Math.round(cssH * targetDpr);

    w = Math.min(CAM.maxW, Math.max(Math.round(cssW), w, 1));
    h = Math.min(CAM.maxH, Math.max(Math.round(cssH), h, 1));

    if (el.cameraCanvas.width !== w || el.cameraCanvas.height !== h) {
        el.cameraCanvas.width = w;
        el.cameraCanvas.height = h;
    }

    // DPR efectivo REAL (el que de verdad tiene el canvas ahora mismo)
    const effDprX = cssW ? (el.cameraCanvas.width / cssW) : 1;
    const effDprY = cssH ? (el.cameraCanvas.height / cssH) : 1;
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

    // ✅ “Camera Frame” (tuneable): por defecto 1:1 (sin reescalado).
    // Puedes mover/zoom desde consola con KIOSK_TUNE.set({ camX:'0px', camY:'0px', camS:1 })
    const cw = c.width / dpr;
    const ch = c.height / dpr;

    const tuneScope = getCaptureTuneScope();
    const camX = readCssVarNumber(tuneScope, "--cam-x", 0);
    const camY = readCssVarNumber(tuneScope, "--cam-y", 0);
    const camS = Math.max(0.1, readCssVarNumber(tuneScope, "--cam-s", 1) || 1);

    const dw = Math.round(vw * camS);
    const dh = Math.round(vh * camS);

    const dx = Math.round((cw - dw) / 2 + camX);
    const dy = Math.round((ch - dh) / 2 + camY);

    // Actualiza el marco visual del preview (coords en px CSS del stage)
    try {
        const fx0 = Math.max(0, dx);
        const fy0 = Math.max(0, dy);
        const fx1 = Math.min(cw, dx + dw);
        const fy1 = Math.min(ch, dy + dh);
        const fw = Math.max(0, fx1 - fx0);
        const fh = Math.max(0, fy1 - fy0);

        tuneScope?.style?.setProperty("--cam-frame-x", `${Math.round(fx0)}px`);
        tuneScope?.style?.setProperty("--cam-frame-y", `${Math.round(fy0)}px`);
        tuneScope?.style?.setProperty("--cam-frame-w", `${Math.round(fw)}px`);
        tuneScope?.style?.setProperty("--cam-frame-h", `${Math.round(fh)}px`);
    } catch { /* noop */ }


    ctx.save();
    // Si no escalas (camS=1), mejor sin smoothing. Si escalas, pedimos calidad “high”.
    ctx.imageSmoothingEnabled = camS !== 1;
    ctx.imageSmoothingQuality = "high";
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, cw, ch);

    // Fondo sólido por si quedan bandas (no afecta a la transparencia del chroma)
    ctx.fillStyle = `rgb(${BG_RGB[0]}, ${BG_RGB[1]}, ${BG_RGB[2]})`;
    ctx.fillRect(0, 0, cw, ch);

    // Dibujo (con tune opcional)
    ctx.drawImage(v, 0, 0, vw, vh, dx, dy, dw, dh);
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

        // ✅ Solicitar resolución PORTRAIT nativa (evita escalado)
        // Primero intenta alta resolución portrait, luego fallback a resolución media
        const hi = {
            video: {
                facingMode: "user",
                width: { ideal: 1080, min: 720, max: 1920 },   // Portrait: ancho menor
                height: { ideal: 1920, min: 1280, max: 3840 }, // Portrait: alto mayor
                frameRate: { ideal: 30, max: 30 },
            },
            audio: false,
        };

        const lo = {
            video: {
                facingMode: "user",
                width: { ideal: 720, min: 640 },   // Fallback: 720p portrait
                height: { ideal: 1280, min: 480 }, // Fallback: 720p portrait
                frameRate: { ideal: 30, max: 30 },
            },
            audio: false,
        };

        let stream = null;

        try {
            stream = await navigator.mediaDevices.getUserMedia(hi);
        } catch (e) {
            console.warn("[CAM] 4K no disponible, fallback a 1080p.", e);
            stream = await navigator.mediaDevices.getUserMedia(lo);
        }

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
    if (state.view === "capture" && next !== "capture") { stopCamera(); stopCaptureLayoutSync(); stopAutoCapture(); }
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
        // Limpiar timers y ocultar QR
        stopRedirect();
        stopQrReturn();
        el.stage.classList.remove("dim-out");
        if (el.qrOverlay) el.qrOverlay.classList.add("is-hidden");
        resumeIdle();

        stopRenderLoop();
        stopCamera();
        stopCountdown();
        state.photoDataUrl = "";
        state.shareUrl = "";
        state.uploadInFlight = null;
        if (el.photoPreview) el.photoPreview.src = "data:,";
        if (el.qrImage) el.qrImage.src = "data:,";
        if (el.qrOverlay) el.qrOverlay.classList.add("is-hidden");
        hideCameraStatus();
    }

    if (next === "capture") {
        ensureProgressRing();
        ensureCountdownDom();

        // ✅ Capa de tuning persistente (venue-ready)
        applyCaptureTune(loadCaptureTune());
        exposeTuneApi();

        // Si vienes de un build anterior con valores guardados, puede quedar todo “descentrado”.
        // Para evitarlo, limpiamos el tune si cambia el BUILD_ID.
        (function tuneBuildGuard() {
            const key = "KIOSK_TUNE_BUILD_ID";
            try {
                const prev = localStorage.getItem(key);
                if (prev !== BUILD_ID) {
                    localStorage.setItem(key, BUILD_ID);
                    localStorage.removeItem(CAPTURE_TUNE.storageKey);
                }
            } catch { }
        })();


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

        // Sin segmentación externa: el recorte final se hace por silueta (Pantalla 2).

        state.hasFrame = false;
        setCaptureEnabled(false);
        if (el.cameraCanvas) el.cameraCanvas.style.visibility = "hidden";
        showCameraStatus("Alinea tu cara con el círculo.", { kind: "info" });

        stopRenderLoop();
        state.lastRenderTs = 0;
        state.renderReq = requestAnimationFrame(renderFrame);

        stopCountdown();

        if (el.qrOverlay) el.qrOverlay.classList.add("is-hidden");

        // ✅ AUTO-CAPTURE: Espera 2 segundos y dispara automáticamente
        stopAutoCapture();
        state.autoCaptureTimer = setTimeout(() => {
            if (state.view === "capture" && state.hasFrame && !state.isCounting) {
                startCaptureSequence().catch(console.error);
            }
        }, 2000);
    }

    if (next === "send") {
        el.photoPreview.src = state.photoDataUrl || "";
        stopRedirect();

        // ✅ Subida al CDN + QR (arranca ya, para llegar a tiempo al overlay)
        ensureShareUrlAndQr();

        // Después de 5 segundos: oscurecer y mostrar QR
        state.redirectTimer = setTimeout(() => {
            el.stage.classList.add("dim-out");

            setTimeout(() => {
                pauseIdle(); // Pausar idle mientras está el QR

                // Mostrar QR cuando esté listo (o fallback), sin bloquear UI
                (async () => {
                    // Asegura que el QR tenga algo (URL o fallback SVG)
                    await ensureShareUrlAndQr();

                    if (el.qrOverlay) el.qrOverlay.classList.remove("is-hidden");
                })().catch((e) => {
                    console.error("[QR] fail:", e);
                    if (el.qrImage) el.qrImage.src = makeQrFallbackSvg("QR ERROR");
                    if (el.qrOverlay) el.qrOverlay.classList.remove("is-hidden");
                });

                // Después de 22 segundos con QR, volver a home
                state.qrReturnTimer = setTimeout(() => {
                    el.stage.classList.remove("dim-out");
                    if (el.qrOverlay) el.qrOverlay.classList.add("is-hidden");
                    resumeIdle();
                    setView("home");
                }, 22_000);
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

function getGuideCirclePx(canvasEl = el.cameraCanvas) {
    const circle = document.querySelector(".capture-circle");
    if (!circle || !canvasEl) return null;

    const rect = getElemRectPx(circle, canvasEl);
    if (!rect) return null;

    // usamos el diámetro visual del círculo como referencia (en px de canvas)
    const r = Math.min(rect.w, rect.h) / 2;
    return { cx: rect.cx, cy: rect.cy, r };
}

function getGlassesGuidePx(canvasEl = el.cameraCanvas) {
    // guía opcional: si no existe, usamos GLASSES_FIT como fallback
    const g = el.glassesGuide;
    if (!g || !canvasEl) return null;
    return getElemRectPx(g, canvasEl);
}

function makeMirroredCanvas(srcCanvas) {
    const c = document.createElement("canvas");
    c.width = srcCanvas.width;
    c.height = srcCanvas.height;

    const ctx = c.getContext("2d", { alpha: true, willReadFrequently: false });
    if (!ctx) throw new Error("NO_2D_CTX_MIRROR");

    ctx.clearRect(0, 0, c.width, c.height);
    ctx.save();
    ctx.translate(c.width, 0);
    ctx.scale(-1, 1);
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(srcCanvas, 0, 0);
    ctx.restore();

    return c;
}

function extractHeadCanvas(srcCanvas, uiCanvas = el.cameraCanvas) {
    // IMPORTANTE:
    // - El buffer del canvas NO está espejado. El espejo lo hace CSS: #cameraCanvas { transform: scaleX(-1) }
    // - La guía (círculo) está en coordenadas “de pantalla” (lo que ve el usuario).
    // - Para que la exportación coincida con el preview, recortamos desde el buffer real,
    //   pero convirtiendo X a “espacio real” y exportando el crop ya espejado.

    const guide = getGuideCirclePx(uiCanvas);

    // Fallback si por lo que sea no medimos la guía (DOM no listo)
    const fallbackR = Math.min(srcCanvas.width, srcCanvas.height) * 0.18;

    // Coordenadas “UI” (lo que mide el DOM sobre el canvas)
    const cxUI = guide ? guide.cx : srcCanvas.width * 0.5;
    const cyUI = guide ? guide.cy : srcCanvas.height * 0.44;
    const r = guide ? guide.r : fallbackR;

    // ✅ Crop en px del canvas (buffer real)
    const desiredCrop = Math.max(32, Math.round(r * 2 * (COMPOSE.exportPad || 1)));
    const crop = Math.min(desiredCrop, srcCanvas.width, srcCanvas.height);

    // ✅ NO reescalamos: 1:1 (lo que hay dentro del crop sale tal cual)
    const out = crop;

    // Crop clamp en “espacio UI”
    const sxUI = Math.round(cxUI - crop / 2);
    const syUI = Math.round(cyUI - crop / 2);

    const sxUIClamped = Math.max(0, Math.min(srcCanvas.width - crop, sxUI));
    const syUIClamped = Math.max(0, Math.min(srcCanvas.height - crop, syUI));

    // Convertimos X al “espacio real” (buffer no espejado)
    // UI (espejado) -> SRC (real): x_src = W - (x_ui + w)
    const sxSrc = Math.round(srcCanvas.width - (sxUIClamped + crop));
    const sySrc = syUIClamped;

    const cut = document.createElement("canvas");
    cut.width = out;
    cut.height = out;

    const ctx = cut.getContext("2d", { alpha: true, willReadFrequently: false });
    if (!ctx) throw new Error("NO_2D_CTX_CUT");

    ctx.clearRect(0, 0, cut.width, cut.height);

    // No hay scaling (out === crop), pero sí espejo. Mejor evitar “softening”.
    ctx.imageSmoothingEnabled = false;

    // Dibujamos ya espejado para que el resultado sea 1:1 con el preview
    ctx.save();
    ctx.translate(out, 0);
    ctx.scale(-1, 1);
    ctx.drawImage(
        srcCanvas,
        sxSrc, sySrc, crop, crop,
        0, 0, out, out
    );
    ctx.restore();

    // guardamos mapping para mapear guías (en coords del UI canvas) a este crop
    // (IMPORTANTE: sx/sy en espacio UI, porque ahí medimos la guía con DOM)
    state.lastCrop = { sx: sxUIClamped, sy: syUIClamped, sw: crop, sh: crop, out };

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
    if (![x, y, w, h, cx, cy].every(Number.isFinite)) return null;
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
        const targetW = guideInHead.w * (COMPOSE.glassesScale ?? 1);
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
    const targetW = headCanvas.width * fit.s * (COMPOSE.glassesScale ?? 1);
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
    const uiCanvas = el.cameraCanvas;
    if (!uiCanvas || !uiCanvas.width || !uiCanvas.height || !state.hasFrame) {
        showCameraStatus("Aún no hay señal… espera 1s.", { kind: "error", pulse: true });
        throw new Error("NO_CAMERA_FRAME");
    }

    const careta = state.selectedCareta || CARETAS[0];
    const glassesImg = await getGlassesImage(careta);

    // 1) Creamos un “srcCanvas” que es EXACTAMENTE lo que el usuario ve (espejado)
    const srcCanvas = uiCanvas;

    // Nota: el preview se ve espejado por CSS (scaleX(-1)).
    // Para que el póster coincida con lo que ve el usuario, el recorte se exporta espejado desde el buffer real.
    // 2) Extraemos crop 1:1 (sin reescalado) centrado en la guía de Pantalla 2
    const headCanvas = extractHeadCanvas(srcCanvas, uiCanvas);

    // 3) Aplicamos óvalo + feather (un poco más grande que la guía)
    if (GUIDE_MASK.enabled) {
        applyGuideMaskToHeadCanvas(headCanvas, uiCanvas);
    }

    // 4) Pintamos gafas encima (sin re-rasterizar en CSS)
    if (glassesImg) {
        const gpx = getGlassesGuidePx(uiCanvas);
        if (gpx && state.lastCrop) {
            const guideInHead = mapRectToHeadCrop(gpx, state.lastCrop);
            drawGlassesOnHead(headCanvas, careta.id, glassesImg, guideInHead);
        } else {
            drawGlassesOnHead(headCanvas, careta.id, glassesImg, null);
        }
    }

    // Export: PNG (sin pérdida)
    const dataUrl = headCanvas.toDataURL("image/png");
    state.photoDataUrl = dataUrl;

    if (el.photoPreview) el.photoPreview.src = dataUrl;

    // Navegamos a “send”
    setView("send");
}


async function startCaptureSequence() {
    if (state.isCounting) return;

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
    // "capture" action eliminado (ahora es automático)
    if (a === "retake") setView("capture");
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
initQrButtonUX();
exposeTuneApi();
applyCaptureTune(loadCaptureTune());
scaleStage();
bumpIdle();

/* =========================================================
   KIOSK_TUNE HOTFIX (reactiva cam + counter + send + capture)
   - Pegar al FINAL del index.js
   - No rompe el resto: solo reexpone window.KIOSK_TUNE
========================================================= */
(() => {
    const LS_KEY = "KIOSK_TUNE_V3";

    const CAPTURE_SCOPE = () => document.querySelector('.view[data-view="capture"]');
    const SEND_SCOPE = () => document.querySelector('.view[data-view="send"]');

    // Mapa: KEY pública -> CSS var
    const VARS = {
        // PACK / SILUETA
        capX: "--cap-x",
        capY: "--cap-y",
        capCircleW: "--cap-circle-w",

        // GAFAS (nudges)
        glassesNudgeX: "--cap-glasses-nudge-x",
        glassesNudgeY: "--cap-glasses-nudge-y",
        glassesNudgeS: "--cap-glasses-nudge-s",

        // CONTADOR (anillo + número)
        capCounterX: "--cap-counter-x",
        capCounterY: "--cap-counter-y",
        capCounterW: "--cap-counter-w",

        // CÁMARA (offset/zoom del “frame”)
        camX: "--cam-x",
        camY: "--cam-y",
        camS: "--cam-s",

        // SEND (pantalla 3)
        sendX: "--send-x",
        sendY: "--send-y",
        sendS: "--send-s",
    };

    // Aliases para compatibilidad (por si en algún momento cambiaste nombres)
    const ALIASES = {
        // contador
        counterX: "capCounterX",
        counterY: "capCounterY",
        counterW: "capCounterW",

        // gafas
        capGlassesNudgeX: "glassesNudgeX",
        capGlassesNudgeY: "glassesNudgeY",
        capGlassesNudgeS: "glassesNudgeS",
    };

    const normalizePatch = (patch = {}) => {
        const out = {};
        for (const [k, v] of Object.entries(patch)) {
            const kk = ALIASES[k] || k;
            if (kk in VARS) out[kk] = v;
        }
        return out;
    };

    const load = () => {
        try {
            return JSON.parse(localStorage.getItem(LS_KEY) || "{}") || {};
        } catch {
            return {};
        }
    };

    const save = (obj) => {
        localStorage.setItem(LS_KEY, JSON.stringify(obj));
    };

    const applyToScope = (scopeEl, patch) => {
        if (!scopeEl) return;
        for (const [k, v] of Object.entries(patch)) {
            const cssVar = VARS[k];
            if (!cssVar) continue;
            scopeEl.style.setProperty(cssVar, String(v));
        }
    };

    const apply = () => {
        const t = load();
        const cap = CAPTURE_SCOPE();
        const send = SEND_SCOPE();

        // Aplica capture-related
        const capPatch = {};
        for (const k of Object.keys(VARS)) {
            if (k.startsWith("send")) continue;
            if (t[k] !== undefined) capPatch[k] = t[k];
        }
        applyToScope(cap, capPatch);

        // Aplica send-related
        const sendPatch = {};
        for (const k of Object.keys(VARS)) {
            if (!k.startsWith("send")) continue;
            if (t[k] !== undefined) sendPatch[k] = t[k];
        }
        applyToScope(send, sendPatch);

        // Forzar “recolocado” si existen estas funciones en tu script
        try { if (typeof positionProgressRing === "function") positionProgressRing(); } catch { }
        try {
            // algunos builds dibujan cámara en canvas en RAF; esto ayuda a refrescar layout
            window.dispatchEvent(new Event("resize"));
        } catch { }

        // Si el contador está visible, reflow suave
        const cd = document.querySelector(".capture-countdown");
        if (cd) void cd.offsetWidth;
    };

    const api = {
        set(patch) {
            const clean = normalizePatch(patch);
            if (!Object.keys(clean).length) return;
            const t = load();
            Object.assign(t, clean);
            save(t);
            apply();
            return t;
        },
        get() {
            return load();
        },
        reset() {
            localStorage.removeItem(LS_KEY);
            apply(); // re-aplica (queda en defaults del CSS)
        },
        apply,
        // helper: mostrar contador aunque no esté corriendo (para tunear “en vivo”)
        showCounter() {
            const cd = document.querySelector(".capture-countdown");
            if (cd) {
                cd.classList.remove("is-hidden");
                cd.setAttribute("aria-hidden", "false");
            }
            apply();
        },
        hideCounter() {
            const cd = document.querySelector(".capture-countdown");
            if (cd) {
                cd.classList.add("is-hidden");
                cd.setAttribute("aria-hidden", "true");
            }
        }
    };

    window.KIOSK_TUNE = api;

    // Aplica lo guardado al cargar
    apply();
})();
