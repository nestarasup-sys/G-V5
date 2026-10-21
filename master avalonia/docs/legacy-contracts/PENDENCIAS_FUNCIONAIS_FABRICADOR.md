# Pendências funcionais do Fabricador — cobertura do legado Gacha 5

**Data da revisão:** 2026-10-21; atualização após implementação da grade do canvas.
**Fonte:** comparação estática do Gacha 5 Electron com matriz/inventário do Avalonia; a ausência foi registrada nos documentos de auditoria do próprio projeto. Nenhuma captura, build ou teste Windows novo foi executado nesta revisão.  
**Motivo:** após ADR-0006, pequenas diferenças visuais são aceitáveis; **controles e ferramentas reais AUSENTES não são diferenças estéticas** e continuam obrigações de implementação antes do aceite G2/Fabricador completo.

## Lacunas explicitamente observadas

| Recurso do Electron | Situação documentada no Avalonia até F06 | Fase de implementação sugerida | Critério funcional de encerramento |
| --- | --- | --- | --- |
| Dez slots de modelos, selecionar/limpar/excluir | Layout aproximado existe, mas os 10 slots com navegação/exclusão não | F09.15/G2, após dependências F07/F08 | Criar/selecionar/substituir/remover por slot, persistir e reabrir, respeitando proteção de referências |
| Abas Peças, Camadas e Juntas | Painel do workspace de modelos separado em três abas; seleção bidirecional ligada ao ViewModel e mantém a última aba durante a sessão | F09.15/G2 | Implementadas; teste headless confere rótulos, índice inicial, alterações pela UI/ViewModel e a lista de camadas no conteúdo correspondente. Revisão visual Windows permanece pendente. Evidência: `docs/testing/F09.15_MODEL_TABS.md` |
| Miniaturas de peças | Miniaturas 48×48 são obtidas por janela visível via `IThumbnailService`, com cache local limitado a 24 bitmaps e carregamento cancelável ao rolar/trocar a janela | F09.15/G2 | Implementado; teste headless confirma carregar thumbs nos itens de camada. Evidência: `FabricadorImportPreviewUiTests.FilePickerFlowShowsReviewedBitmapAndPublishesOnlyAfterConfirmation`. A validação visual Windows continua pendente. |
| Quadrícula do canvas | Implementada como overlay opcional no canvas de modelos; alternância e desenho acima da imagem opaca, abaixo dos handles, validados em headless | F09.15/G2 | Feito: botão exibir/ocultar, escala adaptativa ao zoom e pan, sem alterar pixels da fonte. Falta validação Windows com mouse/DPI e revisão visual/GPU. Evidência: `FabricadorPersistenceStateTests.ModelCanvasGridToggleUpdatesTheBoundCanvasAndLabel` e `HeadlessShellTests.FabricatorCanvasGrid_RendersOnlyAsAnOverlayOnTransparentModelPreview`.
| Controles de tolerância de chroma | Slider 0–280, ação explícita para recalcular preview e publicação bloqueada quando a tolerância mudou desde o último cálculo; a separação final recebe o mesmo valor e a fonte original é mantida | F09.15/G2 | Implementado e validado em `FabricadorImportPreviewUiTests.FilePickerFlowShowsReviewedBitmapAndPublishesOnlyAfterConfirmation` e `FabricatorModelSourceImportTests.ChromaPreviewUsesAdjustedCopyAndPublishesTheUntouchedSource`. Cancelamento usa o token do processador e preserva a prévia anterior; faltam validação Windows/GPU e revisão com folhas reais antes de encerrar G2. Evidência: `docs/testing/F09.15_CHROMA.md` |
| Misturador/edição de pixels | Ferramenta do legado mapeada; sem UI/serviço correspondente validado | F09.15/G2 | Ferramenta funcional com undo/redo, assets sem perda e round-trip |
| Edição de pivôs/âncoras e estado fixed | CRUD, edição de âncoras, handles/snap e persistência implementados em F07.02/F07.04 | F09.15/G2 para revisão de conjunto e mouse/DPI no Windows | Criar/editar/excluir juntas; arrastar pivôs; fixar/soltar; snap opcional por proximidade; salvar/reabrir |
| Dividir/mesclar peças e restaurar fonte | Legado possui; não há prova completa de controles Avalonia | F09.15/G2 | Ações reversíveis, assets/crop preservados, reabertura |
| Reordenação por arrasto na lista | Alça de arrasto e drop por linha chamam uma alteração atômica da ordem visível; cada gesto gera um único comando undoable e não substitui joints | F09.15/G2 | Ordem/undo, autosave, reabertura SQLite, visibilidade e nova revisão publicada estão cobertos em `docs/testing/F09.15_LAYER_DRAG.md`; gesto nativo, zonas de drop, scroll e DPI em Windows ainda pendentes |
| Heurística de conexões automáticas | Legacy rig.ts auditado F07.01; integração UI nativa ainda não | F07.02–F07.04 / fechamento G2 | Sugestões sem ciclos/pais duplicados, usuário pode corrigir manualmente |

## Regras de condução

- Não antecipar Video Studio nem deslocar funções do Fabricador para áreas alheias.
- F07 deve prosseguir porque o gate **técnico limitado a Modelos F06** tem evidências suficientes. As lacunas são rastreadas e deverão ser implementadas no Fabricador antes do **G2 funcional completo**, especialmente F09.15.
- Se alguma lacuna for comprovada já implementada, adicionar teste e referência ao arquivo e marcar apenas essa linha como concluída; evitar trabalho duplicado.
- A lista não é exaustiva: F09.15 deve revisar todas as funcionalidades de Fabricador comparando com FABRICADOR_INVENTARIO.md e MATRIZ_PARIDADE.md. Não basta preservar aparência geral.
- Gravar falhas funcionais de verdade como pendentes até teste positivo/negativo e persistência; nenhuma captura "bonita" substitui recurso ausente.
- Ajustes de espaçamento, posição ou cores secundárias são refináveis posteriormente e não devem bloquear programação do rig, poses e animações.

## Estado atual

O inventário ainda contém lacunas abertas. F07.02 (`8f11586`) cobre CRUD, validação, undo/redo e persistência/reabertura de juntas; F07.04 (`49b206b`) cobre guias/handles, snap geométrico, undo/redo e persistência/reabertura. A validação manual com mouse/DPI permanece pendente, assim como a heurística de conexões automáticas e outras lacunas listadas acima. **F07 foi encerrada tecnicamente no gate `docs/gates/GATE-F07.md`;** isso não conclui o G2 nem os itens remanescentes do Animador. Para o detalhe atualizado da animação corporal, consultar [`F07_ANIMACAO_PENDENCIAS.md`](F07_ANIMACAO_PENDENCIAS.md), com complementações previstas em F09.13.
