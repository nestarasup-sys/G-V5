@echo off
setlocal
cd /d "%~dp0"
call "%~dp0tools\ambiente.bat"
if not exist "%DOTNET_ROOT%\dotnet.exe" (
  echo Execute Preparar.bat primeiro para baixar o SDK local.
  pause
  exit /b 1
)
if not exist "src\GV5.App\GV5.App.csproj" (
  echo Projeto Desktop nao encontrado. Consulte PLANO_DO_NOVO_APP.md.
  pause
  exit /b 1
)
"%DOTNET_ROOT%\dotnet.exe" watch --project "src\GV5.App\GV5.App.csproj" run
set "result=%errorlevel%"
if not "%result%"=="0" pause
exit /b %result%
