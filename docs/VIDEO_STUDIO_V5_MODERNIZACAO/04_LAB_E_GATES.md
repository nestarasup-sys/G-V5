# LABORATÓRIO DE ENGINES — Benchmarks, paridade, quality gates e rollout
Versão 1 · 2026-10-19. Documento experimental; evidências parciais locais registradas em 2026-10-20 abaixo.

## 0. Missão

Escolher por dados a combinação FFmpeg / MLT / libopenshot / GES / PixiJS / WebCodecs adequada ao Video Studio. Isolar custo de timeline/preview, composição, decode, readback, IPC, encode e áudio. Exigir **correção visual e temporal** antes de performance; não promover "Turbo" por export curto sem validação.

## 1. Fixtures sintéticas, reproduzíveis e sem dados privados

Nomear arquivos sem usuários, personagens reais, projetos de produção ou paths absolutos privados. Gerar testes por código determinístico com semente/version e checksum, por exemplo:

| Fixture | Duração alvo | Componentes | Pergunta |
| --- | --- | --- | --- |
| S00 | 5 s | colorbars/movimento com contador de frame, silêncio | backend/codec e PTS mínimos |
| S01 | 30 s | fundo PNG, 2 sprites PNG alfa, texto longo com Unicode/acentos, boca, piscada, 15 frames de transição | fidelidade visual e custo de arte |
| S02 | 90 s | 2 fontes de vídeo 24/30/60 FPS, cortes com B-frames, sobreposição, áudio tom/click, freeze gaps | decode/VFR + media+audio |
| S03 | 180 s | repetição determinística de S01/S02 e 60 FPS | cold/warm, cache e concorrência |
| S04 | 900 s (15 min) | grande quantidade de keys/clip/textos, poucas e muitas alterações | memory endurance, stall, GC e cancel |
| S05 | 12 s | VFR, 30000/1001 FPS, rotação, PTS não zero, offsets B-frame | escolha frame/PTS exata |
| S06 | 8 s | alpha, sombras, flip, tails, fontes, redimensionamento de janela | pixel oracle contra preview |
| S07 | 20 s | áudio mudo, um clip, 2 clips, overlap, clicks em boundaries | AAC/PCM sync e clipping |

Geração aceita FFmpeg/Node/PNG sintéticos em runner ou PC alvo. Binários/licenças dos geradores devem ser identificados; fixtures não podem depender de login ou ambiente gráfico real. Armazenar hashes/goldens sintéticos versionados quando pequenos; não upload de screenshot/arte privada.

## 2. Protocolos de comparação

**Todos os candidatos de engine na mesma fixture:**
- dimensões 1920×1080, 60fps CFR, mesmas fontes, background/alpha, codec/profile/bitrate ou alvo de qualidade medido, colorspace BT.709;
- identidade de versão Electron, FFmpeg/MLT/GES/PixiJS/Mediabunny, sistema operacional, GPU, driver, memória, CPU, perfil de energia e temperaturas relevantes;
- 3+ amostras (ampliar se variância alta) por modo cold/warm; alternar ordens A-B/B-A para reduzir efeito de cache térmico/IO;
- mesma política de leitura (original/proxy), mesmo número total de frames/áudio/mux; medir wall-clock desde start até MP4 validado e publicado;
- reportar medianas/p95 e raw valores, não apenas "mais rápido"; caso uso de RAM/VRAM cresça progressivamente, não promover;
- **sem executar DEV AI nem auditorias legadas desativadas**. A CI sintética não pode substituir Electron real.

Condições de falha:
- mismatch visual de estado (pose, boca, gap, texto ou cor) invalida benchmark, mesmo se tempo ótimo;
- falha no seek ou frame final invalida resultado;
- encoder que não é distribuível/testável no Windows alvo não ganha status padrão;
- velocidade sem hardware fallback e isolamento de crash não pode ser default.

## 3. Instrumentação mínima por camada

