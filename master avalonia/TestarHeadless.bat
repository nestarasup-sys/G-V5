@echo off
setlocal
cd /d "%~dp0" || exit /b 1

rem Load the portable SDK and NuGet paths; do not require Visual Studio/global dotnet.
call "%~dp0tools\ambiente.bat" || exit /b 1
set "DOTNET_EXE=%DOTNET_ROOT%\dotnet.exe"
if not exist "%DOTNET_EXE%" (
  echo [ERRO] SDK .NET portatil nao encontrado. Execute Preparar.bat primeiro.
  exit /b 2
)

rem xUnit v3 test runner runs in the console. Nothing launches GV5.App or a desktop window.
rem Extra args after -- are passed straight to the runner (e.g. -list).
"%DOTNET_EXE%" run --project "%~dp0tests\GV5.Headless.Tests\GV5.Headless.Tests.csproj" --configuration Release -- %*
set "EXIT_CODE=%ERRORLEVEL%"
if not "%EXIT_CODE%"=="0" echo [ERRO] Testes headless falharam com codigo %EXIT_CODE%.
exit /b %EXIT_CODE%
