# GACHA V5 — transferência técnica: engine de export do Editor V4

**Status:** investigação V4/V5 concluída; plano de execução ampliado; índices e virtualização da timeline, prévia de arraste coalescida e consulta indexada do estado de personagens implementados localmente. Build e comparações sintéticas passaram; validação visual/Electron permanece pendente. A engine MP4 do V5 ainda não existe.
**Objetivo:** estabilizar e acelerar edição, criação, animação, preview, mídia, salvamento e exportação no Video Studio do GACHA V5. Adaptar o conhecimento da pipeline do Editor V4 sem transplantar dependências de domínio nem quebrar os contratos do V5.

## 1. Missão

O Video Studio do GACHA V5 nasceu como editor visual e atualmente já possui timeline, preview, mídia, áudio, estado de personagens e salvamento. A meta desta iniciativa é transformá-lo em um editor de vídeo confiável para projetos crescentes, com exportação determinística e desempenho previsível.

O Editor V4 tem uma engine própria de export, incluindo o modo **Exportar Turbo 2×**. Devemos entender a implementação e seus resultados, identificar quais partes são reutilizáveis e adaptar os conceitos e módulos úteis às fronteiras do GACHA V5. Não fazer transplante cego: os dois produtos têm modelos de projeto, renderizadores, persistência e ciclo de vida diferentes.

## 2. Regras de segurança e escopo

- Trabalhar no GACHA V5 em `master-desenvolvimento`; nunca alterar `master` sem autorização explícita.
- Trabalhar incrementalmente em `master-desenvolvimento`, salvando commits locais pequenos após validar cada fatia.
- Não fazer fetch, push, PR, merge ou publicação como parte desta tarefa.
- Não abrir, exportar nem usar projetos, personagens, imagens ou mídia privada do usuário. Criar fixtures sintéticas para qualquer validação futura.
- Não copiar dados de usuário, caches, perfil, builds, artefatos ou arquivos locais do Editor V4.
- Usar o formato novo do Video Studio conforme a decisão já registrada pelo usuário; preservar bibliotecas compartilhadas de vídeo/fundos e manter projetos e caches dentro de `app-data`.
- O DEV AI e as auditorias completas do V5 foram desativados pelo usuário. Não reativar nem executar esses fluxos.
- Distinguir fatos verificados, resultados documentados no V4, hipóteses e pontos que precisam ser testados no V5.

## 3. Estado inicial verificado no GACHA V5

### Repositório

- Raiz local: `C:\TRABALHO 2\OUTROS\GACHA NYMI V5`
- Branch observada: `master-desenvolvimento`
- Remote `origin`: `https://github.com/nestarasup-sys/G-V5.git`
- HEAD observado nesta investigação: `092f5c6` (`fix: keep generated media outside image import pipeline`)
- A branch estava marcada como `ahead 12` em relação à referência local de `origin/master-desenvolvimento`.
- A árvore contém exclusões locais intencionais de documentos antigos, incluindo `AGENTS.md` e documentos em `docs/refactor`. Essas exclusões não devem ser revertidas ou incluídas nesta tarefa.
- O handoff estava previamente não rastreado no working tree quando esta rodada começou. As exclusões locais permanecem fora do escopo e serão preservadas.

### Video Studio

Arquivos centrais identificados:

- `src/renderer/src/features/videoStudio/VideoStudioEditor.tsx` — componente editor grande (aprox. 180 KB no checkout observado), contendo estado de edição, preview, timeline wiring, autosave e controles.
- `src/renderer/src/features/videoStudio/VideoTimeline.tsx` — interface da timeline.
- `src/renderer/src/features/videoStudio/VideoClipPreview.tsx` e `videoMediaPlayback.ts` — preview de clipes de vídeo.
- `src/renderer/src/features/videoStudio/useCharacterTransitions.ts`, `characterTransitions.ts`, `characterTrack.ts`, `characterGeometry.ts` e `transitionRenderer.ts` — estado/transições/geom. de personagens.
- `src/shared/studio.ts`, `videoMedia.ts` e `videoAudio.ts` — contratos e validação de timeline, mídia e áudio.
- `electron/main.ts` — persistência, bibliotecas e IPC do Video Studio.
- `electron/preload.ts` — API de renderer isolada por IPC.
- `electron/videoLibrary.ts` e `electron/backgroundLibrary.ts` — bibliotecas de vídeo e fundos.

O contrato `VideoTimelineDocument` contém taxa de quadros, duração, playhead, tracks, bases e chaves de personagens, gaps, vídeo/áudio, texto e marcadores. O tipo `VideoCharacterState` guarda um `StudioElement` e uma imagem composta como Data URL durante o uso. Ao salvar, os quadros de personagem são externalizados por hash para arquivos do projeto e representados no JSON por referências `@video-frame:<sha256>`; ao abrir, os bytes são validados pelo hash e restaurados como Data URL.

O processo principal mantém pastas separadas para Studio normal e Video Studio. Os handlers observados cobrem listar/salvar/excluir projetos, importar/associar mídia e salvar/abrir capturas. A API `VideoStudioDesktopApi` não expõe uma operação de exportação de vídeo. A interface observada oferece `saveVideoFrame`, uma captura estática da timeline, e não um export MP4 completo.

O preview ativo usa `requestAnimationFrame` para avançar o playhead e React para atualizar a composição interativa. Isso é adequado para preview; sozinho, não comprova nem constitui uma estratégia de produção de milhares de frames exportados. O componente central concentra muitas responsabilidades. Esses fatos justificam investigação de gargalos, mas não provam que o tamanho do arquivo do componente seja a causa isolada dos travamentos.

Há também trabalho repetido concreto na timeline: a cada arraste, o snapping reconstruía a lista completa de candidatos; a consulta de segmento filtrava e ordenava chaves repetidamente; e a régua tentava renderizar rótulos para toda a duração (o padrão é 10 horas). A primeira correção substitui essas varreduras por índices derivados por revisão e limita os elementos visuais à janela horizontal visível. Isso reduz trabalho algorítmico e nós DOM; o ganho de runtime ainda precisa ser medido.

### Perguntas que precisam ser respondidas no código V5

1. Como obter uma fotografia imutável do projeto e da timeline no início do export, sem capturar estado que continua mudando no editor?
2. Como avaliar um frame arbitrário por tempo absoluto, sem depender do relógio do preview, `requestAnimationFrame` ou estado React incremental?
3. Como renderizar exatamente personagens, camadas, pose, expressão, roupas, texto, transformações, fundos, vídeos, transições e áudio do frame solicitado?
4. Quais mídias podem ser lidas diretamente do armazenamento atual e quais precisam de decodificação/cache?
5. Como limitar memória e paralelismo para imagens grandes, vídeos longos e projetos com milhares de eventos?
6. Qual compatibilidade de codecs e formatos é esperada no Windows alvo, e quais codecs existem no FFmpeg empacotado atualmente?
7. Como cancelar de modo confiável, limpar apenas temporários pertencentes ao job e preservar um relatório de falha acionável?
8. Como garantir que exportar não altere o documento, os overrides do personagem, as bibliotecas do Fabricador nem o outro Studio?

