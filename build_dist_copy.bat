@echo off
setlocal enabledelayedexpansion
chcp 65001 >nul

echo Building editorjs-sandbox...
call npx --yes vite build
set BUILD_RESULT=!ERRORLEVEL!

if !BUILD_RESULT! NEQ 0 (
  echo Build failed: !BUILD_RESULT!
  exit /b !BUILD_RESULT!
)

if not exist "dist\sandbox.umd.js" (
  echo Missing dist\sandbox.umd.js
  exit /b 1
)

if not exist "..\..\QNotes\public\vendor\editorjs-sandbox" (
  mkdir "..\..\QNotes\public\vendor\editorjs-sandbox"
)

copy /Y "dist\sandbox.umd.js" "..\..\QNotes\public\vendor\editorjs-sandbox\sandbox.umd.js" >nul
if !ERRORLEVEL! NEQ 0 (
  echo Copy failed
  exit /b !ERRORLEVEL!
)

echo editorjs-sandbox build copied successfully.
exit /b 0
