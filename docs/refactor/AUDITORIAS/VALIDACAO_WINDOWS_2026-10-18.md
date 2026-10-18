# Validação do DEV AI em Windows — 2026-10-18

**Branch:** `codex/dev-ai-validation-2026-10-18`, derivada de `chore/dev-ai-baseline-2026-10-18` (`7a4a369822264788b1bbf5c4e9512ece64ea2f9a`).
**Ambiente:** Windows 11 Pro x64 (`10.0.26300`), Node `v24.18.0`, npm `11.16.0`.
**Escopo:** validar o runner no checkout completo e comprovar isolamento de dados sintéticos entre Studio normal e Video Studio via processo Electron e IPC reais. Não houve leitura de `userData` real, APPDATA real, mídia ou projetos do usuário.

## Resultados

| Comando | Resultado |
| --- | --- |
| `npm ci` | Passou; 89 pacotes adicionados, 0 vulnerabilidades. O npm informou scripts de instalação pendentes de aprovação para esbuild 0.25.12 e 0.28.2; `postinstall` instalou o Electron. `package-lock.json` não mudou. |
| `npm test` | Passou: 6 aprovados, 0 falhas, 2 skips. Um teste evita tocar em `out/` preexistente; o sistema bloqueou a criação de symlink em outro teste. |
| `npm run typecheck` | Passou. |
| `npm run build` | Passou; gerou main, preload e renderer Electron. Bundles observados incluem Fabricator 1,294.15 kB, shell 730.39 kB, Customizer 331.41 kB, Video Studio 310.73 kB e Studio 126.20 kB. Tamanhos não são benchmark de desempenho. |
| `npm run audit:fast` | Passou: 7/7 auditorias sintéticas. Relatório em `out/dev-ai/runs/2026-10-18T21-19-26-631Z-0559bd6f-7d6f-4643-983f-b58dbfba2fbd/report.json`. |
| `npm run audit:isolation` | Passou com fixture-preload: 4 ciclos e captura antes/depois dos Studios. `realIpcCovered:false`; comprova layout da janela e navegação dentro da cobertura do fixture, não integração de storage. Capturas e resultado ficam no mesmo diretório local da execução. |
| `npm run audit:ipc` | Passou com Electron compilado, preload e IPC reais em `userData` sintético. 10 salvamentos válidos por namespace; UUID igual nos dois; hashes do namespace oposto invariantes durante cada escrita; 4 chamadas malformadas recusadas; processo reiniciado e documentos relidos; root fora do diretório permitido recusado. |
| `npm run audit:all` | Passou em 33 s: typecheck, build, 7 casos rápidos, auditoria visual fixture-preload e auditoria IPC real. Run ID `2026-10-18T21-31-38-524Z-ff41dcd7-d99d-413d-9259-8c85dc776fae`; relatório local `out/dev-ai/runs/<run-id>/report.json`. O relatório identifica o SHA base `7a4a369822264788b1bbf5c4e9512ece64ea2f9a`, pois a execução antecedeu o commit desta validação. |
| `npm run audit:all` após o commit `4b099cb6ec058c5e7e6433b65bc74b7bcf62e8b6` | Passou em 34 s em Windows; 7/7 rápidas, fixture dos Studios e IPC real. Run ID `2026-10-18T21-35-46-605Z-3a9e5afc-3bb5-475a-b521-d7163608728c`; relatório registrou o SHA do próprio commit. |
| `npm run audit:boundaries` | Scanner estático passou e informou 10 imports entre features e 1 import não resolvido aparente de asset com sufixo Vite `?inline`. Veja a saída de console. É regex, não análise TypeScript/JSX completa. |

IPC real: `out/dev-ai/runs/<run-id>/studio-ipc-real/report.json`, `seed-result.json` e `restart-result.json`. Os documentos sintéticos foram escritos apenas em `out/dev-ai/runs/<run-id>/sandbox/electron-user-data/studios/{Studio Principal,Video Studio}`. A auditoria não monitora globalmente o filesystem; `outsideSandboxWritesObserved=0` significa somente que as APIs exercitadas resolveram os diretórios validados.

## Cobertura arquitetural observada

O scanner encontrou dependências entre Customizer e Fabricator (incluindo helpers de rig/renderização e um componente `DesignWorkspace`), imports de Studio/Video Studio para Customizer, além de um helper de expressões entre Studio e Video Studio. São achados estáticos para triagem, não prova de defeito runtime. O Fabricator e o Customizer foram compilados, porém **não** foram montados em smoke Electron independente nesta execução. A matriz ISO-01–ISO-15 não foi executada integralmente; lifecycle, atalhos/teclas, CSS computado, persistência de mídia, crash recovery e shared capability permanecem abertos.

Não foi executado benchmark de 20 repetições. Não afirmar ganho de velocidade ou regressão; os tamanhos de bundles acima são apenas referência inicial. Também não houve migração, acesso a dados reais, screenshots de Customizer/Fabricator nem teste físico de release.

## Ajustes descobertos durante a execução

As primeiras tentativas do IPC harness revelaram três defeitos no harness: criação tardia do diretório de saída, uso das variáveis de ambiente que o runner remove deliberadamente, e resolução do diretório raiz um nível acima do correto. Após corrigir, executar o IPC real isoladamente passou; a suíte combinada voltou a passar. Esses problemas não foram bugs do app.

`npm run audit:ipc` ainda pode exibir aviso Node `[DEP0190]` do runner ao invocar `npm.cmd` com `shell:true` no Windows. Isso não impediu as auditorias, mas deve ser resolvido em melhoria posterior usando resolução de executável compatível com Windows sem composição de shell insegura. O runner não bloqueia a rede em nível de sistema operacional e não é sandbox OS; os testes usados aqui não invocaram serviços de rede.

## Estado de aceite

Os resultados fecham uma validação reproduzível de build, das auditorias existentes e do contrato de persistência de Studio/Video Studio em sandbox sintética. Não concluem a refatoração, nem os itens R-01/R-02/R-05/R-25/R-26 por inteiro. Permanecem necessários: classificar arestas entre todas as features; smoke real de Customizer, Fabricator e Opções; ampliar IPC a ataques de path/namespace e mídia; matriz ISO completa; instrumentação de processo e controle de rede; benchmarks p50/p95 em 20 repetições; baseline visual comparável; e gates de recuperação/migração antes de qualquer alteração de dados.
