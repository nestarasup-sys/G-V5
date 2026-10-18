# Etapa A — Baseline DEV AI inicial, implementação e evidências

**Data:** 2026-10-18. **Branch de implementação:** `chore/dev-ai-baseline-2026-10-18` (derivada de `docs/refactor-review-2026-10-18@1a6b3b9`). **Estado:** implementação parcial de R-01, R-02, R-05 e R-25; **nenhuma delas está concluída** porque faltam build/IPC real/regressão em checkout completo.

## A. Mudanças de código realizadas

| Arquivo | Resultado e finalidade |
| --- | --- |
| `scripts/dev-ai/catalog.cjs` | Catálogo das 12 auditorias existentes com ID, modo, precondições, dados, risco e agrupamento. 7 pure Node em `fast`; uma auditoria Electron oculta em `isolation`; 4 legadas apenas manuais. |
| `scripts/dev-ai/baseline.cjs` | CLI `--list`, `--suite fast|isolation|all`; runner de processos em allowlist; timeout, sinais, cap de saída, report JSON e status pass/failed/inconclusive. Sem `npm ci` automático. |
| `scripts/dev-ai/boundary-scan.cjs` | Scanner de imports estáticos entre `src/renderer/src/features/*` e relatório de imports não resolvidos; não altera fontes. É leitura simples com regex, não substitui TS AST ou testes de runtime. |
| `scripts/audit-studio-isolation.cjs` | Preservada auditoria de layout original, acrescentado root de run por env com marker sintético e checagem de symlinks; ciclos repetidos e probe **de mock** das duas APIs. Ainda não testa IPC main real. |
| `tests/dev-ai-baseline.test.cjs` | Casos Node para registry, argumentos aceitos, containment de paths, ambiente isolado, redaction, listagem CLI, symlink e scanner de fronteiras com fixtures. |
| `package.json` | Novos comandos `test`, `test:dev-ai`, `audit:list`, `audit:boundaries`, `audit:fast`, `audit:isolation`, `audit:all`; sem dependências novas. |
| `.gitignore` | Adicionado `app-data/` à lista de conteúdos não versionados. |
| `README.md` | Runbook básico de comandos e limitações explícitas. |

**Atenção:** a auditoria de Studio usa `show:false`, que não garante `offscreen:true` nem cobertura de IPC. Ela carrega fixture-preload para validar layout e chamadas de API simuladas; screenshot só ocorre depois de `npm run build`. O scanner arquitetural está em modo informativo para não quebrar a branch com imports preexistentes antes de classificá-los.

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

**Comandos NÃO executados** no G-V5: `npm ci`, `npm run typecheck`, `npm run build`, `npm run audit:fast` com código completo, `npm run audit:isolation`, smoke real, E2E, IPC, testes de vídeo, benchmarks, comparação visual e migrations. Sem download/redeploy e sem acesso ao `userData` real.

## C. Como executar a próxima validação no checkout de confiança

1. Garantir Node versão suportada e `git status` limpo; preferir branch `chore/dev-ai-baseline-2026-10-18` e anotar SHA atual.
2. Verificar ausência de `app-data` versionado; **não** iniciar o app com perfil real durante testes.
3. Executar `npm ci` em workspace descartável, sabendo que o projeto já possui `postinstall` que instala Electron. Esse comando pode usar rede e deve ocorrer em ambiente de confiança com permissão de instalação. Verificar license/deps antes de alterar lockfile.
4. Executar `npm test` e `npm run audit:list`; coletar stdout, exit code, Node/npm, SO, SHA.
5. Executar `npm run audit:boundaries`, classificar os imports cross-feature sem bloqueio automático. Salvar relatório manualmente se quiser; o scanner não escreve arquivos.
6. Executar `npm run audit:fast`, conferir todos os 7 casos, timestamps, códigos e report JSON sob `out/dev-ai/runs/<run-id>`.
7. Executar `npm run audit:isolation` no SO/host com Electron/Chromium funcionando (xvfb quando aplicável); requer `typecheck`/build. Verificar `realIpcCovered:false` no result, screenshots antes/depois e código de saída.
8. Rodar UI/IPC real **separadamente** com harness específico de main que injete `app.setPath('userData')` antes do boot e não confie somente no fixture-preload. Essa capacidade é R-26 e permanece aberta.
9. Repetir a baseline em máquina/hardware declarados; não misturar render software/GPU, builds e versões. Arquivar métricas apenas de projetos sintéticos.

**Protocolos de segurança:** não apontar `--suite` para shell/comandos arbitrários; o runner só aceita 3 suites. Não passar mídia privada, projetos ou roteiros como fixture. `scripts/audit-animator-rig.mjs` fica excluído do runner, pois sem path explícito lê `APPDATA`. Relatórios e screenshots permanecem locais, em `out/`, sem commit. Shell child usa HOME/APPDATA de sandbox, mas ainda não é sandbox de rede em nível de SO; o código declara esse limite.

## D. Pendências e bloqueios (não marcar concluído)

- [ ] Executar todos os comandos no checkout completo com dependências instaladas em Windows e, se suportado, Linux.
- [ ] Conferir `npm run build` e `typecheck` no commit desta branch após edição dos scripts.
- [ ] Provar regressão visual e semântica real do Studio normal com uma janela oculta e fixture, guardar screenshot.
- [ ] Adapter que teste **IPC/preload real**, namespace de dados, falhas e alterações durante troca de área.
- [ ] Runner que bloqueie rede por política de SO/container e limpe process tree no Windows; atualmente só isola variáveis de ambiente, usa timeout e logs locais.
- [ ] Fuzz de paths/symlinks e prova que nenhum arquivo fora da sandbox foi lido/escrito.
- [ ] Suite de estado, atalhos, CSS, recursos, timers/RAF e persistência coberta por testes reais; os ciclos atuais testam layout e mocks.
- [ ] Métricas p50/p95 de startup/timeline/salvamento/RSS/CPU e baseline por fixture, hardware e commit.
- [ ] Classificação completa de import cross-feature com parser TS AST e allowlist versionada; o scanner inicial só encontra arestas estáticas simples.
- [ ] Testes de Windows sem privilégio de symlink, diferentes volumes/UNC e caminhos com espaços.

## E. Decisões deste incremento

- Não adicionar Vitest/Playwright/Axe/Rust antes de provar necessidade e compatibilidade do harness atual; primeiro adotar `node:test` da versão mínima de Node.
- Não instalar Electron via `npm ci` sem checkout e autorização explícita de ambiente; as alterações aqui são scripts sem nova dependência.
- Não ativar GitHub Actions externo automaticamente: evitar upload de código/logs privados e custo operacional não aprovado.
- Não criar PR/merge, não tocar `master`, não apagar arquivo legado. Commitar apenas código de testes e docs em branch.
- Não declarar R-01/R-05/R-25 como completos até resultados efetivos em checkout real.
