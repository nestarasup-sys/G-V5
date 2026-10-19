# Revisão de refatoração do G-V5 — índice

**Data da revisão estática:** 2026-10-18. **Base inspecionada:** `master` em `5b8483454757f4cc9606c626471aabbeccf35daa`. **Estado:** a primeira revisão foi documental. As branches posteriores implementaram runner DEV AI, IPC Electron sintético, GitHub Actions e proteções direcionadas ao fluxo de roupas; migração de dados reais e matriz AF/ISO completa continuam não executadas.

**Atualização local 2026-10-19:** os gates de teste, build, typecheck, auditorias rápidas, isolamento e IPC passaram na branch `codex/finalizar-dev-ai-local`; Ayla e Chloe foram testadas somente em cópias privadas com backup verificado. As matrizes AF e ISO permanecem parciais. Resultados e limites: [validação local](AUDITORIAS/VALIDACAO_LOCAL_2026-10-19.md).

**Estado consolidado em 2026-10-19:** o [PR #3](https://github.com/nestarasup-sys/G-V5/pull/3) integrou o DEV AI à `master` (`3b70ceef`) e criou `master-desenvolvimento` a partir desse commit. A interface do Fabricador possui **um único Roupas Dev**; 1.0/2.0 são formatos legados. O usuário relatou que um ajuste de roupa seguiu poses e os dois Studios; isso não comprova criação, migração e salvamento/reinício E2E. Ver [Entrega A](AUDITORIAS/ENTREGA_A_CI_E_ROADMAP_2026-10-19.md).

**Handoff para continuação:** [CONTINUACAO_DEV_AI_2026-10-18.md](CONTINUACAO_DEV_AI_2026-10-18.md) registra os commits, a prova de edição IPC/reabertura, limites e próximos passos; não marca o objetivo amplo como concluído.

## Fontes de verdade — não duplicar especificações

| Assunto | Documento normativo |
| --- | --- |
| Visão, metas, princípios, decisões de produto e gates gerais | [Plano principal](../PLANO_ESTRUTURA_PROJETO_E_DADOS.md) |
| Inventário observado, caminhos, provas, divergências, histórico e pendências | [INVENTARIO_E_EVIDENCIAS.md](INVENTARIO_E_EVIDENCIAS.md) |
| Ordem de execução, tarefas marcáveis, dependências, esforço, rollback e critérios | [ROADMAP_EXECUTAVEL.md](ROADMAP_EXECUTAVEL.md) |
| Política de dados, formato portátil, transações, backups e restauração | [DADOS_E_RECUPERACAO.md](DADOS_E_RECUPERACAO.md) |
| Isolamento e contrato de runner DEV AI, suites, evidências e matriz | [ISOLAMENTO_STUDIOS_E_DEV_AI.md](ISOLAMENTO_STUDIOS_E_DEV_AI.md) |
| Fluxo normativo de modelos montado/desmontado, poses, roupas 1/2, cabelo, cabeça, Customizador e Studios | [FLUXO_ASSETS_FABRICADOR_CUSTOMIZADOR_STUDIOS.md](FLUXO_ASSETS_FABRICADOR_CUSTOMIZADOR_STUDIOS.md) |
| Segurança, logging, performance, acessibilidade e operação | [QUALIDADE_E_OPERACAO.md](QUALIDADE_E_OPERACAO.md) |
| Análise de stack, alternativas e decisões a validar | [DECISOES/ADR-0001-runtime-e-testes.md](DECISOES/ADR-0001-runtime-e-testes.md) |
| Resultados das verificações realmente executadas nesta revisão e limites | [AUDITORIAS/REVISAO_ESTATICA_2026-10-18.md](AUDITORIAS/REVISAO_ESTATICA_2026-10-18.md) |
| Implementação inicial do DEV AI, comandos e resultados sintéticos da Etapa A | [AUDITORIAS/BASELINE_DEV_AI_2026-10-18.md](AUDITORIAS/BASELINE_DEV_AI_2026-10-18.md) |
| Validação real do runner/IPC em Windows e limites da cobertura em 2026-10-18 | [AUDITORIAS/VALIDACAO_WINDOWS_2026-10-18.md](AUDITORIAS/VALIDACAO_WINDOWS_2026-10-18.md) |
| Handoff técnico detalhado para Codex executar testes reais em Windows/Electron/IPC | [CODEX_HANDOFF_EXECUCAO_WINDOWS_E_IPC.md](CODEX_HANDOFF_EXECUCAO_WINDOWS_E_IPC.md) |
| Evidências e limitações do defeito de roupa/ossos, ligação com pose e preview do Customizador | [AUDITORIAS/FLUXO_ASSETS_2026-10-18.md](AUDITORIAS/FLUXO_ASSETS_2026-10-18.md) |
| Resultado real Windows/Linux com 8 auditorias rápidas, IPC Customizador, rede e limitações | [AUDITORIAS/VALIDACAO_ASSET_FLOW_2026-10-18.md](AUDITORIAS/VALIDACAO_ASSET_FLOW_2026-10-18.md) |
| Evidências da CI, teste visual e critérios de avanço por SHA | [AUDITORIAS/CI_DEV_AI_2026-10-18.md](AUDITORIAS/CI_DEV_AI_2026-10-18.md) |
| Dependências runtime AST e planos de extração de páginas inteiras | [AUDITORIAS/DEPENDENCIAS_AST_2026-10-18.md](AUDITORIAS/DEPENDENCIAS_AST_2026-10-18.md) |
| Reexecução local completa DEV AI, teste real de Ayla/Chloe em cópias privadas e pendências remotas | [AUDITORIAS/VALIDACAO_LOCAL_2026-10-19.md](AUDITORIAS/VALIDACAO_LOCAL_2026-10-19.md) |
| CI da branch permanente, roadmap e relato manual da Entrega A | [AUDITORIAS/ENTREGA_A_CI_E_ROADMAP_2026-10-19.md](AUDITORIAS/ENTREGA_A_CI_E_ROADMAP_2026-10-19.md) |
| Roupas Dev unificado e política dos conjuntos legados | [AUDITORIAS/ROUPAS_DEV_UNIFICADO_2026-10-19.md](AUDITORIAS/ROUPAS_DEV_UNIFICADO_2026-10-19.md) |
| Entrega C — fixtures legadas 1.0/2.0, reinício e isolamento de dois personagens | [AUDITORIAS/ENTREGA_C_COMPATIBILIDADE_E_PERSONAGENS_2026-10-19.md](AUDITORIAS/ENTREGA_C_COMPATIBILIDADE_E_PERSONAGENS_2026-10-19.md) |
| Entrega D — paridade AF-13 com assets criados pela interface, screenshots, geometria e reinício | [AUDITORIAS/ENTREGA_D_PARIDADE_AF13_2026-10-19.md](AUDITORIAS/ENTREGA_D_PARIDADE_AF13_2026-10-19.md) |

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

## Fundação de testes e CI DEV AI (incremento 2026-10-18)

A implementação foi iniciada na branch histórica `ci/dev-ai-foundation-hardening-2026-10-18` e integrada posteriormente à `master` e `master-desenvolvimento` via PR #3. O inventário AST identificou 22 ocorrências runtime entre features (10 pares únicos) e o gate de arquitetura bloqueia novos acoplamentos sem mascarar a dívida existente; consultar [classificação e plano de extração](AUDITORIAS/DEPENDENCIAS_AST_2026-10-18.md). Ela adiciona comparação visual por bitmap com diff e estabilização do compositor, guardas adicionais no encerramento e workflow Linux + Windows com fixtures sintéticas. Consulte [guia e aceite de CI](AUDITORIAS/CI_DEV_AI_2026-10-18.md). Nenhum workflow verde isolado substitui a matriz ISO, o benchmark ou o gate de recuperação de dados.

## Estado desta revisão

- [x] Leitura integral do plano original via GitHub e levantamento da árvore versionada da branch base.
- [x] Revisão estática direcionada de entradas, persistência, canais IPC, CSS, workspaces, scripts, dependências e commits relevantes — evidências e limites no inventário.
- [x] Proposição documental de fases, critérios mensuráveis e isolamento DEV AI.
- [x] Rodar `npm ci`, `npm run typecheck`, `npm run build` e auditorias sintéticas/IPC em Windows — [resultados e limites](AUDITORIAS/VALIDACAO_WINDOWS_2026-10-18.md).
- [ ] Inventário de todos os dados reais e `localStorage` instalado.
- [ ] Teste cross-workspace completo ISO-01–ISO-15; smoke sintético de montagem/leitura Customizer/Fabricador passou. Persistência/edição dessas áreas ainda aberta; 20 ciclos visuais Studio↔Video documentados no relatório Windows.
- [ ] Benchmark reproduzível e comparação antes/depois.
- [ ] Migração de dados de produção (ainda não executada; houve mudanças pontuais de código de produto nas entregas DEV AI).

**Escopo atual:** alterações de código foram feitas em `electron/main.ts`, auditorias e na criação/equipamento de roupas. Nenhum arquivo de usuário foi acessado, enviado ou migrado; as auditorias usam fontes e perfis sintéticos. Cobertura do fluxo visual e de armazenamento de modelos/roupas/poses **não está concluída**.

**Próxima prioridade:** fechar [R-29..R-38](ROADMAP_EXECUTAVEL.md) para a coerência de preview e source, mantendo AF-01..AF-20 abertos até evidência real. Regressões de Character Copy-on-write já podem rodar em IPC sintético, mas render idêntico Fabricador/Customizador/Studio/Video ainda exige fixture raster E2E.