| Stage | Métrica | Insight |
| --- | --- | --- |
| parse/preflight | tamanho Studio, revisões, bytes hashed, ms | tempo de preparação e custo assets |
| scene compile | eventos/s, memory, digest hits | possibilidade de render por estado |
| sprite/face | ms/state, PNG bytes, cache misses | custo real de expressões/roupa |
| preview | p50/p95 seek-to-present, frame drops, interatividade | editor usável |
| video decode | ms/frame, source PTS, decoder queue, seek preroll | VFR e clipes longos |
| compositor | ms/draw, layers, dirtyRect área, GPU util | custo de composição |
| GPU readback | ms/readback, bytes/copy, ownership | custo potencial evitado por shared textures |
| pipe/IPC | bytes/s, stall/backpressure, copies | BGRA Full HD ~8.29MB/frame |
| video encode | ms/frame, CPU/GPU, profile, bitrate | encoder software/hardware |
| audio | sample count, start/end PTS, peaks/clipping, ms | sincronismo e qualidade |
| mux/concat | stream extradata, DTS/PTS, durations, ms | Turbo e tail |
| ffprobe/decode | frame count, missing/corrupt, color tags | validade real da saída |
| publish/cleanup | ms, disk peak, orphan processes/files | robustez e recuperação |

**Usar instrução de logging local sanitizado:** job IDs aleatórios, contagens, hashes de saída e tempos; nomes/paths/mídia reais omitidos por padrão. Diagnóstico com conteúdo só com decisão e controle explícitos, nunca no GitHub.

## 8. Evidência parcial de paridade DOM ↔ Canvas (2026-10-20)

- Harness: `scripts/video-studio/character-media-oracle-smoke.cjs`, Electron real no Windows, apenas fixture sintética; sem DEV AI, assets pessoais ou saves de usuário. O preview usa o componente de produção `VideoStudioClipPreview` e `<video>`; o outro caminho usa o compositor Canvas e o pool de frames FFmpeg.
- Foram comparados oito seeks em sequência A-B-A (`5, 22, 30, 10, 65, 186, 140, 5`) nas variantes `animated` e `static-characters`, incluindo pose inicial/transição/final, idle/fala, blink, vídeo importado, texto, fundo e extensão V546. O harness também verifica IR de pose/expressão, `sourceTick`, ordem das camadas e snapshot imutável.
- Repetibilidade do primeiro/último frame: igualdade binária dentro de cada superfície/variante. SHA-256 DOM/Canvas: animated `28d390a8c3ef292cbd2f651d77a294a0bea91257c9b3e47493645025b79b44b5` / `ad4b77de8dc7d28fda9ad776a91cb20fd0e9a7719ac597cda58b642cde0826ac`; static `21910b8072d9b470987d2141d6352aac3fe0864766e754db64d5342bd436606a` / `e4eef93eaa2d4a5340f7bb1b98d46d31ee591d392108a75766ba2609203c39ed`.
- Pior ROI de vídeo nas oito capturas e duas variantes: MAE `0.931`, changed-pixel ratio `7.68%` (contando diferença RGB acima de 1), p95 por canal `1`, canal máximo `107`. O limite de mudança acima de 1 acomoda a diferença de conversão YUV→RGB entre Chromium e FFmpeg; MAE/p95 e valor bruto máximo continuam registrados. Não se afirma igualdade perfeita entre decoders.
- Corrigidos pela comparação: texto/alpha e padding de balões, cantos arredondados e caudas cortadas no Canvas; geometria `border-box` do plugin V546; ordenação DOM de layers. As ROIs são separadas para fundo, arte, personagem, narrador, balões, vídeo e extensão, com limites individuais.
- Resultado local: `npm run test:video:character-media-oracle` passou; `npm test` (117/117), `npm run typecheck` e `npm run build` passaram. A execução do workflow Linux/Windows para o novo SHA ainda é necessária após publicar.
- Limite: isto é evidência sintética de preview DOM ↔ Canvas, não paridade de MP4 exportado, print, Studio normal, projetos longos, hardware ou empacotamento. V501/V502/V504, V508/V510 e V546 permanecem parciais; os gates de release seguem desmarcados.

## 4. Oráculo de paridade por camadas (não enganar pelo SSIM)

