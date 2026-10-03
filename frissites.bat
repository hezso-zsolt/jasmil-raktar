@echo off
rem Jasmil leltar: frissites a GitHubrol, majd az app inditasa.
rem Dupla kattintassal futtathato; elotte a futo appot allitsd le.
title Jasmil leltar - frissites es inditas
cd /d "%~dp0"

echo.
echo === Frissites letoltese (git pull) ===
git pull
if errorlevel 1 (
  echo.
  echo HIBA: a frissites letoltese nem sikerult. Az app a regi verzioval indul.
  pause
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
