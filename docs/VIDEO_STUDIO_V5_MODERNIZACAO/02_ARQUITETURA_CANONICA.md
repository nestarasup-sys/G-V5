# ARQUITETURA CANÔNICA — Smart Scene Compiler + RenderIR + Export Engine
Proposta de engenharia para Video Studio V5 · 2026-10-19 · **não implementada ainda**.

## Por que separar compilador, renderizador e encoder

O Studio atual conhece *documentos autorais* (elementos, PNG de personagem, characterKeys, textClips, videoClips e áudio). O FFmpeg conhece *streams temporizados e codecs*. React/DOM conhece *interação e apresentação*. Não podemos usar qualquer um dos três como fonte exclusiva de verdade.

Criar um **Smart Scene Compiler** puramente lógico para resolver estado, dependências e trabalho reutilizável. Ele alimenta:
1. frame de preview canônico; 2. still/print; 3. raster serial para FFmpeg; 4. chunk paralelo; 5. cache por estado.

O compilador é um domínio TS de alta previsibilidade, não um efeito React nem um novo formato de projeto salvo.

## 1. Modelo temporal explícito

- Project frame rate: **60/1 FPS**. Projeto de duração N possui frames válidos [0,N), display timestamp n/60.
- Cada faixa/clip vale [startFrame,endFrame) sem duplicar frame de fronteira.
- Um corte em n apresenta estado novo em n; transição de 15 frames pode ter amostras em [n-14,n-1], com início efetivo calculado por `compileCharacterTransitions()`, gaps e key anterior. A função existente `transitionSampleFrames()` exclui o frame exato de início e a boundary. **Reusar a regra real, não hardcodar '15 amostras'**.
- Tempo é `RationalTime` (numerador/denominador inteiros) no núcleo; converter a FFmpeg `time_base`/PTS quando montar filtros. Não usar `toFixed(6)` como identidade canônica do estado.
- `sourceStartFrame` do V5 é tick da timeline de 1/60 s, não índice real em H.264/VFR. Resolver timestamp de origem `(sourceStartFrame + n - clip.startFrame)/60` e mapear por PTS. Decoder precisa informar o frame efetivamente escolhido, bem como política de arredondamento/nearest sample.
- Clipes que não têm vídeo/áudio possuem silêncio/alpha transparente **definido**, não frame remanescente.
- Áudio não usa relógio da preview nem clock de frame de vídeo para calcular samples: `sampleIndex = rationalTime * 48000` com arredondamento especificado. Uma mixagem única por render inteiro.

## 2. Tipos internos sugeridos — separação por responsabilidade

Interfaces ilustrativas e versionadas, sem assumir que já existem:
~~~ts
type Rational = { num: bigint; den: bigint };
type FrameRange = { start: number; endExclusive: number };
type Digest = string; // sha256 hex + version no nome do campo

type ExportManifest = {
  schema: 2;
  engineVersion: string;
  studioDigest: Digest;
  artDigest: Digest;
  mediaDigest: Digest;
  fontDigest: Digest;
  pipelineProfileDigest: Digest;
  renderSize: { width: 1920; height: 1080 };
  fps: { num: 60; den: 1 };
  range: FrameRange;
  capabilities: { encoder: string; configDigest: Digest };
};

type MediaAsset = {
  id: string;
  bytesDigest: Digest;
  canonicalPath: string; // somente no processo principal e sob root de leitura permitido
  streamInfo: {
    timeBase: Rational; startPts: bigint; rotation: number;
    fpsNominal?: Rational; durationPts?: bigint;
    width: number; height: number; hasAudio: boolean;
  };
};

type RenderLayer =
  | { type: 'background'; id: string; asset: Digest | null; stageTransform: unknown }
  | { type: 'video'; id: string; sourcePts: Rational; asset: Digest; transform: unknown; z: number }
  | { type: 'sprite'; id: string; pixels: Digest; transform: unknown; z: number }
  | { type: 'text'; id: string; glyphRun: Digest; shape: unknown; z: number };

type CompiledFrame = {
  frame: number;
  pts: Rational;
  layers: ReadonlyArray<RenderLayer>;
  semanticDigest: Digest;
  dynamicFlags: ReadonlyArray<'video'|'blink'|'mouth'|'transition'|'text'|'transform'>;
};
~~~