1. **Estado IR**: snapshot+frame tem digest exatamente igual em N, N±1 e seeks A-B-A, independentemente de tocar/pausar.
2. **Pixels de sprite sem perdas**: RGBA hash pixel idêntico para PNG sintetizado pela mesma engine, ROI por camada, tolerância 0 se a operação é determinística; mismatches em diferentes bibliotecas devem ter explicação, nunca aceitação automática.
3. **Text/balloons**: comparar bounding boxes, linhas, glyph metrics, speaker, tail, opacity, corner radius, font face, coordenadas; diferenciar raster AA de layout errado.
4. **Frames de vídeo**: overlay por PTS, clip start/end, B-frame/VFR/source rotation, blend, z-order.
5. **Output codificado**: comparar H.264 decodificado contra referência pré-codec, PSNR/SSIM por ROI como métricas auxiliares (não substituem busca de glitch único). Mapear perdas esperadas de compressão; não usar apenas SSIM médio.
6. **Audio**: PCM após decode, onset de click e offset por stream; comparar energia por janela e limites de clipping; AAC introduz latency/encoder delay que precisa ser contabilizada. Testar sample rate e downmix.
7. **Mux**: ffprobe completo, decode do output inteiro e timestamps monotônicos com contagem N. `-count_frames` pode ser usado em sondagem, mas confirmar com decode real da fixture.

Casos obrigatórios de regressão: frames 0/1/N-1, 14 amostras internas de transição quando aplicável, começo/meio/fim de blink, boca fala/fim, gap boundaries, duas falas simultâneas, projeto sem background, imagem transparente, vídeo cropped/rotated, clip out-of-range (preflight falha), silêncio inicial/final, cancel.

## 5. Testes de robustez obrigatórios

- cancelar durante preflight, render, encode, mux, verificação e publish;
- renderer offscreen morto/no-paint, cancel de request e solicitação A-B-A;
- FFmpeg não instalado / binário corrompido / encoder h264_mf anunciado mas indisponível;
- GPU/driver ausente, crash do decoder, vídeo corrompido ou audio stream ausente;
- disco cheio, output path sem permissão, rename cross-volume, múltiplos jobs concorrentes;
- shutdown/reopen/retry checkpoint v1 sequencial vs v2 Turbo out-of-order;
- fontes alteradas e assets do Fabricador removidos após snapshot;
- dependências nativas recompiladas para Electron, app empacotado em Windows limpo;
- syslinks/junction traversal na pasta de job, redirect IPC de janela não confiável, deleção restrita ao owner.

**Critério de sucesso:** nenhuma dessas falhas modifica projeto, originais, bibliotecas compartilhadas ou export anterior; nenhuma deixa resultado MP4 parcialmente publicado como pronto.

## 6. Política de promoção por maturidade

| Gate | Prova mínima | Onde executar | Status nesta rodada |
| --- | --- | --- | --- |
| G0 — Contratos | Node unit determinístico + typecheck + build no SHA | GitHub Windows CI | **não executado nesta rodada** |
| G1 — Preview IR | pixel e estado por frame no compositor sem reencode | Windows Electron fixture | não executado |
| G2 — MP4 serial | MP4 H.264/AAC, frame count, pts e decode inteiro | Electron+FFmpeg real | não executado |
| G3 — Paridade / recovery | screenshots sintéticos, A-B-A, crash/cancel, sidecar | runner gráfico/sandbox + PC | não executado |
| G4 — Turbo | 1×/2×, concat sem reencode, bordas/PTS, fallback | PC alvo e CI adequada | não executado |
| G5 — Product performance | cold/warm medido, p95 preview/seek, memória, política HW | PC alvo 5/30/90/180/900s | não executado |
| G6 — Distribuição | empacotamento, licença/BOM, Windows clean install | PC alvo + pipeline build | não executado |

O workflow `.github/workflows/video-export-synthetic.yml` só cobre parte de G0. Sua existência/sucesso histórico não prova G1-G6.

## 7. Scorecard para adoção de bibliotecas (sem dar nota antes do teste)

Pontuação por categoria de 0 a 5 **após evidência**; categorias:
- 30% paridade visual e temporal;
- 20% desempenho/latência frio-quente;
- 15% Windows packaging e hardware fallback;
- 15% robustez/recuperação;
- 10% manutenção/debug/adaptação ao V5;
- 10% footprint/RAM/VRAM/energia.

**Veto independentemente do score:** licença incompatível, perda de dados, falha de frames/PTS/sync, falta de fallback, dependência de dados privados em CI. Decisão registrada em ADR com SHA, runs e link para testes.

Limiar de adoção para otimização adicional (política inicial, revisável após baseline): paridade aprovada; melhoria repetível de **≥10% no gargalo relevante** ou redução relevante de risco/complexidade; sem regressão material de p95/estabilidade. Não exigir número arbitrário para correções de bugs. Alternativa com menos linhas de código, maior robustez e mesma performance pode ganhar.

