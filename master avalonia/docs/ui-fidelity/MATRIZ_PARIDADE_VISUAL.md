# Matriz de paridade visual

**ADR-0006:** aparência reconhecível, não pixel a pixel. **Funções ausentes são débitos técnicos**, não meras diferenças estéticas; devem ser implementadas antes do aceite G2/área. Ver `docs/legacy-contracts/PENDENCIAS_FUNCIONAIS_FABRICADOR.md`.

Estados: `INVENTARIADO`, `REFERENCIA_PENDENTE`, `IMPLEMENTACAO_PENDENTE`, `EM_IMPLEMENTACAO`, `VALIDACAO_VISUAL_PENDENTE`, `VALIDADO`, `DIVERGENTE`.

Os itens abaixo têm fontes/estrutura identificadas por inspeção estática, mas a captura Electron real ainda não foi feita. Os estados por linha refletem implementações e divergências já registradas. Conforme **ADR-0006**, paridade visual pixel a pixel não é pré-condição de avanço técnico, mas **falta de botões/funções é pendência funcional obrigatória**; ver docs/legacy-contracts/PENDENCIAS_FUNCIONAIS_FABRICADOR.md. Atualizar por componente/subárea e nunca afirmar validação visual Windows não realizada.

| Módulo / componente | Fonte do legado | Código inventariado | Captura Electron | Avalonia / evidência | Estado |
|---|---|---|---|---|---|
| Shell, top bar e navegação | `src/renderer/src/ui/App.tsx`; `ui/components/TopBar.tsx`; `ui/styles.css` | rotas e estados CSS | pendente | nenhuma | REFERENCIA_PENDENTE |
| Fabricador — Modelos/peças/canvas | `features/fabricator/FabricatorPage.tsx`; `ui/styles.css` | canvas adjacente ao painel lateral; slotbar 76 px com 10 slots, toolbar 60 px, coluna lateral 37%/mín. 270 px, canvas claro xadrez, abas Peças/Camadas/Juntas, miniaturas, seleção rosa, chroma/misturador/pivôs e controles por estado inventariados estaticamente | pendente | A view agora separa shell superior, toolbar e canvas/painel lateral; canvas usa superfície clara e acento rosa. Headless cobre importação, edição, undo, autosave, reopen e publicação. Divergências de implementação conhecidas: sem os 10 slots e sua navegação/exclusão, sem abas Peças/Juntas, miniaturas, quadrícula, chroma, misturador e pivôs. Captura Avalonia/Electron e folha real no Windows ainda pendentes | DIVERGENTE |
| Fabricador — Importação e revisão da folha | `features/fabricator/FabricatorPage.tsx`; worker `models/imageProcessor.worker.ts`; estilos do workspace | seleção, chroma, componentes conectados, margens de 4 px e nomenclatura por posição mapeados estaticamente | pendente | picker/prévia/confirmação e extração em assets PNG existem; Headless percorre SQLite/AssetStore com fixture sintética e compara pixels sólidos, margem e uma borda chroma-feathered com valores esperados; comparação contra PNG independente do worker e captura Electron/Avalonia pendentes | VALIDACAO_VISUAL_PENDENTE |
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
- `VALIDADO`: identidade familiar e controles/estados comparados por evidência suficiente para a revisão visual, com pequenas diferenças permitidas; se não houve screenshot Windows real, registrar esta limitação, não declará-la testada.
- `DIVERGENTE`: diferença relevante encontrada; separar desvio estético pequeno (não bloqueante) de **controle/função ausente** (bloqueante no aceite G2). Registrar causa, impacto e estado, sem mascarar lacunas funcionais.
