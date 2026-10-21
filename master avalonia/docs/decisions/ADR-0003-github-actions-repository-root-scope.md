# ADR-0003 — Workflow do GitHub exige arquivo na raiz do repositório

- **Estado:** Aceita; escopo excepcional autorizado
- **Data:** 2026-10-20
- **Escopo:** F01.12 — GitHub Actions

## Contexto

F01.12 pede uma GitHub Action para build/teste. O GitHub só descobre workflows em `.github/workflows/` na raiz do repositório. O limite vigente em `AGENTS.md` e na meta desta execução permite alterar somente `master avalonia/`; portanto, o diretório ativo de workflows está fora do escopo.

Colocar um YAML em `master avalonia/.github/workflows/` não atende F01.12: por ser uma pasta aninhada, o GitHub não o executaria. Um workflow fora do escopo alteraria a raiz/legado que está definido como somente leitura.

## Decisão

O usuário autorizou explicitamente a criação do workflow executável em `.github/workflows/` na raiz. Essa é a única exceção ao limite de edição restrito a `master avalonia/`; nenhum outro arquivo da raiz ou do legado pode ser alterado. Não criar workflow aninhado inerte.

O workflow compila e testa a solução a partir de `master avalonia/`, usa o SDK fixado em `global.json` e executa a suíte Avalonia Headless. Windows é obrigatório. Linux entra na matriz para comprovar compatibilidade; eventual incompatibilidade deve ser corrigida ou documentada com evidência antes de remover essa plataforma.

## Consequências

- A suíte local `dotnet test GV5.sln -c Release` continua disponível, mas não é CI remota.
- O YAML do workflow é o único arquivo permitido fora de `master avalonia/`; o restante do legado permanece somente leitura.
