# Inventário visual do Gacha 5 original

**Data da auditoria documental inicial:** 2026-10-21.  
**Método:** inspeção estática do código do Gacha 5 neste repositório e leitura dos inventários funcionais já registrados. Nenhuma captura Electron foi produzida nesta auditoria. Nenhum dado de `app-data/` ou mídia pessoal foi aberto.  
**Importante:** “inventariado” aqui significa estrutura e fontes encontradas no código; não significa inspeção visual em runtime nem paridade Avalonia.

## Shell e navegação global

- **Fontes:** `src/renderer/src/ui/App.tsx`, `src/renderer/src/ui/components/TopBar.tsx`, `src/renderer/src/ui/styles.css`.
- **Estrutura identificada:** shell com top bar e rotas para Fabricador Dev, Customizador, Studio, Roteiros/Base de Vídeos, Video Studio e Opções. Ícones e rótulos são construídos na UI compartilhada.
- **Evidência disponível:** CSS estático define top bar de 67 px, padding horizontal de 25 px, fundo branco, divisória inferior e links com estados hover/ativo. A resolução mínima CSS declarada é 760×560 CSS px.
- **Pendente:** captura em execução de cada rota, menu/tooltip, foco/teclado, dimensões totais e comportamento em DPI/resoluções reais.

## Fabricador Dev

- **Fontes principais:** `src/renderer/src/features/fabricator/FabricatorPage.tsx`, `PoseWorkspace.tsx`, `AnimatorWorkspace.tsx`, `wardrobe/WardrobeWorkspace.tsx`, `ExpressionPresetWorkspace.tsx`, `FaceAnimatorWorkspace.tsx`, `DesignWorkspace.tsx`, `face/FaceComponentsWorkspace.tsx`, `face/HeadExtrasWorkspace.tsx`; estilos locais correspondentes e `styles.css`.
- **Áreas localizadas no inventário funcional:** Modelos/peças, Chroma, rig e juntas, histórico, Poses, Animador corporal, Roupas, Face/olhos, presets/coleções de expressão, Animador facial, Cabelos, Extras de cabeça e Design Dev (banner).
- **Elementos de interface observados por código:** lista de seções; slots de modelo; undo/redo; título do modelo; ajuste de chroma; prévia/canvas com pivôs; painel com abas/ferramentas e lista de layers; workspaces especializados com slots, preview, listas, propriedades e diálogos.
- **Evidência disponível:** estrutura/semântica e controles estáticos; ver `../legacy-contracts/FABRICADOR_INVENTARIO.md`.
- **Pendente:** capturar a página e cada workspace em estados vazio, ocupado, seleção, edição, diálogo, erro e scroll. Medidas e tokens próprios de cada seção ainda não foram extraídos de forma completa.

## Customizador

- **Fonte principal:** `src/renderer/src/features/customizer/CustomizerPage.tsx`; estilos locais e componentes de preview/portrait compartilhados.
- **Subáreas a capturar:** catálogo/lista e seleção de personagem; criação/edição; modelo e pose; proporções; roupas e paletas; cabelo; rosto/expressões; ferramentas de prévia e dialogs descobertos durante captura.
- **Evidência disponível:** inventário funcional em `../legacy-contracts/OUTRAS_AREAS_INVENTARIO.md`; CSS compartilhado confirma primitives globais, mas não a aparência completa da página.
- **Pendente:** mapa visual dos painéis e estados interativos, screenshots com personagem sintético e geometria/tipografia medida.

## Studio

- **Fonte principal:** `src/renderer/src/features/studio/StudioPage.tsx` e estilos/componentes relacionados.
- **Subáreas a capturar:** biblioteca/lista de projetos; editor e canvas; fundo; imagens/objetos; personagens; layers/propriedades; elementos de fala/pensamento/narração; importação/exportação e diálogos.
- **Evidência disponível:** inventário funcional em `../legacy-contracts/OUTRAS_AREAS_INVENTARIO.md`.
- **Pendente:** screenshots do canvas com fixture sintética, painéis, seleção/handles, menu/context menu, dialogs, scroll e estados vazios/ocupados.

