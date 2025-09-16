@echo off
setlocal ENABLEDELAYEDEXPANSION

echo:
echo =====================================================
echo  Clean reinstall script for Expo/React Native project
echo  - Verwijdert node_modules, lockfiles
echo  - Leegt Expo/Metro projectcaches
echo  - Leegt Metro cache in %TEMP%
echo  - Doet een schone install (npm/yarn/pnpm auto-detect)
echo =====================================================
echo:

REM 1) Basischeck
if not exist "package.json" (
  echo [ERROR] Dit script moet in de projectroot draaien (package.json niet gevonden).
  exit /b 1
)

REM 2) Project-caches en build artefacts opruimen
echo [CLEAN] Verwijderen: node_modules
if exist "node_modules" rmdir /s /q "node_modules"

echo [CLEAN] Verwijderen: .expo
if exist ".expo" rmdir /s /q ".expo"

echo [CLEAN] Verwijderen: .cache
if exist ".cache" rmdir /s /q ".cache"

REM 3) Lockfiles verwijderen (forceert her-resolve van deps)
echo [CLEAN] Verwijderen: package-lock.json / yarn.lock / pnpm-lock.yaml
if exist "package-lock.json" del /f /q "package-lock.json"
if exist "yarn.lock" del /f /q "yarn.lock"
if exist "pnpm-lock.yaml" del /f /q "pnpm-lock.yaml"

REM 4) Metro cache in TEMP map
echo [CLEAN] Verwijderen: %TEMP%\metro-cache
if exist "%TEMP%\metro-cache" rmdir /s /q "%TEMP%\metro-cache"

REM 5) (Optioneel) package manager caches opschonen
REM  - npm cache clean --force is veilig als je npm gebruikt
REM  - yarn cache clean of pnpm store prune alleen uitvoeren als tool beschikbaar is
for /f "delims=" %%A in ('where npm 2^>nul') do set HAS_NPM=1
for /f "delims=" %%A in ('where yarn 2^>nul') do set HAS_YARN=1
for /f "delims=" %%A in ('where pnpm 2^>nul') do set HAS_PNPM=1

if defined HAS_NPM (
  echo [CLEAN] npm cache clean --force
  call npm cache clean --force
)

if defined HAS_YARN (
  echo [CLEAN] yarn cache clean
  call yarn cache clean
)

if defined HAS_PNPM (
  echo [CLEAN] pnpm store prune
  call pnpm store prune
)

REM 6) Package manager auto-detect (volgorde: yarn > pnpm > npm)
set PM=
if exist "yarn.lock" set PM=yarn
if exist "pnpm-lock.yaml" set PM=pnpm
if not defined PM (
  if defined HAS_YARN set PM=yarn
)
if not defined PM (
  if defined HAS_PNPM set PM=pnpm
)
if not defined PM set PM=npm

echo:
echo [INFO] Geselecteerde package manager: %PM%

REM 7) Schone installatie
echo [INSTALL] %PM% install
if /I "%PM%"=="yarn" (
  call yarn install || (echo [ERROR] yarn install faalde & exit /b 1)
) else if /I "%PM%"=="pnpm" (
  call pnpm install || (echo [ERROR] pnpm install faalde & exit /b 1)
) else (
  call npm install || (echo [ERROR] npm install faalde & exit /b 1)
)

echo:
echo [DONE] Clean reinstall voltooid.
echo:
echo Tips:
echo  - Start vervolgens met:  npx expo start -c
echo  - Voor Dev Client:      eas build -p android --profile development  ^&^&  npx expo start --dev-client
echo  - Voor Preview APK:     eas build -p android --profile preview
echo:
endlocal
exit /b 0
