# ESTUDO COMPARATIVO — Motores e bibliotecas open source para o G-V5
Investigação de fontes primárias · 2026-10-19 · **análise de arquitetura, não prova de desempenho real**.

## Pergunta principal

Qual combinação entrega ao **Video Studio existente** edição rápida, exportação frame-exata, prévia WYSIWYG, aceleração segura, baixo custo de manutenção e distribuição viável no Windows? O objetivo não é copiar o Shotcut/Kdenlive/OpenShot; são principalmente **clientes** de tecnologias reutilizáveis.

## Critérios eliminatórios antes de qualquer score

1. Pode reproduzir o contrato V5 de personagens, pose interpolada, expressão, roupas, boca, piscada, texto do balão e z-index (ou aceitar uma superfície V5 compositada com alpha).
2. Render em frame absoluto sem depender de reprodução em tempo real; compositor isolado e cancelável.
3. Saída 1920×1080/60fps, H.264 e AAC com PTS correto; export parcial e Turbo sem mudanças semânticas.
4. Integração testável no Electron Windows empacotado e fallback sem driver/GPU.
5. Licença e lista de dependências conciliáveis com a distribuição do produto, após revisão apropriada.
6. Capacidade de exportar no projeto privado sem copiá-lo para serviços externos.

Se um candidato falha uma condição e só atende uma subfunção (por ex. OTIO), classificá-lo como **componente opcional**.

## Matriz inicial: direção técnica, não benchmark

| Candidato | Papel legítimo | Benefícios documentados | Custos/riscos para G-V5 | Recomendação |
| --- | --- | --- | --- | --- |
| **FFmpeg CLI/libav*** | decoder/filters/audio/encode/mux/probe | filtros e composição por timestamp; formatos e encoder candidatos de hardware; uso isolado por processo | filtergraph complexo e milhares de estados dinâmicos; conversões alpha/color/CPU-GPU; manutenção de argumentos; licenças/codec/Windows | **Base candidata A / prioridade 1** |
| **MLT Framework** | timeline, vídeo multi-track, filtros, consumers | produtores, mixers, XML, avformat, GPU/Movit opcional, headless | biblioteca C/C++ e plugins Qt/FFmpeg; problemas de packaging e semântica V5; módulos GPL opcionais | **Spike de comparação B / prioridade 2** |
| **GStreamer Editing Services (GES)** | timeline + pipeline edit/preview/export | GESTimeline, camadas, tracks, encodebin; LGPL; multiplataforma | empacotamento plugins Windows, thread-safety específica, clock/PTS, muita superfície nativa | **Spike de comparação C, se MLT não satisfizer** |
| **libopenshot** | timeline + reader/writer + keyframes | API C++, FFmpeg, leitores/filtros/animations, Windows | native bridge e Qt, curva de integração, dependências; estado facial do V5 permanece customizado; LGPLv3/dual | **Spike alternativo, não port automático** |
| **PixiJS v8/WebGL** | compositor visual 2D de personagens e PNG | sprites/render groups, texturas, batching, GPU | divergência com tipografia CSS (quebra de linha, antialias, gradientes, bordas); readback GPU→CPU; memória/alpha | **Prioridade 1 para A/B visual; não é editor nem encoder** |
| **PixiJS WebGPU** | backend visual experimental | caminho moderno; recurso avançado | documentação oficial recomenda WebGL em produção; compatibilidade e paridade variáveis | **Laboratório, não default** |
| **WebCodecs + Mediabunny** | decoder/encoder/container em Chromium | VideoFrame, VideoDecoder/Encoder; media mux/demux via Mediabunny TS | codecs e suporte variáveis; cor e sincronização; worker/frame lifecycle; integração do áudio; MPL-2.0 | **Spike de preview/proxy e encode curto; não assumir substituição FFmpeg** |
| **Electron offscreen bitmap** | capturar superfície HTML/CSS com paridade | composição Chromium e eventos de paint | GPU readback caro; dirtyRects; frames estáticos não pintam; stale-frame se handshake incorreto | **Caminho inicial de correção/paridade** |
| **Electron offscreen shared texture** | evitar cópia GPU→CPU para consumer nativo | API experimental compartilha handle GPU; versões recentes suportam formatos específicos | exige módulo nativo e import texture, lifetime `release()`, formato/color; zero-copy end-to-end depende do encoder | **Pesquisa avançada após medição** |
| **Remotion** | vídeo declarativo React | DX React, timeline programática e player | custo comercial atual para ferramentas de automação; ainda renderização React; semântica autoral diferente | **Não priorizar** |
| **OpenTimelineIO** | intercâmbio de decisões de edição | tracks, clips, time abstractions e adapters | não renderiza frames nem mídia; integração a formatos externos | **Possível export/import de timeline futuro** |
| **Olive / OBS libobs / Shotcut / Kdenlive** | estudo de código/algoritmos | experiência em edição/composição | apps inteiros, licenças, plugins/UI e modelo mental distintos; Olive avisa alpha instável | **Consultar ideias, não incorporar aplicativo** |