## Base de Vídeos

- **Fonte principal:** `src/renderer/src/features/roteiros/BaseVideosPage.tsx`.
- **Subáreas a capturar:** área principal/publicados; Rascunhos; cartões; adicionar/excluir; preview/play; pesquisa/filtros/ordenação; edição de descrição, contexto, linha do tempo e reações; categorias e modal de categorias; publicação e confirmações.
- **Evidência disponível:** inventário funcional em `../legacy-contracts/OUTRAS_AREAS_INVENTARIO.md`; estilos `.base-videos-*` existem no CSS compartilhado.
- **Pendente:** capturar dimensões, estados vazio/selecionado/erro, player e modais; identificar formalmente quais tratamentos por card variam entre publicado e rascunho.

## Roteiros

- **Fontes:** composição/rotas/editor em `src/renderer/src/ui/App.tsx`; biblioteca Base de Vídeos em `src/renderer/src/features/roteiros/BaseVideosPage.tsx`; CSS `.roteiro-*` e `.roteiros-*` em `src/renderer/src/ui/styles.css`.
- **Subáreas a capturar:** biblioteca/lista; editor do roteiro; abertura; TikToks; elenco/modal; faixa e preview de vídeo; sequência de blocos; campos PT/EN, personagem, tipo e expressão; contexto e tempos; picker da Base; exportações e logs.
- **Evidência disponível:** código CSS define, entre outros, sidebar de roteiros de 280 px, subnav vertical, cards de biblioteca de 300–360 px e modal com largura máxima de 520 px. Estes são valores declarados em CSS, não medidas de screenshot.
- **Pendente:** confirmar a aparência atual executando a referência, porque estilos e código podem divergir por viewport/estado; capturar editor completo e interações de ocultar/mostrar por roteiro.

## Opções

- **Fonte principal:** `src/renderer/src/features/options/OptionsPage.tsx`.
- **Subáreas a capturar:** configurações/armazenamento; migração; backups; verificação/restauração; estados de progresso, confirmação, erro e reinício.
- **Evidência disponível:** inventário funcional em `../legacy-contracts/OUTRAS_AREAS_INVENTARIO.md`.
- **Pendente:** dimensões/paleta e captura real de todos os diálogos e estados assíncronos.

## Video Studio — auditoria antecipada, implementação permanece por último

- **Fontes:** `src/renderer/src/features/videoStudio/VideoStudioPage.tsx`, `VideoStudioEditor.tsx`, `VideoTimeline.tsx`, `VideoLibraryModal.tsx`, `PreviewTransport.tsx`, `VideoAudioControls.tsx`, `BackgroundLibraryModal.tsx`, `VideoClipPreview.tsx`, `VideoStudioEditor.css` e componentes auxiliares na mesma pasta.
- **Subáreas a capturar:** biblioteca/criação; editor; preview/transporte; timeline, faixas e clips; ator, vídeo, fala/pensamento e áudio; propriedades/keyframes; seleção e ferramentas; biblioteca/modal; exportação/jobs; estados e menus.
- **Evidência disponível:** inventário funcional em `../legacy-contracts/OUTRAS_AREAS_INVENTARIO.md`.
- **Pendente:** capturas do editor com fixture sintética e leitura visual de cada estado. Esta auditoria não antecipa implementação; ordem do Plano Mestre permanece inalterada.

## Referências e lacunas gerais

- A única captura identificada como evidência deve vir do app Electron original aberto com uma fixture controlada. As imagens compartilhadas em conversas antigas não são automaticamente referências versionadas nem cobrem o app inteiro.
- `src/renderer/src/ui/styles.css` contém regras globais e estilos das áreas; existem estilos locais adicionais junto a workspaces, especialmente Fabricador e Video Studio. O catálogo de seletores por componente ainda requer varredura sistemática.
- Não há neste inventário afirmação de inspeção em execução, medição de pixel da tela, resolução DPI, comparação Avalonia, nem aprovação visual do usuário.
