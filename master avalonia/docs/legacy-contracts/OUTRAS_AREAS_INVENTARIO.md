# Inventário funcional: Customizador, Studio, vídeo e opções

Data da leitura: 2026-10-20. Escopo: leitura estática do código legado para planejar a reconstrução; nenhum dado de `app-data/` ou mídia do usuário foi aberto. Este inventário registra estruturas e operações encontradas no código, não certifica que a interface ou os fluxos foram executados nesta sessão.

## Customizador

| Item | Evidência observada |
| --- | --- |
| Responsabilidade | Criar e manter personagens combinando fontes publicadas do Fabricador com escolhas e ajustes privados daquele personagem. A tela também fornece prévia e navegação de catálogo. |
| Entradas | `modelSlot` e `poseSlot`; referências a peças/sets de roupa, cabelo, folhas e componentes faciais; paletas; cor de pele; proporções, dimensões corporais e transformações por peça. As fontes do Fabricador são tratadas como somente leitura. |
| Saídas | Um `CustomizerCharacter` identificado por `id`, com nome, cores resumidas, `customization`, datas de criação/atualização e referências aos ativos escolhidos. O renderizador prepara uma imagem derivada para a prévia/consumo por Studio. |
| Persistência | `userData/customizer/characters/characters.json`, com manifesto temporário e cópia recuperável `.backup`; escrita serializada por fila IPC. Ausência do manifesto pode inicializar personagens de exemplo. |
| Limites observados | A identidade de persistência é o manifesto JSON, não SQLite. Assets referenciados pertencem às bibliotecas do Fabricador. O contrato aceita campos opcionais e contém compatibilidade para valores antigos de roupa e proporções. |
| Fontes | `src/shared/customizer.ts`; `src/renderer/src/features/customizer/CustomizerPage.tsx`; `electron/main.ts` (`readCustomizerCharacters`, `writeCustomizerCharacters`, handlers `customizer:characters:*`, paths em `characterLibraryPath`). |

## Studio (cenas estáticas)

| Item | Evidência observada |
| --- | --- |
| Responsabilidade | Compor uma cena em canvas com fundo, imagens/objetos, personagens e elementos de narração, fala ou pensamento; editar posição, tamanho, rotação, ordem e propriedades locais do ator. |
| Entradas | Personagens do Customizador, arquivos de imagem importados, cor/fundo e edições locais. Um elemento pode conter overrides de rosto, expressão, pose, escala, bloqueio de posição e `zIndex`. |
| Saídas | `StudioDocument` com metadados da cena, referências/manifesto de assets e lista ordenada de elementos. Há fluxo para gravar e abrir impressões/exportações PNG. |
| Persistência | Workspace `userData/studios/Studio Principal/studio-<id>/studio.json`; binários de cena em `assets/backgrounds`, `assets/objects` e `assets/characters`; impressões em `prints`. Assets são normalizados para PNG e manifestos são publicados por arquivo temporário + rename. |
| Limites observados | `schemaVersion` do documento é 1. Dados de personagem são incorporados/derivados para a cena, mas as escolhas locais de Studio vivem no elemento; o contrato declara expressamente que não modifica o personagem salvo no Customizador. |
| Fontes | `src/shared/studio.ts` (`StudioDocument`, `StudioElement`, `StudioDesktopApi`); `src/renderer/src/features/studio/StudioPage.tsx`; `electron/main.ts` (`readStudio`, `writeStudio`, `listStudios`, `studioLibraryPath`). |

## Base de Vídeos

| Item | Evidência observada |
| --- | --- |
| Responsabilidade | Catalogar arquivos de vídeo e seus metadados de roteiro. A UI separa publicados dos rascunhos, permite importar, buscar/filtrar/ordenar, editar detalhes e categorias, publicar e excluir. |
| Entradas | Vídeos importados (`mp4`, `webm`, `mov`, `m4v`), duração reconhecida, descrição, contexto adicional, linha do tempo, fim da cena e tempos das reações; categoria opcional. |
| Saídas | ID estável do vídeo e, ao publicar, número permanente. Categorias têm ID e cor atribuída pelo backend. Uma exclusão de vídeo é recusada quando uma abertura/TikTok ainda referencia o ID. |
| Persistência | Bytes/catálogo da biblioteca por `VideoLibraryStore` (`media-library`, catálogo schema 1, hash SHA-256 e tombstones); detalhes, número e associação de categoria em tabelas SQLite (`base_video_details`, `base_video_category_assignments`, `base_video_categories`). Arquivo e metadados são armazenados em domínios distintos. |
| Limites observados | A biblioteca também é consumida pelo Video Studio. Importar cria rascunho até publicação; publicar exige duração identificada. O painel grava detalhes por operação IPC e a biblioteca mantém cópias/referências de projeto separadas. |
| Fontes | `src/renderer/src/features/roteiros/BaseVideosPage.tsx`; `src/shared/roteiros.ts`; `src/shared/studio.ts` (`VideoLibraryItem`); `electron/videoLibrary.ts`; handlers `base-videos:*` em `electron/main.ts`. |

## Roteiros