## 4. Editor V4: identificação local observada

- Checkout: `C:\TRABALHO 2\EDITOR V4\EDITOR V4`
- Remote: `https://github.com/nestarasup-sys/EDITOR-V4.git`
- Branch local observada: `oai/aggressive-export-v5`, rastreando `origin/oai/aggressive-export-v5`
- HEAD local observado: `b951b4d` (`test(positioning): cover global flip and layer semantics`)
- `git status` local não mostrou alterações pendentes.
- A consulta somente leitura `git ls-remote` confirmou que `origin/oai/aggressive-export-v5` aponta para o mesmo SHA `b951b4d2cbb360e3cfef7769e457894337bbc83e` do checkout local.
- Não houve fetch/pull nem alteração do Editor V4.

Arquivos/documentos encontrados:

- `EXPORT_ENGINE_ARCHITECTURE.md`
- `CODEX_EXPORT_V3_HANDOFF.md`
- `docs/EXPORT_V5_STATUS_2026-09-21.md`
- `src/core/export/*` — planejamento de ranges, frames, chunks, render semântico, compatibilidade híbrida, cache e Turbo.
- `src/render/ExportSurface.tsx`, `SceneSurface.tsx`, `ParitySurface.tsx` — superfícies de renderização.
- `electron/exportManager.ts`, `turboExportCoordinator.ts`, `hybridExportManager.ts`, `smartExportCoordinator.ts` — orquestração.
- `electron/ffmpegFrameWriter.ts`, `ffmpegPipeWorker.ts`, `dirtyFrameComposer.ts`, `frameCaptureBackend.ts` — captura/composição e transporte para FFmpeg.
- `src/components/ExportDialog.tsx` — UX de export normal, Turbo 2× e Turbo LAB.
- Testes e scripts incluem `tests/turboPlan.test.ts`, `tests/renderPlan.test.ts`, `tests/visualTrackRenderParity.test.ts`, `scripts/turbo-smoke.cjs`, `scripts/canonical-export-parity-smoke.cjs`, `scripts/perf-export-ab.cjs` e benchmarks V10.

O `package.json` observado usa `ffmpeg-static` e scripts de build, testes, smoke, paridade e benchmark. A existência de um arquivo ou teste não demonstra sozinha que o caminho inteiro foi validado; relatar o alcance exato de cada teste.

## 5. Evidência técnica preliminar do Editor V4

O documento local `EXPORT_ENGINE_ARCHITECTURE.md` descreve este fluxo de produção:

1. O documento do projeto é normalizado e separado do estado da preview.
2. Um `ExportManager` cria uma janela offscreen com tamanho de conteúdo explícito e DPI 1.
3. A superfície de export recebe tempo absoluto; o hot loop não usa RAF para avançar frames.
4. A resolução semântica detecta mudanças de cena, estado persistente, mídia e áudio.
5. `CompositedPaintBitmapBackend` mantém uma superfície BGRA Full HD e recompõe dirty rectangles.
6. Dimensões e número de bytes de cada frame são validados antes de escrever rawvideo.
7. FFmpeg recebe BGRA, converte para `yuv420p`, codifica H.264, e o áudio é muxado quando solicitado.
8. Relatório de debug registra frames capturados/reutilizados, estágios, memória, warnings, mídias ausentes e erros.

O handoff local relata, para um cenário específico daquela máquina e projeto, que o backend compositado reduziu o tempo mediano de um range aleatório de 90 s de 230,660 s para 52,598 s (aprox. 4,4× menor), com gates visuais/de mídia/áudio/FYN declarados aprovados. Um benchmark V10 documentado relata 25.977 frames, 532,608 s de parede e 1,625× tempo real. Esses valores são históricos, hardware e projeto específicos; não são uma promessa de desempenho no V5.

O handoff também registra 0 chamadas RAF por frame exportado no hot loop, verificação de 8.294.400 bytes BGRA por frame Full HD, cancelamento, progresso e arquivos `.debug.json`. O encoder final relatado era `libx264`; AMF foi testado mas não escolhido como padrão devido ao resultado/qualidade observados. `capture-page` era experimental e não foi promovido.

O código local de `turboExportCoordinator.ts` mostra uma coordenação de managers de export separados, workers por chunks, codificação dos chunks sem áudio, concatenação sem reencode e mixagem de áudio uma vez no resultado. Há validações de contagem/bordas e fallback para o manager estável. O perfil Turbo pode escolher o número de chunks conforme CPU, duração e calibração persistida. A estratégia exata e as limitações atuais precisam ser confirmadas pelo chat do V4 usando a revisão atual do repositório.

**Não inferir:** “Turbo 2×” não significa automaticamente dobrar FPS, qualidade ou velocidade em todo computador. A semântica do nome, seleção de chunks, fallback, compatibilidade de codecs, impacto de RAM/CPU e limites devem ser documentados a partir do código e dos benchmarks atuais.

## 6. Decisões arquiteturais a avaliar para a adaptação

Proposta inicial, sujeita a evidência do V4 e inspeção do V5:

1. **Contratos do V5 como fonte canônica:** o export recebe um snapshot validado de `StudioDocument` + `VideoTimelineDocument`; não importa o modelo de projeto do Editor V4 para o produto.
2. **Separar pipeline de editor:** exportação como domínio/módulo próprio (por exemplo, `src/renderer/src/features/videoStudio/export/` e coordenadores no processo Electron), sem acrescentar todo o pipeline ao grande componente React.
3. **Render por tempo absoluto:** uma função pura resolve o estado visual no frame N; preview e export podem compartilhar a resolução sem compartilhar relógio/estado mutável.
4. **Superfície offscreen específica:** criar renderer de export do V5 que consuma o snapshot e assets permitidos. Reutilizar ou adaptar composição incremental somente após demonstrar paridade de pixels/layers com o preview do V5.
5. **Fila com limites:** controlar concorrência, tamanho dos buffers e backpressure; chunks só se benchmark sintético demonstrar ganho sem estourar memória ou causar divergência visual/temporal.
6. **Encoder isolado do renderer:** FFmpeg/encoder em worker/processo controlado, com progresso, cancelamento, timeout, captura de stderr limitada e cleanup por job.
7. **Fallback explícito:** caminho simples/estável funciona antes do Turbo; falha Turbo pode voltar ao caminho estável sem sobrescrever o arquivo final nem ocultar o erro.
8. **Debug e recuperação:** manifesto do job e relatório local com versão da engine, preset, contagem de frames, tempos por estágio, memória máxima, assets ausentes, erros e hash do snapshot. Sem dados privados em telemetria ou logs remotos.
9. **Compatibilidade:** não alterar o formato existente de projetos só para acomodar a engine; versionar novos campos opcionais apenas se tecnicamente necessários, com leitura retrocompatível.
10. **Paridade como gate:** produzir fixture sintética cobrindo ator/roupa/pose/expressão/texto/fundo/vídeo/áudio e comparar preview versus frame exportado, inclusive camadas e boundaries.

