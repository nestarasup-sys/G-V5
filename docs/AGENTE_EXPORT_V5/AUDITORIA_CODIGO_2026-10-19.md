# AUDITORIA DE CÓDIGO — Video Studio V5 vs Editor V4
Data: 2026-10-19. Escopo: revisão estática remota via GitHub, **não** execução de Electron, FFmpeg ou benchmarks nesta rodada.

## Referências e limite da prova
- Destino: G-V5 / master-desenvolvimento; revisão de partida observada: 71183cc5cc56840c7d6390d98146a9032d7d79d3.
- Origem somente leitura: EDITOR-V4 / oai/aggressive-export-v5, revisão b951b4d2cbb360e3cfef7769e457894337bbc83e.
- Evidências: arquivos de origem e testes indicados abaixo. Nenhuma mídia privada, arquivos de usuário ou modelo real foram lidos.
- Rótulos: **CONFIRMADO** = código inspecionado; **RISCO** = cenário inferido ainda não reproduzido; **PROPOSTA** = não implementada.

## Inventário de verdade: componentes disponíveis
| Camada | Evidência | Diagnóstico |
| --- | --- | --- |
| Documento | src/shared/studio.ts | CONFIRMADO: VideoTimelineDocument v1, frames inteiros, 60 FPS, dados de atores, gap, textos, vídeo e áudio. |
| Snapshot | src/shared/videoExportSnapshot.ts | CONFIRMADO: clone/freeze, limpeza de playhead/playing e seleção de texto/gap/vídeo/blink. **Não** cria identidade persistida de job nem rasteriza pixels. |
| Preview | src/renderer/src/features/videoStudio/VideoStudioEditor.tsx | CONFIRMADO: RAF controla playhead, personagens/bolhas renderizados no React; Print não é MP4. |
| Estados | characterTrack.ts / characterTransitions.ts | CONFIRMADO: chave de personagem pode carregar VideoCharacterState+imageDataUrl; transições de 250 ms equivalem a 15 frames a 60 FPS. |
| Animação | useCharacterTransitions.ts / transitionRenderer.ts | CONFIRMADO: samples de transições só entram no mapa quando playing; geração lê bibliotecas do Fabricador/Customizer assincronamente. |
| Media | VideoClipPreview.tsx / videoMediaPlayback.ts | CONFIRMADO: HTMLVideoElement e seek por tempo alvo (sourceStartFrame + frame - clip.startFrame)/60; sincronização tolerante durante playback não constitui captura exata. |
| Áudio | src/shared/videoStudioAudioPlan.ts | CONFIRMADO: gera argumentos para entradas e filtro AAC; não executa nem sonda mídia. |
| Checkpoints | electron/videoExportJobs.ts | CONFIRMADO: chunks sequenciais de 600 frames, SHA-256, retomada por prefixo contíguo; os testes usam bytes de arquivo sintéticos, não MP4 decodificável. |
| Writer | electron/videoRawFrameWriter.ts | CONFIRMADO: valida comprimento BGRA, escreve a processo filho, perfil h264_mf fixo; não recebe raster do V5 nem garante que encoder existe. |
| Raster | electron/videoSyntheticRaster.ts | CONFIRMADO: gerador de padrões artificiais determinísticos; explicitamente não compositor de arte. |
| Publicação | electron/videoExports.ts | CONFIRMADO: publica final.mp4 com hash e sidecar após checagens de arquivo. Não realiza validação ffprobe/PTS/codec. |
| Integração | electron/main.ts / preload.ts / src/shared/studio.ts | CONFIRMADO: há IPC para listar/deletar/abrir exportações; **não** há operação funcional de start/cancel/progress/MP4. |
| CI | .github/workflows/video-export-synthetic.yml | CONFIRMADO: teste Node sintético + typecheck + build Windows; não inicia Electron, não testa FFmpeg, não sobe artefatos. |

## Descobertas críticas adicionais, priorizadas

### P0 — O preview NÃO é uma especificação temporal já unificada
- Em VideoStudioEditor.tsx, o estado de personagem no play usa characterStateAt, useCharacterTransitions e efeitos automáticos; ao pausar, o conjunto de samples de useCharacterTransitions depende de playing.
- O resolvedor do snapshot exportado **não** devolve pose/expression state interpolado, boca falante, efeitos dinâmicos, z-order final ou pixels.
- O blink do resolvedor é determinístico, mas a prévia real prepara PNGs assincronamente só em certas condições; a exportação deve definir regra explícita para idle/paused/talk/blink e paridade de modo.
- PROPOSTA: construir avaliação temporal comum pura (frame absoluto + snapshot) e uma camada de assets resolvidos; separar apresentação visual do estado de transporte. Transições pré-calculadas devem funcionar também no frame arbitrário do meio da transição.
- Gate: frame 0, 1, key-16 até key+1, 14 amostras internas de transição de 15 frames, seek aleatório e render sem playback; verificar pixels e prioridade de mouth/blink/transition.

