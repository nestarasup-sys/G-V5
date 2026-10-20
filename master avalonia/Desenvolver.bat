@echo off
setlocal
cd /d "%~dp0"
call "%~dp0tools\ambiente.bat"
if not exist "%DOTNET_ROOT%\dotnet.exe" (
  echo Execute Preparar.bat primeiro para baixar o SDK local.
  pause
  exit /b 1
)
if not exist "src\GachaNymi.Desktop\GachaNymi.Desktop.csproj" (
  echo Ambiente preparado. O projeto do aplicativo ainda sera criado na proxima etapa.
  pause
  exit /b 1
)
"%DOTNET_ROOT%\dotnet.exe" watch --project "src\GachaNymi.Desktop\GachaNymi.Desktop.csproj" run
set "result=%errorlevel%"
if not "%result%"=="0" pause
exit /b %result%