### A. FFmpeg como base de mídia, não engine de personagem

**Funções que vale delegar:**
- probe de codec, fps nominal/real, base temporal, PTS e streams;
- decoder confiável e normalização de mídia para preview/proxy;
- concat e encode H.264 com perfil explícito; audio filtergraph por plano de clips;
- mux MP4 e validação `ffprobe` + decodificação completa no gate final.

**O que evitar:** gerar 54 mil imagens PNG de um vídeo de 15min em disco, entregar todos os frames brutos por IPC sem limitação ou construir um único filtergraph que precisa de uma camada por frame. O modelo ideal explora segmentos estáticos/camadas, preservando render per-frame nas regiões dinâmicas. `overlay` e framesync trabalham com timestamps e alpha; têm particularidades de PTS e conversão que exigem oráculo.

**GPU:** D3D11VA, AMF, QSV, NVENC e filtros de overlay em dispositivos diferentes **não implicam** pipeline zero-copy. Qualquer `hwdownload`, `hwupload`, conversão de pixel, codificação e driver podem mudar o gargalo. Fazer capability probe e comparar latência+qualidade; Windows AMD alvo só após medição local.

**Licença:** FFmpeg pode ser LGPL ou GPL conforme configuração e bibliotecas habilitadas. Verificar origem/hash exato/configuração do binário e obrigações de redistribuição; filtro textual `--enable-gpl` é triagem, não auditoria jurídica completa. H.264 também pode suscitar considerações de patentes/licenciamento em certos usos/jurisdições: verificar na distribuição.

### B. MLT — melhor motor NLE completo para benchmark concorrente

O MLT descreve producers, filters, transitions, consumers, XML e um consumidor avformat que usa FFmpeg; oferece ferramenta `melt` executável, e modo headless. Isso facilita um teste isolado com 3 vídeos sintéticos, overlay de PNG e mixagem, independente do React.

**Porém:** o G-V5 não tem 50 filtros genéricos como requisito central. Ter uma NLE genérica não garante que frame de pose/expressão interpolada, mouth e CSS sejam reproduzidos. Para V5, MLT continuaria a consumir raster/IR do personagem. O overhead nativo e a integração com módulos/Qt podem superar o benefício.

**Prova requerida:** Windows empacotado ou runner semelhante, `melt`/MLT com vídeo A/V + alpha + range + texto rasterizado pelo próprio V5, saída 60fps validada, instalação reproduzível, BOM de plugins LGPL/GPL clara e mediana cold/warm. Não adotar apenas porque editor final conhecido usa MLT.

### C. GES — robusto para NLE, custoso para bridge

GStreamer Editing Services é uma biblioteca LGPL para edição com `GESTimeline` (track/layer) e `GESPipeline` que pode alternar preview e encode. A documentação oficial alerta que APIs GES devem ser chamadas na thread onde `ges_init` foi invocado; não é garantida thread-safety.

**Prova requerida:** suporte Windows às plugins e codecs necessários, worker próprio com serialização de comandos (não expor ponte de métodos GObject arbitrários ao renderer), tempo de seek em 60fps e manejo de lifecycle/cancelamento.

