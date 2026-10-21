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
| Até 12 slots identificados por modelo | Implementado na migration 17 e no Animador: 12 associações por `ModelId`, persistentes entre revisões; liberar slot preserva o rascunho, substituir associação preserva ambos os IDs | F09.13 | Headless comprova criar, reabrir, mover, liberar e substituir sem apagar rascunhos; Data comprova limite 1–12 e backfill determinístico sem perder excedentes |
| Miniatura de cada animação | Render derivado do primeiro frame, sob demanda ao abrir o slot e renovado depois de salvar; cache em memória limitado a 12 imagens | F09.13 | Teste Headless verifica thumbnail após salvar; implementação invalida a revisão anterior e o eviction mantém o limite |
| Identidade opcional `characterId` | Sem campo no `AnimationDraft`. ADR-0007 decide mantê-la fora do documento; no legado, ela restaura personagem/contexto da prévia e alimenta geração corporal, não identifica os frames. Serviço persistente/resolver de personagem ainda não é consumido pelo Fabricador | Decisão arquitetural em F09.13; integração fica para a etapa de personagens/G2 | Fronteiras de módulos garantem que Fabricador e Customizador não dependam um do outro; reavaliar contexto opcional via `CharacterId` após o serviço persistente existir |
| Validação interativa de UI | Headless cobre comandos e render CPU; Windows/GPU/DPI não testados | Aceite global/G2 | Executar a view no Windows com modelo sintético equivalente, conferir mouse, playback, DPI e registrar captura real |
| Paridade visual completa do Animador | Não declarada | G2 | Capturas Electron/Avalonia do mesmo estado, resolução, DPI e conteúdo; comparar controles, slots, estados e preview |

## Decisão de escopo

F07 está tecnicamente fechada: as funções mínimas definidas nas tarefas F07.10/F07.11 persistem e passam pelos casos sintéticos. F09.13 fecha os slots e miniaturas, e registra em ADR-0007 por que `characterId` não pertence ao documento de animação enquanto falta a fonte persistente de personagens. A escolha/restauração de personagem continua explicitamente pendente para a integração vertical; validação Windows/visual permanece em G2. Nenhuma dessas pendências autoriza antecipar o Video Studio.