| Item | Evidência observada |
| --- | --- |
| Responsabilidade | Organizar um roteiro, elenco, abertura e TikToks; ligar cada seção a um vídeo opcional; editar blocos de fala/pensamento, tradução, descrição, contexto adicional e tempos de cena/reação; exportar personagens, roteiro e assets. |
| Entradas | IDs de personagens, referência de vídeo, blocos com personagem/tipo/expressão/textos PT e EN, metadados temporais, fundo/GIF selecionado e metadados de exportação. |
| Saídas | Documento composto `RoteiroDocument`, exportações de personagens/roteiro/fundo/vídeos/GIF e registros de execução de exportação (sucesso ou erro). GIFs têm biblioteca própria, incluindo item inicial protegido. |
| Persistência | Documentos/seções/TikToks, detalhes da Base, categorias, atribuições e logs usam SQLite via `DataPlatform`; gravações são transacionais e serializadas. Arquivos de mídia/fundos/GIFs ficam em bibliotecas próprias com catálogo e bytes separados. Logs são limitados a 50 por roteiro. |
| Limites observados | Abertura é uma seção independente; cada TikTok aponta para uma seção identificada pelo próprio ID. `additionalContext` existe na abertura, em TikToks e nos detalhes da Base. Exclusão de vídeo verifica referências antes de apagar. |
| Fontes | `src/shared/roteiros.ts`; rotas/página em `src/renderer/src/App.tsx`; `src/renderer/src/features/roteiros/BaseVideosPage.tsx`; handlers `roteiros:*` e `base-videos:*` em `electron/main.ts`; `electron/roteiroProjectExport.ts`; `electron/roteiroCharacterExport.ts`; `electron/roteiroUiGifLibrary.ts`. |

## Video Studio

| Item | Evidência observada |
| --- | --- |
| Responsabilidade | Workspace separado de Studio para composição audiovisual e edição em timeline a 60 fps: faixas de personagem, vídeo e fala/pensamento; reprodução/prévia, keyframes, áudio, recorte, posição, transformações, exportação e recuperação de jobs. |
| Entradas | Cena/atores do mesmo contrato visual do Studio, vídeos da biblioteca, áudio e eventos por frame. Vídeos ligados ao projeto são cópias gerenciadas do asset de biblioteca. |
| Saídas | `StudioDocument` com `videoTimeline`, clips/keyframes/faixas e arquivos exportados (1920×1080, 60 fps, H.264 e AAC opcional segundo o contrato). Operações de export são jobs com progresso/cancelamento e registros recuperáveis. |
| Persistência | Workspace `userData/studios/Video Studio/studio-<id>/studio.json`, manifesto leve `studio-card.json`, assets e quadros PNG identificados por SHA-256; arquivos de vídeo vinculados ao projeto. `VideoTimelineDocument` tem schemaVersion 1. A lista de cartões lê o manifesto leve antes de hidratar timelines. |
| Limites observados | O contrato de timeline já existe no Electron, mas não deve antecipar implementação nesta reconstrução: a ordem aprovada coloca Video Studio por último. Compartilha contratos de cena/atores e a biblioteca, porém tem workspace separado. |
| Fontes | `src/shared/studio.ts` (`VideoTimelineDocument`, clips, assets, API); `src/renderer/src/features/videoStudio/VideoStudioPage.tsx`; `src/renderer/src/features/videoStudio/VideoStudioEditor.tsx`; `electron/main.ts` (`readStudio`/`writeStudio`/cards); `electron/videoLibrary.ts`; `electron/videoExport*.ts`. |

## Opções: dados, migração e recuperação

| Item | Evidência observada |
| --- | --- |
| Responsabilidade | Exibir medição local por grupos/domínios, orientar migração de dados por domínio e gerenciar backups manuais: criar, verificar, restaurar e excluir. |
| Entradas | Resumo retornado pelos serviços de dados, espaço livre estimado, estado/progresso da migração e lista de backups. |
| Saídas | Mensagens de sucesso/erro, progresso e solicitação de reinício após migração/restauração. A interface informa que a origem só é removida após abertura e validação da estrutura nova. |
| Persistência | A página consome APIs do backend; o resumo mede arquivos existentes e o catálogo de assets. Backup/migração são serviços separados, não estado de tela. |
| Limites observados | A inspeção estática confirma os controles e as chamadas, não execução real de migração, restauração, recuperação após crash ou integridade de dados do usuário. A UI registra que formatos existentes continuam ativos até migração. |
| Fontes | `src/renderer/src/features/options/OptionsPage.tsx`; contratos da janela em `src/renderer/src/desktop.d.ts`; chamadas IPC em `electron/preload.ts`; handlers/serviços de dados em `electron/main.ts` e `electron/dataPlatform.cjs`. |

## Leitura arquitetural para a reconstrução

1. Customizador fornece identidade persistente de personagem; Studio e Video Studio guardam instâncias e ajustes locais separados.
2. Biblioteca binária, metadados de Base de Vídeos e documentos de Roteiros têm hoje donos e mecanismos distintos. A plataforma nova deve uni-los sob contratos de `DataPlatform` sem obrigar assets binários a virar blobs SQLite.
3. IDs de vídeo e personagem são referências de domínio. Título/nome do arquivo não substitui a identidade.
4. O código observado ainda contém compatibilidade e formatos legados opcionais. A migração não pode assumir que campos opcionais estão presentes.
5. Este documento é um inventário do legado para paridade; não aprova copiar a forma atual de persistência para GV5 Avalonia.

