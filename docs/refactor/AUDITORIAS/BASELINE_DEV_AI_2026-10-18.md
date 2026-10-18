# Etapa A — Baseline DEV AI inicial, implementação e evidências

**Data:** 2026-10-18. **Branch inicial:** `chore/dev-ai-baseline-2026-10-18` (derivada de `docs/refactor-review-2026-10-18@1a6b3b9`). Este registro preserva os resultados do primeiro ambiente sintético. A validação posterior no checkout completo de Windows está em [VALIDACAO_WINDOWS_2026-10-18.md](VALIDACAO_WINDOWS_2026-10-18.md).

## A. Mudanças de código realizadas

| Arquivo | Resultado e finalidade |
| --- | --- |
| `scripts/dev-ai/catalog.cjs` | Catálogo das auditorias existentes com ID, modo, precondições, dados, risco e agrupamento. Inclui auditoria Electron real de IPC em `ipc`. |
| `scripts/dev-ai/baseline.cjs` | CLI `--list`, `--suite fast|isolation|ipc|all`; runner de processos em allowlist; timeout, sinais, cap de saída, report JSON e status pass/failed/inconclusive. Sem `npm ci` automático. |
| `scripts/dev-ai/boundary-scan.cjs` | Scanner de imports estáticos entre `src/renderer/src/features/*` e relatório de imports não resolvidos; não altera fontes. É leitura simples com regex, não substitui TS AST ou testes de runtime. |
| `scripts/audit-studio-isolation.cjs` | Preservada auditoria de layout original, acrescentado root de run por env com marker sintético e checagem de symlinks; ciclos repetidos e probe **de mock** das duas APIs. Ainda não testa IPC main real. |
| `scripts/audit-studio-ipc.cjs` e `scripts/dev-ai/studio-ipc-driver.cjs` | Controlador e driver que executam o main compilado, preload, IPC e filesystem reais contra userData sintético; 10 gravações por namespace, colisão de UUID, restart e root inválido. |
| `tests/dev-ai-baseline.test.cjs` | Casos Node para registry, argumentos aceitos, containment de paths, ambiente isolado, redaction, listagem CLI, symlink e scanner de fronteiras com fixtures. |
| `package.json` | Novos comandos `test`, `test:dev-ai`, `audit:list`, `audit:boundaries`, `audit:fast`, `audit:isolation`, `audit:ipc`, `audit:all`; sem dependências novas. |
| `.gitignore` | Adicionado `app-data/` à lista de conteúdos não versionados. |
| `README.md` | Runbook básico de comandos e limitações explícitas. |

**Atenção:** a auditoria de Studio usa `show:false`, que não garante `offscreen:true`; ela usa fixture-preload para validar layout e chamadas simuladas. A cobertura separada de IPC real adicionada depois está registrada no [relatório Windows](VALIDACAO_WINDOWS_2026-10-18.md). O scanner arquitetural segue informativo e não substitui análise AST.

## B. Comandos realmente executados nesta sessão

Executados em workspace **sintético local de desenvolvimento do runner** (`/mnt/data/gv5-work`), não no checkout completo do G-V5. Ambiente: Linux, Node.js `v22.16.0`, npm `10.9.2`. Esse isolamento é proposital, mas impede interpretar resultados como aprovação do aplicativo real.

| Comando | Resultado real | Interpretação |
| --- | --- | --- |
| `node --check scripts/dev-ai/baseline.cjs` | exit 0 | Sintaxe da versão local do runner válida |
| `node --check scripts/dev-ai/catalog.cjs` | exit 0 | Sintaxe de catálogo válida |
| `node --check scripts/dev-ai/boundary-scan.cjs` | exit 0 | Sintaxe do scanner válida |
| `node --test tests/dev-ai-baseline.test.cjs` | **8/8 passaram**, 0 falharam; ~137 ms | Testes de harness e fixtures, não do G-V5 |
| `node scripts/dev-ai/baseline.cjs --list` | exit 0 | Catálogo consultável sem dependências |
| `node scripts/dev-ai/baseline.cjs --suite fast` | **exit 2 — inconclusive** | `node_modules/typescript` ausente no workspace sintético; runner falha fechado, sem inventar pass |
| `node scripts/dev-ai/boundary-scan.cjs` em árvore sintética | 2 fontes, 1 import cruzado, 0 imports não resolvidos | Scanner detectou dependência Video Studio→Studio inserida na fixture |
| Verificação sintática da versão persistida no GitHub via parser JS | quatro arquivos CJS, sem erro sintático | **Não** prova que compilem/rodem no repositório alvo |

