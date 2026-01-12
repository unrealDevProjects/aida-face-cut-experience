# Frontend (estático) — guía operativa

El frontend es un sitio estático (HTML/CSS/JS). No necesita build.

---

## Servir en 8000
Desde la carpeta raíz (donde está `index.html`):

```bash
python -m http.server 8000
```

Luego:
- `http://localhost:8000`

---

## Nota importante (no abrir con doble click)
No uses `file:///.../index.html` porque:
- rompe permisos de cámara en muchos casos
- rompe llamadas al backend (CORS / fetch)

Siempre sirve con HTTP local.

---

## Endpoint del backend
En `scripts/index.js`:
- `APP.apiEndpoint` está configurado a `http://localhost:8001`

Eso significa:
- Frontend en 8000
- Backend en 8001

---

## Alternativa: VS Code Live Server
Si prefieres Live Server (típico 5500):
- Frontend: `http://localhost:5500`
- Backend: `http://localhost:8001`

El backend ya contempla 5500 en CORS (si no lo cambiaste).
