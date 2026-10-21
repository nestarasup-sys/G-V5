# GATE-F07 — Rig, poses e animação do Fabricador

**Verificação local:** 2026-10-21  
**Branch:** `Master-AValonia`  
**Tarefas:** F07.01–F07.12  
**Resultado técnico:** PASSOU  
**Commits de código principais:** `22bde76`, `9760e92`, `3c7e836`

## Critério do gate

Rig, poses e animação devem persistir, manter as revisões publicadas imutáveis, evitar alterar as fontes durante a edição e apresentar comportamento geométrico previsível.

| Critério | Evidência executada | Estado |
| --- | --- | --- |
| CRUD de juntas, ciclos inválidos, anchors e modo fixed/loose | Fluxo headless e SQLite já registrado nas linhas F07.02–F07.04 de `EXECUTION_STATUS.md` | COMPROVADO |
| Undo/Redo de rig e pose sem misturar pilhas entre workspaces | `FabricadorImportPreviewUiTests`; histórico limitado e reabertura após SQLite | COMPROVADO |
| Criar, editar, salvar, duplicar, publicar e reabrir pose | Fluxo Headless/SQLite integrado; publicação preservada e thumbnails derivadas sob demanda | COMPROVADO |
| Contrato de animação e recusa de estrutura inválida | `AnimationDraftContractTests` cobre IDs, limites, frames, topologia, transforms e referências | COMPROVADO |
| Editar frames/transformações e reproduzir/pausar preview | `FabricadorImportPreviewUiTests.RealSqliteImportEditUndoSaveReopenAndPublishKeepsModelAssetsAndRevision` percorre os comandos do ViewModel e a view Avalonia | COMPROVADO |
| Persistência e concorrência de animação | `SqliteAnimationRepositoryTests`: migration 11, checksum, revisão otimista, conflito, corrupção e reabertura | COMPROVADO |
| Pose-base → animação → fechar/reabrir e carregar | Teste headless com pose salva em SQLite verifica `BasePoseId`, transforms/visibilidade das keys e recarga | COMPROVADO |
| Braço/pivô/anchors extremos, easing e modos | `AnimationDraftContractTests.AnimationEvaluatorRemainsFiniteForExtremeArmTransformsPivotsAndRigAnchors`; teste de interpolação cobre Once/Loop/PingPong | COMPROVADO |
| Não alterar publicação/fonte do modelo ao editar pose/animação | Fluxos integrados comparam conteúdo persistido e `SourceTransform` antes/depois | COMPROVADO |
| Build e suítes locais | `TestarLocal.bat rapido`: build Debug 0 erros; Core 29, Architecture 8, Assets 31, Geometry 43, Data 54, Rendering 22, Headless 40; **227 testes aprovados, 0 falhas** | PASSOU |
| Windows interativo, GPU, DPI e comparação visual Electron/Avalonia | Não foram executados neste gate | PENDENTE — aceite global |

## Pendências de paridade do Animador

Este gate fecha o escopo técnico de rig, pose e animação básica da F07; não declara reprodução completa de todos os detalhes do Animador Electron. A matriz permanece `EM_EXECUCAO` para a linha do Animador corporal. Slots nomeados até 12, miniaturas, `characterId` opcional e a validação visual no Windows continuam pendentes em [`F07_ANIMACAO_PENDENCIAS.md`](../legacy-contracts/F07_ANIMACAO_PENDENCIAS.md) e F09.13/G2.

As pendências não invalidam os testes do fluxo básico e não bloqueiam F08. O aceite integral do Fabricador continua sujeito a G2 e às lacunas listadas em `PENDENCIAS_FUNCIONAIS_FABRICADOR.md`.

## Limites da evidência

Os dados usados nos testes são sintéticos; o banco e os assets ficam em pastas temporárias. Nenhum arquivo pessoal foi aberto. O teste Headless valida a View/ViewModel e a engine de renderização CPU sob Avalonia Headless; não comprova hardware GPU, DPI real, ergonomia do mouse ou paridade visual em execução Windows interativa. Os dois avisos `CS0618` de `SKPaint.FilterQuality`/`SKFilterQuality` surgem no código preexistente de `ThumbnailService.cs` quando recompilado e não são erros da F07.
