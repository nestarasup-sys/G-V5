# GACHA V5 — plano mestre de engenharia da exportação

> Área de trabalho de agente: `docs/AGENTE_EXPORT_V5/`.
> Atualizado: 2026-10-19. Estado: **fundação sintética implementada; MP4 real e Turbo não implementados/validados**.

## Estado executivo após reanálise de código — 19/10/2026

**Nenhum MP4 real foi demonstrado nesta reanálise.** Há código de fundação e testes sintéticos, mas falta integração em Electron (renderer isolado + decoder + FFmpeg + publish), paridade V5 e Turbo. A revisão atual foi **estática via repositórios**, não houve execução de testes nesta rodada.

Documentação operacional detalhada (nova):
- [README.md](./README.md) — ponto de entrada e status.
- [AUDITORIA_CODIGO_2026-10-19.md](./AUDITORIA_CODIGO_2026-10-19.md) — evidência arquivo a arquivo, problemas P0/P1 e distinção fato/hipótese.
- [CONTRATOS_ENGINE_E_TESTES.md](./CONTRATOS_ENGINE_E_TESTES.md) — job imutável, semântica de frames/PTS, IPC/handshake, checklist de 14 gates.
- [BACKLOG_EXECUTAVEL.md](./BACKLOG_EXECUTAVEL.md) — E01–E20, ordem de implementação e qualidade de prova.

**Decisões novas que prevalecem sobre ambiguidades do texto histórico:**
1. O snapshot atual congela Studio JS, mas NÃO congela bibliotecas externas do Fabricador/Customizer; incorporar digests/bytes de arte e mídia no preflight antes de processar um job real.
2. Transições de personagem, boca automática e blink **não** ficam semanticamente iguais apenas por reutilizar resolveVideoFrameSelection. O preview aplica transições com samples condicionados a playing; construir resolvedor canônico absoluto e testá-lo a 60 FPS independentemente do transporte.
3. 'sourceFrame' existente significa tick da timeline em 1/60 s, **não** índice real de frame em arquivo de vídeo. Para VFR/29.97/24/25/30/60 usar timestamp/PTS de stream e decodificação reproduzível.
4. videoExportJobs.ts confirma blocos de 600 frames em ordem e hashes, **não** valida MP4. Turbo conclui fora de ordem: exigir manifesto versionado e validation gate por chunk.
5. VideoRawFrameWriter com BGRA e callback por frame não garante pipeline paralelo pleno; medir e limitar cópias/IPC/RSS. Full HD BGRA = 8.294.400 bytes por frame, 497.664.000 bytes/s a 60 FPS; não persistir frames brutos.
6. buildVideoStudioAudioPlan apenas produz argumentos; mixer, PTS, cancelamento e waveform sintética devem ser verificados com encoder real. VideoExportLibrary apenas verifica arquivo/hash; validar ffprobe, frame count e decode antes de publicar.
7. h264_mf não pode ser chamado de encoder garantido nem 'licença correta' pode ser inferida só de grep em FFmpeg -buildconf. Probar pacote efetivo e revisar redistribuição. Suporte/ fallback depende do ambiente comprovado.
8. Antes de habilitar Turbo, serial com áudio único e validação no PC alvo deve ser estável. 'Turbo 2×' expressa concorrência de até dois workers, jamais promete 2× de velocidade. Hybrid entra só quando benchmarks/paridade justificarem.
9. A matriz de CI sintético não executa Electron/FFmpeg nem cobre as alterações em superfícies visuais/IPC. O caminho para 'pronto' exige gates separados e evidências no SHA exato.
10. Preservar a branch master-desenvolvimento do G-V5; V4 é referência somente leitura; não ativar scripts DEV AI/auditorias desativadas nem empregar mídia privada.

## Identidade e limites

