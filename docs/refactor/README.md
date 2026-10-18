# Revisão de refatoração do G-V5 — índice

**Data da revisão estática:** 2026-10-18. **Base inspecionada:** `master` em `5b8483454757f4cc9606c626471aabbeccf35daa`. **Estado:** documentação de planejamento; nenhuma refatoração de runtime, migração de dados, instalação ou suíte foi executada nesta revisão.

## Fontes de verdade — não duplicar especificações

| Assunto | Documento normativo |
| --- | --- |
| Visão, metas, princípios, decisões de produto e gates gerais | [Plano principal](../PLANO_ESTRUTURA_PROJETO_E_DADOS.md) |
| Inventário observado, caminhos, provas, divergências, histórico e pendências | [INVENTARIO_E_EVIDENCIAS.md](INVENTARIO_E_EVIDENCIAS.md) |
| Ordem de execução, tarefas marcáveis, dependências, esforço, rollback e critérios | [ROADMAP_EXECUTAVEL.md](ROADMAP_EXECUTAVEL.md) |
| Política de dados, formato portátil, transações, backups e restauração | [DADOS_E_RECUPERACAO.md](DADOS_E_RECUPERACAO.md) |
| Isolamento e contrato de runner DEV AI, suites, evidências e matriz | [ISOLAMENTO_STUDIOS_E_DEV_AI.md](ISOLAMENTO_STUDIOS_E_DEV_AI.md) |
| Segurança, logging, performance, acessibilidade e operação | [QUALIDADE_E_OPERACAO.md](QUALIDADE_E_OPERACAO.md) |
| Análise de stack, alternativas e decisões a validar | [DECISOES/ADR-0001-runtime-e-testes.md](DECISOES/ADR-0001-runtime-e-testes.md) |
| Resultados das verificações realmente executadas nesta revisão e limites | [AUDITORIAS/REVISAO_ESTATICA_2026-10-18.md](AUDITORIAS/REVISAO_ESTATICA_2026-10-18.md) |
| Implementação inicial do DEV AI, comandos e resultados sintéticos da Etapa A | [AUDITORIAS/BASELINE_DEV_AI_2026-10-18.md](AUDITORIAS/BASELINE_DEV_AI_2026-10-18.md) |
| Validação real do runner/IPC em Windows e limites da cobertura em 2026-10-18 | [AUDITORIAS/VALIDACAO_WINDOWS_2026-10-18.md](AUDITORIAS/VALIDACAO_WINDOWS_2026-10-18.md) |
| Handoff técnico detalhado para Codex executar testes reais em Windows/Electron/IPC | [CODEX_HANDOFF_EXECUCAO_WINDOWS_E_IPC.md](CODEX_HANDOFF_EXECUCAO_WINDOWS_E_IPC.md) |

**Histórico:** a versão anterior integral do plano permanece recuperável no Git em [`5b848345`](https://github.com/nestarasup-sys/G-V5/blob/5b8483454757f4cc9606c626471aabbeccf35daa/docs/PLANO_ESTRUTURA_PROJETO_E_DADOS.md). Esta versão é histórico, **não** uma segunda fonte normativa. O documento `docs/STUDIO_WORKSPACES.md` foi removido em `192245e`; não criar links correntes para ele.

## Regras de evidência e atualização

- **Confirmado:** observado em código versionado na base, com arquivo/linha, ou resultado reproduzível anexado. **Desatualizado:** afirmação explicitamente contrariada pela base. **Incompleto:** parcialmente válido, omite aspecto material. **Não comprovado:** requer execução, ambiente real, inspeção visual ou dados de usuário.
- Uma leitura estática **não** comprova que um teste passa, que um bug está reproduzido, que um benchmark melhorou ou que os dados reais foram copiados.
- `[x]` só depois de artefato identificável (comando, ambiente, SHA, saída, evidência, data e responsável) e gate aceito; `[ ]` significa aberto. Nunca marcar por intenção ou existência de um arquivo.
- Cada mudança deve ter ID `R-xx`, tipo (investigação / documentação / código / migração / validação), escopo, dependências, hipótese, prova, plano de reversão e aceitação. Bugs e riscos abertos têm dono e prioridade.
- Reabrir observações se a branch de implementação divergir do SHA-base; citar caminho e ref. Não anexar capturas de imagens pessoais, projetos de usuário, paths completos, tokens ou logs não redigidos.
- ADR substituída recebe `Status: superada por ADR-...`; o contexto permanece legível. Notas experimentais têm data, resultado e link para decisão; não devem virar arquitetura por acidente.

## Disciplina de execução

Antes de modificar runtime: criar baseline e sandbox de testes, registrar fluxos de risco, confirmar perfil de produção e regras de portabilidade. Nunca testar migração destrutiva com `userData` real. A ordem e os bloqueios são definidos no roadmap. Uma alteração em `shared/`, `electron/preload.ts`, `electron/main.ts`, `src/renderer/src/ui/styles.css` ou shell de rotas exige regressão dos **dois** Studios e das demais áreas afetadas, não apenas da feature alterada.

## Estado desta revisão

- [x] Leitura integral do plano original via GitHub e levantamento da árvore versionada da branch base.
- [x] Revisão estática direcionada de entradas, persistência, canais IPC, CSS, workspaces, scripts, dependências e commits relevantes — evidências e limites no inventário.
- [x] Proposição documental de fases, critérios mensuráveis e isolamento DEV AI.
- [x] Rodar `npm ci`, `npm run typecheck`, `npm run build` e auditorias sintéticas/IPC em Windows — [resultados e limites](AUDITORIAS/VALIDACAO_WINDOWS_2026-10-18.md).
- [ ] Inventário de todos os dados reais e `localStorage` instalado.
- [ ] Teste cross-workspace completo ISO-01–ISO-15 e smoke de Customizer/Fabricador; validação parcial de layout dos Studios e IPC real documentada no relatório Windows.
- [ ] Benchmark reproduzível e comparação antes/depois.
- [ ] Qualquer migração ou mudança de código de produção.

**Escopo da edição documental:** não cria `app-data/`, não executa exclusões, não toca mídia nem altera o comportamento do aplicativo.