**À época deste primeiro registro, não foram executados** no checkout completo: `npm ci`, typecheck/build, auditorias completas, smoke real, E2E, IPC, benchmarks, comparação visual e migrações. A validação subsequente está no relatório Windows.

## C. Como executar a próxima validação no checkout de confiança

1. Garantir Node versão suportada e `git status` limpo; preferir branch `chore/dev-ai-baseline-2026-10-18` e anotar SHA atual.
2. Verificar ausência de `app-data` versionado; **não** iniciar o app com perfil real durante testes.
3. Instalar dependências em workspace descartável apenas se o lockfile tiver mudado. `npm ci` pode usar rede e executar o `postinstall` de Electron; anote suas versões e avisos.
4. Executar `npm test` e `npm run audit:list`; coletar stdout, exit code, Node/npm, SO, SHA.
5. Executar `npm run audit:boundaries`, classificar os imports cross-feature sem bloqueio automático. Salvar relatório manualmente se quiser; o scanner não escreve arquivos.
6. Executar `npm run audit:fast`, conferir todos os 7 casos, timestamps, códigos e report JSON sob `out/dev-ai/runs/<run-id>`.
7. Executar `npm run audit:isolation`; conferir `realIpcCovered:false` no resultado fixture e as screenshots antes/depois.
8. Executar `npm run audit:ipc` e revisar o relatório de sandbox real do main/preload/IPC. A matriz completa de IPC/lifecycle continua aberta em R-26.
9. Repetir a baseline em máquina/hardware declarados; não misturar render software/GPU, builds e versões. Arquivar métricas apenas de projetos sintéticos.

**Protocolos de segurança:** não apontar `--suite` para shell/comandos arbitrários; o runner aceita suites allowlisted. Não passar mídia privada, projetos ou roteiros como fixture. `scripts/audit-animator-rig.mjs` fica excluído do runner, pois sem path explícito lê `APPDATA`. Relatórios e screenshots ficam em `out/`; não versionar execuções locais. HOME/APPDATA são sintéticos no child, porém isso não equivale a sandbox de rede ou filesystem em nível de SO.

## D. Pendências e bloqueios (não marcar concluído)

- [x] Executar `npm ci`, testes, typecheck/build, audit:fast/isolation/ipc/all e scanner no checkout completo em Windows; evidências e SHA base no [relatório Windows](VALIDACAO_WINDOWS_2026-10-18.md).
- [ ] Repetir validação no commit final e executar em outra plataforma suportada.
- [x] Capturar regressão de layout Studio normal ↔ Video Studio em janela oculta fixture; semântica de storage foi exercitada separadamente com IPC real.
- [x] Adapter IPC/preload real para persistência, namespace, restart e rejeição de root inválido; ampliar para lifecycle, mudanças entre áreas e vetores da matriz ISO.
- [ ] Runner que bloqueie rede por política de SO/container e limpe process tree no Windows; atualmente só isola variáveis de ambiente, usa timeout e logs locais.
- [ ] Fuzz de paths/symlinks e monitoramento OS-level que prove nenhuma leitura/escrita fora da sandbox.
- [ ] Suite de estado, atalhos, CSS, recursos, timers/RAF e persistência coberta por testes reais; os ciclos atuais testam layout e mocks.
- [ ] Métricas p50/p95 de startup/timeline/salvamento/RSS/CPU e baseline por fixture, hardware e commit.
- [ ] Classificação completa de import cross-feature com parser TS AST e allowlist versionada; o scanner inicial só encontra arestas estáticas simples.
- [ ] Testes de Windows sem privilégio de symlink, diferentes volumes/UNC e caminhos com espaços.

## E. Decisões deste incremento

- Não adicionar Vitest/Playwright/Axe/Rust antes de provar necessidade e compatibilidade do harness atual; `node:test` cobre o baseline inicial.
- A validação Windows instalou dependências em checkout local e usou Electron instalado pelo `postinstall`; nenhuma dependência nova foi adicionada.
- Não ativar GitHub Actions externo automaticamente: evitar upload de código/logs privados e custo operacional não aprovado.
- Não criar PR/merge, não tocar `master`, não apagar arquivo legado. Commitar apenas código de testes e docs em branch.
- Não declarar R-01/R-05/R-25 como completos até resultados efetivos em checkout real.
