@echo off
setlocal EnableExtensions
cd /d "%~dp0" || exit /b 1
call "%~dp0ambiente.bat" || exit /b 1
"%DOTNET_ROOT%\dotnet.exe" run --project "%~dp0GV5.Geometry.Benchmarks\GV5.Geometry.Benchmarks.csproj" --configuration Release
exit /b %ERRORLEVEL%
