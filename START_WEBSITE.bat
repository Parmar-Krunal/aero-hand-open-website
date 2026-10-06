@echo off
setlocal enabledelayedexpansion
title Aero Hand Open — Engineering, 3D CAD & Digital Twin Hub

echo ===================================================================
echo           AERO HAND OPEN - LOCAL WEBSITE LAUNCHER
echo ===================================================================
echo.

:: Check Python installation.
python --version >nul 2>&1
if errorlevel 1 (
    echo [ERROR] Python is not installed or not in PATH!
    echo Please install Python 3.10+ from https://www.python.org/downloads/
    echo Make sure to check "Add Python to PATH" during installation.
    echo.
    pause
    exit /b 1
)

:: Find the website project.
set "ROOT_DIR=%~dp0"
if exist "%ROOT_DIR%source-aero-hand-main\simulation\run_services.py" (
    set "MAIN_DIR=%ROOT_DIR%source-aero-hand-main"
) else if exist "%ROOT_DIR%simulation\run_services.py" (
    set "MAIN_DIR=%ROOT_DIR%"
) else (
    set "MAIN_DIR=%ROOT_DIR%"
)

cd /d "%MAIN_DIR%"
if errorlevel 1 (
    echo [ERROR] Could not enter the website project folder.
    pause
    exit /b 1
)

:: Verify and install the required Python packages if needed.
echo [*] Checking dependencies...
python -c "import websockets" >nul 2>&1
if errorlevel 1 (
    echo     - Installing required package 'websockets'...
    python -m pip install websockets -q
    if errorlevel 1 goto :dependency_error
)

cadgen --version >nul 2>&1
if errorlevel 1 (
    echo     - Installing required package 'cadgen==0.7.10'...
    python -m pip install cadgen==0.7.10 -q
    if errorlevel 1 goto :dependency_error
)

:: The supervisor checks ports, starts all services, and opens the preview.
echo [*] Starting website, CAD viewer, and digital-twin services...
echo.
python simulation\run_services.py --preview
set "EXIT_CODE=%ERRORLEVEL%"

if not "%EXIT_CODE%"=="0" (
    echo [ERROR] Website services stopped with exit code %EXIT_CODE%.
    pause
    exit /b %EXIT_CODE%
)

echo [OK] Aero Hand Open services stopped.
exit /b 0

:dependency_error
echo [ERROR] A required package could not be installed.
pause
exit /b 1
