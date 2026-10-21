# Inventário funcional do Fabricador legado

Inspeção: 2026-10-20  
Objetivo: inventariar o escopo funcional antes de reconstruir o Fabricador no G-V5 Avalonia.  
Limite aplicado: código-fonte legado consultado somente para leitura; nenhum arquivo em `app-data/` ou mídia do usuário foi aberto.

Este inventário descreve o comportamento expresso no código. Ele não declara equivalência visual, execução sem erros ou paridade validada do novo app.

## Navegação e áreas

`FabricatorPage.tsx` reúne o editor de Modelos e navega para dez áreas especializadas: Poses, Roupas, Olhos, Rosto, Preset Expressão, Animador de Rosto, Cabeças extras, Cabelos, Animador e Design. Design Dev edita o banner do app; não é o editor de modelos. Os tipos compartilhados estão em `src/shared/fabricator.ts`, com Customizer como consumidor de assets publicados, e o acesso ao processo principal passa por `FabricatorDesktopApi` no preload.

## Capacidades encontradas

| Parte do Fabricador | Comportamento/campos existentes | Fontes principais |
| --- | --- | --- |
| Modelos e peças | Dez slots de modelo. Importa PNG/JPG/WebP, normaliza para PNG de 8 bits e limita arquivo a 50 MiB e imagem a 32 milhões de pixels. Worker remove o fundo por amostragem/chroma, separa componentes conectados em peças, guarda recorte original e tenta nomear peças por posição. O editor move, gira, redimensiona, seleciona, renomeia, oculta, divide/mescla peças, muda ordem e reseta para a imagem importada. | `src/renderer/src/features/fabricator/FabricatorPage.tsx`; `models/imageProcessor.worker.ts`; `models/resize.ts` |
| Chroma | Ajuste de tolerância com pré-visualização e aplicação assíncrona a partir da base recuperável; despill de franjas verdes. Processamento pesado ocorre em `imageProcessor.worker.ts` e `chromaAdjust.worker.ts`. | `models/chroma.ts`; `models/imageProcessor.worker.ts`; `models/chromaAdjust.worker.ts` |
| Rig | Peças podem se conectar automática ou manualmente por pai/filho; cada junta contém anchors e pivô, com modo fixo/solto e indicação de sugestão. A heurística identifica tronco, cabeça e segmentos por nomes/posição, liga partes restantes por proximidade. Ordem de camadas é independente das juntas. | `models/rig.ts`; `src/shared/fabricator.ts` (`JointLink`, `ModelPart`) |
| Histórico do modelo | Undo/redo persiste snapshots de edição, mixer ou reset, até 50 por direção. Assets de histórico são PNG endereçados por SHA-256; manifestos são versionados e assets sem referência são limpos depois de gravar. | `FabricatorPage.tsx`; `electron/main.ts` (`writeFabricatorHistory`, `readFabricatorHistory`) |
| Poses | Doze slots por modelo e cinco escolhas independentes para exportação. Pose é snapshot de peças, juntas, ordem de camadas, visibilidade, categoria e revisão/nome do modelo de origem. Há rascunho separado com `editingSlot`, autosave, seleção/edição de peças e histórico local da sessão. | `PoseWorkspace.tsx`; `wardrobe/poseTransform.ts`; tipos `FabricatorPose*` |
| Animador corporal | Até doze slots por modelo, com frames de duração e transforms por peça, juntas, miniatura, interpolação suave ou por etapas, loop once/loop/ping-pong e velocidade. Guarda pose-base e identidade opcional de personagem. O contrato do backend aceita até 300 frames, cada um entre 40 ms e 10 s. | `AnimatorWorkspace.tsx`; tipos `AnimatorAnimation*`; `electron/main.ts` (`validateAnimatorDocument`, `writeAnimatorAnimation`) |
| Roupas | Conjuntos por modelo e componentes categorizados (camisa, jaqueta, mangas, luvas, capa, cinto, óculos, acessórios, saia/calça/shorts, meias e sapatos). Cada peça aponta para uma parte do modelo e possui posição, dimensão e rotação; `WardrobeBinding` guarda o encaixe relativo ao osso de origem para transferir a roupa à pose. Existem edições 1 e 2 e uma migração de categorias antigas. O Customizer aplica overrides por personagem sem gravar na biblioteca do Fabricador. | `wardrobe/WardrobeWorkspace.tsx`; `wardrobe/poseTransform.ts`; `src/shared/assetFlow.ts`; tipos `Wardrobe*` |
| Face/olhos | Catálogos importam folhas de olhos/sobrancelhas/nariz/boca fechada/boca aberta e guardam recortes, índices, transforms e ligação de lados. Há assets faciais independentes: olho, pupila, olho fechado, sobrancelha, destaques, blush, sombra e extras da cabeça. O editor tem guias e transforms padrão. | `face/FaceComponentsWorkspace.tsx`; `face/processFaceSheet.ts`; `face/splitEyeSheet.ts`; tipos `FaceCatalogItem`, `FaceComponentAsset*` |
| Expressões | Presets apontam para assets compartilhados e guardam seleções e transforms privados, calibração de referência, opacidade do nariz e efeitos de sombra/blush. Collections e workspace draft ficam separados dos presets publicados; nomes e cópias locais também são persistidos. | `ExpressionPresetWorkspace.tsx`; `legacyStandardExpressions.json`; tipos `FaceExpressionPreset*`; `electron/main.ts` (`writeFaceExpressionPreset`, workspace draft) |
| Animador facial | Área própria para gravar/analisar animação facial; exporta vídeo WebM por diálogo nativo do Electron, validando assinatura EBML e tamanho máximo de 250 MiB. | `FaceAnimatorWorkspace.tsx`; `electron/main.ts` (`fabricator:face-animation:export`) |
| Cabelos | Cinco IDs semânticos (`backHair`, `rearHair`, `ponytail`, `frontHair`, `ahoge`) ocupam três slots (`front`, `back`, `fringe`). Rascunho por modelo guarda transforms, folha original recuperável, chroma auto/verde/quadriculado e borracha raster. Estilos publicados têm categoria e transforms. O Customizador expõe cinco roles de cor e 20 paletas; a máscara de role é inferida em memória, sem bitmap persistido. Ver [contrato detalhado F09 cabelos](F09_CABELOS_LEGADO.md). | `HairWorkspace.tsx`; `HairPiecePreview.tsx`; `hairEraser.ts`; `hairProcessor.worker.ts`; `src/shared/hairCategories.ts`; tipos `HairWorkspace*`, `HairStyle*`; [contrato F09](F09_CABELOS_LEGADO.md) |
| Extras de cabeça | Catálogo de assets de cabeça (óculos/acessório), posicionável sobre a cabeça com transforms e guias. | `face/HeadExtrasWorkspace.tsx`; tipo `FaceComponentAsset` |

