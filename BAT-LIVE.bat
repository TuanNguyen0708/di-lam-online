@echo off
cd /d "%~dp0"
if not exist node_modules (
  echo Run pnpm.cmd install first.
  pause
  exit /b 1
)
call pnpm.cmd run setup
call pnpm.cmd build
if errorlevel 1 (
  pause
  exit /b 1
)
echo Dashboard: http://localhost:3101
echo OBS Browser Source: http://lvh.me:3101/?view=stage
echo Width 1080, height 1920. Production build: no hot reload.
call pnpm.cmd start
pause
