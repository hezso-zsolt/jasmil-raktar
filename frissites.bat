@echo off
rem Jasmil leltar: frissites a GitHubrol, majd az app inditasa.
rem Dupla kattintassal futtathato; elotte a futo appot allitsd le.
rem Windows inditasakor is futtathato (Inditopult mappa): ha nincs internet,
rem nem all meg, hanem 10 mp utan a regi verzioval elinditja az appot.
title Jasmil leltar - frissites es inditas
cd /d "%~dp0"

echo.
echo === Frissites letoltese (git pull) ===
git pull
if errorlevel 1 (
  echo.
  echo HIBA: a frissites letoltese nem sikerult ^(nincs internet?^).
  echo Az app a regi verzioval indul.
  timeout /t 10
)

cd jasmil-leltar
echo.
echo === Csomagok ellenorzese (npm install) ===
call npm install
if errorlevel 1 (
  echo.
  echo HIBA: az npm install nem sikerult.
  pause
  exit /b 1
)

echo.
echo === Az app indul. Ezt az ablakot ne zard be, amig hasznaljatok! ===
call npm start
pause
