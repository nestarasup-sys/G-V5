# PESQUISA OPEN SOURCE E FECHAMENTO DO EXPORTADOR — Video Studio V5

Atualizado em 2026-10-20. Este documento consolida a rodada documental de pesquisa externa e substitui a necessidade de espalhar novas hipóteses em vários arquivos. **Escopo exclusivo: Video Studio.** Roteiros e Base de Vídeos ficam fora desta investigação, exceto interfaces estritamente necessárias para o Video Studio consumir mídia já existente.

## 0. Objetivo desta rodada

Prioridade do produto:

1. **finalizar o exportador** com correção, recuperação e distribuição Windows;
2. aumentar estabilidade do Video Studio;
3. aumentar velocidade de export e preview sem perder paridade;
4. estudar projetos open source e extrair técnicas úteis;
5. evitar trocar a arquitetura por uma engine maior sem evidência objetiva.

Nenhuma tecnologia abaixo é automaticamente uma dependência. "Extrair" significa primeiro aprender o padrão arquitetural/algorítmico; copiar código só seria permitido após revisão de licença, compatibilidade e necessidade.

## 1. Conclusão executiva

A pesquisa reforça a arquitetura atual:

```text
StudioDocument
  -> snapshot/AssetManifest pinado
  -> Scene Compiler / RenderIR absoluto
  -> compositor determinístico
  -> scheduler serial/Turbo
  -> FFmpeg encode/audio/mux
  -> ffprobe + full decode
  -> publish transacional
```

**Não há justificativa atual para substituir o backbone por MLT, GES ou libopenshot.** Essas engines resolvem NLE genérico; o G-V5 tem composição autoral 2D específica de personagem, rosto, pose, balão e automações próprias. Uma troca agora aumentaria superfície de integração antes de fechar o exportador.

A melhor estratégia é **absorver padrões maduros**:

- MLT: pull model, lazy evaluation, serviços isolados, headless rendering;
- Kdenlive/Shotcut: proxy separado do original, preview escalável, jobs assíncronos e cache administrável;
- mpv: seek cache por ranges, readahead limitado por bytes, fallback de vídeo e disciplina de timestamps;
- VapourSynth/AviSynth+: avaliação frame-based, cache/prefetch configurável e políticas explícitas de thread safety;
- Natron: RAM/disk cache, proxy render e isolamento do processo de render;
- GStreamer: filas/buffers explícitos, backpressure e compositor D3D11 como referência de experimento GPU;
- FFmpeg: encode/mux/audio/verificação, limites de buffering, threading calibrado e progress estruturado;
- Electron OSR: dirty rectangles já expostos; sharedTexture apenas se profiling provar gargalo de readback;
- libplacebo/mpv gpu-next: referência futura para scaling/color/GPU, não novo compositor obrigatório;
- Mediabunny/WebCodecs: candidato de preview/decode e manipulação web; export final só após A/B e compatibilidade;
- NodeAV/libav* direto: candidato futuro para reduzir subprocess/cópias, mas aumenta risco nativo/packaging; não bloquear release atual;
- GPAC/MP4Box: ferramenta de laboratório para inspeção/concat/fragmentação, não dependência obrigatória;
- OpenTimelineIO: útil se um dia houver interchange, não serve como render engine.

## 2. Matriz de tecnologias

