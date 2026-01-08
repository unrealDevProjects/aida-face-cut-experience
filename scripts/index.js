/* Kiosk SPA — 1 HTML, 3 views (Home / Capture / Send) */

const APP = {
    baseW: 1080,
    baseH: 1920,
    idleMs: 60_000,
    autoAdvanceMs: 220,
    apiEndpoint: "",
};

// Render / calidad
const CAM = {
    maxW: 1080,
    maxH: 1600,
    dprCap: 1, // 1 = estable en kiosko; 1.5 = más nítido (más CPU)
};

const REDIRECT_URL = "https://www.sonypictures.es/form/promocion-aida";

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
    preset: "tight", // "tight" | "normal" | "loose"
};

const HEAD_PRESETS = {
    tight: { cropW: 2.10, cropH: 2.35, yUp: 1.25, maskY: 0.46, maskRX: 0.47, maskRY: 0.52 },
    normal: { cropW: 2.25, cropH: 2.55, yUp: 1.18, maskY: 0.46, maskRX: 0.47, maskRY: 0.55 },
    loose: { cropW: 2.45, cropH: 2.85, yUp: 1.10, maskY: 0.46, maskRX: 0.48, maskRY: 0.60 },
};

const GLASSES = {
    dir: "assets/Gafas",
    exts: ["png", "webp", "svg"],
};

const GLASSES_FIT = {
    aida: { x: 0.50, y: 0.47, s: 0.78, r: 0 },
    fidel: { x: 0.50, y: 0.47, s: 0.80, r: 0 },
    hija: { x: 0.50, y: 0.47, s: 0.78, r: 0 },
    hijo: { x: 0.50, y: 0.47, s: 0.80, r: 0 },
    machu: { x: 0.50, y: 0.47, s: 0.82, r: 0 },
    paz: { x: 0.50, y: 0.47, s: 0.78, r: 0 },
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
    for (const ext of GLASSES.exts) candidates.push(`${GLASSES.dir}/${careta.id}.${ext}`);
    for (const ext of GLASSES.exts) candidates.push(`${GLASSES.dir}/${careta.num}.${ext}`);

    let img = null;
    for (const src of candidates) {
        try { img = await loadImg(src); break; } catch { }
    }

    glassesCache.set(careta.id, img);
    return img;
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
    captureCounter: document.querySelector(".capture-counter"),
    captureBtn: document.querySelector('[data-view="capture"] [data-action="capture"]'),
    externalModal: document.getElementById("externalModal"),
    externalFrame: document.getElementById("externalFrame"),
    qrOverlay: document.getElementById("qrOverlay"),
};

const state = {
    view: "home",
    selectedCareta: CARETAS[0],

    stream: null,
    photoDataUrl: "",

    idleTimer: null,
    renderReq: null,
    hasFrame: false,

    redirectTimer: null,

    // 🔥 para auto-key
    frameIdx: 0,
    keyRGB: { r: CHROMA.r, g: CHROMA.g, b: CHROMA.b },

    // countdown
    isCounting: false,
    countdownTimer: null,
};

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
}

function bumpIdle() {
    clearTimeout(state.idleTimer);
    state.idleTimer = setTimeout(() => setView("home"), APP.idleMs);
}

function stopRedirect() {
    clearTimeout(state.redirectTimer);
    state.redirectTimer = null;
}

function stopCountdown() {
    clearTimeout(state.countdownTimer);
    state.countdownTimer = null;
    state.isCounting = false;
    if (el.captureCounter) el.captureCounter.classList.add("is-hidden");
}

function setCountdownImage(n) {
    if (!el.captureCounter) return;
    if (!n) {
        el.captureCounter.classList.add("is-hidden");
        return;
    }
    el.captureCounter.src = `assets/Pantalla2/Contador/${n}Contador.png`;
    el.captureCounter.classList.remove("is-hidden");
    el.captureCounter.classList.remove("is-pulse");
    // reflow para reiniciar animación
    void el.captureCounter.offsetWidth;
    el.captureCounter.classList.add("is-pulse");
}

