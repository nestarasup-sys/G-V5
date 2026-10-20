# G-V5 — Architecture & Performance V1

Origem: `master-desenvolvimento` @ `1a72bfe30cda70fb76db56b30c298fea5b1b1ed3`. Branch de trabalho: `oai/architecture-performance-v1`. EDITOR-V4 não foi alterado.

## Princípio
Diagnosticar primeiro, reduzir trabalho desnecessário sem alterar semântica do projeto, manter testes de regressão em cada commit. Tamanho de arquivo é indício de acoplamento, **não** prova de lag.

## Inventário inicial
| Arquivo | Linhas iniciais | Risco a investigar |
|---|---:|---|
| CustomizerPage.tsx | 4053 | estado e geração de previews muito concentrados |
| electron/main.ts | 3617 | IPC e I/O centralizados no processo principal |
| VideoStudioEditor.tsx | 2613 | edição e composição estreitamente acopladas |
| StudioPage.tsx | 1673 | eventos de bibliotecas e gravação assíncrona |
| FabricatorPage.tsx | 1085 | observers duplicados e atualizações de layout |
| App.tsx | 856 | roteiros + roteamento no mesmo módulo |

## Fases e evidências / limites
1. **Diagnóstico (parcial):** inventário estático versionado em `scripts/architecture/performance-audit.cjs`; observação opcional de commits React por rota e long tasks no Chromium. Sem medições de FPS real/GPU ainda.
2. **Arquitetura (parcial):** budgets que impedem crescimento desses módulos sem revisão. Extração dos módulos grandes e limitação de dependências cruzadas continuam necessárias.
3. **Execução (parcial):** Fabricador substitui duas fontes de resize por ResizeObserver com comparação de dimensão; mantém rerun ao mudar projeto para não perder elemento montado tardiamente.
4. **Memória/dados (em diagnóstico):** não foi feita migração arriscada de SQLite, projeto ou assets. Coletar RSS, p95 de carregamento e retenção de imagens em hardware real antes de mudar caches e persistência.
5. **Regressão (em execução):** tests do budget e workflow Windows/Linux com typecheck, build e contratos de export. CI verde é necessário, mas não prova lag ausente.
6. **Windows real (bloqueada pelo ambiente):** requer sessão gráfica e dados do computador-alvo; não pode ser completada apenas por GitHub hospedado.

## Diagnóstico de interface — opt-in
No DevTools do aplicativo:

```js
sessionStorage.setItem('gv5:perf', '1')
location.reload()
```

Interaja com Customizador, Fabricador, Studio, Video Studio, Roteiros e Base. No console:

```js
window.__gv5PerformanceReport?.()
```

Os dados registram apenas nomes de rotas pré-definidos, duração média/máxima de commits e duração agregada de tarefas longas, sem nomes de projetos ou caminhos privados. O relatório também aparece ao fechar/navegar para fora da janela. Para desativar:

```js
sessionStorage.removeItem('gv5:perf')
location.reload()
```

React Profiler na build normal pode não produzir todos os eventos. PerformanceObserver `longtask` depende do Chromium. Zero não significa ausência de problema. Esses dados não substituem métricas de CPU/GPU nem benchmarks de cold/warm.

## Plano verificável de fechamento
- No HEAD exato: `node scripts/architecture/performance-audit.cjs --check`; `node --test tests/architecture-audit.test.cjs`; `npm run typecheck`; `npm run build`; `npm run test:export:synthetic`.
- Executar três vezes o mesmo fluxo de cada área em projetos sintéticos (100 / 1.000 / 10.000 itens quando aplicável), reportar mediana, p95, long tasks, RSS e comparação cold/warm.
- Testar abrir/sair repetidamente de todas as telas; validar saves pendentes, atalhos, undo/redo, cancel/recovery, paridade visual e exportação nos dois modos.
- Dividir Customizer, `electron/main` e VideoStudioEditor por responsabilidades, com testes de contratos antes de movimentar a implementação; fazer PRs pequenos e não misturar mudanças simultâneas de export.
- Comparar dados antes/depois no PC: `powershell -ExecutionPolicy Bypass -File scripts/video-studio/run-hardware-gate.ps1 -Include15Min`. Não subir mídia, caminhos nem personagens privados ao GitHub.
- Aprovar release somente se pacote Windows e sessões gráficas reais comprovarem ausência de regressões e o desempenho melhorar de modo mensurável.

**Estado:** esta rodada entrega infraestrutura de mensuração, prevenção de crescimento e primeira otimização; não representa certificação das seis fases. O gate local e a decomposição abrangente seguem abertos.
