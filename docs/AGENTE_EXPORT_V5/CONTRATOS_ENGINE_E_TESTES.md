# CONTRATOS EXECUTÁVEIS — Export Engine Video Studio V5
Data: 2026-10-19. **Especificação proposta**, não interface pública implementada.

## Invariantes de produto (não negociáveis)
1. StudioDocument v1 / VideoTimelineDocument v1 são origem canônica. FPS timeline 60; duração N frames, amostras inteiras no domínio [0,N). Render de frame n independe de playhead, playback, ordem de seeks, viewport e histórico de ações React.
2. Resultado padrão alvo: 1920×1080, H.264 yuv420p, CFR 60; áudio AAC estéreo 48 kHz quando não mudo e material existente. Valores só são 'suportados' após capability probe de binário real.
3. O frame solicitado deve corresponder visualmente ao preview V5 para o MESMO frame e mesmo estado de animações (preview em modo canônico); se a prévia atual divergir por usar playing, corrigir o domínio compartilhado, não reproduzir bug silenciosamente.
4. Um job usa snapshot de projeto, **dependências de imagem/presets/poses e mídia fixadas**, engineVersion, profileVersion, versão e configuração do encoder. Nenhuma escrita em Studio, Fabricador, Customizador, bibliotecas ou arquivos de usuário.
5. Não publicar parcial. Toda saída passa por probe/decodificação/validação, depois commit da biblioteca de export, depois limpar temporários próprios; preservar export anterior em qualquer falha.
6. Serial é sempre fallback seguro até Turbo provar paridade.

## Boundary A: compilação do job
A função pure/sem side effects que planeja frames não deve ser confundida com materialização do job.
Entrada: StudioDocument normalizado, revisões de dependências externas, resoluções de paths seguras, perfil e range.
Saída interna planejada (interfaces ilustrativas, **não existem ainda**):

~~~ts
type ExportRange = { startFrame: number; endFrameExclusive: number };
type ExportJobSpec = {
  schemaVersion: 1;
  jobId: string; studioId: string;
  timelineFps: 60;
  width: 1920; height: 1080;
  range: ExportRange;
  studioSnapshotDigest: string;
  mediaManifestDigest: string;
  artManifestDigest: string;
  rendererVersion: string;
  profileVersion: string;
  encoderCapabilityDigest: string;
};
type ExportFrame = {
  absoluteFrame: number;
  timestampNumerator: number; timestampDenominator: 60;
  visibleLayers: unknown[]; // substituir por discriminated union tipada
};
~~~

- Range [start,end) com 0 <= start < end <= N. Transformar vídeo parcial e áudio a partir do **mesmo start absoluto**; nunca serializar playhead/playing como identidade.
- Hash SHA-256 de representação **canônica** com ordenação estável de keys, normalização de números, versionamento de campos e digest de bytes de todos os assets externos. Evitar hash de timestamps/ordem de mapa/caminhos específicos da máquina.
- Versões distintas para renderer, codec profile e schema de cache. Uma mudança de qualquer uma invalida os checkpoints afetados.
- Páginas/bytes imutáveis ou empréstimo com lifetime controlado; snapshot JS frozen não congela arquivos em disco.
- Preflight valida UUID/paths sob roots próprios, clips e gaps em bounds, assets ausentes, duração válida, disco disponível, FFmpeg probe, memória estimada e output separado de input.