- **Destino**: `nestarasup-sys/G-V5`, branch exclusiva `master-desenvolvimento`; nunca escrever em `master`.
- **Base confirmada ao iniciar**: commit `a5a488f5a6803350cd397c4f4fed351bcebbe75f` (GitHub). A branch avançou após a pesquisa anterior; a sequência de exclusões documentais da branch é intencional e não será revertida.
- **Referência**: `nestarasup-sys/EDITOR-V4`, `oai/aggressive-export-v5`, commit `b951b4d2cbb360e3cfef7769e457894337bbc83e`, leitura apenas.
- **Documento anterior**: `docs/VIDEO_STUDIO_ENGINE_V4_HANDOFF.md`; é registro histórico, não alterar retroativamente medições.
- **Fontes externas verificadas**: [Electron offscreen](https://www.electronjs.org/docs/latest/tutorial/offscreen-rendering), [Electron webContents/frame subscription](https://www.electronjs.org/docs/latest/api/web-contents), [FFmpeg license](https://ffmpeg.org/legal.html). Fontes web orientam riscos, não substituem teste no Electron empacotado.
- **Privacidade**: nenhum projeto, modelo, personagem, fundo, mídia, screenshot ou log privado em testes ou no CI. Apenas fixtures sintéticas.
- **Operação**: DEV AI e auditorias desativadas não podem ser invocadas. Testes de unidade isolados, typecheck e build não são as auditorias desativadas.
- **Alterações autorizadas**: commits pequenos nesta branch e workflow mínimo isolado; não editar Fabricador, Customizador, bibliotecas reais ou dados do usuário.

## Descobertas confirmadas no G-V5

| Área | Evidência | Estado / risco |
|---|---|---|
| Contrato de projeto | `src/shared/studio.ts`: `StudioDocument`, `VideoTimelineDocument` | Studio v1, timeline v1, duração em frames, **60 FPS** canônico; não usar o JSON V4 |
| Seleção temporal | `src/shared/videoFrame.ts`: `resolveVideoFrameSelection`, `automaticBlinkFrameFor` | Gaps, textos, clips com intervalos `[start,end)` e blink sem timers; não é um rasterizador |
| Personagens | `src/renderer/src/features/videoStudio/characterTrack.ts`: `characterStateAt`; `characterTransitions.ts` | Chaves com `VideoCharacterState` e PNG composto por estado; transições entre poses/expressões exigem paridade fora de `playing` |
| Preview | `VideoStudioEditor.tsx`, `VideoClipPreview.tsx`, `videoMediaPlayback.ts` | Preview vinculado a RAF/React e HTMLVideo; não capturar `playing` como relógio de export |
| Persistência | `electron/main.ts`: `writeStudio` | Assets/imagens `@video-frame:<sha256>` por projeto; não gravar quando exportar |
| Biblioteca de saída | `electron/videoExports.ts`: `VideoExportLibrary` | Publicação por `final.mp4`, sidecar hash; **não produz MP4** |
| Checkpoints | `electron/videoExportJobs.ts`: `VideoExportJobStore` | Chunks de **600 frames** e hashes recuperáveis; checkpoint sequencial ≠ Turbo paralelo |
| Writer | `electron/videoRawFrameWriter.ts`: `VideoRawFrameWriter` | Pipe BGRA, backpressure e exatidão; **sem produtor de pixels** conectado |
| Áudio | `src/shared/videoStudioAudioPlan.ts`: `buildVideoStudioAudioPlan` | Planejamento AAC, trim/mute/volume; falta preflight e execução FFmpeg real |
| Dependência crítica | `package.json`, `videoRawFrameWriter.ts` | Nenhum FFmpeg empacotado/validado atualmente; o preset h264_mf precisa probe no Windows |
| CI existente | Árvore do HEAD no GitHub | Sem `.github/workflows` ativo nesta branch; criar gate **novo**, isolado e sintético |

## Lições verificadas no Editor V4

1. `electron/exportManager.ts`, `src/render/ExportSurface.tsx`: janela isolada, handshake ready/frame-ready, tempo absoluto, BGRA validado e FFmpeg; desacoplar do relógio do preview.
2. `electron/turboExportCoordinator.ts`, `src/core/export/chunkPlan.ts`, `turboPlan.ts`: Turbo em chunks por renderizador, concatenação de vídeo sem reencode e áudio único; **“2×” são dois caminhos simultâneos, não ganho garantido de velocidade**.
3. `electron/hybridExportManager.ts`, `src/core/export/renderPlan.ts`: foreground por estados semânticos, cache persistente, composição FFmpeg; extremamente acoplado às regras visuais V4 — **não transplantar agora**.
4. `electron/mediaCompatibility.ts`, `videoEncoder.ts`: proxies/cache e capability probe de encoders; riscos de GOP, drivers, licença e cache frio.
5. `scripts/turbo-smoke.cjs`, `canonical-export-parity-smoke.cjs`, `docs/EXPORT_V5_STATUS_2026-09-21.md`: smoke e benchmarks históricos V4 têm fixtures/hardware específicos; não comprovam V5.
6. `ffmpeg-static` do V4 não é um binário pronto para redistribuição automática no V5: revisar licenças, origem, configuração de compilação, avisos, codecs e driver. Fonte oficial: https://ffmpeg.org/legal.html.

## Arquitetura de destino (não alterar contratos editoriais)

```text
StudioDocument + VideoTimelineDocument (dados salvos)
  -> preflight de integridade/referências e orçamento
  -> snapshot imutável de job + assinatura/hash canônico
  -> avaliador puro frame absoluto N (sem useEffect, RAF, playing)
  -> renderer V5 isolado: imagem/fundo/roupas/poses/transições/texto/vídeo
  -> barrier de assets/video frame apresentado, captura 1920×1080 BGRA
  -> writer com fila e backpressure (single-worker)
  -> encoder H.264 testado + áudio planejado uma vez + mux
  -> ffprobe + count/duration/PTS/frame-boundaries + paridade visual
  -> publicação transacional via VideoExportLibrary + relatório
  -> encerramento IPC/processos/temporários próprios
  -> (apenas posteriormente) cache por conteúdo -> chunks paralelos -> Turbo
```

Os contratos `StudioDocument` e `VideoTimelineDocument` permanecem autoritativos. Frame exportado deve depender de **snapshot + frame absoluto + versão do renderer + bytes de mídia**, jamais do estado atual do React.

## Execução por fases e gates

### M0 — Registro e base sintética [em andamento]
- [x] Auditar superfícies, contratos e lacunas da engine V5 sem acessar dados privados.
- [x] Separar conhecimento V4 de arquitetura V5.
- [x] Criar helper de snapshot isolado do estado `playing/playhead` com defesa contra mutações (`videoExportSnapshot.ts`; serialização/hash de job persistido ainda pendente).
- [x] Criar plano temporal determinístico de vídeos/textos/gaps por frame, com testes de boundary, sem afirmar paridade raster.
- [x] Habilitar CI mínimo apenas para testes sintéticos, typecheck e build (sem DEV AI/audit scripts). Gate base `e8b98b2`: [success](https://github.com/nestarasup-sys/G-V5/actions/runs/39323448321).
**Aceite:** testes isolados passando no SHA exato, nenhuma alteração em document/preview/dados reais, prova de repetibilidade em frames 0, 1, boundaries e último.

### M1 — Frame sintético determinístico
- [x] Rasterizador **sintético** independente de assets privados: BGRA com padrão e marcador móvel em pixels previsíveis; **não** é compositor V5.
- [ ] Teste de tamanho exato `1920*1080*4`, determinismo bit a bit, contagem, seek aleatório, memória/ownership. *Implementados checks BGRA/determinismo/contagem/intervalos/transporte; benchmark de memória e ownership real ainda faltam. CI M1 pendente.*
- [ ] Separar teste puramente funcional de smoke Electron. Sem declarar visual V5 compatível antes da prova.
**Aceite:** hashes de PNG/BGRA estáveis por frame e sem frames antigos reusados.

### M2 — Export serial single-worker end-to-end
- [ ] Criar renderer offscreen V5, com protocolo `prepare(frame)` / asset barrier / `frameReady`, snapshot fixo.
- [ ] Um MP4 curto de fixture sintética com 60 FPS, H.264, pipeline de áudio real e `ffprobe`.
- [ ] Verificar codec, colorimetria, FPS, duração, PTS, número exato de frames, cancelamento e output atômico.
- [ ] Validar FFmpeg e `h264_mf` no Windows alvo antes de empacotar; fallback somente para encoder disponível/licenciado comprovado.
**Aceite:** MP4 decodifica sem frames faltantes, testes de kill/cancel apenas em sandbox e sem sobrescrever export anterior.

### M3 — Paridade visual real
- [ ] Reusar o mesmo resolvedor para preview/export ou provar equivalência explícita; primeira/última amostra + boundaries +/- 1.
- [ ] Composição de personagem V5: pose, faces, roupas, joints, hair, flip/scale/zIndex, backgrounds e textos.
- [ ] Transições interpoladas nos 15 frames (250 ms a 60 FPS) independentemente de `playing`; blink/talk determinísticos.
- [ ] Teste de entrada/saída e seeks aleatórios sem state leakage, CSS/DPR e alpha.
- [ ] Camadas e geometrias com tolerância justificável; para fixture sintética de RGBA sem compressão exigir pixels exatos.
**Aceite:** diferença raster documentada e eliminada no estágio correto, sem aumentar tolerâncias ad hoc.

### M4 — Mídia e áudio
- [ ] Decodificação de vídeo em frame de origem exato, pausado e seek; conteúdo entre clipes, fades/transform e overlaps.
- [ ] Proxies só se necessários, cache associado a hash/version de origem, preferir original na export.
- [ ] Planos `buildVideoStudioAudioPlan` conectados a sonda de streams real, resample/trim/volume/mute/mix.
- [ ] Testes de sincronização com sinais sintéticos, silence, clipping e contenção de processos.
**Aceite:** amostras e PTS corretos; erro explícito para mídia quebrada.

### M5 — Robustez/empacotamento
- [ ] API IPC tipada `start/cancel/progress/status` sem métodos genéricos, validação de remetente/dono.
- [ ] Temp dentro de `app-data/temp/video-studio/export/<jobId>`, cancel idempotente, limpeza somente do job dono.
- [ ] Reopen/hash de checkpoint, validação de output e publicação apenas após sucesso; log diagnóstico sem nomes privados.
- [ ] Bundle multiplataforma dentro do escopo suportado, licenças FFmpeg/rebuild de nativos (better-sqlite3, sharp).
**Aceite:** falha/crash/disco cheio não publica MP4 parcial nem toca em save/bibliotecas.

### M6 — Desempenho e Turbo, apenas depois do serial
- [ ] Bench cold vs warm em fixtures sintéticas 5s/30s/90s, cpu/RSS/picos/bytes/tempo/codecs.
- [ ] Cache semântico por asset hashes/estado/versão do renderer, LRU por bytes e pruned sem tocar originais.
- [ ] Comparar um vs dois chunks com mesmos bytes, ambiente e resultado, depois 3+ se justificar.
- [ ] Verificar cada borda frame n-1/n, PTS, audio sync, concat sem reencode, cancel de workers e fallback seguro.
- [ ] `Turbo 2×` nunca como promessa 2× de throughput; Smart/Hybrid V4 e LAB fora do escopo inicial.
**Aceite:** mediana com repetição e paridade sem regressão; pior caso de memória dentro de limite medido; rollback para serial.

## Matriz de reutilização e critérios de rollback

| V4 | Política no V5 | Por quê |
|---|---|---|
| `chunkPlan.ts`, `exportRange.ts` | Adaptável | Algoritmos puros, FPS V5 fixo 60 |
| `ffmpegFrameWriter.ts`, `ffmpegPipeWorker.ts` | Adaptável | Padrão de backpressure já parcialmente portado |
| `exportManager.ts` | Reescrever ao redor de IPC V5 | `ProjectDocument`, ownership e handshake V4 são diferentes |
| `SceneSurface/ExportSurface` | Não trazer | Runtime/DOM/assets diferentes |
| `compileSceneRuntime`, `renderPlan.ts` | Ideias adaptáveis | Dependência da semântica V4 |
| `hybridExportManager.ts` | Somente referência | Cache/FFmpeg compositor com hipóteses sobre layers/foregound do V4 |
| `turboExportCoordinator.ts` | Adaptável após M2–M5 | Dois jobs isolados, validação, concat e áudio único |
| `smartExportCoordinator`, Turbo LAB | Não trazer agora | Auto heuristics antes da paridade introduzem risco |

Rollback por fase: se teste de snapshot, boundary ou composições falhar, manter implementações atrás de API de laboratório, não habilitar botão real. Falha serial impede Turbo. Falha de encoder deixa workflow diagnóstico sem distribuição/binário.

## Evidência mínima de cada etapa

Registrar em `docs/AGENTE_EXPORT_V5/DIARIO.md`:
1. base/head SHA e arquivos alterados;
2. ações permitidas executadas (comandos e versão/hardware, quando real);
3. gates medidos/pass/fail **sem confundir teste lógico com MP4 real**;
4. blockers, retorno/rollback e próxima fase;
5. status exato do GitHub Actions no SHA, sem inferência antecipada.

Não executar ferramentas `audit:*`, `test:dev-ai`, `scripts/dev-ai/*` ou workflows desativados no G-V5. Os workflows novos de exportação usam somente fixtures criadas em memória.

## Links canônicos

- V5: https://github.com/nestarasup-sys/G-V5/tree/master-desenvolvimento
- V4: https://github.com/nestarasup-sys/EDITOR-V4/tree/oai/aggressive-export-v5
- Handoff: ../VIDEO_STUDIO_ENGINE_V4_HANDOFF.md


## Atualização de estratégia — modernização integral (2026-10-19)

O objetivo mais recente **não é reproduzir o motor do Editor V4**. O V4 deve ser tratado como referência de técnicas/benchmarks, enquanto o G-V5 recebe um pipeline especializado que preserve sua semântica de personagem, roupas, pose, expressão, texto, vídeo, áudio e preview. Este plano M0-M6 permanece a rota **tática do export**; o [plano diretor independente](../VIDEO_STUDIO_V5_MODERNIZACAO/00_PLANO_DIRETOR.md) agora governa toda a modernização.

Pesquisa complementar:
- [Engines open source e comparação de compatibilidade/licença](../VIDEO_STUDIO_V5_MODERNIZACAO/01_ESTUDO_DE_MOTORES.md): FFmpeg baseline, PixiJS WebGL, MLT, GES, libopenshot, WebCodecs/Mediabunny, Electron sharedTexture.
- [RenderIR e compilador de cenas](../VIDEO_STUDIO_V5_MODERNIZACAO/02_ARQUITETURA_CANONICA.md): estado absoluto por frame, layout de balão, cache semântico, asset manifests e PTS racionais.
- [Migração de dados](../VIDEO_STUDIO_V5_MODERNIZACAO/03_MIGRACAO_E_DADOS.md): `VideoLibraryStore.attach()` **faz cópia física por projeto**; considerar CAS/proxies somente com shadow mode, rollback, backup/delete sem perda.
- [Gates/benchmarks](../VIDEO_STUDIO_V5_MODERNIZACAO/04_LAB_E_GATES.md) e [backlog integral](../VIDEO_STUDIO_V5_MODERNIZACAO/06_BACKLOG_DE_EXECUCAO.md).

Fatos relevantes adicionais no G-V5:
1. `VideoStudioEditor.css` utiliza `font-size:clamp(9px,1.4vw,18px)` para balões, enquanto `makeCanvasPrint()` usa Canvas2D/tipografia própria. **Não há contrato de raster paritário único**.
2. No JSX, elementos têm `zIndex+2`, vídeos usam CSS `z-index:1`; o compositor novo deve preservar essa semântica antes de introduzir layers NLE arbitrárias.
3. `transitionSampleFrames()` retorna os frames **intermediários estritos**, excluindo início e boundary; um intervalo de 15 frames tipicamente entrega 14 samples internos. Descrever duração e número de amostras separadamente.
4. Bibliotecas externas carregadas pelo TransitionRenderer durante execução precisam de snapshot/pinning de bytes, não somente `Object.freeze()` do Studio.
5. SharedTexture GPU Electron é experimental e requer bridge nativa, lifetimes/driver; WebCodecs não é muxer; Mediabunny é MPL-2.0. Nenhum substitui FFmpeg antes de teste de Windows, codecs, áudio e paridade.
6. A fase M6 de Turbo só pode ser promovida após MP4 serial real correto e benchmarks no PC alvo; duas threads/workers não prometem tempo 2x menor.

**Política:** manter `master-desenvolvimento`, dados privados inacessados, sem DEV AI/auditorias desativadas; esta rodada altera documentos, não runtime.


## Requisitos posteriores e contrato de modos (2026-10-19)

A meta é implementação integral do **Video Studio Nova Geração**, não somente portar Turbo. A engenharia local pode reconstruir o editor mediante segurança e paridade do projeto legado. Dois modos no mesmo motor: `animated` (transições, piscadas e boca automáticas quando elegíveis) e `static-characters` (sem interpolações/piscadas/boca automáticas, mantendo keys authored, vídeo e áudio). Para que a exportação possa avançar é obrigatório implementar, testar e manter corretos ambos os perfis, com MP4 serial antes de promover Turbo.

Fonte superior de requisitos: [missão Codex](../VIDEO_STUDIO_V5_MODERNIZACAO/09_MISSAO_CODEX_AUTONOMA.md), [modos](../VIDEO_STUDIO_V5_MODERNIZACAO/07_MODOS_DE_EXPORTACAO.md) e [arquitetura extensível](../VIDEO_STUDIO_V5_MODERNIZACAO/08_ARQUITETURA_EXTENSIVEL_E_RECONSTRUCAO.md). As otimizações do Editor V4 são conhecimento reaproveitável **somente** quando superiores no G-V5 após medição.
