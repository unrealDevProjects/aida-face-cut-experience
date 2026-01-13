@echo off
setlocal enabledelayedexpansion

REM ====== CONFIG ======
set "URL=http://localhost:8000/"
set "CHROME=C:\Program Files\Google\Chrome\Application\chrome.exe"

set "API_DIR=C:\Users\WEIDIAN\Documents\dev\aida-face-cut-experience\server"
set "VENV_PY=%API_DIR%\.venv\Scripts\python.exe"
set "WEB_DIR=C:\Users\WEIDIAN\Documents\dev\aida-face-cut-experience"

set "API_PORT=8001"
set "WEB_PORT=8000"

REM ====== KILL PREVIOUS (por si quedó algo colgado) ======
call :KillPort %API_PORT%
call :KillPort %WEB_PORT%
taskkill /F /IM chrome.exe >nul 2>&1

REM ====== START API (uvicorn) ======
start "API_UVICORN" /min cmd /c ^
  "cd /d "%API_DIR%" && "%VENV_PY%" -m uvicorn app:app --host 127.0.0.1 --port %API_PORT%"

REM ====== START WEB (http.server) ======
start "WEB_HTTP" /min cmd /c ^
  "cd /d "%WEB_DIR%" && py -3.11 -m http.server %WEB_PORT%"

REM ====== WAIT UNTIL WEB IS UP ======
call :WaitPort 127.0.0.1 %WEB_PORT% 60

REM ====== LAUNCH CHROME KIOSK (fullscreen real, sin bordes) ======
start "" "%CHROME%" --kiosk "%URL%" --no-first-run --disable-session-crashed-bubble --disable-infobars

exit /b 0


REM ====== FUNCTIONS ======
:WaitPort
REM args: host port timeoutSeconds
set "HOST=%~1"
set "PORT=%~2"
set "TIMEOUT=%~3"

for /l %%i in (1,1,%TIMEOUT%) do (
  powershell -NoProfile -Command ^
    "if (Test-NetConnection -ComputerName '%HOST%' -Port %PORT% -InformationLevel Quiet) { exit 0 } else { exit 1 }" >nul
  if !errorlevel! equ 0 exit /b 0
  timeout /t 1 /nobreak >nul
)

REM si falla, igual abre Chrome (mejor mostrar algo que pantalla negra)
exit /b 1


:KillPort
REM args: port
set "P=%~1"
for /f "tokens=5" %%a in ('netstat -ano ^| findstr /r /c:":%P% .*LISTENING"') do (
  taskkill /F /PID %%a >nul 2>&1
)
exit /b 0