## 7. Matriz de adaptação preliminar

| Capacidade encontrada no V4 | Situação inicial no V5 | Trabalho para decidir/adaptar |
| --- | --- | --- |
| Render por tempo absoluto offscreen | Não identificado no Video Studio | Implementar renderizador para snapshot V5 e comparar visualmente |
| Composição incremental/dirty rectangles | Não identificada | Medir primeiro; só usar se a composição do V5 permitir invalidation correta |
| Export H.264 via FFmpeg | Não há operação de export na API Video Studio observada | Especificar container, codecs, qualidade, resolução, FPS e empacotamento |
| Export Turbo via chunks paralelos | Não identificado | Portar apenas depois de export single-worker determinístico e benchmark |
| Cache semântico de frames | Não identificado | Definir identidade/hash considerando timeline, personagem, assets, áudio e versão do renderer |
| Cancelamento/progresso/debug por job | Há salvamento/importação, sem API de export observada | Definir contrato IPC tipado, eventos e estado de job independente do editor |
| Vídeo e áudio no timeline | Contratos/preview presentes | Reutilizar sem divergência de timing, trim, volume, fade ou sync |
| Projeto V5 com personagem composto | Tem estruturas e imagens por chave | Adaptar resolução canônica sem modificar personagens ou bibliotecas |

## 8. Plano sugerido para implementação posterior

### Fase A — prova de contrato e render single-worker

- Fixar uma fixture sintética pequena e determinística, incluindo dois personagens e uma troca de pose.
- Definir um snapshot imutável validado, com referências a assets canônicos e timeline.
- Renderizar um frame arbitrário em offscreen usando o compositor que represente o V5.
- Comparar preview versus render por pixels, geometria, camadas e resolução; salvar relatório e screenshots sintéticos.
- Criar MP4 curto por um único fluxo estável; confirmar duração, contagem de frames, áudio, cancelamento e reabertura.

### Fase B — estabilidade/performance antes do paralelismo

- Medir projetos sintéticos pequenos, médios e longos (p.ex. centenas e milhares de eventos) com cold/warm cache.
- Registrar tempo por estágio, CPU, RSS/pico de memória, throughput, frames reutilizados, tamanho de saída e uso de temporários.
- Exercitar seek aleatório, mídia ausente, frame inválido, falha/cancelamento do encoder e falta de espaço simulada.
- Estabelecer limites e limpeza que nunca removam dados originais nem artefatos de outro job.

### Fase C — Turbo calibrado e fallback

- Só depois dos gates anteriores, adaptar chunks/worker pool com limite pelo hardware e memória disponível.
- Comparar single-worker e Turbo nas mesmas fixtures/ranges; medir p50/p95, RAM máxima, CPU e paridade em boundaries.
- Validar frames perdidos/duplicados, timestamps, áudio contínuo, concatenação e cancelamento de todos os workers.
- Manter Turbo opt-in ou calibrado até haver resultado repetível; fallback estável automático e relatório claro.

### Fase D — integração de UX e compatibilidade

- UX de preset, localização do arquivo, espaço estimado quando confiável, progresso por estágio, cancelamento, retry e resultado.
- Proteger edição enquanto o snapshot exporta (ou deixar editar sem afetar o job) e tornar explícita a política.
- Verificar Windows empacotado, caminhos com espaços/acentos, assets externos, reinício do app e limites de armazenamento em `app-data`.
- Somente após testes, considerar adoção do nome “Exportar Turbo 2×” e comunicar seu significado real.

## 9. Critérios mínimos para declarar pronto

- Mesma fixture salva e reaberta gera os mesmos frames-chave, dentro de tolerância objetiva documentada.
- Nenhum frame faltando/duplicado; frame rate, duração e timestamps conferem com a timeline.
- Composição exportada corresponde ao preview em geometria, camadas, recortes, transformações e alpha.
- Áudio presente, sem drift perceptível/incremental medido; trim, mute/volume e mix respeitam os contratos.
- Projeto original, assets, Fabricador, personagem, Studio normal e outro projeto permanecem intactos.
- Memória e buffers permanecem limitados para os cenários de duração/eventos definidos; backpressure demonstrado.
- Cancelamento encerra workers/processos e remove apenas temporários próprios; export parcial não se faz passar por resultado final.
- Fallback, recuperação após erro e relatório local de debug verificados.
- Benchmark reproduzível em ambiente identificado, sem prometer speedup universal.
- Typecheck, testes pertinentes e build do V5 passam; prova visual real e smoke Electron são descritos separadamente.

## 10. Análise técnica própria da pipeline do Editor V4

### 10.1 Caminho de entrada: UI → store → preload → processo principal

**Confirmado no código local em `b951b4d`:** `src/components/ExportDialog.tsx` prepara os presets e chama `useEditorStore.startExport`. O botão padrão deixa `engine` ausente/automático. O botão “EXPORTAR TURBO 2×” informa explicitamente `engine: 'turbo'` e `parallelChunks: 2`; o botão Turbo LAB usa `engine: 'turbo-lab'` e uma contagem própria.

`src/store/editorStore.ts` (`startExport`, aprox. linhas 845–895) compõe o payload com projeto, catálogo, recursos e opções e chama `window.gacha.exportVideo`. `src/shared/types.ts` define os contratos `ExportPayload`, options, progress e debug. `electron/preload.ts` expõe `exportVideo`, `cancelExport`, subscrição de progresso e eventos privados de renderer; `electron/main.ts` registra `export:start`/`export:cancel`, cria o `SmartExportCoordinator` e retransmite progresso para a janela principal.

### 10.2 Exportação single/compatível: renderer isolado → frame exato → encoder

`src/main.tsx` direciona `?mode=export` para `src/render/ExportSurface.tsx`. O processo principal não usa a janela do editor como alvo: `ExportManager.start` constrói uma `BrowserWindow` oculta com `useContentSize`, resolução de saída, DPI fixo, `contextIsolation`, sandbox, sem `nodeIntegration`, sem background throttling e modo offscreen configurável.

