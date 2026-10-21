# Pendências do Animador corporal após F07

Data da auditoria de implementação: 2026-10-21.  
Referências do legado: `FABRICADOR_INVENTARIO.md`, `MATRIZ_PARIDADE.md`, `docs/architecture/CONTRATO_ANIMACAO_FABRICADOR.md` e fontes Electron citadas no contrato. O legado foi consultado somente em leitura.

## O que F07 implementou e comprovou

- Animação tipada e pinada à revisão imutável do modelo.
- Criação a partir do modelo publicado ou de uma pose salva da mesma revisão.
- Edição de transform/visibilidade por peça, duração e ordenação de frames.
- Interpolação `Step`, `Linear` e `Smooth`; modos `Once`, `Loop` e `PingPong`; velocidade limitada.
- Preview Avalonia com reprodução/pausa e atualização de frame.
- Migration 11, SQLite, snapshot com SHA-256, revisão otimista e conflito/corrupção tratados.
- Undo/Redo local e round-trip em sessão Headless com SQLite.
- Fixture sintética com translations, pivôs e anchors de ±1.000.000 e rotações próximas de ±π.
- Publicações e transforms-fonte permanecem intactos.

Evidências: `docs/gates/GATE-F07.md`, `EXECUTION_STATUS.md`, `AnimationDraftContractTests`, `SqliteAnimationRepositoryTests` e `FabricadorImportPreviewUiTests`.

## Diferenças que continuam abertas

| Diferença do Electron | Estado Avalonia | Próxima etapa | Prova para encerrar |
| --- | --- | --- | --- |
| Até 12 slots identificados por modelo | Atualmente há biblioteca de drafts por modelo/revisão, sem slots numéricos fixos | F09.13 | Criar/carregar/substituir cada slot, preservar IDs, testar limite, fechar/reabrir e cobrir conflito |
| Miniatura de cada animação | Não implementada | F09.13 | Thumbnail derivada e lazy, limite de cache e atualização após salvar |
| Identidade opcional `characterId` | Não faz parte do contrato novo atual | F09.13, se ainda fizer sentido nos contratos nativos | Mapear a semântica de uso; decidir em ADR/contrato tipado e testar compatibilidade sem acoplar personagem ao editor |
| Validação interativa de UI | Headless cobre comandos e render CPU; Windows/GPU/DPI não testados | Aceite global/G2 | Executar a view no Windows com modelo sintético equivalente, conferir mouse, playback, DPI e registrar captura real |
| Paridade visual completa do Animador | Não declarada | G2 | Capturas Electron/Avalonia do mesmo estado, resolução, DPI e conteúdo; comparar controles, slots, estados e preview |

## Decisão de escopo

F07 está tecnicamente fechada: as funções mínimas definidas nas tarefas F07.10/F07.11 persistem e passam pelos casos sintéticos. As diferenças da tabela não devem ser escondidas pela palavra “validada”; elas permanecem abertas na matriz e devem ser consideradas por F09.13 antes do G2. Nenhuma delas autoriza antecipar o Video Studio.