## Persistência observada no código

O processo principal deriva caminhos de `app.getPath('userData')/fabricator/` e usa `DataPlatform` + `DomainFileSystem` para intermediar operações de arquivo. Não há persistência SQLite nessa área do legado: os metadados são manifestos JSON e os bytes das imagens ficam em arquivos PNG/na imagem de origem. Esta conclusão vem do código; a pasta real de dados não foi inspecionada.

| Domínio | Organização de arquivos definida no código | Escrita/leitura e cuidados visíveis |
| --- | --- | --- |
| Modelo | `models/slot-{n}/project.json`, `source-*.png`, `parts/{id}.png` e, quando existente, `{id}.base.png` | Grava assets primeiro, confere referências, grava `project.json.tmp` e renomeia para manifesto; saves são enfileirados por slot. |
| Histórico | `models/slot-{n}/history/history.json` e assets de hash | Até 50 undo/redo; SHA-256 por PNG; manifesto temporário + rename; assets e fontes sem referência podem ser removidos. |
| Pose e rascunho | `poses/model-{n}/slot-{n}/pose.json`, `parts/`; `draft/draft.json`; `export-slots.json` | Manifesto temporário + rename; slot independente recebe imagens do rascunho quando necessário; cinco slots de exportação exigem referências existentes e sem duplicata. |
| Animador | `animations/model-{n}/slot-{n}/animation.json`, `parts/`; `draft/draft.json` | Valida limites/frames e escreve manifesto temporário + rename; gravações são serializadas. |
| Roupas | `wardrobe/model-{n}/set-{id}/wardrobe.json`, `parts/{id}.png` | Assets precisam existir antes do manifesto. Em Windows há recuperação do manifesto `.backup` para substituir arquivos sem perder a versão válida. |
| Rosto, catálogo e componentes | `faces/model-{n}/set-{id}/face.json`, `catalog/item-{id}/item.json`, diretórios `images/`; `face-components/model-{n}/item-{id}/asset.json` e `asset.png` | Valida schema, IDs, dimensões/índices e assets referenciados; publica manifesto temporário + rename. |
| Presets e guias faciais | `expression-presets/model-{n}/preset-{id}.json`, `collections.json`, `workspace-draft.json`; arquivos `guides-{profile}.json` | Presets e collections versionados no JSON; workspace draft separado. Escritas são enfileiradas. |
| Cabelos | `hair/model-{n}/hair.json`, `images/`; `styles/style-{id}/hair-style.json`, `images/` | Valida transforms, partes e dimensões; assets são separados do manifesto; migração lazy converte workspace antigo para o estilo `legacy-workspace`. |