O coordenador manda `export-renderer:prepare`; `ExportSurface` calcula timeline e aguarda mídia/React se preparar. Para cada frame, `ExportManager` envia `{jobId, frame, time}`; `ExportSurface` sincroniza vídeos no tempo requisitado, espera metadata/seek e readiness de imagens/GIF, valida a assinatura publicada pela `SceneSurface` e responde com `export-renderer:frame-ready`. Respostas tardias de outro frame são ignoradas pelo `expectedFrame`. O tempo vem de `rangeStart + frame / fps` e não do RAF do preview.

`SceneSurface` compartilha regras semânticas/visuais com preview, mas recebe `playing={false}` e `exportMode`; efeitos interativos ficam desativados. O `FrameCaptureBackend` captura a composição real do Chromium. O backend final documentado na entrega anterior é `paint-dirty-composited-full-frame`, com bitmap BGRA persistente, manutenção de dirty regions e full-frame validado. Se a assinatura semântica autorizou repetição de um frame estático, o writer repete o bitmap anterior; estados contínuos de vídeo/GIF não podem ser tratados como estáticos.

`createFfmpegFrameWriter` (padrão `worker`) transfere buffers para `worker_threads`, limita frames em voo e aplica backpressure por acks. `ffmpegPipeWorker.ts` inicia FFmpeg e escreve os frames rawvideo. Cancelar envia a mensagem de cancelamento/encerra worker e processo; o `ExportManager` destrói a janela e remove exclusivamente o diretório temporário do job. O MP4 final é produzido por FFmpeg com pixel format definido e `+faststart`, e um relatório debug é salvo ao lado do resultado.

### 10.3 Engines: Smart Export, Hybrid e Turbo são pipelines diferentes

`SmartExportCoordinator` é a escolha do botão de export normal. Ele inspeciona projeto/timeline e compatibilidade Hybrid; seleciona Hybrid se o plano comprime estados o suficiente (limiar padrão observado de 3×) e/ou perfil de performance favorece Hybrid; senão escolhe Turbo. Em modo automático, erro do Hybrid pode cair para Turbo, registrando o motivo. Seleção pode ser forçada por engine/opção/variáveis de diagnóstico.

`HybridExportManager` não é o Turbo renomeado. `compileRenderPlan` agrupa overlays não-vídeo semanticamente idênticos em runs e deixa vídeo/loading como tracks separadas. O manager captura foreground raro em janela Electron offscreen, usa cache persistente por fingerprint/assinatura de foreground, então FFmpeg compõe fundo, vídeos, foreground e loading em filtergraphs/chunks; o áudio é combinado uma vez. `analyzeHybridCompatibility` exige stacking contract específico. Projetos incompatíveis voltam ao caminho Chromium/Turbo em Smart. Isso é uma otimização especializada e não uma engine genérica para qualquer canvas.

**Turbo 2× de produção:** solicitado explicitamente pelo botão UI com dois chunks. `TurboExportCoordinator` possui managers separados (até quatro), cada um executando `ExportManager` e janela de render independente. `planExportChunks` divide frames em intervalos half-open por contagem inteira e distribui remainder. Cada chunk exporta somente vídeo com encoder igual. Após `Promise.all`, o coordinator concatena com FFmpeg demuxer e `-c:v copy`, depois adiciona o audio graph uma vez (`buildSinglePassAudioGraph`) e publica o temporário joined por rename.

`validateJoinedOutput` verifica que saída abre, H.264, resolução, FPS, `yuv420p`, AAC/48 kHz quando há áudio, duração, número de frames via progress/framecrc e decodificação de pequenos ranges em cada boundary. Essas probes pegam arquivo truncado/contagem errada/boundary que falha ao decodificar, mas não são uma prova completa de paridade visual ou ausência de descontinuidade perceptual.

No caminho do botão, `parallelChunks: 2` sobrepõe as heurísticas e solicita exatamente dois chunks (limitado ao número de frames). Sem valor explícito, `chooseTurboChunkCount` considera perfil/calibração, duração, CPU e override: export curto abaixo de 120 s tende a 1; >=6 CPUs pode usar 2; >=600 s e >=16 CPUs pode usar 3; há teto de managers. A função não mede memória disponível diretamente. Perfil/calibração pode existir, mas o botão explícito de 2 chunks não deixa o perfil trocar o valor. Logo, “2×” é a solicitação de paralelismo do botão, não uma previsão de velocidade 2×.

Em falha Turbo, o caminho estável single-manager roda novamente (fallback padrão ligado, configurável), a menos que job seja cancelado. Se fallback também falha, erro combina as duas causas. Turbo LAB mantém coordinator/manager e profiling separados, explicitamente experimental; não portá-lo no primeiro incremento.

### 10.4 Mapa de módulos e dependências

| Caminho V4 | Responsabilidade observada | Decisão para V5 |
| --- | --- | --- |
| `src/shared/types.ts` | payload, opções, eventos de progresso e métricas | Adaptar somente os contratos necessários |
| `src/core/timeline/resolveTimeline.ts` | resolver tempo e timeline do modelo V4 | Não portar tipos; usar contratos do V5 |
| `src/core/scene/sceneRuntime.ts`, `characterTrackState.ts` | semântica canônica de cena/estados | Estudar; reimplementar para `VideoTimelineDocument` |
| `src/core/export/exportRange.ts`, `chunkPlan.ts`, `turboPlan.ts`, `ffmpegFrameCount.ts` | funções puras de range, chunking e validação | Bons candidatos para adaptação independente com testes |
| `src/core/export/renderPlan.ts`, `foregroundCacheIdentity.ts`, `hybridCompatibility.ts` | compressão de overlays, cache identity e gates Hybrid | Reutilizar ideias; V5 precisa semântica/layer contract próprios |
| `src/render/ExportSurface.tsx`, `SceneSurface.tsx` | render DOM do produto V4 e sincronização de mídia | Reescrever: render do V5 não é intercambiável |
| `electron/exportManager.ts`, `ffmpegFrameWriter.ts`, `ffmpegPipeWorker.ts` | janela offscreen, frame loop, encode, backpressure e cancel | Adaptar após estabilizar renderer V5 e arquivo temporário/IPC |
| `electron/turboExportCoordinator.ts` | multi-manager, chunks, concat, áudio, gates e fallback | Redesenhar em volta do payload e caminhos do V5 |
| `electron/hybridExportManager.ts`, `smartExportCoordinator.ts` | compositor FFmpeg especializado e seleção automática | Adiar; complexidade e layer assumptions do V4 não cabem no V5 sem prova |
| `electron/videoEncoder.ts`, `audioGraph.ts`, `mediaRegistry.ts` | seleção encoder, grafo áudio e resolução de mídia | Adaptar dependências individuais e política de `app-data` |

