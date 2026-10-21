# Formatos versionados e mapeamento de IDs do Electron

Data da inspeção: 2026-10-20. Baseado apenas em contratos, validadores, operações de arquivo e definição de schema no código legado. Nenhum manifesto real, banco de usuário, pasta `app-data/` ou mídia pessoal foi lido. Este documento não define o importador Avalonia; é o mapa de origem para uma migração futura, explicitamente autorizada e testada sobre cópias sintéticas/fornecidas.

## Regras de interpretação

- `schemaVersion` identifica a estrutura do documento, quando o contrato o declara. Não é necessariamente revisão do conteúdo ou versão do aplicativo.
- Campos marcados opcionais abaixo podem faltar em arquivos antigos; preservar defaults/compatibilidade documentados. Não fabricar valores de negócio sem regra explícita.
- IDs de arquivo/nome são endereços físicos ou rótulos; preservar como identidade apenas quando o contrato faz esse papel. Referências de domínio devem migrar para IDs tipados estáveis.
- Os tipos compartilhados descrevem a forma aceita pelo código atual, não todos os formatos que já circularam historicamente. Sem exemplos reais e sem histórico completo, o formato de dados particulares desconhecidos permanece desconhecido.

## Formatos e campos relevantes

| Domínio/documento | Versão observada | Identidade e relações | Campos opcionais/compatibilidade observados |
| --- | --- | --- | --- |
| Modelo do Fabricador (`FabricatorProject`) | `schemaVersion: 1` | Slot numérico `1..10`; peças por `part.id`; juntas por IDs das peças; arquivo `models/slot-{slot}/project.json`; imagens em arquivos separados referidos pelo manifesto | `chromaVersion`, `chromaBaseTolerance`, `layerOrder`, `hiddenPartIds`, `ModelPart.resizeBase`, `chromaBaseDataUrl`, `chromaBaseSaved`, `sourceTransform`, `jointAnchor`, `pivot`, `fixed`, `suggested`, `selected` são opcionais. IDs de peça são strings; não assumir UUID. |
| Histórico de modelo | `schemaVersion: 1` no snapshot serializado | Slot + sequência de `undo`/`redo`; ação `edit`, `mixer` ou `reset`; imagens por SHA-256 | Snapshot remove `sourceDataUrl`; save pode omitir bytes de peças e guardar assets em arquivos. Contém no máximo 50 entradas por direção segundo o fluxo identificado. |
| Pose e rascunho | Pose `schemaVersion: 1`; wrapper de rascunho não declara schema próprio | Slot de pose numérico dentro de modelo numérico; `sourceModelSlot` e `sourceModelUpdatedAt`; IDs das peças e attachments | `category` opcional; rascunho permite `editingSlot: null`; referência de nome/revisão do modelo e estado de edição devem ser tratados sem inferir validade de revisão. |
| Animador corporal e rascunho | Animação `schemaVersion: 1`; draft sem `schemaVersion` no tipo | Slot/modelo numéricos; frame possui ID string, transforms por ID de peça; `characterId` nullable | `basePoseSlot` e `characterId` podem ser `null`; transform de frame pode não ter width/height/jointAnchor; conteúdo salvo separa imagens dos metadados. Até 300 frames no validador. |
| Roupa (`WardrobeSet`) | `schemaVersion: 1` | Set identificado por string `id`, ligado ao `modelSlot`; componente por `component.id`, preso a `attachedPartId` | `edition` ausente é legado da edição 1; edições 1/2. Coordenadas de origem, binding e `renderAboveHair` podem faltar. `WardrobeBinding.version: 1`. Categorias antigas têm normalização/migração explícita no fluxo. |
| FaceSet, FaceCatalogItem, FaceComponentAsset | Todos `schemaVersion: 1` | `id` string + `modelSlot`; catálogo também relaciona categoria/recortes e índices; asset de componente separado | FaceSet pode ter folhas parciais por categoria; transforms de catálogo são parciais; `opacity`, `rightSidePositioned`, `pairId` são opcionais. Save types retiram `dataUrl` e guardam bytes em arquivos separados. |
| Preset/coleção/rascunho de expressão | Preset, coleção e workspace `schemaVersion: 1` | IDs string; referência `modelSlot`; preset escolhe assets compartilhados por IDs; coleção pode agrupar presets | Preset `collectionId`, `expressionIndex`, `referenceTransforms`, `effects` opcionais. Comentário do contrato: `collectionId` opcional mantém presets standalone antigos legíveis. Workspace draft separado dos presets publicados. |
| Cabelo (`HairWorkspace`, `HairStyle`) | Schema 1 | `modelSlot`; estilo tem string `id`, imagens front/back/fringe como papéis separados | Workspace pode não ter `fringe`, imagem-fonte e flags de salvamento/aplicação, tolerância, modo de chroma e categoria por lado. Estilo pode não ter `category`/fringe; sem categoria estilos antigos são listados em categorias compatíveis. |
| Personagem do Customizador | `CustomizerCharacter` e `CharacterCustomization` não declaram `schemaVersion` | `id` string; referências a `modelSlot`, `poseSlot`, set/asset IDs; manifesto `characters.json` | Proporções, dimensões, override de pele, cabelo/face, grupos/paletas são opcionais; modelo/pose nullable. Compatibilidade remove `wardrobeColors` antigo e converte categorias antigas. Valores numéricos antigos de corpo (`chest*`, `legs*`) são lidos como fallback para dimensões atuais. |
| Studio (`StudioDocument`) | `schemaVersion: 1` | UUID do projeto; `asset.id`, `element.id`, `characterId` e `assetId` formam referências; caminhos `studio-<uuid>/studio.json` | `thumbnailDataUrl` é opcional. Campos de ator em `StudioElement` são em grande parte opcionais para projetos antigos; dados locais de face/pose/transform não são automaticamente mudanças do personagem salvo. Assets: save separa manifesto e bytes. |
| Timeline (`VideoTimelineDocument`) | `schemaVersion: 1`, `frameRate: 60` obrigatório no validador | IDs de ator/clip/key/text e `assetId`; tempo em frames; vídeos associados por ID | Quase todos os novos controles são opcionais: transição, lock, zoom/altura, settings de faixa, bases, transform/position, lacunas, limites de faixa, vídeo/assets, capa e mix. `characterKeys.state` e `textClips.state` são opcionais. Clip `audio` e `transform` opcionais têm defaults de compatibilidade documentados no tipo. |
| Export de vídeo (`VideoExportRecord`) | `schemaVersion: 1` | Export ID e `studioId` | Largura 1920, altura 1080, 60 fps, H.264 fixados pelo contrato; áudio AAC ou null. É um registro de saída, não a timeline editável. |
| Base de Vídeos | Catálogo de arquivos `schemaVersion: 1`; detalhes/categorias vivem no SQLite, sem schema version próprio no DTO | UUID `videoId` é identidade; número permanente é único e separado; categoria por UUID | Duração pode ser desconhecida (`null`) durante importação. `sha256` no catálogo pode faltar em entradas antigas; `videoNumber`, `categoryId`, tempos/contexto adicionais são opcionais. Categorias têm cor e data de criação. |
| Catálogo de fundos | `schemaVersion: 1` | UUID do asset; cópia de projeto referenciada pelo mesmo ID | MIME/extensão/tamanho/data obrigatórios no catálogo; projetos antigos podem não conter manifesto central e o serviço pode reconstruir catálogo copiando assets encontrados nos projetos. |
| Catálogo de GIFs UI | `schemaVersion: 1`, `initialized: true` | UUID do GIF | `builtIn` opcional; ausência de catálogo pode semear um `loading.gif` do recurso do app; arquivos precisam validar assinatura GIF87a/GIF89a e trailer. |
| Roteiro e seção | DTOs sem `schemaVersion`; schema SQLite do app | Roteiro ID; TikTok ID também é `section_id`; abertura usa `{roteiroId}:opening`; vídeo/personagem são IDs referenciados | `opening`, campos de seção, referência `video`, `blocks`, tempos, descrição e contexto podem estar ausentes nos DTOs antigos; defaults são aplicados ao montar/salvar SQLite. `previewDetailsCollapsed` opcional. Campos numéricos nullable no SQL. |