### P0 — Dependências de personagem externas ao Studio ainda são mutáveis
- transitionRenderer.ts lê loadFabricatorSlot, loadFabricatorPose, loadFaceComponentAsset, loadFaceCatalogItem e CustomizerPage na hora de compor a transição.
- structuredClone+deepFreeze do Studio não congela os **bytes** de bibliotecas externas; trocar uma pose, asset ou preset durante render pode produzir dois resultados no mesmo job.
- PROPOSTA: preflight deve listar, resolver e versionar/hash **todas** as dependências transitivas de arte que são realmente lidas; criar AssetManifest imutável com conteúdo pinned ou bloquear/invalidar mudança. Never assume IDs or updatedAt uniquely identify byte contents.
- Gate: editar biblioteca sintética após snapshot; o job inteiro usa bytes originais ou aborta consistentemente, nunca mistura revisões.

### P0 — Origem de vídeo por tempo, não por índice de frame suposto
- videoExportSnapshot.ts calcula sourceFrame = sourceStartFrame + (frame - startFrame); videoMediaPlayback.ts transforma esse valor em segundos dividindo por 60.
- O contrato mede cortes em unidades de frames da **timeline**, não da cadência codificada na mídia. Isso precisa ser descrito como **source timeline ticks**.
- RISCO: VFR/23.976/29.97/25 FPS, PTS não zero, edit lists, rotação e B-frames tornam incorreto assumir 'sourceFrame' = índice de frame do arquivo.
- PROPOSTA: target timestamp racional = (sourceStartFrame + absoluteFrame - clip.startFrame)/60, convertido por regra documentada para PTS de stream, com política explícita de nearest/previous frame; ffprobe mediainfo e decoder com seek preciso + validação de frame apresentado, sem confiar apenas em 'seeked'.
- Gate: fontes sintéticas 24, 25, 30, 60, 30000/1001 e VFR com identificador de frame visível e boundaries [start,end).

### P0 — Encoder/distribuição ainda hipotéticos
- buildVideoStudioChunkArgs fixa h264_mf, bitrate 12M, 1920×1080, 60 FPS, 600 frames. assertCompatibleFfmpegBuild faz checagem textual de GPL/nonfree e nome do encoder, mas isso **não equivale a probe funcional** nem resolve obrigações legais.
- Sem FFmpeg garantido no package.json e sem executável instalado não se pode prometer MP4 em Windows. h264_mf depende de build, API e hardware/software Windows; fallback deve ser realmente testado.
- PROPOSTA: FFmpegLocator+EncoderCapabilities com versão/hash/licença origem do binário, testes de encode/decode curtos e perfil imutável por job/chunk; output h264/yuv420p/aac 48 kHz quando habilitado.
- Gate: smoke real em Windows alvo e binário de distribuição, exame ffprobe; revisão jurídica de licença antes de redistribuir.

### P1 — Checkpoint sequencial não é Turbo pronto
- videoExportJobs.ts aceita apenas recordChunk(jobId,index) se index = chunks.length; dois workers podem terminar fora de ordem.
- reopen comprova SHA/size e prefixo contíguo, não SPS/PPS, codec, PTS, duração, frame count, closed GOP ou compatibilidade dos segmentos.
- PROPOSTA: não reutilizar o manifesto atual para Turbo sem versionamento de schema; guardar chunks concluídos fora de ordem + validação por chunk e status atomicamente, preservar prefixo de publicação ordenado. Verificar comportamento do filesystem entre disco/partições.
- Gate: worker 1 completa antes do 0, falha de 0, retomada seletiva, corrupção válida em SHA mas MP4 inválido, duplicação e cancelamento concorrente.

### P1 — Backpressure/Memória merecem medição e correção
- No writer, writeFrame() aguarda callback do write de stdin antes de retornar. Chamado sequencialmente, maxInFlight=2 tende a não usar dois writes pendentes; **risco de throughput**, não bug de integridade comprovado.
- Buffer.from(frame) faz cópia por frame. Um BGRA de 1920×1080 custa exatamente 8.294.400 bytes (~7,91 MiB); a 60 FPS, o tráfego bruto é 497.664.000 B/s (~475 MiB/s). **Não persistir todos os raw frames**.
- PROPOSTA: medir geração/cópia/IPC/pipe/decode/encode separadamente; bounded pool ou transferência de ownership com acknowledgement de frame, sem reutilização prematura do buffer; timeout de processo.
- Gate: 5/30/90 s sintéticos e streaming sem crescimento RSS monotônico, p95 e memória pico reportados.

### P1 — Áudio e publicação têm gates distintos
- videoStudioAudioPlan.ts usa -ss/-t antes de input e atrasos arredondados em milissegundos; pressupõe stream áudio existente e usa mix/alimiter condicional; não mede atraso final, PTS, silêncios e clipping em MP4.
- videoExports.ts verifica tamanho/hash; a existência do arquivo não comprova decodificação, 60 FPS, duração, áudio nem sincronismo. Em rename cross-volume, semântica de transação precisa ser observada.
- PROPOSTA: mixer único final, probe das entradas, áudio em timeline clock, teste de click/sine sintético e erro explícito em ausência de stream; validar final inteiro antes de finalize. Publicar sidecar só depois do vídeo validado, com recuperação de falha entre renames.
- Gate: zero áudio, mute, vários clipes/overlap, silêncio entre clipes, PTS final e cancelamento durante publish.