Dependência binária confirmada: `ffmpeg-static` 5.3.0 em `package.json`, desempacotada de ASAR em `build.asarUnpack`. Código permite cair para `ffmpeg` do PATH em certos fluxos. Encoder candidates incluem `libx264`, AMF, NVENC e QSV; `videoEncoder.ts` usa probes e fallback para libx264 quando hardware falha. O relatório de package não foi verificado quanto à composição de codecs/licenças do binário real; fazer auditoria de distribuição antes de qualquer reutilização/empacotamento no V5.

### 10.5 Testes e evidências inspecionados (não executados nesta tarefa)

| Arquivo | Exercício aparente no código | Limite da prova |
| --- | --- | --- |
| `tests/turboPlan.test.ts`, `frameIntervals.test.ts`, `ffmpegFrameCount.test.ts` | heurísticas/intervalos/parsing | Não executam export real, concorrência, memória ou performance |
| `tests/renderPlan.test.ts`, `semanticHybridPlan.test.ts`, `hybridChunkPlan.test.ts` | plano semântico e timeline de compose | Não provam captura visual completa |
| `tests/hybridCompatibility.test.ts` | aceita/rejeita stacking, hold, GIF, ranges | Não prova compatibilidade arbitrária nem V5 |
| `tests/visualTrackRenderParity.test.ts` | estado authored vs track/render plan para frames de teste | Não captura preview e saída real de Electron |
| `tests/audioGraph.test.ts` | delays, range, volume, mute, stream e ausência de áudio | Não mede sincronismo ouvido em vídeo longo |
| `scripts/turbo-smoke.cjs` | Electron + FFmpeg reais com fixture sintética de 1 s/10 FPS, vídeo e tom de áudio | Smoke de execução, não stress/qualidade/buffer bound |
| `scripts/canonical-export-parity-smoke.cjs` | fixture sintética pequena e caminhos ExportManager/Hybrid/Turbo/Smart, pixel/frame e streams | Não cobre todas combinações de projeto, media, GPU ou V5 |
| `scripts/hybrid-export-smoke.cjs`, `hybrid-parity-smoke.cjs` | execução real do Hybrid e paridade em fixture | Projetos incompatíveis e estabilidade longa ficam fora |
| `scripts/export-smoke.cjs`, `export-media-smoke.cjs`, `audio-matrix-smoke.cjs`, `frame-integrity-smoke.cjs` | smoke, mídia, áudio e bytes/frames por Electron/FFmpeg | Não equivalem a benchmark de edição com milhares de entidades |
| `scripts/perf-export-ab.cjs`, `perf-v10-random90.cjs`, `perf-v10-parallel-chunks.cjs`, `turbo-calibrate.cjs` | A/B e benchmarks com ranges controlados | Resultados dependem de cache/hardware/engine e não são velocidade universal |
| `tests/realProjectVisualTrack.test.ts` | opcionalmente abre arquivo externo via `GACHA_REAL_PROJECT_PATH` | Risco de dado privado se variável for definida; manter ausente em CI e usar fixtures sintéticas |

Relatórios existentes têm checkpoints distintos. `CODEX_EXPORT_V3_HANDOFF.md` registra comparação antiga de 90 s (subscription 230,660 s vs compositor mediana 52,598 s), 60 s/1.800 frames e outro benchmark V10 de 25.977 frames/532,608 s, com libx264 indicado como encoder final daquele checkpoint. `EXPORT_V5_STATUS_2026-09-21.md` foca Hybrid: 180 s, Full HD/30 FPS, áudio, AMF, 5.400 frames, 2 chunks de compose; cache quente 57,502 s de parede/54,377 s internos/68.974.604 bytes; cache frio parcial 90,286 s e 5.290/5.400 frames sem Chromium. São medições reportadas, não reexecutadas. Não misturar esses resultados Hybrid com o botão Turbo 2×, nem inferir que o V5 obterá esses fatores.

## 11. Adaptação concreta recomendada ao GACHA V5

### Contratos e limites atuais

`StudioDocument` mantém elementos/assets e só inclui `videoTimeline` no Video Studio. `VideoTimelineDocument` traz frameRate/duration/playhead, character bases/keys, transforms, gaps, vídeo/áudio, texto e tracks. `VideoCharacterState` guarda `StudioElement` e `imageDataUrl`; ao salvar, `electron/main.ts` externaliza imagens de quadro sob SHA-256 no projeto e restaura como Data URL ao abrir. `VideoStudioDesktopApi` (em `src/shared/studio.ts`) contém CRUD, bibliotecas, imports e prints, mas não export MP4. `saveVideoFrame` em `VideoStudioEditor.tsx` captura/chaveia estado no playhead, não codifica vídeo.

O preview usa RAF para playback e React para cena viva. Esse relógio mutável não deve alimentar o export. A timeline suporta até 100.000 video clips pelo validador em `electron/main.ts`, por isso não se deve criar sem limites um array de bitmap por frame nem mandar Data URLs repetidas via IPC. O atual documento guarda tracks/eventos e referências; uma export precisa resolver cada frame sob demanda com working set limitado.

### Arquitetura alvo

1. No renderer, congelar uma versão do documento e criar `ExportSnapshot` (project ID/revision/hash, dados necessários, refs de asset, range, FPS/dimensões, preset). Edição posterior não altera o job.
2. O processo principal valida o schema, limites e IDs e resolve as referências por interfaces do armazenamento `app-data`; renderer não passa path arbitrário. Manter fontes e biblioteca read-only.
3. Módulo puro compartilhado resolve `frameIndex → estado visual` a partir de tempo absoluto, usando regras da mesma timeline do preview. Testar seek em ordem não sequencial, boundaries e reabertura.
4. Uma superfície offscreen exclusiva do Video Studio renderiza o snapshot no tamanho/export scale final e aguarda imagens/vídeos. Não reutilizar o DOM da janela de edição nem `SceneSurface` V4. Comparar capturas com preview do V5 primeiro.
5. Começar com manager serial e FFmpeg writer isolado com backpressure, temporário UUID e rename atômico só após validação. IPC limitado: start/cancel/progress/result; log local estruturado sem conteúdo dos assets.
6. Só depois medir e adicionar cache semântico, identificando entradas por hash do snapshot, track state, hash/ref dos assets, dimensões, FPS e versão do renderer.
7. Só então testar Turbo de 2 chunks. Manter single-worker como referência/fallback; validar saída final, áudio contínuo e boundaries antes de publicar. Adicionar auto selection somente se benchmarks determinísticos e repetidos provarem benefício.

### Sequência, rollback e aceite

**E0 — fixture sintética:** fundo, dois personagens, roupa/layers com transparência, duas poses, expressão, texto, vídeo com áudio, boundaries, transform individual e segundo ator. Hashes e output esperado sob sandbox temporário.