## Boundary B: resolvedor visual determinístico
Produzir estado completo para frame N sem React/useEffect/RAF:
- z-order estável e política de empate; background e transform; elementos image/narrator/speech/thought.
- characterBases + characterKeys + characterGaps + characterTransforms globais. Escolher estado local por frame e interpolar transition de 250 ms/15 frames conforme regras V5; ordem de prioridade transition > auto-mouth > blink, depois neutral.
- Speech ativa modo talk apenas no intervalo; thought não fala; mouth phase baseado no start da fala e frame absoluto, **nunca** em wall-clock.
- Blink referenciado ao relógio absoluto e ID, respeitando visibilidade/estado e modo.
- Text clips sobrepostos devem ter precedência determinística igual à UI; usar estado salvo do clip e posição relativa ao personagem quando aplicável.
- Para vídeos, converter tick da timeline (1/60s) para timestamp racional do asset; decoder informa PTS/frames efetivamente apresentados. Separar 'frame de timeline' e 'índice de frame codificado'.
- Transições não podem variar com tamanho da janela, DPR, GPU flags ou decoder state. Dimensionar stage 1920×1080 e parametrizar valores usados pelo Customizer.
- Se uma pose ou preset não estiver disponível, falhar no preflight ou usar fallback explicitamente aprovado e testado; nunca apresentar um frame anterior silenciosamente.

## Boundary C: renderer/presenter isolado
Protocolo lógico sugerido (não canais IPC definitivos):
1. PREPARE(jobDigest, assetManifest, rendererVersion)
2. READY(jobDigest, renderSurfaceId)
3. RENDER(frameAbsolute, requestId)
4. FRAME_READY(requestId, frameAbsolute, imageDigest?, width, height, pixelFormat)
5. CAPTURE_REQUEST(requestId); CAPTURE_ACK(requestId, bufferChecksum?, bytes)
6. ACK_CONSUMED(requestId)
7. CANCEL(jobId) / FAILED(reason) / CLOSED

- Em cada request, concluir render assíncrono, fontes/imagens/decoders, pelo menos um commit visual relevante e prova de que pixels correspondem a requestId. Eventos 'paint', 'seeked' ou React commit isolados **não** garantem isso.
- Dimensões 1920×1080, BGRA, stride/alpha/cores explícitos; validar length=8.294.400 ou normalizar stride em buffer próprio; não capturar interface, seleção/handles, overlays de edição ou HUD.
- A captura do export nunca herda opacidade/zoom/DPR da janela editor.
- Backpressure por acknowledgement; lease por buffer para evitar reutilização antes do writer. Timeout e abort por etapa; nenhuma Promise pendente para sempre após abort/exit.

## Boundary D: encoder, áudio e saída
- Capability probe do executável ABSOLUTO em ambiente-alvo: licença/config real, codecs, pix formats, GPU/driver, curto encode+decode. h264_mf NÃO é garantia.
- Todos os chunks do mesmo job: codec/profile/level/pix_fmt/color tags/resolução/timebase/GOP/SPS/PPS/metadata compatíveis; preferir keyframe no início, sem GOP aberto atravessando chunk. Chunks do Turbo são video-only.
- Áudio só uma vez depois da concatenação, usando entradas verificadas; trim e delays referenciados ao range absoluto, sem duplicar na junção.
- Verificar ffprobe + decodificação e contagem efetiva de frames; monotonicidade de PTS, FPS, duração, bordas chunk-1/chunk, codec, amostragem e sync. ffprobe metadata isolado **não** garante ausência de frames corrompidos.
- Chunks validados atomicamente e recuperáveis por hash/codec/profile. Manifest do esquema atual de 600 frames é SEQUENCIAL; criar schema separado para out-of-order Turbo.
- Ao publicar, observar fsync/rename e cross-volume; sidecar pode servir recuperação. Não remover outro job, não limpar export já publicado.
- Cancel deve ser idempotente e possuído pelo usuário/job; matar process tree com timeout/escalada, liberar BrowserWindow, stdin/stdout, elementos de mídia e cache lease.