| Projeto | Papel real | Licença / risco | O que interessa ao G-V5 | Decisão agora |
|---|---|---|---|---|
| FFmpeg | decode/encode/filter/audio/mux/probe | LGPL/GPL depende do build | backbone de mídia, audio mix, H.264, concat, verification | **MANTER / PRIORIDADE A** |
| MLT | framework NLE multitrack | LGPL core; módulos variam | pull frames, lazy evaluation, producer/filter/consumer, headless | **REFERÊNCIA / spike só se dor real** |
| GStreamer + GES | media graph/NLE | LGPL, plugins variam | queue/backpressure, D3D11 compositor, pipelines | **REFERÊNCIA / A-B futuro** |
| libopenshot | biblioteca NLE C++ | LGPL/GPL componentes precisam revisão | curves, time mapping, mixing, multiprocessing | **NÃO ADOTAR AGORA** |
| Shotcut | editor sobre MLT | GPLv3 | proxy manager, jobs, preview scale, original/proxy separation | **EXTRAIR PADRÕES** |
| Kdenlive | editor sobre MLT | GPL | proxy/preview/render jobs, divisão UI vs engine | **EXTRAIR PADRÕES** |
| mpv | player/renderer | GPL; libplacebo LGPL | seekable demux cache, ranges, readahead, GPU fallback | **EXTRAIR PADRÕES** |
| libplacebo | GPU video rendering | LGPL-2.1+ | scaling/color/tone map/shaders, D3D11/Vulkan/OpenGL | **LAB FUTURO** |
| VapourSynth | frameserver | LGPL | get-frame determinístico, caches, threading | **EXTRAIR PADRÕES** |
| AviSynth+ | frameserver | GPL | cache hints, prefetch, thread mode | **EXTRAIR PADRÕES** |
| Natron | compositor node-based | GPLv2 | cache RAM/disco, proxy render, render subprocess isolation | **EXTRAIR PADRÕES** |
| Blender VSE | NLE | GPL | memory/disk cache + proxies | **EXTRAIR PADRÕES** |
| WebCodecs | API browser | plataforma | VideoFrame transferível, worker decode/encode | **A-B PREVIEW** |
| Mediabunny | toolkit TS media | MPL-2.0 | demux/mux/timestamps/WebCodecs | **A-B PREVIEW**, não default export |
| NodeAV | binding libav* | revisar distribuição/binários | API FFmpeg C direta, HW accel, menos CLI/cópias em tese | **SPIKE PÓS-RELEASE** |
| BeamCoder | binding FFmpeg Node | GPL e projeto antigo | exemplo de binding direto | **REJEITAR produção** |
| GPAC/MP4Box | ISO BMFF tools | licença revisar por componente | inspeção/fragmentação/concat de laboratório | **FERRAMENTA DE LAB** |
| OpenTimelineIO | modelo/interchange | Apache-2.0 | interchange de timeline | **FORA DO CAMINHO CRÍTICO** |
| PixiJS | compositor WebGL/WebGPU | MIT | sprite batching/composição | **A-B existente; promover só por dados** |

## 3. Ideias específicas a extrair

### 3.1 Pull-based frame evaluation (MLT / frameservers)

MLT trabalha com producers que entregam frames sob demanda e usa lazy evaluation de imagem/áudio. VapourSynth/AviSynth também partem da ideia de pedir um frame N e permitir cache/prefetch.

Aplicação no G-V5:

- `evaluateFrame(N)` continua sendo a autoridade;
- renderer não avança estado global para descobrir N;
- seek A-B-A deve produzir o mesmo frame;
- cada dependência do frame deve poder ser descrita antes da rasterização;
- caches ficam acima/abaixo da avaliação sem mudar semântica.

**Gate:** o oracle A-B-A precisa ser totalmente determinístico antes de novas otimizações agressivas.

### 3.2 Cache hierárquico por bytes (mpv / Blender / Natron)

Padrão comum:

```text
L0 estado compilado
L1 frame/layer RAM
L2 cache derivado em disco
L3 mídia/proxy
```

Não usar "quantidade de itens" como orçamento principal. Usar bytes e métricas de hit/miss/eviction.

Aplicação:

- L1 semantic/raster cache já existente;
- L2 persistent frame cache;
- proxy/waveform separado;
- nenhuma camada pode crescer sem quota;
- disco e RAM devem ter eviction independente;
- cache corrompido nunca bloqueia export: remove/regenera.

### 3.3 Seek cache e readahead adaptativo (mpv)