**E1 — um frame determinístico:** resolver e renderizar frames específicos e seeks aleatórios; comparar imagem do preview real com frame offscreen em resolução/escala comum, métricas de pixels e geometria/layer.

**E2 — MP4 serial curto:** validar dimensions, codec, FPS, timestamps, duration, frame count, audio stream/sync, restart, asset absent, errors, cancellation, disk failure simulated e path Windows. Só saída validada substitui o destino.

**E3 — stress/profile:** 100/1k/10k eventos sintéticos, resoluções/FPS progressivos, cold/warm cache; medir peak RSS, buffers in-flight, CPU, p50/p95 por stage, real-time factor e disk temp. Limites devem ser claros e protegidos.

**E4 — otimização:** cache/dirty composition se profiler apontar gargalo; teste de invalidação para cada campo que muda pixels; output hash em cenário determinístico.

**E5 — Turbo opcional:** A/B serial vs 2 chunks com mesmo snapshot, repetição e cache state; comparar frame count, stills em boundaries, métricas de imagem, áudio e memória. Não afrouxar tolerâncias; se falhar, não promover Turbo.

Gates gerais: nenhum frame ausente/duplicado; V5 preview/export correspondente; sem pose/layer/alpha drift; áudio sem drift acumulativo; memória limitada com backpressure; cancel fecha janela/processos/workers e limpa apenas pasta do job; nenhum save, Fabricador ou personagem alterado; recovery e relatório compreensível; typecheck/tests/build e smoke Electron reportados separadamente. Fazer commits locais pequenos só após implementação autorizada e documentar rollback por fase.

| Elemento do V4 | Decisão | Razão |
| --- | --- | --- |
| range planner/chunk planner/count validation | Portar algoritmos puros com testes equivalentes | Baixo acoplamento se tipos forem redesenhados |
| worker FFmpeg writer/backpressure | Adaptar cuidadosamente | Padrão valioso, precisa adaptar cancel/ownership/paths ao main V5 |
| engine job progress and diagnostics | Recriar contrato V5 | IPC e persistência diferem; evitar API V4 inteira |
| `ExportSurface`/`SceneSurface` | Reescrever | Renderers/domínios não correspondem |
| Runtime/RenderPlan/identity | Adaptar ideias, não os modelos | Tem semântica de timeline V4 e assumptions próprios |
| Hybrid compositor | Adiar; referência técnica | Alto acoplamento a layers/compatibility e complexidade |
| Turbo coordinator | Reimplementar depois da export serial | Deve operar sobre snapshot V5 e seu armazenamento |
| Smart Export/auto-profile/Turbo LAB | Não trazer na primeira versão | Política automática e superfície experimental prematuras |

**Recomendação:** não extrair agora uma biblioteca compartilhada entre os projetos. Compartilhar/copy-adapt apenas algoritmos puros que não conhecem `ProjectDocument`, DOM ou media paths; reimplementar as bordas e o compositor sobre contratos do V5. Isso retém o know-how da engine sem carregar dependências semânticas e de segurança erradas.

## 12. Estado da execução local — 2026-10-19