## Matriz de testes e gates (somente mídia sintética)
| ID | Tipo | Caso | Aceite |
| --- | --- | --- | --- |
| T01 | Node/puro | frames 0,1,N-1,N, gaps, text overlaps, keys | estabilidade de seleção e bounds |
| T02 | Node/puro | transição frames key-15 até key; seek reverso | mesmo estado/hash em qualquer ordem |
| T03 | Node/puro | snapshot alterado na UI depois do start | frame e digests invariantes |
| T04 | Node+filesystem | snapshot externo, symlink/junction, bytes de pose trocados | job pinned ou erro explícito |
| T05 | Electron sintético | request A→B→A, mudança idempotente de DOM | capturas A iguais, B distinto, sem stale |
| T06 | Electron/paridade | atores, roupas, mouth, blink, textos, z-order, flip, rotation | captura equivalente ao preview canônico; tolerância explicada |
| T07 | Decoder real | 24/25/30/60/VFR + B-frame, cortes e overlap | quadro correspondente a PTS canônico |
| T08 | FFmpeg real | 5/30/90 s MP4 CFR H.264 | N frames decodificáveis, duração N/60 e PTS monotônico |
| T09 | Audio real | mudo, click por boundary, 2 fontes overlap, clipping | duração/sync e volume validados |
| T10 | Failure injection | kill encoder, renderer crash, disco cheio, cancel 3 estágios | nenhum parcial publicado, sem orphan/overwrite |
| T11 | Turbo vs serial | 1/2 chunks, range parcial e boundaries | visual por frame dentro de tolerância codec; áudio exatamente uma mixagem |
| T12 | Bench | cold/warm repetidos, 5/30/90 s e 15 min no PC alvo | mediana, p95, RSS peak, CPU/GPU, qualidade e tempo por etapa |
| T13 | Security | IPC sender inválido, path traversal, checksum errado, rename falho | fail closed, só arquivos próprios afetados |
| T14 | Distribution | Electron empacotado no Windows alvo, probed binary | funciona sem FFmpeg instalado externamente |

## Gates de promoção
G0 Node sintético (sem DEV AI/audit) -> G1 Electron raster/asset barrier -> G2 MP4+áudio real serial -> G3 paridade visual e robustez -> G4 Turbo com fallback -> G5 performance e instalador.
O sucesso de um gate não substitui os posteriores. Sem G2, UI de export deve permanecer indisponível/experimental. Turbo só default com G3+G4+G5.


## Nota de compatibilidade com o plano integral (2026-10-19)

1. `transitionSampleFrames()` entrega somente amostras internas; no caso clássico de 15 frames de janela, os frames estritamente internos são 14. Os testes devem verificar função real, e não exigir exatamente 15 PNGs intermediários.
2. Balões/textos do preview DOM CSS e `makeCanvasPrint()` Canvas2D têm layouts independentes; unificar por contrato tipográfico/geométrico fixo 1920×1080 antes de chamar "mesmo preview/export".
3. Política de camada atual: CSS vídeo z=1, elementos Studio zIndex+2. Preservar até decisão/versionamento explícito.
4. Contrato V5 `sourceStartFrame` em ticks 60Hz, não índice físico de frame comprimido; timestamps racionais/PTS para fonte VFR.
5. O `attach()` de videoLibrary faz cópia por projeto, portanto snapshot pinning/digests devem cobrir resolução de qual cópia/original é lido.
6. Contratos expandidos (RenderIR, scene events, cache, media pipeline, milestones) estão em [02_ARQUITETURA_CANONICA.md](../VIDEO_STUDIO_V5_MODERNIZACAO/02_ARQUITETURA_CANONICA.md). O [plano diretor](../VIDEO_STUDIO_V5_MODERNIZACAO/00_PLANO_DIRETOR.md) prevalece no escopo de modernização; este arquivo cobre os gates do *export*.


## Extensão de aceite dos dois modos (requisito mais recente)

Export deve receber `renderVariant` versionado, `animated | static-characters`, sem mutar Studio. `animated` preserva transições e microanimações automáticas conforme configuração do projeto. `static-characters` preserva keyframes authored, mudanças de pose/expressão por segmento e todos os vídeos/áudio, desliga apenas transições interpoladas, piscada/boca automáticas de personagem. Validar interseções, limites, timings, cancel, retomada e paridade de cada variante com preview canônico; teste sintético de comparação visual com frames em key boundary. Protocolo completo em [07_MODOS_DE_EXPORTACAO.md](../VIDEO_STUDIO_V5_MODERNIZACAO/07_MODOS_DE_EXPORTACAO.md). Os dois modos utilizam **a mesma engine**.
