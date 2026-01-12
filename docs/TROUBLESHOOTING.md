# Troubleshooting (lo típico en kioskos)

## 1) “Address already in use” (puerto ocupado)
### Windows
Ver qué usa el puerto:
```powershell
netstat -ano | findstr :8000
netstat -ano | findstr :8001
```

Matar proceso por PID:
```powershell
taskkill /PID <PID> /F
```

### macOS/Linux
```bash
lsof -i :8000
lsof -i :8001
kill -9 <PID>
```

---

## 2) Error CORS en consola
Checklist:
- ¿Frontend corre en `http://localhost:8000`? (no `file://`)
- ¿Backend corre en `http://localhost:8001`?
- ¿`APP.apiEndpoint` es `http://localhost:8001`?

---

## 3) Cámara no aparece
- Solo fiable en `localhost` o HTTPS.
- Revisa permisos del navegador (icono de cámara en la barra).
- Cierra apps que estén usando la webcam (Zoom, OBS, Teams).

---

## 4) El backend responde pero `/api/snapshot` falla
Normalmente es credenciales/endpoint del bucket:
- revisa `server/.env`
- revisa logs del backend (terminal uvicorn)

---

## 5) Pantalla negra / baja FPS
- Baja carga: revisa variables de render en `scripts/index.js` (DPR / maxW / maxH)
- Cierra pestañas, desactiva extensiones, usa Chrome en modo kiosko