**Usar só se:** resolver gargalo de decode/time/mix e reduzir manutenção vs FFmpeg CLI + compilador V5. Caso contrário, descartá-lo explicitamente com medições.

### D. libopenshot — alternativa à camada de mídia, não ao compositor de personagens

libopenshot é C++ LGPL-3.0-or-later, com alternativa comercial reportada pelo projeto; oferece readers, frames, keyframes, cache de RAM/disco e writer com FFmpeg. O README adverte aceleração de hardware experimental pode até piorar desempenho.

**Prova requerida:** build reproduzível e pacote Windows com bindings, CPU/RSS, startup, H.264/AAC, evento de cancel, manutenção de nativos em Electron 44, alpha/text layer e sincronismo. Comparar a lib específica; não portar openshot-qt.

### E. PixiJS — compositor potencialmente excelente com risco de tipografia

O PixiJS recomenda WebGL para produção; render groups e cacheAsTexture são oportunidades para personagem estático, cenas de fundos e sprites. A documentação também alerta que `cacheAsTexture` em conteúdos grandes depende de limites de GPU e precisa de invalidação, e que render groups em excesso podem piorar desempenho.

**Foco de spike:** sprite PNG, 2 personagens, cabelo/roupa/faces, flip/scale/rotation/z-order; efeitos sombra/alpha e balão idêntico à DOM. *Não assumir* que o renderer `Text` quebra linhas, pesa fontes, borda, tail de balões e hinting igual ao CSS atual.

**Possíveis soluções de paridade:** manter balão como textura raster SVG/canvas com layout canônico; escolher motor de layout tipográfico único e testado; render de personagens Pixi + texto canônico em camada separada. A composição pode usar WebGL no preview e offscreen, desde que seja testada sem readback excessivo.

### F. WebCodecs/Mediabunny — bom para candidatos sem DLLs

MDN confirma que WebCodecs fornece acesso a VideoDecoder/VideoEncoder/VideoFrame e **não** faz demux/mux de container. Mediabunny cobre containers como MP4/WebM/MOV e é **MPL-2.0**, não MIT. Integração em Electron é atraente para decoder no renderer, porém suporte H.264 e comportamento de GPU/cores são dependentes de plataforma e Chromium. Timestamp `VideoFrame` em microssegundos exige política racional de arredondamento e PTS.

**Spike:** decodificar mídia sintética 24/25/29.97/60/VFR, buscar frames arbitrários incluindo B-frames; testar encode H.264+AAC+MP4 e memória com `VideoFrame.close()`; comparar ffprobe e tela com pipeline FFmpeg. Usar para proxies/scrub se vencer, mesmo que export final fique no FFmpeg.

### G. Electron OSR bitmap vs textura compartilhada

A documentação Electron esclarece:
- `paint` entrega região suja; página parada não emite paint; não use como relógio de export.
- Bitmap via `NativeImage` pode copiar GPU→CPU; `useSharedTexture` (experimental) pode fornecer handle de textura a consumidor nativo.
- A textura deve ser liberada via `release()` quando concluída; formatos/cor reais devem ser lidos de `textureInfo`.
- Zero-copy de compositor até encoder **só** após bridge nativa que prove compatibilidade de handle, device, sincronização e tempo de vida; não declarar capacidade do Video Studio atual.

Caminho de menor risco: OSR bitmap com requestId/capture barrier correto. Só experimentar shared texture se profiling mostrar o readback como gargalo, quando MP4 serial já funcionar.

### H. Outras opções explicitamente não selecionadas

- **Remotion:** sua documentação em outubro/2026 trata criação de ferramentas de edição/automação em categorias de licença específicas, em muitos casos cobradas por render; comparar custos/licença antes de adotar. Não resolve automaticamente assets customizados e autonomia local.
- **Olive:** o próprio repositório avisa que é alpha/instável, com código GPL; útil como referência de grafos, inadequado para transplante de código sem planejamento de licença.
- **OpenTimelineIO:** modelo/intercâmbio de cortes, **não** encoder nem media container. Pode ser adaptador opcional quando houver demanda por export para outro editor.
- **Shotcut/Kdenlive:** tomar conhecimentos dos clientes do MLT; não copiar interface/código como atalho.

