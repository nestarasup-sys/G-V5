# Auditoria estática — Fluxo Fabricador Dev → Customizador → Studio e Video Studio

**Data:** 2026-10-18. **Branch:** `feat/dev-ai-foundation-asset-flow-2026-10-18`, partindo de `ci/dev-ai-foundation-hardening-2026-10-18@15bf34275e`. **Natureza:** inspeção de código atual, implementação parcial de guards, teste sintético. **Não** se presume inspeção de imagens, roupas ou projetos reais do proprietário.

## Evidências de código analisadas

| ID | Local | Fato verificado | Risco/ação |
| --- | --- | --- | --- |
| AF-E01 | `src/shared/fabricator.ts`, `ModelPart` | Guarda rig montado (`x,y,width,height,rotation`) e `sourceTransform` do recorte original. | São dois referenciais distintos; nunca substituir largura de origem pela largura alterada. |
| AF-E02 | `FabricatorProject`, `FabricatorPose` | Modelos possuem partes/juntas/layers; poses levam `sourceModelSlot/sourceModelUpdatedAt`. | Revisão baseada somente em timestamp, falta pinning de conteúdo. |
| AF-E03 | `WardrobeComponent` e `WardrobeBinding` | Guarda boneId, ratios, centro local e rotação relativa ao osso. | Pré-ajuste só funciona se `boneId` e referencial de pose coincidirem. |
| AF-E04 | `WardrobeWorkspace.tsx`, antigo `guessBone` | Escolhia osso pela posição na folha, mas somava `part.width/height` montadas a `sourceTransform.x/y`; quando sem candidato retornava `model.parts[0]`. | **Defeito de código confirmado**: uma peça pode ser atribuída ao osso errado. Nova seleção usa frame original e não cria fallback arbitrário. Não prova que todos os pré-ajustes existentes estejam corretos. |
| AF-E05 | `WardrobeWorkspace.tsx`, `withSourceFrame/rebindComponents` | Referência origina calibragem e rebinding; editor pode recalibrar ao carregar. | Confirmar que compatibilidade e revisão não reescrevem automaticamente binding de um conjunto antigo. |
| AF-E06 | `WardrobeWorkspace.tsx`, `importSheet` | Categorias e ossos estimados a partir da posição da peça; novo draft recebe binding automático. | Classificação pode estar incorreta; exigir validação manual/diagnóstico, não assumir mágica por posição. |
| AF-E07 | `WardrobeWorkspace.tsx`, `save` | Salva `WardrobeSet` + imagens via IPC e emite `fabricator:assets-updated`. | **Correção desta rodada:** bloqueia publicar componente sem bone/binding válido. |
| AF-E08 | `WardrobeWorkspace.tsx`, `testDragOffsets` | Ajustes no modo Testar pose ficam em offset de teste, o `save()` grava somente `draft.components`. | Se o usuário espera que a correção feita na prévia de pose seja publicada, há divergência de UX. Exigir botão específico 'Aplicar ao conjunto' com conversão inversa e confirmação, ou rotular claramente como simulação. |
| AF-E09 | `wardrobeV2Reference.ts`, `supportsWardrobeV2` | Testa 1122×1402, 10 peças e coordenadas de referência; usa recortes definidos por índice. | V2 não é formato genérico: requer revisão de mapeamento e identity de peças; **hipótese de incompatibilidade** em modelos que desviam dessa base. |
| AF-E10 | `wardrobeReference.worker.ts` / `imageProcessor.worker.ts` e `WardrobeWorkspace.tsx` | Fonte original é reprocessada para separar peças; índices são atribuídos a part IDs do modelo. | Mudança de chroma/corte/order pode associar imagem errada a um ID: testar ID estável vs ordenação heurística, não afirmar que ocorreu com usuário. |
| AF-E11 | `src/shared/customizer.ts`, `CharacterCustomization` | Tem `modelSlot`, `poseSlot`, `partOverrides`, `wardrobeGroups`, `hairAppearance`, `faceAppearance`. | Separação local de ajustes já existe no tipo, mas sem `assetRevisionId` versionado. |
| AF-E12 | `electron/main.ts`, `customizer:characters:create` | Personagem criado com `modelSlot:1`, `poseSlot:1`, sem equipar automaticamente roupa. | Valor default não prova que modelo/pose 1 foram publicados; criar fallback e indicar estado vazio. |
| AF-E13 | `CustomizerPage.tsx`, `applyUpperWardrobePanel` | Equipamento adiciona `wardrobeGroups` com `offsetX/Y=0`, `scaleX/Y=1`, `rotation=0`. | Correto conceito de override neutro; se não aparece no local esperado, investigar composição/binding, não exigir ajuste do personagem. |
| AF-E14 | `CustomizerPage.tsx`, `renderWardrobeOverlay` | Encontra source/pose bone por ID e chama `mapWardrobeComponentToPose`, aplica deltas do grupo depois. | **Observação confirmada:** `if (!sourceBone || !targetBone) continue` omite peça sem diagnóstico no rendering. Falta UI de erro e preflight integrado. |
| AF-E15 | `poseTransform.ts`, `mapWardrobeComponentToPose` | Para binding V1 usa ratios/centro local e rotação do osso, fallback legado para peças sem binding. | Comparar matematicamente com CSS da prévia de pose e pixel output; sem prova visual global. |
| AF-E16 | `HairWorkspace.tsx` | Guarda transforms de cabelo relativos à cabeça/modelSlot e catálogo reutilizável. | Testar head-local nas poses/escala/camadas e cópia individual antes de permitir asset versioning. |
| AF-E17 | `HeadExtrasWorkspace.tsx` | Guarda `defaultTransform` do asset `head-extra` e exibe preview só de cabeça. | Óculos no Customizador podem usar caminho diferente de wardrobe vs face `headExtras`: unificar ownership e z-order. |
| AF-E18 | `CustomizerPage.tsx`, `prepareSavedCharacterRenderer` | Compõe personagem com pose, shape, cabelo, roupa e face e é importado nos dois Studios. | Já há ponto comum de render, porém localizado em página inteira, com risco de dependências/caches UI. |
| AF-E19 | `StudioPage.tsx` e `VideoStudioEditor.tsx` | Reutilizam render via `import('../customizer/CustomizerPage')`. | 15 usos runtime somando 6+8+1 em transition renderer. Criar módulo de render separado com golden tests. |
| AF-E20 | `scripts/audit-wardrobe-flow.mjs`, `src/shared/assetFlow.ts`, `boneSelection.ts` | Novo teste unitário sintético de pose, head/shoes, pré-ajuste, copy-on-write e diagnósticos de referência. | **Só** cobre a camada pura; ainda sem E2E de verdade com assets/capturas dos 5 ambientes. |
| AF-E21 | `electron/main.ts`, `customizer:characters:save` | Grava personagem separado do Fabricador; não grava modelo/roupa no save do Character. | Invariante de ownership apoiada por código, exigir hash end-to-end, backup e concorrência. |

