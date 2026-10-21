@echo off
setlocal EnableExtensions
cd /d "%~dp0" || exit /b 1
call "%~dp0tools\ambiente.bat" || exit /b 1

set "DOTNET_EXE=%DOTNET_ROOT%\dotnet.exe"
set "HEADLESS_PROJECT=%~dp0tests\GV5.Headless.Tests\GV5.Headless.Tests.csproj"
if not exist "%DOTNET_EXE%" (
  echo [ERRO] SDK portatil ausente. Execute Preparar.bat.
  exit /b 2
)
if not exist "%HEADLESS_PROJECT%" (
  echo [ERRO] Suite headless nao encontrada: "%HEADLESS_PROJECT%".
  exit /b 3
)

set "MODE=%~1"
if "%MODE%"=="" set "MODE=rapido"
if /i "%MODE%"=="rapido" goto :quick
if /i "%MODE%"=="gate" goto :gate
if /i "%MODE%"=="headless" goto :headless

echo Uso: TestarLocal.bat [rapido ^| gate ^| headless]
exit /b 2

:quick
echo [G-V5] Testes locais rapidos - Debug incremental, sem janelas.
"%DOTNET_EXE%" build "GV5.sln" -c Debug --verbosity minimal
if errorlevel 1 goto :fail
"%DOTNET_EXE%" test "GV5.sln" -c Debug --no-build --verbosity minimal
if errorlevel 1 goto :fail
"%DOTNET_EXE%" run --project "%HEADLESS_PROJECT%" --configuration Debug
if errorlevel 1 goto :fail
goto :success

:gate
echo [G-V5] Validacao local de gate - Release, sem janelas.
"%DOTNET_EXE%" restore "GV5.sln" --verbosity minimal
if errorlevel 1 goto :fail
"%DOTNET_EXE%" restore "%HEADLESS_PROJECT%" --verbosity minimal
if errorlevel 1 goto :fail
"%DOTNET_EXE%" build "GV5.sln" -c Release --no-restore --verbosity minimal
if errorlevel 1 goto :fail
"%DOTNET_EXE%" test "GV5.sln" -c Release --no-build --verbosity minimal
if errorlevel 1 goto :fail
"%DOTNET_EXE%" run --project "%HEADLESS_PROJECT%" --configuration Release --no-restore
if errorlevel 1 goto :fail
goto :success

:headless
echo [G-V5] Suite de interface invisivel.
call "%~dp0TestarHeadless.bat"
if errorlevel 1 goto :fail
goto :success

:success
echo [G-V5] PASSOU: modo %MODE% - testes executados localmente.
exit /b 0

:fail
set "EXIT_CODE=%ERRORLEVEL%"
if "%EXIT_CODE%"=="0" set "EXIT_CODE=1"
echo [G-V5] FALHOU: modo %MODE%, exit code %EXIT_CODE%.
exit /b %EXIT_CODE%
