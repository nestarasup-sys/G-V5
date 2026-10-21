# GATE-F00 — auditoria, baseline e sincronização

- **Resultado:** PASSOU para o escopo de auditoria F00.
- **Data:** 2026-10-20
- **Branch:** `Master-AValonia`
- **HEAD observado antes do relatório:** `c587e8a` (checkpoint F00.12).
- **Ambiente:** Windows x64, build `10.0.26300`, .NET SDK portátil `10.0.402`, Avalonia `12.1.4` conforme baseline do repositório.
- **Limite:** este gate prova baseline e shell atual. Não declara Fabricador, Customizador, engines, persistência funcional nem fluxo vertical de produto prontos. A reconstrução continua no F01.

## Critérios de entrada e evidências

| Critério | Resultado/evidência |
| --- | --- |
| Branch e escopo isolado | `git branch --show-current` = `Master-AValonia`; alterações e novos artefatos estão restritos a `master avalonia/`. Legado externo permaneceu somente leitura. |
| Solução e projetos | `dotnet sln GV5.sln list` lista 12 projetos. Baseline detalha quais possuem implementação e quais ainda são shells. |
| Restore | `.tools/dotnet/dotnet.exe restore GV5.sln --verbosity minimal` terminou com exit 0; 11/12 projetos já estavam atualizados e `GV5.App` restaurou em 1,05 min. |
| Build Release | `.tools/dotnet/dotnet.exe build GV5.sln -c Release --no-restore --verbosity minimal` terminou com exit 0, 0 avisos e 0 erros; todos os 12 assemblies foram produzidos. |
| Smoke de inicialização | `.tools/dotnet/dotnet.exe run --project src/GV5.App/GV5.App.csproj -c Release --no-build` manteve o processo `GV5.App` ativo. `Get-Process` observou título `G-V5 Avalonia` e `Responding=True` após cerca de 10 s. O processo foi encerrado com Ctrl+C. |
| Inspeção visual | **NÃO EXECUTADA.** A existência do título e estado Responding comprovam inicialização do processo/janela, não aparência, interação ou GPU. |
| Testes automatizados | Não existe projeto de teste C# na solução neste checkpoint; `dotnet test` não foi executado. A fixture F00.12 foi validada como JSON e suas referências foram verificadas por script PowerShell, mas isso não é teste da aplicação. |
| Inventário e paridade | `docs/legacy-contracts/FABRICADOR_INVENTARIO.md`, `OUTRAS_AREAS_INVENTARIO.md`, `MATRIZ_PARIDADE.md` com 47 funcionalidades e `FORMATOS_E_IDS_ELECTRON.md` registram evidência estática e lacunas. |
| Decisão geométrica | `docs/decisions/ADR-0001-coordinate-and-rendering-contract.md` fixa convenções para implementação futura; sem testes de geometria/golden ainda. |
| Fixture sintética | `tests/Fixtures/vertical-flow/fixture.json` é JSON válido: 6 partes, 5 juntas, 2 poses e relações consistentes. O README explicita que ainda não há builder, raster de fixture ou golden. |
| Integridade de mudanças | `git diff --check` passou nos artefatos das tarefas F00.08–F00.12. Commits pequenos e checkpoint foram gravados localmente; nenhum push foi feito. |

## Conclusão

F00 pode ser fechada: as 13 tarefas da fase têm evidência registrada em `EXECUTION_STATUS.md`, a solução restaura/compila e o shell inicia em Windows. Isso é um baseline de reconstrução, não aceite de arquitetura por comportamento de produto. O fluxo Fabricador → Customizador → Studio permanece não implementado e precisa ser comprovado nos gates F01–F12 com persistência após reinício e comparação visual da fixture.

## Pendências explícitas para fases seguintes

- Abrir e inspecionar visualmente a janela em uma sessão Windows com captura verificável.
- Criar projetos de teste úteis e reproduzíveis; não há testes C# nesta solution ainda.
- Implementar o pipeline básico de dados/asset/geometria/render e materializar a fixture em pixels/goldens.
- Executar o fluxo vertical completo, salvar, fechar o processo e reabrir os dados sintéticos.