## Comparação de bancada obrigatória (não dar notas sem executar)

| Experimento | Fixture | Métrica central | Resultado de decisão |
| --- | --- | --- | --- |
| F1 (FFmpeg puro) | vídeo 30s, 2 fontes, PNG alpha + som | wall, CPU, RSS, ffprobe, decode | Baseline NLE |
| F2 (MLT) | EXATAMENTE F1, mesmo codec/preset | idem + custo build/licença | MLT só avança se manter qualidade e justificar overhead |
| F3 (GES) | F1 | idem + plugin DLL Windows | GES opcional e medido |
| F4 (libopenshot) | F1 | idem + bindings/lifecycle | avaliar frente F1/F2 |
| R1 (React/DOM) | quadro estático, blink, balão, texto | pixel oracle, resize, memory | Baseline visual |
| R2 (Pixi WebGL) | EXATAMENTE R1 | pixel/geometry/text ROI, RSS/VRAM/readback | Pixi avança se paridade atingível |
| R3 (WebGPU) | R2, se R2 aprovado | pixel/GPU driver compatibility | laboratório |
| W1 (WebCodecs+Mediabunny) | 24/25/29.97/60/VFR | PTS, frame accuracy, encode + mux | apenas subfunções que vencerem |
| O1 (Electron sharedTexture) | R2 vs OSR bitmap | cópias GPU/CPU, throughput, lifecycle | zero-copy lab se ROI medido |

**Classificação:** `CANDIDATO` → `SPIKE` → `PARIDADE APROVADA` → `PERFORMANCE APROVADA` → `LICENÇA/BUNDLE APROVADOS` → `PROMOVIDO`. Ausência de qualquer gate = não promovido.

## Fontes primárias (consultadas em 2026-10-19)

- FFmpeg filters/overlay/frame sync: https://ffmpeg.org/ffmpeg-filters.html
- FFmpeg hardware/CLI: https://ffmpeg.org/ffmpeg.html
- FFmpeg licença: https://ffmpeg.org/legal.html
- MLT documentação, consumidores, GPU, licença: https://mltframework.org/docs/ ; https://mltframework.org/plugins/ConsumerAvformat/ ; https://www.mltframework.org/features/
- MLT repo: https://github.com/mltframework/mlt
- GES: https://gstreamer.freedesktop.org/documentation/gst-editing-services/index.html ; https://gstreamer.freedesktop.org/documentation/gst-editing-services/ges.html
- libopenshot projeto e licença: https://www.openshot.org/libopenshot/ ; https://github.com/OpenShot/libopenshot
- PixiJS renderers/grupos/cache: https://pixijs.com/8.x/guides/components/renderers ; https://pixijs.com/8.x/guides/concepts/render-groups ; https://pixijs.com/8.x/guides/components/scene-objects/container/cache-as-texture
- Electron OSR e sharedTexture: https://www.electronjs.org/docs/latest/tutorial/offscreen-rendering ; https://www.electronjs.org/docs/latest/api/web-contents ; https://www.electronjs.org/docs/latest/api/structures/offscreen-shared-texture
- MDN WebCodecs: https://developer.mozilla.org/en-US/docs/Web/API/WebCodecs_API ; https://developer.mozilla.org/en-US/docs/Web/API/WebCodecs_API/Video_processing_concepts
- Mediabunny (licença MPL-2.0): https://github.com/Vanilagy/mediabunny
- Remotion licença (atual): https://www.remotion.dev/docs/license
- OpenTimelineIO (intercâmbio apenas): https://github.com/AcademySoftwareFoundation/OpenTimelineIO
- Olive (alpha): https://github.com/olive-editor/olive

**Conclusão provisória:** priorizar composição V5 + FFmpeg para fazer MP4 real; PixiJS compete como compositor e WebCodecs/Mediabunny como decoder/proxy; MLT/libopenshot/GES como alternativas NLE medíveis. Não afirmar que qualquer engine é “a mais rápida” sem benchmark na mesma fixture.
