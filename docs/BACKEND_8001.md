# Backend (FastAPI) — guía operativa

El backend está en `server/app.py` y expone, como mínimo, este endpoint:

- `POST /api/snapshot`  
  Recibe un `data_url` (PNG base64) y devuelve un `url` público si la subida funciona.

---

## Instalación
Desde `server/`:

```bash
pip install -r requirements.txt
```

---

## Ejecutar en 8001
```bash
python -m uvicorn app:app --host 0.0.0.0 --port 8001 --reload
```

---

## Variables de entorno (.env)
El archivo `server/.env` define credenciales/config para guardar la captura (p.ej., DigitalOcean Spaces / S3 compatible).

Campos esperables (según el código):
- `DO_ACCESS_ID`
- `DO_SECRET_KEY`
- `DO_BUCKET` (opcional, default: `no-madproject`)

> Si no tienes credenciales válidas, el endpoint de snapshot puede devolver error (401/403/500).  
> En ese caso el frontend “funciona”, pero no tendrá URL final para descarga/entrega.

---

## Test con curl
### Windows (PowerShell)
```powershell
curl http://localhost:8001/docs
```

### macOS/Linux
```bash
curl http://localhost:8001/docs
```
Si responde HTML/OpenAPI, estás arriba.

---

## Logs útiles
- Errores de credenciales: `NoCredentialsError` / `ClientError`
- Errores de CORS: normalmente se ven en la consola del navegador (frontend), no aquí