mpv diferencia ranges seekable, readahead e limites por bytes. Isso inspira melhorar vídeo importado no preview:

- cache curto em torno do playhead;
- prioridade para seeks recentes;
- latest-only scheduler;
- invalidar seeks antigos;
- readahead maior durante playback contínuo;
- readahead pequeno durante scrub aleatório;
- limite absoluto em bytes;
- source decoder deve poder ser descartado/recriado sem afetar documento.

Não transformar isso em cache ilimitado de frames RGBA Full HD.

### 3.4 Proxy não altera original (Shotcut/Kdenlive/Blender)

Regra já alinhada ao V5:

- proxy é derivado;
- original é autoridade para export;
- proxy tem version/hash;
- arquivo `.pending` ou equivalente antes do publish evita proxy parcialmente pronto;
- falha de proxy -> original;
- proxy deve ter quota e cleanup.

Extrair adicionalmente: estado explícito `pending/ready/failed/stale` em vez de inferir apenas por existência de arquivo.

### 3.5 Isolamento de render (Natron)

Natron separa render do processo principal para que crash da UI não mate necessariamente o render e vice-versa.

O V5 já usa ExportSurface/worker separation. Levar o princípio até o fim:

- renderer/surface crash é falha de worker, não corrupção de projeto;
- processo FFmpeg tem ownership e cancel explícito;
- coordinator é fonte de verdade do estado do job;
- checkpoint só marca chunk após validação;
- publish final acontece só depois de verify;
- recovery não confia em arquivo presente sem manifest/hash/probe.

### 3.6 Backpressure e filas limitadas (GStreamer)

Evitar filas implícitas grandes:

- no máximo N frames "in flight" por surface/writer;
- decoder de vídeo não fica muito à frente do compositor;
- writer só recebe próximo buffer quando stdout/stdin suporta;
- métricas: waitForSurface, compose, readback, pipe stall, encode;
- cancelar deve liberar fila e buffers imediatamente.

Adicionar futuramente um teste que deliberadamente torne o encoder lento para provar memória bounded.

### 3.7 Threading não significa "mais é melhor" (FFmpeg/AviSynth)

FFmpeg usa pools de threads e permite limitar frames buffered; AviSynth explicita thread safety de filtros. Para o V5:

- Turbo 2 + FFmpeg multithread pode gerar oversubscription;
- autotuner deve considerar workers *e* threads do encoder/filter;
- limitar workers em perfis text-heavy/RAM-heavy;
- benchmark deve testar combinações `workers × encoder threads`, não apenas workers.

**Nova hipótese de laboratório:** em CPU limitada, 1 surface + encoder com threads suficientes pode vencer 2 surfaces competindo pelo mesmo CPU/cache.

### 3.8 Dirty rectangles do Electron OSR

Electron documenta que OSR entrega dirty area no `paint`. Antes de construir um sistema próprio complexo:

- medir se dirtyRect do OSR pode reduzir cópias/raster em preview;
- para export frame-exato, usar somente se o compositor consegue garantir que pixels fora do rect estão preservados corretamente;
- dirty rect não pode quebrar alpha/blur/shadow/tails.

Isso é mais seguro como experimento de preview primeiro.

### 3.9 sharedTexture só depois do perfil

Electron sharedTexture elimina cópia GPU→CPU, mas exige módulo nativo, lifetime e `release()` corretos. O próprio Electron marca a API como experimental.

Decisão:

- não bloquear release;
- só criar POC se `readbackRatio` for dominante de forma repetível em PC alvo;
- exigir fallback CPU;
- medir custo total até encoder, não apenas captura.

### 3.10 libplacebo como biblioteca de qualidade, não engine do editor

libplacebo traz scaling, color management, shaders e backend D3D11/Vulkan/OpenGL. MLT 7.42 também passou a oferecer módulo placebo.

Possíveis usos futuros:

