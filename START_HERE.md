# START HERE — levantar el proyecto (puertos 8000 + 8001)

Este proyecto funciona con **2 servidores**:

- **Frontend (estático)** → `http://localhost:8000`  
  Sirve `index.html`, `styles/`, `scripts/`, `assets/`.

- **Backend (API FastAPI)** → `http://localhost:8001`  
  Recibe el `POST /api/snapshot` (subida/guardado de la captura).

> Nota de arquitectura: el frontend ya apunta a `APP.apiEndpoint = "http://localhost:8001"` en `scripts/index.js`.

---

## 0) Requisitos
- **Python 3.10+** (recomendado)
- 2 terminales abiertas (una para cada servidor)
- Navegador (Chrome recomendado) — la cámara funciona en `localhost`

---

## 1) Instala dependencias
python -m pip install --upgrade pip
python -m pip install -r requirements.txt

---

## 2) Backend (FastAPI) — puerto 8001

### Windows (CMD)
```CMD
cd server
py -m venv .venv
.venv\Scripts\activate
pip install -r requirements.txt
py -m uvicorn app:app --host 0.0.0.0 --port 8001 --reload
```

### macOS / Linux (bash/zsh)
```bash
cd server
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
python -m uvicorn app:app --host 0.0.0.0 --port 8001 --reload
```

**Checks**
- API docs: `http://localhost:8001/docs`
- Health mental: si `/docs` abre, el backend está vivo.

---

## 3) Frontend (estático) — puerto 8000

Abre **otra terminal** en la raíz del proyecto (donde está `index.html`).

### Windows (PowerShell)
```powershell
py -m http.server 8000
```

### macOS / Linux (bash/zsh)
```bash
python3 -m http.server 8000
```

**Check**
- App: `http://localhost:8000`

---

## 4) Flujo de prueba rápido
1. Abre `http://localhost:8000`
2. Acepta permisos de cámara
3. Haz una captura
4. Si todo está OK, el frontend llamará a:
   - `POST http://localhost:8001/api/snapshot`

---

## 5) Si algo falla (lo típico)
- **“Port already in use”** → usa `docs/TROUBLESHOOTING.md`
- **CORS** → confirma que el frontend corre en `http://localhost:8000` (no `file://`)
- **Cámara no abre** → solo funciona en `localhost`/HTTPS; no en IP remota sin HTTPS
