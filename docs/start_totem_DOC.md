# Documentación — `start_totem.bat` (KIOSK Totem)

## Objetivo
Automatizar el arranque del tótem en Windows 11 para que, al ejecutar un solo `.bat`, se realice lo siguiente:

1. **Libera puertos** (por si quedaron procesos colgados).
2. Levanta **API (FastAPI/Uvicorn)** en `http://127.0.0.1:8001`.
3. Levanta **WEB estática** (servidor simple) en `http://127.0.0.1:8000`.
4. Espera a que ambos servicios respondan.
5. Abre **Google Chrome en modo KIOSK** apuntando a `http://localhost:8000/`.
6. (Opcional) Auto-acepta el UI de permisos de cámara/mic con un flag de Chrome.

---

## Arquitectura (resumen)
- **WEB**: `python -m http.server 8000` sirviendo el directorio del front.
- **API**: `python -m uvicorn app:app --port 8001` desde la carpeta `server`.
- **Chrome**: `--kiosk` + perfil dedicado para persistir permisos/configuración.

---

## Requisitos
### Software
- Windows 11
- Python instalado (para crear la venv inicialmente).
- Google Chrome instalado.

### Estructura esperada del proyecto
Este `.bat` está preparado para que el proyecto esté en:

- **Proyecto**: `%USERPROFILE%\Documents\dev\aida-face-cut-experience`
- **Backend**: `%USERPROFILE%\Documents\dev\aida-face-cut-experience\server`
- **Venv**: `%USERPROFILE%\Documents\dev\aida-face-cut-experience\server\.venv`

> El `.bat` usa `%USERPROFILE%` para no depender del nombre del usuario (ej. `WEIDIAN`, `KIOSK`, etc.).

---

## Instalación inicial (solo la primera vez)
En **CMD**, desde la carpeta `server`:

```bat
cd %USERPROFILE%\Documents\dev\aida-face-cut-experience\server
py -m venv .venv
.venv\Scripts\activate
python -m pip install --upgrade pip
python -m pip install -r requirements.txt
```

Verifica que exista:

- `...\server\.venv\Scripts\python.exe`

---

## Ubicación recomendada del BAT
Colocar el archivo aquí (recomendado):

- `C:\KIOSK\start_totem.bat`

Además, el BAT usa un perfil fijo de Chrome en:

- `C:\KIOSK\ChromeProfile`

Esto sirve para que Chrome guarde:
- permisos de cámara/mic,
- estado del sitio (y evitar prompts repetitivos).

---

## Qué hace el BAT en detalle
### 1) Configuración
Variables principales:

- `URL`: URL del front (`http://localhost:8000/`)
- `PROJECT_DIR`: raíz del proyecto (usa `%USERPROFILE%`)
- `API_DIR`: carpeta del backend (`%PROJECT_DIR%\server`)
- `WEB_DIR`: carpeta del front (`%PROJECT_DIR%`)
- `API_PORT`: `8001`
- `WEB_PORT`: `8000`
- `VENV_PY`: python de la venv (`%API_DIR%\.venv\Scripts\python.exe`)
- `CHROME_PROFILE`: `C:\KIOSK\ChromeProfile`

### 2) Validaciones
Antes de levantar nada, comprueba:
- Existe `app.py` en `API_DIR`.
- Existe `python.exe` dentro de la venv.

Si falla, muestra error y se detiene (no hace “cosas a medias”).

### 3) Limpieza de puertos
Usa `netstat -ano` para encontrar procesos en LISTENING en:
- `8000`
- `8001`

Y los mata con:
- `taskkill /F /PID <pid>`

### 4) Levanta API y WEB en dos CMD separados
- API:
  - hace `cd /d "%API_DIR%"` (crítico para que `uvicorn app:app` encuentre `app.py`)
  - ejecuta `uvicorn` en `127.0.0.1:8001`
- WEB:
  - hace `cd /d "%WEB_DIR%"`
  - ejecuta `python -m http.server 8000` con `--directory "%WEB_DIR%"`

### 5) Espera activa hasta que respondan
Hace ping HTTP con PowerShell a:
- `http://127.0.0.1:8001/docs`
- `http://127.0.0.1:8000/`

Si no responde en 30s, avisa con `[WARN]`, pero el BAT sigue (útil para diagnóstico).

### 6) Abre Chrome en modo KIOSK
Lanza Chrome con flags:
- `--kiosk`
- `--no-first-run`
- `--disable-session-crashed-bubble`
- `--autoplay-policy=no-user-gesture-required`
- `--user-data-dir="C:\KIOSK\ChromeProfile"`

**Extra (radical):**
- `--use-fake-ui-for-media-stream`
  - Auto-acepta el UI de permisos de cámara/mic.
  - **No fuerza la cámara exacta** si hay varias; para eso conviene deshabilitar cámaras no usadas en el Administrador de dispositivos.

---

## Arranque automático con Windows (recomendado)
### Programador de tareas (Task Scheduler)
1. `Win + R` → `taskschd.msc`
2. **Create Task…** (no “Basic”)
3. **General**
   - Name: `KIOSK Totem`
   - ✅ Run with highest privileges
   - ✅ Run only when user is logged on (para que Chrome se vea)
4. **Triggers**
   - At log on
   - (Opcional) Delay task: 30 seconds
5. **Actions**
   - Start a program:
     - Program/script: `C:\KIOSK\start_totem.bat`
     - Start in: `C:\KIOSK`
6. **Conditions / Settings**
   - Quita restricciones de energía si aplica (tótem enchufado).

---

## Operación diaria (runbook)
- Para iniciar manualmente: doble click a `C:\KIOSK\start_totem.bat`
- Para reiniciar “limpio”: reinicia el PC (la tarea lo levantará solo).
- Si el front no carga:
  - revisa CMD “KIOSK WEB :8000”
- Si la API falla:
  - revisa CMD “KIOSK API :8001”
  - valida que `uvicorn` está instalado en la venv.

---

## Troubleshooting rápido
### Error: `Could not import module "app"`
Causa: `uvicorn` se ejecutó fuera de la carpeta `server`.

Solución:
- Asegurar `cd /d "%API_DIR%"` antes del `uvicorn` (ya está contemplado en el BAT correcto).

### No abre Chrome
- Chrome no está en la ruta esperada.
- Ajusta variable `CHROME` o instala Chrome.

### Puertos 8000/8001 ocupados
El BAT intenta matar procesos en esos puertos.
Si aún falla:
- ejecuta como admin
- o revisa `netstat -ano | findstr :8000` / `:8001`.

### Selección de cámara incorrecta
Chrome puede escoger otra cámara si hay varias.
Solución “tótem”:
- Deshabilitar cámaras virtuales o no usadas:
  - Administrador de dispositivos → Cámaras → Deshabilitar.

---

## Seguridad / Notas de producción
- `--use-fake-ui-for-media-stream` es **conveniente** en kiosko, pero reduce fricción de permisos.
- El servidor `http.server` es para **LAN/local**; no es para exponer a internet.
- Se recomienda ejecutar en un usuario Windows dedicado “KIOSK” y con auto-login si el tótem es unattended.

---

## Checklist de aceptación
- [ ] `http://localhost:8000/` abre en Chrome KIOSK automáticamente.
- [ ] `http://localhost:8001/docs` responde.
- [ ] No aparecen prompts de permisos (o se auto-aceptan).
- [ ] Tras reiniciar Windows, el sistema arranca solo (Task Scheduler).