- scaling de vídeo importado;
- conversão de cor;
- tone map/HDR;
- GPU effects.

Não serve para substituir lógica de personagens/balões. Um spike só faz sentido quando o V5 tiver necessidade real de color pipeline/HDR/efeitos GPU.

### 3.11 WebCodecs/Mediabunny

WebCodecs expõe `VideoFrame` transferível e decode/encode low-level em workers. Mediabunny oferece demux/mux e precisão de timestamps sobre esse ecossistema.

Uso prioritário potencial:

1. preview de vídeo importado;
2. geração de proxy;
3. thumbnails;
4. waveform/media inspection complementar.

Não promover para export final antes de provar:

- H.264/AAC compatível no Windows alvo;
- 24/25/29.97/30/60/VFR;
- B-frames;
- negative/non-zero start;
- seek A-B-A;
- memory lifecycle de VideoFrame (`close()`);
- pacote Electron;
- qualidade/bitrate previsível.

### 3.12 NodeAV / libav* direto

Um binding moderno de libav* pode no futuro eliminar alguns subprocessos e permitir zero-copy em pipelines específicos. Isso é atraente para decode/imported video e talvez encode.

Riscos:

- native addon;
- ABI Electron;
- distribuição de DLLs;
- licença/configuração FFmpeg;
- crash nativo dentro do app;
- complexidade de atualização;
- debugging mais difícil que CLI isolada.

**Decisão:** não substituir o FFmpeg CLI antes do release. Criar spike posterior isolado se profiling mostrar que subprocess/pipe/copy é gargalo relevante.



### 3.13 MP4 recuperável / chunk container (FFmpeg)

A documentação atual do muxer MOV/MP4 do FFmpeg oferece `hybrid_fragmented`: durante a escrita o arquivo permanece fragmentado e legível mesmo se a gravação for abortada; ao terminar normalmente, é convertido para MP4 não fragmentado. Um arquivo interrompido pode ser remuxado posteriormente.

Isso cria uma hipótese útil para exports longos, mas **não substitui automaticamente** o modelo atual de chunks validados:

- chunk independente continua melhor para Turbo/retry seletivo;
- `hybrid_fragmented` pode ser útil para o caminho serial ou para o estágio final de mux;
- medir compatibilidade, overhead, tamanho, seek e tempo de finalização;
- crash test deve matar FFmpeg sem cleanup e depois provar recuperação/remux;
- saída recuperada nunca é publicada sem o verifier normal.

Também manter como alternativa de laboratório Matroska para temporários, pois clusters têm limites explícitos de tempo/tamanho; porém a entrega final continua MP4/H.264/AAC.


### 3.14 Resultado do EXP-07 — hybrid fragmented REJEITADO (2026-10-20)

Execução GitHub Actions `39479796555`, Windows, usando o **FFmpeg LGPL pinado de produção** (binário direto, sem shim do Chocolatey):

- o MP4 interrompido permaneceu parseável;
- o remux `-c:v copy` produziu um arquivo;
- porém o decode estrito falhou com `Invalid NAL unit size` / `Error splitting the input into NAL units`;
- causa prática: um kill pode interromper o bitstream H.264 dentro de um NAL mesmo quando a estrutura fragmentada do container é recuperável.

Decisão: **não adotar `hybrid_fragmented` como mecanismo de recovery do Video Studio V5**. O desenho de chunks independentes + checkpoint + validação por chunk é superior porque permite descartar/refazer apenas unidades completas e não depende de recuperar uma unidade H.264 cortada no meio. O experimento foi removido do CI após registrar a evidência para evitar um gate permanentemente vermelho.

## 4. Prioridade revisada — FINALIZAR EXPORTADOR

### P0 — Determinismo/paridade
1. corrigir qualquer falha A-B-A do character/media oracle;
2. repetir `A→B→A→C→A` em animated/static;
3. distinguir estado divergente de diferença de codec/raster;
4. bloquear otimização que introduza dependência da ordem dos seeks.