A implementação concreta **deve** usar unions e `unknown` tipado por geometria, não expor `unknown` indiscriminadamente; os exemplos não são API pública a ser copiada cegamente.

## 3. Compilação: de eventos para intervalos semânticos

**Passo A:** resolver e validar:
- keys, bases, transforms, gaps, textos, vídeo (inclusive overlaps);
- toda dependência de arte externa lida por `TransitionRenderer`: modelos, poses, catálogo, peças faciais, cabelo, roupas, fundos, fontes;
- bibliotecas de mídia e vídeos associados;
- assimetria de versões de `Customizer` e `Fabricador`.

**Passo B:** gerar lista ordenada de boundaries relevantes: frame 0, N; início/fim de texto, gap, clip, key, transição, fala, mudança de imagem, blink, mouth cycle; agrupar intervalos conservando spans de animação. Para blink periódico longo, usar funções aritméticas e heap de próximos eventos, evitando enumerar milhões de eventos à toa.

**Passo C:** `evaluateFrame(n)` busca estado com índices (binary search), devolve layer IR e digests. `classifyInterval(a,b)` identifica:
- invariantes *de estado* (imagem/posição/fundo);
- partes animadas por frame (vídeo/rotação/mouth/blink/transição);
- dependência de meios (scroll, fades — quando introduzidos);
- z-index/occlusion/dirty regions válidas.

**Passo D:** decidir custo:
- **Cache sprite** se imagem/pose/face/roupa/efeitos e rendererVersion idênticos;
- **Cache background layer** se composição espacial igual;
- **Dirty rect** somente se intersecções/alpha/tails, sombras e z-order calculados com halo correto;
- **Hold segment** como otimização possível de vídeo estático, mas export final continua N frames CFR; fast-path com FFmpeg só após provar PTS e bordas, sem introduzir stutters;
- **Vídeo dinâmico** sempre decode por PTS/timestamp, preferindo decoder sequencial durante intervalo contíguo.

## 4. Hashes de arte e cache: a chave precisa identificar o resultado

**Errado:** `hash(characterId + expressionName)`.
**Certo (resumo):**
`sha256(engineVersion|rendererVersion|stageGeometryVersion|fontDigest|model/pose/wardrobe/face/assets bytes|expressionTransforms|effects|flip|scale|rotation|targetPixelFormat|colorspace|frame-in-animation)`.

- Para textura final que não sofre transform, separar `spriteDigest` de `transformDigest` para reutilização do bitmap no movimento da personagem.
- Para frame composto, incluir ordem/z-index, background, vídeo PTS, textos e alpha.
- Incluir `sourceDate` ou `updatedAt` *somente* como auxílio, nunca como substituto de hash de bytes.
- Cache `rendererVersion` e `colorPipelineVersion` têm invalidation explícita e testes de upgrade.
- LRU com quota em bytes, memória e VRAM; pin apenas estados da janela de preview ou dos dois chunks ativos. Deduplicar PNG/hashes de conteúdo se licenças/dados permitirem, sem tocar os originais.
- Cache indexado em diretório derivado seguro do app-data; falha de checksum = regenerar, não exibir arte de outro personagem.

## 5. O compositor e o palco são uma única especificação

**Palco lógico = 1920×1080**. Coordenadas percentuais de V5 mapeadas uma vez e usadas por preview e export. A UI pode escalar o *resultado* para caber, mas não mudar geometria/font size/algoritmo de wrapping de texto.

Registros de paridade obrigatórios:
- fundo, image, personagem; layers com z determinístico e desempate por ordem do documento;
- política atual do vídeo: `video-studio-video-composition` usa z-index=1; elementos usam `zIndex+2`. Isto não é uma timeline livre de camadas e deve ser preservado até mudança explícita de produto com migração.
- `speech`/`thought` com speakerName, speakerColor, borda, ellipse, tail e fontes;
- split preview/print: atualmente Canvas Print usa `context.roundRect`/fonte sem CSS, o DOM usa `clamp(9px,1.4vw,18px)`/CSS e elementos do print não reproduzem estado temporal do playhead. **Unificar através do RenderIR**, não copiar um dos dois sem aprovação visual.
- sprite trimmed: `faceRenderGeometry`, imagem crop, `characterCanvasWidth`, stages x/y/flip e escalas globais;
- alpha straight/premultiplied, interpolação de imagem, stroke e color space BT.709/sRGB explicitamente versionados;
- `requestId` de asset decode. Não renderizar falha silenciosa e reusar estado anterior.