## IDs: semântica e destino conceitual

| ID legado | Forma observada | Relação usada pelo legado | Mapeamento conceitual para GV5 |
| --- | --- | --- | --- |
| Slot de modelo | Inteiro de 1 a 10 | Pasta do modelo e chave para poses, cabelo, face, roupa, presets e animações | `ModelId` persistente; manter `legacySlot` como metadado de origem, não identidade definitiva |
| Slot de pose/animação | Inteiro em contexto de modelo | Localiza pose/animação dentro do modelo | `PoseId` / `AnimationId` persistentes + relação ao `ModelId`; guardar `legacySlot` para reimportação |
| Peça, junta, componente de roupa/face/cabelo, set, preset, coleção | String; alguns são UUID, outros são IDs internos sem formato universal explícito nos tipos | Referências internas e nomes de arquivos `set-{id}`, `item-{id}`, `style-{id}` | IDs tipados por entidade e referências validadas; reter `legacyId` para auditoria/mapeamento um-para-um |
| Personagem | String em `CustomizerCharacter.id` | Referenciado pelo elenco do roteiro e elemento do Studio/Video Studio | `CharacterId`; manter chave de origem e never renomear ao importar |
| Projeto Studio/Video Studio | UUID versão 4 no caminho/validador | Elementos/assets e arquivos associados ao workspace | `SceneId` ou `VideoProjectId` conforme tipo; ID global sem colisão e `legacyId` persistido |
| Vídeo de biblioteca | UUID versão 4 | Roteiro usa `video.id`; projeto Video Studio usa `videoAssets[].id`; bytes endereçados por ID + extensão | `VideoId`; identidade independente de nome e número. Preservar SHA-256 e refs de projeto |
| Número de Base | Inteiro positivo e único, emitido por sequence SQLite | Rótulo público permanente; não é a chave usada nas refs | `displayNumber`; manter como atributo imutável e distinto de `VideoId` |
| Roteiro/TikTok/bloco/categoria/GIF | UUID versão 4 nos validadores/geradores consultados | Relações pai-filho, seção, categoria ou biblioteca | IDs tipados (`RoteiroId`, `SectionId`, `BlockId`, `CategoryId`, `GifAssetId`); conservar IDs existentes se migrados sem colisões |
| Imagem binária no catálogo central | SHA-256 para objeto binário; asset possui ID próprio | `assets.id` aponta para `objects.sha256` por papel; referências adicionais por domínio | `AssetId` para identidade lógica, `ContentHash` para deduplicação; não confundir hash com ID do personagem/asset |