## 8. Experimentos que devem ocorrer em paralelo

**Pilha A — serial minimalista**: compositor atual/isolado + FFmpeg com input raw BGRA/PNG alpha + áudio único.
**Pilha B — PixiJS WebGL**: renderizar exatamente S01/S06, comparar com DOM e tempo de GPU readback. Escolher onde Pixi pode substituir raster de personagens mas não necessariamente balão.
**Pilha C — MLT**: benchmark de NLE em S02/S03, integração headless sem UI/Qt pesada quando possível.
**Pilha D — WebCodecs/Mediabunny**: decode seek/source PTS e mux 5s, focus proxy.
**Pilha E — GES/libopenshot**: rodar somente se C ou A revelar gargalo de mídia ou manutenção justificável; não abrir 3 projetos nativos grandes simultaneamente sem razão.
**Pilha F — sharedTexture**: só depois que readback for o gargalo medido e CPU/GPU profiles indicarem ROI positiva.

## 9. Guia de relatório de benchmark

```text
Date / commit / fixture / durationFrames / platform / build / GPU driver
Candidate / settings / codec / quality target / fps
Run1 cold: wall/preflight/raster/decode/readback/encode/mux/verify, peakRSS/VRAM
Run2-4 warm: idem; median and spread
Pixel parity: ROI results, boundary test passed/failed, glyph layout
PTS/Frame count: expected N, decoded N, errors/gaps
Audio: stream, sample rate, expected click, measured click, offset
Reliability: cancel/crash/recovery, temp clean, output atomic
Licence/BOM: FFmpeg config and dependencies
Recommendation: promote / keep spike / reject + evidence + rollback
```

## 10. Benchmarks V4 são histórico, não predição

A documentação V4 `docs/EXPORT_V5_STATUS_2026-09-21.md` relata no V4 180s a 30 FPS, export interno 54.377s warm com 2 chunks e 3.310× realtime em cenário específico. O V5 tem 60 FPS, geometria/personagens/mídia distintos e não foi benchmarkado com essa nova arquitetura. Não extrapolar `2x`, `3x`, nem comparar msec V4 com V5 como se fossem mesma workload.

## 11. Artefatos e privacidade

CI pode registrar checksums/JSON de estatísticas/fixtures geradas sem dados privados. Antes de criar workflow com upload, revisar se usuário mantém política "sem artefatos" — o workflow atual não os envia; manter esta política até decisão explícita. O bench real do PC deve rodar local e anexar apenas relatório sanitizado por ação autorizada. Não iniciar/reativar DEV AI ou auditorias desativadas.

## 12. Benchmark full-engine serial/Turbo por perfil (5 s, amostra única)

- Comando: `$env:GACHA_BENCH_SECONDS=5; $env:GACHA_BENCH_PROFILE='<perfil>'; npm run bench:video:workers`, com caminhos explícitos de FFmpeg/FFprobe. O harness agora usa o mesmo fixture sintético completo do oráculo de personagem: modelo e duas poses do Fabricador, personagem com rosto/olhos/boca, fala/pensamento, blink, vídeo importado e extensão V546. Serial e dois workers recebem a mesma cena; o relatório inclui configuração da máquina, número de itens, tempos por etapa, contagem/decode, working set do Electron e hash final.
- Resultados medidos no Windows, Ryzen 5 4600G/12 processadores lógicos/16 GB. Cada célula é uma execução curta, não mediana de 3+ repetições:

| Perfil | Carga sintética | Serial | 2 workers | Speedup observado | Pico working set Electron serial/Turbo |
| --- | --- | ---: | ---: | ---: | ---: |
| `mixed-realistic` | 2 personagens, 8 text clips, 1 vídeo, 9 transições | 21,01 s | 14,80 s | 1,42× | 1,19 / 1,66 GB |
| `static-heavy` | 10 personagens, 4 text clips, sem vídeo/transição | 29,26 s | 21,55 s | 1,36× | 1,76 / 3,18 GB |
| `transition-heavy` | 2 personagens, 4 text clips, 9 transições | 14,88 s | 12,19 s | 1,22× | 0,81 / 1,18 GB |
| `imported-video-heavy` | 1 personagem, 4 text clips, 4 decoders de vídeo | 32,53 s | 20,88 s | 1,56× | 1,39 / 1,85 GB |
| `text-heavy` | 1 personagem, 42 text clips, sem vídeo/transição | 57,80 s | 42,31 s | 1,37× | 4,30 / 6,07 GB |