## Diagnóstico: por que roupas/sapatos podem aparecer fora do pré-ajuste

**Demonstrado no código**: o antigo `guessBone` interpretava `sourceTransform.x/y` com `part.width/height` do rig montado (em vez de dimensões da fonte); quando não existia osso adequado, usava `model.parts[0]`. Uma única peça erroneamente vinculada explica uma discrepância no Customizador **sem nenhuma edição manual do personagem**. Isto é uma causa técnica plausível para parte do problema, **não prova que os assets específicos do usuário foram afetados**.

**Outros candidatos que exigem reprodução**: `sourceTransform` inconsistente entre modelos/pose/roupas, reprocessamento que troca a identidade dos recortes por índice, componentes da categoria errada, `WardrobeBinding` legado, diferença de DOM/CSS vs canvas, default pose inexistente, render em cache e ajustes de teste não persistidos.

**Nunca usar solução de mascaramento**: não implementar um `offsetX=42` universal, não corrigir só na prévia Customizador, não editar o conjunto global para compensar um personagem e não trocar automaticamente os IDs de ossos de assets antigos. Uma eventual migração deverá ser read-only dry-run primeiro, com export/backups hash e comparação visual antes/depois.

## Implementação e limites desta rodada

- Seleção inicial de osso extraída para função pura; computa centro da referência desmontada com `sourceTransform.width/height`; não escolhe primeiro osso arbitrário quando não há candidato.
- Para óculos/head-extra não inventa uma cabeça a partir do tronco se não achar part identificado como cabeça.
- Novos conjuntos impedem publicação com IDs/bindings pendentes. O autor ainda pode corrigir manualmente na UI — save retorna erro legível e não destrói projeto.
- `validateWardrobeFlow` reporta issues por ID no domínio; não grava e não altera renderer por si.
- `applyCharacterWardrobeAdjustment` cria cópia do grupo ajustado, não muta o source; ainda não substitui todos os caminhos UI de edição.
- Testes `audit-wardrobe-flow.mjs` estão na suíte `fast` e `all`; a execução GitHub Actions precisa comprovar o status do SHA final.

**Pendente:** integração de diagnósticos com UI (antes que `renderWardrobeOverlay` oculte peça), equivalência visual das telas, snapshot asset revisions, atualização segura de revisões antigas, desduplicação do render, testes de cabelo/head-extra, editor de roupas e poses com assets raster no Electron real. **Não marcar AF-01–AF-20 como concluídos.**

## Próximos artefatos de teste necessários

`out/dev-ai/runs/<run-id>/asset-flow/`: `manifest.json` com fixture SHA, `model-sheet.png`, `model-assembled.png`, `pose-1.png`, `pose-2.png`, `wardrobe-v1-sheet.png`, `wardrobe-v1-on-pose.png`, `wardrobe-v2-sheet.png`, `wardrobe-v2-on-pose.png`, `hair-head.png`, `head-extra-head.png`, `customizer-new-character.png`, `customizer-outfit.png`, `studio-actor.png`, `video-actor.png`, `diffs/*.png` e `asset-flow-report.json`. Esses arquivos devem nascer de **fixtures sintéticas**, sem upload de dados pessoais. Não gerar screenshots antes de ter os assets sintéticos renderizáveis e adapter real.

A matriz AF-01–AF-20 e os contratos detalhados estão em [FLUXO_ASSETS_FABRICADOR_CUSTOMIZADOR_STUDIOS.md](../FLUXO_ASSETS_FABRICADOR_CUSTOMIZADOR_STUDIOS.md).