**Regra de UX:** editor pode manter handles de seleção, mas capture/preview canônico não deve renderizar seleção, overlay do mouse, rulers, título ou status.

## 6. Animações sem estado implícito

Priority IR:
1. invisibilidade por gap/clip;
2. key-base/estado do personagem no frame;
3. transição interpolada, se habilitada no documento e abrangendo N (independente de `playing`);
4. mouth/talk para fala ativa, respeitando regra explícita de conflito com transição;
5. blink determinístico quando elegível;
6. stage transform global e z-order.

Os hooks `useCharacterTransitions`, estados `automaticBlinkPreview` e `automaticMouthPreview` atuais misturam preparação e apresentação. Separar:
- `computeCharacterAnimationState(frame, timeline, dependencies)` puro;
- `renderCharacterState(state)` assíncrono com cache;
- `displayFrame()` (preview) ou `captureFrame()` (export), ambos aguardam asset barrier.

O G-V5 usa ciclo de boca com seis PNGs e `cycleFrames = frames.length * 6` ao falar. Definir uma função de phase usando `speechStartFrame` e frame, idempotente para seek. Se o rosto não oferece assets para falar, fallback deve ser **o mesmo** em preview/export com aviso diagnóstico, jamais uma expressão anterior presa.

## 7. MediaDecoder e AudioMixer

**Vídeo:**
- ffprobe para metadata real (start_time, time_base, frame count se disponível, fps nominal, sar/rotation, B-frames, áudio);
- `readFrame(assetDigest, desiredTimeRational)` com seek eficiente usando pré-roll e decoder ownership; amostras identificáveis;
- regras explícitas para VFR e frames com timestamps repetidos/ausentes; regressão sintética;
- preview pode usar proxies com mapeamento PTS persistido; export usa original ou proxy comprovadamente equivalente quando permitido;
- sobreposição clipes segue ordem/z-index do compositor V5 (atual: HTML <video> no lane própria).

**Áudio:**
- um `AudioPlan` por projeto/range, resample 48k, trim e gain por clip, mute project/clip, mix/silence;
- clipping, fades (quando existirem) e alimiter medidos; revisar política de alimiter (hoje mistura de 2+ clipes usa alimiter, 1 não);
- timestamp PCM sample-accurate e AAC encoder delay tratado na inspeção final;
- nunca mixar áudio por chunk e depois de novo; áudio completo é renderizado/muxado uma vez.

## 8. Surface e protocolo de sincronização

Estados: `idle → preflight → prepared → rendering(frameN) → frameReady(requestId) → captured → consumed → next`.

```text
Host:  RENDER(requestId=42, frame=719)
Guest: evaluate(719); resolve assets; media decode; compose 1920x1080
Guest: FRAME_READY(42,719,layoutDigest)
Host:  verify(requestId); capture with presentation barrier
Host:  CAPTURE_ACK(42,719,checksum/bytes)
Encoder: take buffer under lease; stdin write acknowledgement
Host:  ACK_CONSUMED(42); release texture/buffer
```

- **Não usar** evento `paint` como relógio; em frame visual idêntico pode não haver novo paint. Asset ready, compositor flush e captura têm de provar o id da requisição.
- Lidar com `requestId` obsoleto (seek A→B→A, cancel, GPU context lost).
- Buffer stride, formato BGRA/alpha/color tags e ownership explicitamente checados. Bitmap readback pode ser gargalo; shared GPU texture só laboratório depois de benchmark.
- Cancel idempotente com timeout de etapa e kill de processo filho; não deixar janelas ocultas/FFmpeg abandonados.

## 9. Controle de paralelismo