- Em cada perfil, os dois arquivos passaram FFprobe (H.264, 1920×1080, 60/1, número exato de frames) e decode integral; os hashes serial/Turbo foram iguais por perfil. A razão `readbackMs/(composeMs+readbackMs)` variou de 3,8% no perfil texto a 32,5% no perfil transição, portanto sharedTexture não é justificada por este conjunto curto e heterogêneo.
- Limitações: uma amostra por perfil, apenas 5 s, um encoder e uma máquina. A métrica de RAM soma processos Electron e **omite os subprocessos FFmpeg**; não é RAM total do job. Os perfis 30/90 s, amostras repetidas, carga de áudio e outros encoders ainda não foram medidos. Não promover Turbo com base nesses números.
- O perfil `text-heavy` consumiu até 6,07 GB de working set Electron com dois workers; `static-heavy` chegou a 3,18 GB. O autotuner recebeu um guard conservador de complexidade da cena (elementos + vídeos + grupos de transição); com 12 unidades ou mais escolhe serial. Este limite é uma proteção provisória derivada dessas amostras, não uma calibragem final de performance, e deve ser revisto após os testes de 30/90 s e memória total incluindo FFmpeg.

**Fases e responsáveis técnicos** estão em [00_PLANO_DIRETOR.md](./00_PLANO_DIRETOR.md); escolha de motores em [01_ESTUDO_DE_MOTORES.md](./01_ESTUDO_DE_MOTORES.md).


## GATE DE PRODUTO OBRIGATÓRIO: comparação dos dois modos de exportação

**Completo vs Sem animações de personagem:** capturar frame 0, intermediários de transição, boundaries de key, fala, blink, vídeo com contador e áudio com click; garantir que Completo mantenha animações elegíveis e Sem animações preserve todas as keys authored como cortes, desligando somente transição automática/blink/boca. Ambos devem manter PNGs base, transformações, balões, fundo, vídeos importados com movimento e AV-sync. Não comparar apenas médias SSIM. Rodar serial e Turbo quando disponível. Mesmo `RenderVariant` deve produzir pixels equivalentes em serial/Turbo, exceto diferenças explicáveis por H.264. RenderVariant entra no digest de cache/checkpoint.

**Gate de extensibilidade:** em fixture, adicionar `SceneElement` sintético (novo tipo com 3 keys/efeito), registrar nas interfaces, verificar preview/print/export/ambos os modos sem mudança espalhada em monólito; rejeitar arquitetura que exige editar a UI inteira a cada kind novo.

**Gate de substituição do editor:** inventário de recursos atuais completo, projetos v1 reabertos e editados, undo/redo/autosave/exportPrint/import/dedup/face/pose/transforms/UI mouse/teclado assegurados. Remover implementação antiga apenas depois desse gate. Ver [07_MODOS_DE_EXPORTACAO.md](./07_MODOS_DE_EXPORTACAO.md) e [08_ARQUITETURA_EXTENSIVEL_E_RECONSTRUCAO.md](./08_ARQUITETURA_EXTENSIVEL_E_RECONSTRUCAO.md).

A conclusão da missão local depende de testes reais no PC alvo, não apenas da matriz sintética; [09_MISSAO_CODEX_AUTONOMA.md](./09_MISSAO_CODEX_AUTONOMA.md).

### 13. Instrumentação observável do layer cache no full-engine

- O full-engine benchmark recebe contadores reais por surface e agrega deltas por worker: hits, misses, evictions, bytes usados/pico e layers cuja rasterização foi evitada. Perfil misto de 5 s: serial 3.042 hits/148 misses/136 evictions; dois workers 3.032/158/134; ambas surfaces chegaram a 99.532.800 bytes, perto do orçamento de 96 MiB. Serial e Turbo mantiveram o mesmo SHA final (`47544666d67287f60e96c0b568014f06fe467ca0dac59d0a17b0a0e830e768cc`), 300 frames e decode íntegro.
- Medições mostram que o cache está integrado e reutiliza layers, mas ainda não isolam seu ganho de tempo: falta o ensaio A/B com cache desativado na mesma fixture. Não declarar ganho causal nem implementar dirty rectangles até comparar tempo, RAM e pixels.
