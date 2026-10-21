# ADR-0003 — Workflow do GitHub exige arquivo na raiz do repositório

- **Estado:** Bloqueada por limite de escopo
- **Data:** 2026-10-20
- **Escopo:** F01.12 — GitHub Actions

## Contexto

F01.12 pede uma GitHub Action para build/teste. O GitHub só descobre workflows em `.github/workflows/` na raiz do repositório. O limite vigente em `AGENTS.md` e na meta desta execução permite alterar somente `master avalonia/`; portanto, o diretório ativo de workflows está fora do escopo.

Colocar um YAML em `master avalonia/.github/workflows/` não atende F01.12: por ser uma pasta aninhada, o GitHub não o executaria. Um workflow fora do escopo alteraria a raiz/legado que está definido como somente leitura.

## Decisão

Não criar um workflow aninhado inerte e não escrever fora de `master avalonia/`. Manter F01.12 bloqueada até o escopo ser ampliado para permitir somente `.github/workflows/` na raiz, ou até que uma instrução superior defina outro local executável compatível com a fronteira.

Depois de liberada, a implementação deverá continuar compilando e testando a solução a partir de `master avalonia/`, com SDK fixado em `global.json`; Windows será obrigatório e Linux será incluído se a execução comprovar compatibilidade.

## Consequências

- A suíte local `dotnet test GV5.sln -c Release` continua disponível, mas não é CI remota.
- F01.13 e o fechamento de G0 não podem ser declarados concluídos enquanto F01.12 estiver bloqueada.
- Nenhum arquivo do legado ou da raiz do repositório foi modificado.