### P1 — CI é garantia limitada, não 'export pronto'
- Workflow existente não dispara por mudanças no VideoStudioEditor/characterTrack/useCharacterTransitions/transitionRenderer/videoMediaPlayback/main/preload nem executa Electron; não pode ser gate único.
- PROPOSTA: gate isolado com mudança explícita de paths para contratos visuais, smoke Electron com fixture em runner apropriado **se/quando** ambiente suportar, sem DEV AI/auditorias desativadas, sem assets privados.
- Gate: matriz definida em CONTRATOS_ENGINE_E_TESTES.md.

## O que adaptar do V4
| Origem no Editor V4 | Destino no G-V5 | Decisão |
| --- | --- | --- |
| src/core/export/chunkPlan.ts | plano de intervalo [start,end) em frames V5 | Adaptar conceito; não converter duração para float/ceil desnecessariamente. |
| electron/exportManager.ts e src/render/ExportSurface.tsx | serviço main + surface específica V5 | Reaproveitar protocolo frame-ready/asset-ready, não DOM/ProjectDocument. |
| electron/ffmpegFrameWriter.ts | videoRawFrameWriter.ts | Já há esqueleto; provar throughput, encerramento e ownership. |
| electron/turboExportCoordinator.ts | orquestrador pós-serial V5 | Chunks determinísticos, encode idêntico, concat copy, áudio único, fallback. |
| electron/hybridExportManager.ts | cache de composição do V5 | Pesquisa posterior: estáticos/dinâmicos, content addressing, dirty regions, invalidação. |
| scripts/canonical-export-parity-smoke.cjs | fixtures de oracle do V5 | Adaptar método de detecção de stale-frame, não golden images V4. |

### Dados históricos V4 — não são medição V5
O arquivo V4 docs/EXPORT_V5_STATUS_2026-09-21.md informa 180 s de vídeo a 30 FPS com 2 chunks em Ryzen/AMD: export interno ~54,377 s com cache quente, 3,310× tempo real (cenário específico). G-V5 é 60 FPS, compositor distinto; desempenho deve ser medido do zero, com mediana cold/warm e qualidade.

## Critério de verdade
Separar quatro estados nos próximos diários: IMPLEMENTADO NO CÓDIGO, TESTADO SINTETICAMENTE, TESTADO EM ELECTRON/FFMPEG REAL, VALIDADO NO PC ALVO. Nunca promover um estado a outro apenas porque build/typecheck passou.


## Extensão da auditoria — domínio integral do Video Studio (2026-10-19)

A comparação inicial focava export. A inspeção ampliada encontrou:
- `VideoStudioEditor.tsx::makeCanvasPrint` faz raster de texto com `context.roundRect`, `measureText` e fonte própria, independente dos balões reais feitos em DOM/CSS. O print atual portanto **não é oráculo raster da prévia**; testar texto, círculo/tail, fonte, cor e clipping separadamente.
- `VideoStudioEditor.css` usa `font-size: clamp(9px, 1.4vw, 18px)` para balões. Uma superfície de export em viewport diferente pode calcular tipografia diferente. Migrar geometria/tipografia para palco 1920×1080 canônico.
- `VideoStudioEditor.tsx` atribui `zIndex: Math.max(0, element.zIndex)+2` aos elementos, com `video-studio-video-composition` CSS em `z-index:1`; importar engine de timeline genérica pode inverter camadas.
- `electron/videoLibrary.ts` mantém `media-library/videos` e cópias físicas `studio-<id>/videos`. `attach()` chama `copyVerified()`; a integridade de cópia é aferida por **tamanho**, não hash completo. CAS e proxies devem ser migrados em shadow mode; não assumir deduplicação global automática.
- `src/shared/videoMedia.ts` garante corte/source range de tamanho igual em *ticks 1/60*; não confundir sourceStartFrame com frame real de stream, especialmente VFR/29.97.
- `useCharacterTransitions.ts` usa `playing` para samples, `transitionSampleFrames()` exclui os extremos. Ao falar em '15 frames de transição', diferenciar **janela de 15** de **14 intermediários** no caso pleno.
- `VideoStudioEditor.tsx` monta seis quadros de boca em ciclo `frames.length*6` ao falar; sequenciamento deve ser dependente do frame absoluto e speechStartFrame, não do relógio React.

**Estudos externos e plano integral:** [Motores](../VIDEO_STUDIO_V5_MODERNIZACAO/01_ESTUDO_DE_MOTORES.md) · [Arquitetura](../VIDEO_STUDIO_V5_MODERNIZACAO/02_ARQUITETURA_CANONICA.md) · [Dados](../VIDEO_STUDIO_V5_MODERNIZACAO/03_MIGRACAO_E_DADOS.md) · [Gates](../VIDEO_STUDIO_V5_MODERNIZACAO/04_LAB_E_GATES.md).

**Limites:** fontes verificadas estaticamente; testes runtime/Pixi/FFmpeg/MLT/GES não foram realizados nesta rodada. Direção arquitetural = hipótese até bench real.