## Versões persistentes e migrations SQLite

`electron/dataPlatform.cjs` cria o catálogo SQLite com `PRAGMA user_version` máximo observado de 16. Uma abertura com versão maior que 16 é recusada. As tabelas têm `schema_migrations`, `app_metadata`, `domains`, `domain_migrations`, `assets`, `objects`, `asset_objects`, `entity_references`, `domain_files`, `domain_image_refs`, `domain_directories`, `domain_storage_state`, `migration_runs` e tabelas específicas de roteiro/Base.

Os marcos registrados no código incluem inicialização do catálogo (1), armazenamento por domínio/journal (2), referências canônicas de imagem (3), roteiros em SQLite (4), compatibilidade de posição (5), conteúdo/blocos da seção (6), descrição do vídeo (7), linha temporal e tempos (8), detalhes de Base (9), sequência estável e referência de fundo (ambos usam `version=10` no registro de migration), referência GIF (11), contexto IA (12), recolhimento de painel (13), categorias (14), cor (15) e logs de export (16). `user_version` e `app_metadata.schema_version` são ajustados para 16.

**Achado que exige cuidado na migração:** `schema_migrations.version` é chave primária, enquanto o código tenta registrar dois nomes distintos com versão 10 (`roteiro-background-library-reference` e `base-video-stable-sequence-numbers`). O segundo `INSERT OR IGNORE` não cria uma segunda linha para a mesma versão. A sequência é inicializada e a alteração de coluna é aplicada pelo código, mas o registro histórico de migrations não é unívoco nesse ponto. Não copiar a numeração nem inferir histórico exclusivamente desta tabela; futuras alterações devem usar IDs/versionamento sem colisão.

## Compatibilidade e lacunas conhecidas

1. O código atual aceita valores antigos documentados em comentários e normalizadores (categoria de roupa, dimensões de corpo, presets standalone, estilos sem categoria, dados de timeline/cenas sem propriedades novas). Preservar esses caminhos em fixtures de migração.
2. Muitos tipos JSON têm `schemaVersion: 1`, mas alguns wrappers (rascunhos, Customizer, Roteiros e detalhes de vídeo) não têm versão declarada. Não inventar uma versão de origem para esses objetos; a migration nova deve identificar formato por contexto e validador explícito.
3. Os tipos compartilhados nem sempre comprovam todos os requisitos do runtime. Validadores em `electron/main.ts` podem impor limites adicionais; o destino deve mapear restrições por domínio e rejeitar/carantinar dados inválidos sem apagar fonte.
4. Não é possível determinar, sem examinar os arquivos do usuário, quantos documentos antigos existem, quais campos opcionais faltam, se IDs têm colisões ou se assets referenciados estão ausentes. Isso é desconhecido até inventário explícito de uma cópia fornecida.
5. O legado tem serialização de JSON, caminhos e compatibilidade em vários serviços. Os exemplos aqui não são promessa de que versões anteriores à atual possam sempre ser carregadas sem conversão.

## Fontes lidas somente para leitura

- `src/shared/fabricator.ts`, `customizer.ts`, `studio.ts`, `roteiros.ts`, `assetFlow.ts`
- `electron/main.ts` (tipos/validadores, paths, normalizadores e IPC)
- `electron/dataPlatform.cjs` (DDL, user_version, migrações e import de roteiros JSON)
- `electron/videoLibrary.ts`, `backgroundLibrary.ts`, `roteiroUiGifLibrary.ts`
- `docs/legacy-contracts/FABRICADOR_INVENTARIO.md`, `OUTRAS_AREAS_INVENTARIO.md`