IDs ainda são mistos: slots numéricos para modelos/poses/animações e IDs string para roupas, catálogos, face components e presets. A maioria dos documentos usa `schemaVersion: 1`; há regras específicas de validação e compatibilidade legacy no processo principal. Isso é informação para planejar mapeamento futuro, não uma proposta de copiar o formato JSON para o app novo.

## Limites desta auditoria

- Foram lidos contratos, UI e persistência em código-fonte. Não foram lidos manifests reais, imagens pessoais nem arquivos em `app-data/`.
- O inventário cobre capacidades/formatos identificados, não confirma que todos os caminhos da interface funcionem em execução.
- O novo app não deve depender deste IPC, de Electron, de caminhos de `userData` do legado ou de imagens Base64 como identidade persistente. A migração deve ser explícita e separada, conforme o plano.

## Referências de código

- `src/renderer/src/features/fabricator/FabricatorPage.tsx:18-20, 992-1002, 1044-1080`
- `src/renderer/src/features/fabricator/models/imageProcessor.worker.ts:1-140`
- `src/renderer/src/features/fabricator/models/chromaAdjust.worker.ts:1-62`
- `src/renderer/src/features/fabricator/models/rig.ts:18-164`
- `src/renderer/src/features/fabricator/PoseWorkspace.tsx`
- `src/renderer/src/features/fabricator/AnimatorWorkspace.tsx`
- `src/renderer/src/features/fabricator/wardrobe/WardrobeWorkspace.tsx`
- `src/renderer/src/features/fabricator/wardrobe/poseTransform.ts`
- `src/renderer/src/features/fabricator/face/FaceComponentsWorkspace.tsx`
- `src/renderer/src/features/fabricator/face/HeadExtrasWorkspace.tsx`
- `src/renderer/src/features/fabricator/ExpressionPresetWorkspace.tsx`
- `src/renderer/src/features/fabricator/FaceAnimatorWorkspace.tsx`
- `src/renderer/src/features/fabricator/HairWorkspace.tsx`
- `docs/legacy-contracts/F09_CABELOS_LEGADO.md`
- `src/shared/fabricator.ts:1-415`; `src/shared/assetFlow.ts:1-112`
- `electron/main.ts:224-277, 1537-1786, 1806-1894, 2590-3174`
- `electron/preload.ts:1-66`
