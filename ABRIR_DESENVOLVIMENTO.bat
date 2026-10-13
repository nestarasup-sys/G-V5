@echo off
setlocal
cd /d "%~dp0"

where node >nul 2>&1
if errorlevel 1 (
  echo Node.js nao foi encontrado. Instale Node.js 20.19+ ou 22.12+.
  pause
  exit /b 1
)

where npm >nul 2>&1
if errorlevel 1 (
  echo npm nao foi encontrado. Reinstale o Node.js com npm.
  pause
  exit /b 1
)

if not exist "node_modules\electron\install.js" (
  echo Preparando as dependencias do aplicativo...
  call npm install
  if errorlevel 1 (
    echo Nao foi possivel instalar as dependencias.
    pause
    exit /b 1
  )
)

if not exist "node_modules\electron\dist\electron.exe" (
  echo Instalando o executavel do Electron...
  call node scripts\install-electron.cjs
  if errorlevel 1 (
    echo Nao foi possivel instalar o executavel do Electron.
    pause
    exit /b 1
  )
)

if not exist "node_modules\electron\dist\electron.exe" (
  echo O Electron continua sem o executavel esperado em node_modules\electron\dist.
  echo Confira a conexao e as mensagens de instalacao acima.
  pause
  exit /b 1
)

echo Iniciando Gacha Nymi em modo de desenvolvimento...
echo Salve seus arquivos para aplicar as mudancas automaticamente.
echo Feche esta janela para encerrar o modo de desenvolvimento.
echo.
call npm run dev
set "devExitCode=%ERRORLEVEL%"

if not "%devExitCode%"=="0" (
  echo.
  echo O modo de desenvolvimento foi encerrado com erro %devExitCode%.
  pause
)

exit /b %devExitCode%
