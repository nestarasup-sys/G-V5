@echo off
setlocal EnableExtensions
cd /d "%~dp0"
title Atualizar Gacha Nymi pelo GitHub

echo ==========================================
echo   Atualizador do Gacha Nymi V5
echo ==========================================
echo.

where git >nul 2>&1
if errorlevel 1 (
  echo ERRO: Git nao foi encontrado neste computador.
  echo Instale o Git e tente novamente.
  goto :failed
)

git rev-parse --show-toplevel >nul 2>&1
if errorlevel 1 (
  echo ERRO: esta pasta nao parece ser uma copia Git do projeto.
  goto :failed
)

for /f "delims=" %%B in ('git branch --show-current') do set "CURRENT_BRANCH=%%B"
if /i not "%CURRENT_BRANCH%"=="master" (
  echo ERRO: a copia esta na branch "%CURRENT_BRANCH%".
  echo Este atualizador usa somente a branch principal master.
  echo Mude para master depois que o trabalho da outra branch estiver integrado.
  goto :failed
)

set "LOCAL_CHANGES="
for /f "delims=" %%S in ('git status --porcelain') do set "LOCAL_CHANGES=1"
if defined LOCAL_CHANGES (
  echo ERRO: ha arquivos modificados ou novos nesta copia.
  echo Salve ou faca commit do seu trabalho antes de atualizar.
  echo Nenhum arquivo local foi sobrescrito.
  goto :failed
)

echo Buscando atualizacoes da branch master no GitHub...
echo.
git pull --ff-only origin master
if errorlevel 1 (
  echo.
  echo A atualizacao foi interrompida. A branch local pode ter divergido.
  echo Nenhum merge automatico foi feito. Peca ajuda antes de continuar.
  goto :failed
)

echo.
echo Atualizacao concluida.
echo Para abrir o aplicativo, execute ABRIR_DESENVOLVIMENTO.bat.
echo Este atualizador sincroniza os arquivos; ele nao compila nem abre o app.
goto :done

:failed
echo.
echo Atualizacao nao concluida.

:done
echo.
pause
endlocal
