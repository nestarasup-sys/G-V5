# Matriz de paridade visual

Estados: `INVENTARIADO`, `REFERENCIA_PENDENTE`, `IMPLEMENTACAO_PENDENTE`, `EM_IMPLEMENTACAO`, `VALIDACAO_VISUAL_PENDENTE`, `VALIDADO`, `DIVERGENTE`.

Os itens abaixo têm fontes/estrutura identificadas; a referência visual real ainda não foi capturada. Portanto todos ficam `REFERENCIA_PENDENTE`. A coluna “código” é somente rastreio estático, não captura visual. Atualizar uma linha por componente/subárea conforme o inventário seja aprofundado.

| Módulo / componente | Fonte do legado | Código inventariado | Captura Electron | Avalonia / evidência | Estado |
|---|---|---|---|---|---|
| Shell, top bar e navegação | `src/renderer/src/ui/App.tsx`; `ui/components/TopBar.tsx`; `ui/styles.css` | rotas e estados CSS | pendente | nenhuma | REFERENCIA_PENDENTE |
| Fabricador — Modelos/peças/canvas | `features/fabricator/FabricatorPage.tsx`; `ui/styles.css` | estrutura, slots, preview, layers | pendente | `FabricatorCanvas` mostra frame Skia, ferramentas de seleção/pan, hit test e overlay; Headless cobre coordenadas e zoom | VALIDACAO_VISUAL_PENDENTE |
| Fabricador — Importação e revisão da folha | `features/fabricator/FabricatorPage.tsx`; estilos do workspace | seleção, revisão e confirmação mapeadas estaticamente | pendente | cartão Avalonia e prévia funcionais; teste Headless `FabricadorImportPreviewUiTests`; captura Electron/Avalonia pendente | VALIDACAO_VISUAL_PENDENTE |
| Fabricador — Chroma e histórico | `features/fabricator/FabricatorPage.tsx`; `models/*` | controles e operações | pendente | nenhuma | REFERENCIA_PENDENTE |
| Fabricador — Poses | `features/fabricator/PoseWorkspace.tsx` | slots, edição e diálogos | pendente | nenhuma | REFERENCIA_PENDENTE |
| Fabricador — Animador corporal | `features/fabricator/AnimatorWorkspace.tsx` | preview, frames, transporte e layers | pendente | nenhuma | REFERENCIA_PENDENTE |
| Fabricador — Roupas | `features/fabricator/wardrobe/WardrobeWorkspace.tsx` | catálogo/edição indicados no inventário | pendente | nenhuma | REFERENCIA_PENDENTE |
| Fabricador — Face/olhos | `features/fabricator/face/FaceComponentsWorkspace.tsx` | folhas, componentes e guias | pendente | nenhuma | REFERENCIA_PENDENTE |
| Fabricador — Expressões | `features/fabricator/ExpressionPresetWorkspace.tsx` | presets/coleções/workspace | pendente | nenhuma | REFERENCIA_PENDENTE |
| Fabricador — Animador facial | `features/fabricator/FaceAnimatorWorkspace.tsx` | workspace e export diálogo | pendente | nenhuma | REFERENCIA_PENDENTE |
| Fabricador — Cabelos | `features/fabricator/HairWorkspace.tsx` | partes e edição | pendente | nenhuma | REFERENCIA_PENDENTE |
| Fabricador — Extras de cabeça | `features/fabricator/face/HeadExtrasWorkspace.tsx` | catálogo e posicionamento | pendente | nenhuma | REFERENCIA_PENDENTE |
| Fabricador — Design Dev | `features/fabricator/DesignWorkspace.tsx` | edição de banner conforme inventário | pendente | nenhuma | REFERENCIA_PENDENTE |
| Customizador — catálogo e seleção | `features/customizer/CustomizerPage.tsx` | CRUD/lista no inventário funcional | pendente | nenhuma | REFERENCIA_PENDENTE |
| Customizador — modelo, pose e corpo | mesma fonte | controles identificados funcionalmente | pendente | nenhuma | REFERENCIA_PENDENTE |
| Customizador — roupas/cabelo/rosto/expressão | mesma fonte | controles identificados funcionalmente | pendente | nenhuma | REFERENCIA_PENDENTE |
| Studio — biblioteca e projetos | `features/studio/StudioPage.tsx` | operações no inventário funcional | pendente | nenhuma | REFERENCIA_PENDENTE |
| Studio — canvas, fundo e objetos | mesma fonte | composição identificada funcionalmente | pendente | nenhuma | REFERENCIA_PENDENTE |
| Studio — atores, falas e propriedades | mesma fonte | composição identificada funcionalmente | pendente | nenhuma | REFERENCIA_PENDENTE |
| Base de Vídeos — principal/publicados | `features/roteiros/BaseVideosPage.tsx`; `ui/styles.css` | estilos `.base-videos-*` e operações | pendente | nenhuma | REFERENCIA_PENDENTE |
| Base de Vídeos — rascunhos/importação | mesma fonte | fluxo identificado funcionalmente | pendente | nenhuma | REFERENCIA_PENDENTE |
| Base de Vídeos — preview/detalhes/temporização | mesma fonte | controles identificados funcionalmente | pendente | nenhuma | REFERENCIA_PENDENTE |
| Base de Vídeos — categorias/modal | mesma fonte | CRUD identificado funcionalmente | pendente | nenhuma | REFERENCIA_PENDENTE |
| Roteiros — biblioteca | `ui/App.tsx`; `ui/styles.css` | `.roteiro-main-*` | pendente | nenhuma | REFERENCIA_PENDENTE |
| Roteiros — editor, abertura e TikToks | `ui/App.tsx`; `ui/styles.css` | seções e cards no inventário | pendente | nenhuma | REFERENCIA_PENDENTE |
| Roteiros — blocos de reação e campos | componentes de roteiros; `ui/styles.css` | sequência/inputs identificados | pendente | nenhuma | REFERENCIA_PENDENTE |
| Roteiros — elenco e picker de vídeos | `ui/App.tsx` | modais identificados funcionalmente | pendente | nenhuma | REFERENCIA_PENDENTE |
| Roteiros — export e logs | `ui/App.tsx` e módulos `electron/roteiro*.ts` | ações identificadas funcionalmente | pendente | nenhuma | REFERENCIA_PENDENTE |
| Opções — configurações/armazenamento | `features/options/OptionsPage.tsx` | inventário funcional | pendente | nenhuma | REFERENCIA_PENDENTE |
| Opções — migração/backup/restore | mesma fonte | progresso, confirmações no inventário | pendente | nenhuma | REFERENCIA_PENDENTE |
| Video Studio — biblioteca/editor | `features/videoStudio/VideoStudioPage.tsx`; `VideoStudioEditor.tsx` | inventário funcional | pendente | nenhuma | REFERENCIA_PENDENTE |
| Video Studio — preview/transporte/áudio | `PreviewTransport.tsx`; `VideoAudioControls.tsx`; `VideoClipPreview.tsx` | componentes mapeados | pendente | nenhuma | REFERENCIA_PENDENTE |
| Video Studio — timeline/faixas/clips | `VideoTimeline.tsx`; `VideoStudioEditor.css` | timeline funcional mapeada | pendente | nenhuma | REFERENCIA_PENDENTE |
| Video Studio — bibliotecas/modais/export | `VideoLibraryModal.tsx`; `BackgroundLibraryModal.tsx`; export pages | componentes mapeados | pendente | nenhuma | REFERENCIA_PENDENTE |

## Regra para promoção de estado

- `REFERENCIA_PENDENTE` → `INVENTARIADO`: localizar componentes, recursos, estados e interações no código, registrando paths e pontos desconhecidos.
- `INVENTARIADO` → `IMPLEMENTACAO_PENDENTE` → `EM_IMPLEMENTACAO`: manter o vínculo com tarefa/gate existente; não criar progresso adicional na contagem das 247 tarefas.
- `VALIDACAO_VISUAL_PENDENTE`: implementação existe, mas falta captura/golden lado a lado em condições equivalentes.
- `VALIDADO`: captura real Electron e Avalonia comparadas, estados cobertos, divergências resolvidas e evidência aprovada conforme contrato.
- `DIVERGENTE`: diferença encontrada; registrar pixels/elementos, causa, impacto e se foi autorizada. Não ocultar divergências sob um estado geral de “pronto”.