- Branch `master-desenvolvimento`; HEAD de entrada `092f5c6`. A árvore inicial tinha exclusões documentais do usuário e este handoff não rastreado. Nenhuma exclusão foi revertida.
- `VideoTimeline.tsx` agora usa índices derivados por revisão para chaves, gaps, clips, marcadores e snapping. Consultas de segmento e clips visíveis usam busca binária; snapping não recria candidatos a cada movimento do ponteiro.
- Régua, clips, estados e keyframes são limitados à janela horizontal visível, com overscan. O redimensionamento persiste a altura ao concluir o gesto em vez de atualizar o documento em cada evento pointermove.
- Atualizações visuais de drag de clipe e boundary são coalescidas em `requestAnimationFrame`; o ponteiro mantém o último valor e o documento recebe a mudança uma única vez ao concluir o gesto.
- `VideoTimeline.tsx` memoiza a projeção visível de falas/pensamentos e os segmentos de personagem; ticks de playback deixam de refazer os filtros e a divisão por gaps enquanto documento e janela visível não mudam.
- `characterTrack.ts` agrupa e ordena chaves de pose uma vez por revisão imutável; buscar o estado do ator em qualquer frame usa busca binária. Transform base e primeira pose são derivados por revisão em um WeakMap, que não mantém vivas revisões antigas. A ordem original de chaves empatadas e keys sem estado foi preservada.
- Foi criado teste sintético para indexação, gaps, limites, snapping excluindo o próprio clip, janela visível e 10 mil keyframes. O primeiro ciclo revelou um erro na seleção do frame mais próximo; a correção passou nos testes.
- Baseline anterior à rodada atual: `npm test` teve 29/29 testes aprovados; `npm run typecheck` e `npm run build` passaram.
- `npm run bench:video-timeline` (microbenchmark sintético de 120 buscas mistas por tamanho; mediana de três rodadas de consulta): 100 eventos: baseline 2,60 ms/indexado 1,22 ms (2,14×); 1.000: 12,16/0,18 ms (66,58×); 10.000: 79,10/0,08 ms (939,43×). Construir índice levou 0,14/0,53/9,08 ms. Isso mede funções puras em memória neste computador, não React, playback, Electron, GPU ou exportação.
- O mesmo benchmark compara 120 consultas de estado de personagem: 100 eventos: caminho anterior 0,79 ms/indexado 0,16 ms (4,96×); 1.000: 2,96/0,23 ms (13,17×); 10.000: 16,93/0,19 ms (87,68×). Cada consulta teve o mesmo estado/pose nos dois caminhos. Microbenchmark de funções puras, não FPS de playback nem medida de React/Electron.
- Ainda não houve benchmark Electron, medição de CPU/RAM, comparação de frames nem teste visual de playback/export. Não declarar ganho de velocidade de interface quantificado.
- Nesta continuação, `src/shared/videoFrame.ts` passou a resolver conteúdo temporal a partir do frame absoluto, e o preview usa essa mesma seleção pausado ou reproduzindo. Gaps, balões e clipes usam limites semiabertos `[início, fim)`.
- Piscadas automáticas agora usam agenda determinística pelo ID do personagem e frame absoluto; não dependem de `Math.random` nem de timers aleatórios. O raster facial ainda vem do pipeline de personagem existente.
- `electron/videoExports.ts` e os handlers tipados/preload criam a biblioteca física `app-data/EXPORT/<studioId>`, armazenam um sidecar com SHA-256, listam exports sem depender do projeto original, abrem pastas e permitem exclusão explícita após confirmar tamanho/hash. Finalização aceita somente `app-data/temp/video-studio/export/<jobId>/final.mp4`; ainda não há produtor desse arquivo.
- `electron/videoExportJobs.ts` adiciona manifesto com hash do snapshot e mídias, checkpoints de 600 frames, retomada condicionada à identidade dos inputs e validação dos hashes de chunks; cancelar remove somente a pasta do job validado.
- A leitura do `electron/exportManager.ts` V4 confirmou o desenho de janela dedicada, handshake por frame, captura validada, progresso por estágio e FFmpeg separado. O protocolo visual é específico ao runtime/timeline V4; transplantá-lo inteiro ignoraria o contrato React e os dados de mídia V5.
- `electron/videoRawFrameWriter.ts` adapta a escrita por pipe do `ffmpegFrameWriter.ts` V4: processo filho sem shell, confirmação assíncrona de escrita, quantidade exata de frames e limite de dois frames pendentes (V4 permite três por padrão). Os argumentos V5 são fixos em BGRA 1920×1080, 60 fps, H.264 Media Foundation e MP4; o módulo ainda não está conectado a um produtor de frames.
- `src/shared/videoStudioAudioPlan.ts` adapta o grafo de mixagem de `audioGraph.ts` ao contrato V5: origem/trim por `VideoMediaClip`, início na timeline, volume global e por clipe, mute, mixagem AAC estéreo a 48 kHz e erro explícito se uma mídia audível não estiver disponível. Depende de preflight que descubra se cada arquivo realmente contém áudio; essa integração ainda não existe.
- O `ffmpeg-static@5.3.0` do V4 declara `GPL-3.0-or-later`; seu binário local é `FFmpeg 6.1.1-essentials_build-www.gyan.dev` e `-version` mostra `--enable-gpl` e `--enable-libx264`. Portanto, essa dependência/binário não foi copiada para o V5. A verificação de build em `videoRawFrameWriter.ts` rejeita `--enable-gpl`/`--enable-nonfree` e exige os encoders `h264_mf` e `aac`. O FFmpeg upstream informa que partes GPL tornam a licença aplicável ao FFmpeg e que builds LGPL devem excluir GPL/nonfree; ainda falta fornecer e empacotar um build correspondente com sua fonte/configuração e avisos. [FFmpeg: licença e distribuição](https://ffmpeg.org/legal.html)
- Novos testes cobrem determinismo, limites de frame, integridade/path containment da biblioteca, checkpoints, cálculo do áudio e backpressure/contagem do pipe com filhos sintéticos. Eles não representam MP4 decodificável nem comprovam captura visual, AAC real ou paridade.
- Validação desta continuação: `npm test` passou com 42 testes, sem falhas ou skips; `npm run typecheck`, `npm run build` e `git diff --check` passaram. Os seis testes novos verificam o plano AAC e a escrita limitada de frames com um processo sintético; não executam FFmpeg real.
- Ainda não há renderer canônico reutilizável, worker/UtilityProcess, FFmpeg empacotado/licenciado, UI de exportação, captura offscreen, validação real de chunks/MP4, mixagem AAC, progresso/cancelamento conectado, cache/proxies, medição Electron ou comparação visual de MP4. O Video Studio permanece aberto e sem exportação MP4 real.

## 13. Fontes de evidência revisadas

**Editor V4:** `ExportDialog.tsx`, `editorStore.ts`, `main.ts`, `preload.ts`, `ExportSurface.tsx`, `SceneSurface.tsx`, `exportManager.ts`, `turboExportCoordinator.ts`, `hybridExportManager.ts`, `smartExportCoordinator.ts`, `ffmpegFrameWriter.ts`, `ffmpegPipeWorker.ts`, `videoEncoder.ts`, `audioGraph.ts`, `renderPlan.ts`, `chunkPlan.ts`, `turboPlan.ts`, `hybridCompatibility.ts`; testes e scripts listados nas seções 11–12; `EXPORT_ENGINE_ARCHITECTURE.md`, `CODEX_EXPORT_V3_HANDOFF.md`, `EXPORT_V5_STATUS_2026-09-21.md`, `TURBO_LAB_REAL_BENCHMARK.md` e `EXPORT_RESEARCH_2026-09-20.md`.

**GACHA V5:** `VideoStudioEditor.tsx`, `VideoTimeline.tsx`, `VideoClipPreview.tsx`, `videoMediaPlayback.ts`, `useCharacterTransitions.ts`, `characterTransitions.ts`, `characterTrack.ts`, `characterGeometry.ts`, `transitionRenderer.ts`, `src/shared/studio.ts`, `videoMedia.ts`, `videoAudio.ts`, `electron/main.ts`, `electron/preload.ts`, `electron/videoLibrary.ts` e `electron/backgroundLibrary.ts`.

A análise V4 permanece baseada no checkout e SHA anotados acima. A validação desta rodada usa fixtures sintéticas; nenhum projeto, personagem, biblioteca ou mídia privada foi aberto, migrado ou excluído.

## 14. Plano de execução — estabilização e desempenho do Video Studio

### Fase A — baseline e orçamento de desempenho

1. Criar fixture sintética com 100, 1.000 e 10.000 eventos; cenários com 1, 10 e 50 personagens; keyframes, gaps, texto, áudio, clipes de vídeo e transforms.
2. Medir separadamente mount da timeline, scrubbing, drag de clipe/keyframe, playback de animação, autosave, seek e uso de CPU/RAM. Registrar p50/p95, nós DOM, frames perdidos, bytes serializados, pico de memória e resultados locais reproduzíveis.
3. Manter benchmarks opt-in e somente locais. Não registrar conteúdo de roteiro, nomes/paths de assets ou dados dos personagens; não subir resultados nem executar DEV AI/auditoria completa.
4. Comparar cada mudança com baseline no mesmo hardware. Testes funcionais não dependem de limites de tempo instáveis.

### Fase B — edição escalável

1. Manter seletores e índices derivados imutáveis por revisão. Busca por tempo usa pesquisa binária; drag usa snap index em vez de refazer filtros e sorts.
2. Virtualizar horizontalmente régua, keyframes, estados e blocos. Conservar um predecessor/sucessor fora da janela para desenhar estados que atravessam limites; seleção, navegação por teclado, zoom e drag preservam semântica.
3. Limitar publicação visual de pointermove a uma atualização por frame e persistir uma vez ao concluir o gesto. Undo/redo registra operações/checkpoints, sem histórico por pixel de movimento.
4. Se profiling mostrar bloqueio no autosave, serializar snapshot imutável em worker e fazer gravação atômica mantendo o último projeto válido.
5. Extrair módulos de `VideoStudioEditor.tsx` conforme fronteiras reais (state/history, timeline, media, animation, persistence/export), uma etapa por vez. Não misturar estado ou comandos com o Studio normal.

### Fase C — preview e mídia

1. Criar cache derivado por projeto com chave completa: revisão/frame, transforms, hashes dos assets, dimensões, composição, renderer/version e parâmetros de preview.
2. Limitar cache por bytes e LRU; permitir relatório/limpeza seletiva e regeneração. Originais e bibliotecas compartilhadas nunca são cache.
3. Adotar proxies de vídeo quando úteis, sempre dentro de `app-data`; preview pode usar proxy e export resolve mídia original. Regenerar proxy não pode mudar clip nem sincronização de áudio.
4. Enfileirar decodificação, thumbnails e waveform com concorrência limitada, priorizando playhead e viewport.
5. Preview renderizado de trechos pode acelerar playback de composição pesada, mas deve invalidar regiões dependentes. Kdenlive documenta que preview rendering melhora playback, não edição, e fornece visibilidade/limpeza do cache. [Preview rendering](https://docs.kdenlive.org/en/tips_and_tricks/tips_and_tricks/timeline_preview_rendering.html) · [Dados de cache](https://docs.kdenlive.org/en/project_and_asset_management/project_settings/tab_cache_data.html)

### Fase D — render e export serial

1. Capturar snapshot imutável e versionado no início do job; implementar avaliador determinístico `frame -> scene`, sem relógio/playhead React nem mutação do documento ativo.
2. Renderizar por uma superfície isolada que compartilhe geometria, camadas e alpha canônicos do V5. Validar primeiro quadros selecionados e seeks aleatórios; só depois exportar ranges.
3. Definir API tipada `start/cancel/progress/complete/fail`, `jobId` UUID e dono do job. Começar com um export por projeto, cancelamento idempotente e fila de frames com backpressure.
4. Rodar FFmpeg em processo isolado com argumentos vetorizados (sem shell), temporário único dentro de `app-data`, limite de espaço, progresso, validação via ffprobe e rename atômico após sucesso.
5. Verificar dimensões, FPS, timestamps, duração, frame count, áudio/sync, boundaries e comparação de imagem com o renderer. Cancelamento, crash ou falta de espaço preservam qualquer saída anterior e limpam somente temporários do job dono.
6. Antes de incluir binário, auditar origem, licença, codecs distribuídos, empacotamento, assinatura e atualizações. Não copiar builds/binários do V4 sem essa checagem.

### Fase E — hardware encode e Turbo após serial validado

1. Comparar software e encoders de hardware disponíveis (AMF/NVENC/QSV) com fixtures idênticas e qualidade validada; falha de probe/inicialização cai para software com motivo registrável.
2. A/B serial vs 2 chunks em cenas curtas e longas; limitar concorrência por memória estimada e evitar superfícies concorrentes disputando GPU.
3. Particionar em intervals half-open de frames inteiros; confirmar compatibilidade de codec/parâmetros, concatenar vídeo validado e muxar áudio uma vez. Testar início/fim de cada chunk, transições, alpha, áudio e duração.
4. Promover Turbo somente após execuções repetidas mostrarem ganho sem perda visual, instabilidade ou pico de memória inseguro. “2×” descreve paralelismo pedido, não velocidade garantida.
5. Não portar o Hybrid/Smart Export completo do V4 sem contrato de composição V5 que prove compatibilidade.

### Fase F — segurança, persistência e isolamento

- Validar remetente/dono, schema, resolução, duração, tamanho e limites de jobs em cada IPC. Não aceitar shell ou caminhos arbitrários.
- Manter `contextIsolation`, sandbox e APIs específicas no preload; nunca expor `ipcRenderer` genericamente.
- Logs locais estruturados carregam jobId, etapa, duração, códigos e versões; excluem texto, nomes/paths e bytes de assets. Sem telemetria ou upload automático.
- Studio normal e Video Studio conservam comandos e persistência separados. Tocar Fabricador/Customizer somente se perfil e teste mostrarem fronteira compartilhada relevante; preservar bindings, geometria e overrides.
- Usar somente o formato novo do Video Studio. A exclusão de saves antigos aprovada pelo usuário fica restrita aos documentos de projeto antigos e assets pertencentes exclusivamente a esses projetos; bibliotecas compartilhadas de vídeo/fundos e dados de Fabricador/Customizer são preservados.

### Aceite e promoção

- Cada etapa tem teste sintético funcional e medição antes/depois. Não inferir desempenho universal de uma máquina nem declarar meta de 60 FPS ou 2× sem captura e benchmark real.
- React Profiler localiza commits caros, mas sua instrumentação adiciona overhead e não representa o build normal sem profiling. [React Profiler](https://react.dev/reference/react/Profiler)
- Processos pesados ficam fora da interface. Electron recomenda `UtilityProcess` para tarefas CPU/crash-prone e validar sender, sandbox e isolamento. [Process model](https://www.electronjs.org/docs/latest/tutorial/process-model) · [Security](https://www.electronjs.org/docs/latest/tutorial/security/)
- Se WebCodecs for avaliado, limitar `encodeQueueSize` com backpressure; isso não substitui muxagem de MP4. [VideoEncoder queue](https://developer.mozilla.org/en-US/docs/Web/API/VideoEncoder/encodeQueueSize)
- Progresso e cancelamento FFmpeg devem ser explícitos e rastreáveis por processo/job. LosslessCut é referência de padrão de execução, não código a transplantar sem revisão de contratos/licença. [LosslessCut FFmpeg implementation](https://github.com/mifi/lossless-cut/blob/master/src/main/ffmpeg.ts)
- Shotcut/Kdenlive demonstram o uso de proxies para edição e preview, mas o projeto precisa administrar separadamente original, derivado e limpeza do cache. Blender reforça limites de cache com eviction; reproduzir o princípio de limite mensurável, não seu código C++ no app Electron. [Shotcut proxy editing](https://forum.shotcut.org/t/settings-proxy-editing/18517) · [Blender sequencer cache eviction](https://github.com/blender/blender/blob/main/source/blender/sequencer/intern/strip_relations.cc)
- OpenTimelineIO é uma biblioteca de intercâmbio de dados editoriais (tracks, clips, gaps, transitions e tempo racional), não uma engine de render. Não adicioná-la ao runtime interno enquanto o V5 não exigir import/export interoperável; seus conceitos servem para contratos e testes de timeline. [OTIO architecture](https://github.com/AcademySoftwareFoundation/OpenTimelineIO/blob/main/docs/tutorials/architecture.md) · [OTIO timeline structure](https://github.com/AcademySoftwareFoundation/OpenTimelineIO/blob/main/docs/tutorials/otio-timeline-structure.md)
- Aceite funcional: aparência de export coincide com preview; sem frames ausentes/duplicados, drift de áudio, contaminação entre personagens/Studios ou saída parcial publicada. Typecheck, testes, build, smoke Electron e inspeção visual são reportados separadamente.
- AF-13 e “Turbo 2×” não são concluídos sem screenshot reproduzível, geometria, hash, métricas e reabertura do documento.