- Ranges [start,end), nenhum overlap no OUTPUT, lookback/lookahead só para preparar decoder e transição; nunca duplicar frames finalizados.
- A identidade de um chunk inclui range, snapshot e arte/media/version/profile; comparar encoder extradata (SPS/PPS), GOP fechado, pix_fmt, color tags, resolução, timebase, B-frames e PTS.
- Concluir chunks fora de ordem exige manifesto **v2**; checkpoints v1 do `videoExportJobs.ts` são estritamente sequenciais.
- `concat` sem reencode somente quando parâmetros de streams e timestamps forem compatíveis; caso contrário fallback **seguro** serial ou finalization planejada, sem publicar MP4 quebrado.
- Turbo deve ter limite de memória e GPU, mais contenção de CPU/drives. Mais workers ≠ sempre mais rápido.
- Se o cliente editar Studio enquanto job existe, job continua com snapshot fixo e não consome novos assets externos; nunca mistura conteúdo antigo/novo.

## 10. Identidade e observabilidade de jobs

Metrics stages: preflightMs, artResolveMs, videoProbeMs, sceneCompileMs, spriteRasterMs, decodeMs, gpuDrawMs, readbackMs, ipcCopyMs, pipeWaitMs, encodeMs, audioMs, muxMs, verifyMs, publishMs; CPU, GPU, VRAM, RSS peak, cache hit/miss, frames exact, stale, late, duplicate, failed, lost. Reports locais **sem caminhos privados/nomes/falas/screenshot por padrão**.

Estados: CREATED/PREFLIGHT/PREPARED/RENDERING/ENCODING/MIXING/VERIFYING/PUBLISHING/DONE/CANCELLED/FAILED/RECOVERABLE. Persistir manifesto atômico/versão, limpar apenas arquivos do job. Não considerar `VideoExportLibrary.finalize` prova de decodificação: verificar FFprobe e decode antes.

## 11. Critérios de excelência

- Frames arbitrários A/B/A com hash da camada sem perdas idêntico;
- resoluções e viewport distintos preservam texto/posição/expressões, excluindo apenas scaling final;
- capturas de transição independentemente de `playing` e das buscas anteriores;
- mesma arte mesmo após atualização de bibliotecas durante um job (bytes pinned), ou falha explícita;
- imagens finais H.264 sujeitas a diferença codec quantificada, não a mudança semântica de pose/expression;
- source VFR/29.97 com PTS, audio sync e último frame conferidos;
- todos os renders passados G0-G5 e com benchmark cold/warm antes da promoção.

## 12. Ordem de implementação recomendada

1. `src/shared/videoSceneIR.ts`, `videoSceneCompile.ts`, testes puros sem assets reais;
2. `electron/videoExportAssets.ts` + data manifest, hashes de dependências;
3. compositor canônico em módulo próprio com layout de texto; adaptar preview/print progressivamente;
4. surface isolada e writer + FFmpeg sondado serial;
5. decoder/áudio e probes de saída;
6. preview/proxy/cache e depois multiworkers/Smart Export;
7. spikes PixiJS/MLT/GES/Mediabunny guiados por perfil real.

**Status:** contrato conceitual; não conectar ao botão de Export antes das validações. A atualização desse arquivo não constitui implementação.


## Profiles do mesmo compilador (2026-10-19)

O Smart Scene Compiler deve aceitar `RenderVariant = 'animated' | 'static-characters'`. A variante é parte de `JobSpec`, identidade de cache e versionamento do RenderIR. **Não criar dois caminhos de renderização com bugs distintos.** No modo `static-characters`, o evaluator retorna estado authored do segmento a cada key e elimina *apenas* interpolações entre keys, blink automático e talk-mouth automático; todos os clipes de vídeo originais continuam decodificados por PTS, áudios e textos seguem idênticos. Modo `animated` conserva opções autorais e efeitos elegíveis. Implementações futuras declaram política para novos tipos de animação. Ver [07_MODOS_DE_EXPORTACAO.md](./07_MODOS_DE_EXPORTACAO.md).

Os backends devem implementar portas tipadas e substituíveis; a reestruturação do editor foi explicitamente autorizada desde que haja migração/rollback e que `StudioDocument v1` permaneça legível. Ver [08_ARQUITETURA_EXTENSIVEL_E_RECONSTRUCAO.md](./08_ARQUITETURA_EXTENSIVEL_E_RECONSTRUCAO.md).