function runCountdown() {
    const steps = [3, 2, 1];
    return new Promise((resolve) => {
        let idx = 0;
        const tick = () => {
            if (idx >= steps.length) {
                setCountdownImage(null);
                return resolve();
            }
            setCountdownImage(steps[idx]);
            idx += 1;
            state.countdownTimer = setTimeout(tick, 800);
        };
        tick();
    });
}

function closeModal() {
    stopRedirect();
    el.stage.classList.remove("dim-out");
    if (el.externalFrame) el.externalFrame.src = "about:blank";
    if (el.externalModal) el.externalModal.classList.add("is-hidden");
    if (el.qrOverlay) el.qrOverlay.classList.add("is-hidden");
}

/* =========================
   Camera canvas sizing
========================= */

function resizeCameraCanvas() {
    if (!el.cameraCanvas) return;

    const rect = el.cameraCanvas.getBoundingClientRect();
    const dpr = Math.min(CAM.dprCap, window.devicePixelRatio || 1);

    const w = Math.min(CAM.maxW, Math.max(1, Math.floor(rect.width * dpr)));
    const h = Math.min(CAM.maxH, Math.max(1, Math.floor(rect.height * dpr)));

    if (el.cameraCanvas.width !== w || el.cameraCanvas.height !== h) {
        el.cameraCanvas.width = w;
        el.cameraCanvas.height = h;
    }
}

function stopRenderLoop() {
    if (state.renderReq) cancelAnimationFrame(state.renderReq);
    state.renderReq = null;
}

/* =========================
   Chroma render loop
========================= */