### P1 — Serial como oracle de correção
1. serial precisa ser caminho mais simples e confiável;
2. output temporário;
3. FFmpeg real;
4. frame count exato;
5. áudio;
6. full decode;
7. atomic publish;
8. cancel;
9. retry/recovery.

Turbo nunca substitui o serial como fallback.

### P2 — Recovery torture
Adicionar matriz completa:

- surface crash;
- FFmpeg crash;
- kill durante chunk;
- kill antes/depois de checkpoint;
- concat;
- audio mux;
- verify;
- publish;
- corrupt chunk;
- corrupt manifest;
- permission denied;
- ENOSPC;
- cancel repetido;
- resume repetido;
- cancel durante fallback;
- orphan subprocess.

### P3 — Memória e backpressure
1. medir RAM total incluindo subprocessos;
2. limitar frames in-flight;
3. medir pipe stalls;
4. medir decoder queues;
5. layer/persistent/proxy caches com budgets separados;
6. stress text-heavy e imported-video-heavy.

### P4 — Turbo/autotuner
Benchmark:

```text
1 worker
2 workers
1 worker + encoder threads calibrados
2 workers + encoder threads limitados
```

Por perfil e duração 5/30/90 s. Promover apenas configurações que melhorem wall-clock sem exceder memória.

### P5 — Packaging Windows
O release não termina sem:

- ffmpeg/ffprobe packaged;
- build LGPL auditável;
- license/notices;
- sem dependência de PATH;
- smoke em pacote real;
- export real no pacote;
- machine/profile sem FFmpeg global.

### P6 — Hardware alvo
Executar `run-hardware-gate.ps1 -Include15Min` e recalibrar autotuner com dados reais.

## 5. Prioridade revisada — VELOCIDADE DO VIDEO STUDIO

Depois dos itens críticos do export:

1. latest-only seek scheduler;
2. proxy cache state + quota;
3. decoder/readahead em torno do playhead;
4. layer-cache A/B on/off;
5. dirty rectangles apenas se ganho;
6. worker decode/WebCodecs A/B;
7. PixiJS A/B end-to-end incluindo readback;
8. sharedTexture apenas se readback dominar;
9. libplacebo/GStreamer GPU apenas se surgir requisito/gargalo não resolvido.

## 6. Tecnologias explicitamente não prioritárias

### MLT como substituto completo
Não agora. Benefícios genéricos não compensam portar semântica específica de personagem e compositor.

### GES/GStreamer como export principal
Não agora. Excelente referência de backpressure/GPU/media graph, mas grande superfície de packaging/plugin discovery no Windows.

### libopenshot
Não agora. Duplica timeline/compositor/media abstractions já específicas no V5.

### Olive
Referência limitada; o próprio projeto se descreve como alpha/instável. Não usar como fundação.

### Natron/Blender
Referência de cache/process isolation/proxy; licenças e escopo impedem uso direto como backend simples.

### OpenTimelineIO
Não renderiza mídia. Só revisitar para interchange.

## 7. Experimentos novos recomendados

### EXP-01 — workers × threads
Pergunta: Turbo perde eficiência por oversubscription?
Métrica: wall, CPU, RSS total, compose/readback/encode.
Gate: ≥10% ganho repetível sem aumento material de falhas/RAM.

### EXP-02 — layer cache ON/OFF
Pergunta: o cache integrado economiza tempo total ou só troca CPU por RAM?
Gate: mesma imagem/hash + ganho mensurável.

### EXP-03 — bounded slow encoder
Inserir encoder artificialmente lento para provar que surfaces não acumulam frames sem limite.

### EXP-04 — preview seek ranges
Comparar current latest-only contra pequeno cache/readahead adaptativo inspirado em mpv.

### EXP-05 — WebCodecs imported video
Mesma sequência A-B-A de timestamps contra pool atual.

