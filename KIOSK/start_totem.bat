@echo off
setlocal enabledelayedexpansion

REM ============================================================
REM KIOSK STARTER (Windows 11) - FINAL
REM - Levanta WEB (8000) + API (8001)
REM - Abre Google Chrome en modo KIOSK en http://localhost:8000/
REM ============================================================

REM =========================
REM CONFIG (AJUSTADO A TU RUTA)
REM =========================
set "URL=http://localhost:8000/"

REM Chrome (rutas típicas)
set "CHROME=C:\Program Files\Google\Chrome\Application\chrome.exe"
if not exist "%CHROME%" set "CHROME=C:\Program Files (x86)\Google\Chrome\Application\chrome.exe"

REM Proyecto:
REM   C:\Users\WEIDIAN\Documents\dev\aida-face-cut-experience
REM Sin hardcodear usuario: usamos %USERPROFILE%
set "PROJECT_DIR=%USERPROFILE%\Documents\dev\aida-face-cut-experience"

REM Backend (FastAPI)
set "API_DIR=%PROJECT_DIR%\server"
set "API_PORT=8001"

REM Front (index.html)
set "WEB_DIR=%PROJECT_DIR%"
set "WEB_PORT=8000"

REM Python de la venv del backend
set "VENV_PY=%API_DIR%\.venv\Scripts\python.exe"

REM Perfil fijo de Chrome (guarda permisos cámara/mic)
set "CHROME_PROFILE=C:\KIOSK\ChromeProfile"

REM =========================
REM VALIDACIONES
REM =========================
if not exist "%API_DIR%\app.py" (
  echo [ERROR] No encuentro app.py en: %API_DIR%
  echo         Revisa PROJECT_DIR/API_DIR en este .bat
  pause
  exit /b 1
)

if not exist "%VENV_PY%" (
  echo [ERROR] No existe: %VENV_PY%
  echo         La venv debe estar en: %API_DIR%\.venv
  echo         Solucion rapida:
  echo           cd "%API_DIR%"
  echo           py -m venv .venv
  echo           .venv\Scripts\activate
  echo           python -m pip install -r requirements.txt
  pause
  exit /b 1
)

if not exist "%CHROME%" (
  echo [ERROR] No encuentro Chrome en la ruta esperada.
  echo         Instala Google Chrome o ajusta la variable CHROME.
  pause
  exit /b 1
)

REM =========================
REM LIMPIA PUERTOS (por si quedó algo colgado)
REM =========================
call :KillPort %API_PORT%
call :KillPort %WEB_PORT%

REM =========================
REM LEVANTA SERVIDORES
REM (cd /d para que uvicorn encuentre app.py)
REM =========================

REM API
start "KIOSK API :%API_PORT%" cmd /k ^
  "cd /d "%API_DIR%" && "%VENV_PY%" -m uvicorn app:app --host 127.0.0.1 --port %API_PORT%"

REM WEB
start "KIOSK WEB :%WEB_PORT%" cmd /k ^
  "cd /d "%WEB_DIR%" && "%VENV_PY%" -m http.server %WEB_PORT% --bind 127.0.0.1 --directory "%WEB_DIR%""

REM =========================
REM ESPERA A QUE RESPONDAN
REM =========================
call :WaitHttp "http://127.0.0.1:%API_PORT%/docs" 30
call :WaitHttp "http://127.0.0.1:%WEB_PORT%/" 30

REM =========================
REM CHROME KIOSK
REM NOTA: Si Chrome ya estaba abierto, puede ignorar flags.
REM       Por eso lo cerramos antes de abrir modo kiosko.
REM =========================
taskkill /F /IM chrome.exe >nul 2>&1

start "" "%CHROME%" ^
  --kiosk "%URL%" ^
  --new-window ^
  --no-first-run ^
  --disable-session-crashed-bubble ^
  --autoplay-policy=no-user-gesture-required ^
  --use-fake-ui-for-media-stream ^
  --user-data-dir="%CHROME_PROFILE%"

exit /b 0


REM ============================================================
REM FUNCIONES
REM ============================================================

:KillPort
set "P=%~1"
for /f "tokens=5" %%a in ('netstat -ano ^| findstr /r /c:":%P% .*LISTENING"') do (
  taskkill /F /PID %%a >nul 2>&1
)
exit /b 0

:WaitHttp
set "TESTURL=%~1"
set "SECS=%~2"
set /a "i=0"

:wait_loop
powershell -NoProfile -Command ^
  "try { (Invoke-WebRequest -UseBasicParsing -TimeoutSec 2 '%TESTURL%').StatusCode } catch { 0 }" ^
  | findstr /r "200 301 302" >nul

if %errorlevel%==0 exit /b 0

set /a "i+=1"
if !i! geq %SECS% (
  echo [WARN] No respondio a tiempo: %TESTURL%
  exit /b 1
)

timeout /t 1 /nobreak >nul
goto wait_loop