function renderFrame() {
    const v = el.camera;
    const c = el.cameraCanvas;
    if (!v || !c) return;

    const ctx = el.cameraCtx || c.getContext("2d", { willReadFrequently: true });
    const vw = v.videoWidth;
    const vh = v.videoHeight;

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

    resizeCameraCanvas();

    // ✅ FIX DPR (antes lo capabas a 1 sí o sí)
    const dpr = Math.min(CAM.dprCap, window.devicePixelRatio || 1);

    // object-fit: cover manual
    const cw = c.width / dpr;
    const ch = c.height / dpr;
    const scale = Math.max(cw / vw, ch / vh);
    const sw = cw / scale;
    const sh = ch / scale;
    const sx = Math.floor((vw - sw) / 2);
    const sy = Math.floor((vh - sh) / 2);

    ctx.save();
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, cw, ch);
    ctx.drawImage(v, sx, sy, sw, sh, 0, 0, cw, ch);
    ctx.restore();

    if (!state.hasFrame) {
        state.hasFrame = true;
        if (el.cameraCanvas) el.cameraCanvas.style.visibility = "visible";
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
        const stream = await navigator.mediaDevices.getUserMedia({
            video: { width: { ideal: 1920 }, height: { ideal: 1080 }, facingMode: "user" },
            audio: false,
        });

        state.stream = stream;
        el.camera.srcObject = stream;
        el.camera.play?.();

        state.hasFrame = false;
        state.frameIdx = 0;
        state.keyRGB = { r: CHROMA.r, g: CHROMA.g, b: CHROMA.b };

        if (el.cameraCanvas) el.cameraCanvas.style.visibility = "hidden";
        if (el.cameraStatus) el.cameraStatus.textContent = "";
    } catch (err) {
        console.error(err);
        if (el.cameraStatus) el.cameraStatus.textContent = "No se pudo abrir la cámara.";
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
    if (state.view === "capture" && next !== "capture") stopCamera();
    if (state.view === "send" && next !== "send") stopRedirect();

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
    }

    if (next === "capture") {
        await startCamera();
        await waitVideoReady(el.camera);

        state.hasFrame = false;
        if (el.cameraCanvas) el.cameraCanvas.style.visibility = "hidden";
        if (el.cameraStatus) el.cameraStatus.textContent = "Alinea tu cara con el círculo.";

        stopRenderLoop();
        state.renderReq = requestAnimationFrame(renderFrame);
        stopCountdown();
        setCountdownImage(3);
        setCountdownImage(null);
        if (el.qrOverlay) el.qrOverlay.classList.add("is-hidden");
    }

    if (next === "send") {
        el.photoPreview.src = state.photoDataUrl || "";
        stopRedirect();
        state.redirectTimer = setTimeout(() => {
            el.stage.classList.add("dim-out");
            setTimeout(() => {
                if (el.externalFrame) el.externalFrame.src = REDIRECT_URL;
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

function getGuideCircleNorm() {
    const circle = document.querySelector(".capture-circle");
    const canvas = el.cameraCanvas;
    if (!circle || !canvas) return null;

    const cr = circle.getBoundingClientRect();
    const vr = canvas.getBoundingClientRect();
    if (!vr.width || !vr.height) return null;

    const cx = (cr.left + cr.width / 2 - vr.left) / vr.width;
    const cy = (cr.top + cr.height / 2 - vr.top) / vr.height;
    const r = (Math.min(cr.width, cr.height) / 2) / vr.width;
    return { cx, cy, r };
}

function extractHeadCanvas(previewCanvas) {
    const guide = getGuideCircleNorm();
    const p = HEAD_PRESETS[HEAD.preset] || HEAD_PRESETS.tight;

    const cut = document.createElement("canvas");
    cut.width = HEAD.size;
    cut.height = HEAD.size;

    const ctx = cut.getContext("2d", { alpha: true });
    ctx.clearRect(0, 0, cut.width, cut.height);

    const cx = guide ? guide.cx * previewCanvas.width : previewCanvas.width * 0.5;
    const cy = guide ? guide.cy * previewCanvas.height : previewCanvas.height * 0.38;
    const r = guide ? guide.r * previewCanvas.width : Math.min(previewCanvas.width, previewCanvas.height) * 0.18;

    const cropW = r * p.cropW * 2;
    const cropH = r * p.cropH * 2;

    const sx = Math.round(cx - cropW / 2);
    const sy = Math.round(cy - cropH / 2 - r * p.yUp);
    const sw = Math.round(cropW);
    const sh = Math.round(cropH);

    ctx.drawImage(previewCanvas, sx, sy, sw, sh, 0, 0, cut.width, cut.height);

    ctx.save();
    ctx.globalCompositeOperation = "destination-in";
    ctx.beginPath();
    ctx.ellipse(
        cut.width * 0.5,
        cut.height * p.maskY,
        cut.width * p.maskRX,
        cut.height * p.maskRY,
        0,
        0,
        Math.PI * 2
    );
    ctx.closePath();
    ctx.fill();
    ctx.restore();

    return cut;
}

function drawGlassesOnHead(headCanvas, caretaId, glassesImg) {
    if (!headCanvas || !glassesImg) return;

    const fit = GLASSES_FIT[caretaId] || { x: 0.5, y: 0.47, s: 0.8, r: 0 };
    const ctx = headCanvas.getContext("2d", { alpha: true });

    const targetW = headCanvas.width * fit.s;
    const aspect = (glassesImg.width && glassesImg.height) ? (glassesImg.width / glassesImg.height) : 2;
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
        if (el.cameraStatus) el.cameraStatus.textContent = "Aún no hay señal… espera 1s.";
        return;
    }

    const head = extractHeadCanvas(preview);

    const careta = state.selectedCareta || CARETAS[0];
    const glassesImg = await getGlassesImage(careta);
    drawGlassesOnHead(head, careta.id, glassesImg);

    // PNG (alpha OK)
    state.photoDataUrl = head.toDataURL("image/png");
    setView("send");
}

async function startCaptureSequence() {
    if (state.isCounting) return;
    state.isCounting = true;
    try {
        await runCountdown();
        await capturePhoto();
    } catch (err) {
        console.error(err);
    } finally {
        stopCountdown();
        state.isCounting = false;
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
        stopRedirect();
        if (el.externalFrame) el.externalFrame.src = "about:blank";
        if (el.externalModal) el.externalModal.classList.add("is-hidden");
        el.stage.classList.remove("blur-out");
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

/* =========================
   Init
========================= */

window.addEventListener("resize", scaleStage);
scaleStage();
bumpIdle();
