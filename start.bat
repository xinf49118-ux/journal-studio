@echo off
chcp 65001 >nul
setlocal
cd /d "%~dp0"

set "PY=%USERPROFILE%\.dsh\dsh-runtimes\dsh-primary-runtime\dependencies\python\python.exe"
if not exist "%PY%" set "PY=python"

echo ============================================================
echo   手账工坊 Journal Studio
echo ============================================================
echo.

if not exist "assets\materials\manifest.json" (
  echo [1/2] 首次运行，正在生成内置素材包（大约需要 1-3 分钟）...
  "%PY%" tools\make_materials.py
  if errorlevel 1 (
    echo.
    echo 素材生成失败，请把上面的报错发给开发者。
    pause
    exit /b 1
  )
  echo.
)

echo [2/2] 启动本地服务，浏览器会自动打开...
echo.
"%PY%" server\server.py
pause