### EXP-06 — packaged clean machine
Não é benchmark; é gate operacional obrigatório.

### EXP-07 — hybrid fragmented serial recovery — **REJEITADO**
Resultado registrado na seção 3.14. Não integrar ao runtime.

## 8. Métricas mínimas por export

Registrar de forma sanitizada:

- preflightMs;
- snapshotMs;
- sceneCompileMs;
- surfaceStartupMs;
- composeMs;
- readbackMs;
- decoderMs;
- writerWaitMs / pipeStallMs;
- encodeMs;
- concatMs;
- audioMs;
- verifyMs;
- publishMs;
- frames;
- cache L1/L2/layer hits/misses;
- peak app RSS;
- peak child-process RSS quando possível;
- output bytes;
- encoder;
- worker count;
- failure/fallback count.

Essas métricas devem distinguir **tempo ativo** e **tempo esperando outra etapa**. Sem isso, otimização pode atacar a etapa errada.

## 9. Referências externas desta rodada

Fontes primárias / projetos estudados:

- FFmpeg: https://ffmpeg.org/documentation.html
- FFmpeg filters: https://ffmpeg.org/ffmpeg-filters.html
- MLT: https://mltframework.org/ e https://github.com/mltframework/mlt
- GStreamer Editing Services: https://gstreamer.freedesktop.org/documentation/gst-editing-services/
- GStreamer D3D11 compositor: https://gstreamer.freedesktop.org/documentation/d3d11/d3d11compositor.html
- Kdenlive: https://github.com/KDE/kdenlive
- Shotcut: https://github.com/mltframework/shotcut
- libopenshot: https://github.com/OpenShot/libopenshot
- mpv: https://github.com/mpv-player/mpv
- libplacebo: https://github.com/haasn/libplacebo
- VapourSynth: https://github.com/vapoursynth/vapoursynth
- AviSynth+: https://github.com/AviSynth/AviSynthPlus
- Natron: https://github.com/NatronGitHub/Natron
- Blender VSE docs: https://docs.blender.org/manual/en/latest/editors/video_sequencer/
- Electron offscreen: https://www.electronjs.org/docs/latest/tutorial/offscreen-rendering
- Electron sharedTexture: https://www.electronjs.org/docs/latest/api/shared-texture
- WebCodecs: https://developer.mozilla.org/en-US/docs/Web/API/WebCodecs_API
- Mediabunny: https://github.com/Vanilagy/mediabunny
- NodeAV: https://github.com/seydx/node-av
- GPAC: https://github.com/gpac/gpac
- OpenTimelineIO: https://github.com/AcademySoftwareFoundation/OpenTimelineIO

## 10. Regra de decisão

Uma nova engine/biblioteca só entra no caminho canônico se provar pelo menos um destes resultados sem regressão de correção:

- melhora repetível de throughput;
- grande redução de RAM/cópias;
- resolve classe de crash/seek/codec que o backend atual não resolve;
- reduz substancialmente código/risco de manutenção;
- oferece capacidade necessária ainda inexistente.

E precisa passar:

1. Windows packaging;
2. licença;
3. cancel;
4. recovery;
5. deterministic fixtures;
6. 90 s e 15 min;
7. fallback.

Caso contrário, fica como **referência** ou **experimento rejeitado**, não como dependência.

## 11. Próxima execução técnica recomendada

Quando a fase documental terminar, a sequência de código deve ser:

1. verificar CI do HEAD;
2. fechar oracle A-B-A;
3. fechar recovery torture;
4. medir RAM total/backpressure;
5. executar A/B layer cache;
6. calibrar workers × encoder threads;
7. fechar pacote Windows clean;
8. hardware gate;
9. decidir Pixi/WebCodecs;
10. só então considerar sharedTexture/NodeAV/libplacebo.

**O exportador é o caminho crítico. Novas tecnologias não podem atrasar sua conclusão.**
