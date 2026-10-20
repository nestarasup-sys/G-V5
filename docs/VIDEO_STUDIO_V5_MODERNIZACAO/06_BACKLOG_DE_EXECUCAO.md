# BACKLOG DE EXECUÇÃO — Modernização do Video Studio V5
Versão 1 · 2026-10-19. Tarefas ordenadas por pré-requisito e separadas por domínio.
**Status atual:** `TODO` para todos os itens abaixo, exceto partes expressamente existentes como fundação em código. Planejar != implementar.

## Estratégia de execução

- Escrever apenas em `G-V5/master-desenvolvimento`. V4 é referência de leitura.
- Commits curtos e gates verificáveis; não promover um backend experimental sem testes.
- Não usar dados privados/DEV AI/auditorias desativadas. Sem migração destrutiva.
- O trabalho velho de export está em `../AGENTE_EXPORT_V5/BACKLOG_EXECUTAVEL.md` (E01-E20). Esta lista nova expande para **editor/preview/dados** e deve prevalecer em ordem estratégica.

## Tranche T0 — Oráculos e baseline, 100% sintético

| ID | Mudança sugerida | Dependência | Resultado/teste |
| --- | --- | --- | --- |
| V501 | Criar fixtures reproducíveis de sprites PNG transparentes, texto PT-BR, vídeo com contador/PTS e áudio click | nenhuma | hash fixo e documentação de geração |
| V502 | Harness para capturar preview/export/still em frame N e ROI | V501 | A-B-A/compare, sem ativos de usuário |
| V503 | Perfil de performance inicial da timeline/seek/React (sem export) | V501 | tempos CPU/frame drop e memória em fixture |
| V504 | CI por camadas com paths reais de preview/render/IPC | V501 | G0 mínimo; sem DEV AI, sem artefatos privados |

## Tranche T1 — Semântica, pixels e dependências

| ID | Mudança | Dependência | Aceite |
| --- | --- | --- | --- |
| V505 | `src/shared/videoSceneIR.ts` e avaliação frame absoluta para personagem, texto, gap e layer | V501 | N=0,1,boundaries,N-1; idempotente em ordem reversa |
| V506 | `videoSceneCompile.ts` com event boundaries, índices e stable scene signatures | V505 | colapsa intervalos corretos sem perder estado |
| V507 | Refatorar regra de transição/mouth/blink em evaluator compartilhado; remover dependência de `playing` para estado | V505 | samples internos e pausar/seek sem state leakage |
| V508 | Contrato de layout de balões/texto, geometry 1920×1080, fontes e tails | V502,V505 | ROI de balões/linha iguais em 4 tamanhos de janela |
| V509 | Manifest snapshot de assets externos e bytes pinned do Fabricador/Customizer | V505 | bibliotecas mudam durante job e output não muda |
| V510 | Resolver estável de z-order e vídeo/layers V5 | V505 | ordem vídeo z=1 vs atores zIndex+2 preservada |
| V511 | `Print` e still canônico no mesmo compositor/evaluator | V507,V508,V510 | mesmo frame/geom/texto sem CSS viewport divergente |

**Atualização de V507 (parcial, 2026-10-19):** a matemática pura de interpolação de pose articulada, transforms de palco/rosto, aparência e efeitos foi extraída para `src/shared/videoCharacterInterpolation.ts`; o preview preserva seu wrapper atual e usa as mesmas funções compartilháveis. Há teste sintético de membro articulado, rotação angular, limites, repeatabilidade e imutabilidade. O Scene IR e o `TransitionRenderer` ainda não compartilham um resultado raster; V507 e a paridade visual seguem parciais.

**Avanço de V509 (parcial, 2026-10-19):** `TransitionRenderer` agora aceita um provider injetável completo (modelo, poses, cabelo, conjuntos de roupa, face, catálogo e presets). O mesmo provider é propagado até `prepareSavedCharacterRenderer()` e seus leitores de olhos/componentes, efeitos, cabelo e roupas. O preview segue usando `window.desktop` como adaptador padrão. Há testes sintéticos de provider imutável para o núcleo e de propagação pelo caminho de transição. Ainda falta um coletor que reúna todas as dependências transitivas do personagem/pose e persista/hash/pine os bytes no manifesto de job; o provider completo não é ainda um snapshot durável.

**Estado de V509 (parcial, não concluído):** o código calcula manifesto/hash de dependências de vídeo, fixa os bytes por SHA-256 no job (IDs lógicos diferentes com conteúdo idêntico compartilham o mesmo arquivo), fixa imagens raster embutidas e persiste/restaura o JSON canônico do `StudioDocument` com `RenderVariant`. Manifestos antigos com arquivos nomeados por `assetId` continuam legíveis. A captura/persistência transitiva do Fabricador/Customizer foi iniciada nesta rodada, mas ainda falta ligá-la ao orquestrador IPC/runner de export do produto e provar a retomada em Electron. Assets preparados para render, paridade visual real e MP4 também permanecem abertos. Ver `../AGENTE_EXPORT_V5/DIARIO.md` (Rodadas 08–16). Não considerar esse avanço como exportação end-to-end ou V509 fechado.

**Avanço de captura de dependências do personagem (parcial, base `5ba0ed3`, rodada local seguinte):** `createRecordingVideoCharacterRenderAssetProvider()` agora grava leituras imutáveis e deduplica chamadas do provider para modelo, pose, cabelo, roupa, face, catálogo, componentes e presets. `captureVideoCharacterRenderAssets()` percorre sequencialmente as amostras internas de transições usando `TransitionRenderer`, com cancelamento entre quadros e progresso, para reunir as consultas transitivas que a composição realmente fizer. `VideoExportJobStore` agora aceita esse snapshot opcional, externaliza imagens PNG/JPEG/WebP por SHA-256, reutiliza blobs iguais às imagens do snapshot de cena e persiste `character-assets.json` com hash e dependências; leitura/reabertura reconstrói as Data URLs somente dos blobs pinados e verificados. Isso é fundamento sintético e ainda não está ligado a start/cancel/progress IPC nem a um runner de export do produto; não houve render real de personagens em Electron, MP4 nem prova visual. Portanto V509 continua parcial.

## Tranche T2 — Serial MP4 real

| ID | Mudança | Dependência | Aceite |
| --- | --- | --- | --- |
| V512 | `ExportSurface` V5 offscreen com handshake requestId e readiness barrier | V507,V509 | A-B-A, sem stale paint/frames |
| V513 | `MediaProbe`/timestamp rational e decoder para 24/25/29.97/60/VFR | V501,V509 | S05 / cuts / PTS corretos |
| V514 | `EncoderCapabilities` identifica FFmpeg real, licença e codecs | V501 | encode/decode curto no Windows alvo |
| V515 | Pipeline serial BGRA/alpha controlado, backpressure, cancel e RSS | V512,V514 | MP4 curto 60fps contagem N, sem leak |
| V516 | Plano real de áudio resample/mix/AAC e trim por range | V513,V515 | click offset/sample rate/overlap |
| V517 | Verificador `ffprobe`/decode/PTS/cores e biblioteca transacional | V515,V516 | MP4 íntegro ou falha segura |
| V518 | IPC tipada start/cancel/status/progress e UI em feature isolada | V517 | trusted sender, cancel e no partial |

**Evidência local parcial para V515/V517 (2026-10-19):** `scripts/video-studio/ffmpeg-local-smoke.cjs` consegue alimentar 60 frames BGRA sintéticos pelo `VideoRawFrameWriter`, gerar H.264 1920×1080/60 com um FFmpeg WinGet local e verificar 60 frames + decode completo com FFprobe. O binário é GPL e não foi empacotado. Como a fixture não usa o compositor V5, áudio, IPC, UI, cancelamento ou projeto real, os critérios V515/V517 continuam abertos; ver `../AGENTE_EXPORT_V5/DIARIO.md` (Rodada 18).

## Tranche T3 — Preview e armazenamento eficiente

| ID | Mudança | Dependência | Aceite |
| --- | --- | --- | --- |
| V519 | Scheduler preview (seeks obsoletos, raster prévio, buffer budget) | V507,V509 | p95 seek A/B, interatividade durante edição |
| V520 | Proxy de preview versionado por SHA/probe e waveform | V513 | fontes pesadas sem perder original/PTS |
| V521 | Otimizar indexes/viewport/scroll sem reescrever UI | V503,V519 | render volume, CPU, frame dropped |
| V522 | CAS global em shadow mode, mantendo cópias por projeto | V509,V520 | dados intactos após restart, backup, delete |
| V523 | Migrador CAS opcional e import/export portable robusto | V522 | nada perdido ao copiar/excluir/restaurar |

## Tranche T4 — Smart Export e aceleração

| ID | Mudança | Dependência | Aceite |
| --- | --- | --- | --- |
| V524 | Cache semântico de sprite/layer/fundo, LRU e rendererVersion | V506,V509,V515 | hashes/pixels iguais cold/warm, quota estável |
| V525 | Dirty regions/segment composer conservador por ROI | V524 | SSIM + diff por ROI, sem halo/alpha errado |
| V526 | Turboplan ranges [start,end) e manifesto v2 out-of-order | V517,V524 | testes completude fora de ordem e corruption |
| V527 | 2 workers isolados e concat stream-copy + áudio único | V526 | PTS/boundaries/codec/AV sync e fallback |
| V528 | Autotuner conservador CPU/GPU/mem/projeto | V527 | medianas comparadas; serial se não ganhar |
| V529 | Fallback GPU/CPU sonda de encoder e quality profile | V514,V517 | driver ausente/corrupto sem falha total |

## Tranche T5 — Experimentos de tecnologia (não bloquear MP4)

| ID | Experimento | Dependência | Regra de promoção |
| --- | --- | --- | --- |
| V530 | PixiJS WebGL render sprite/text/alpha vs DOM | V502,V508 | mesma composição, menor custo comprovado |
| V531 | FFmpeg vs MLT em fixture media A/V | V501,V517 | cold/warm, FFprobe, Windows/BOM |
| V532 | libopenshot/GES se houver lacuna no A/B | V531 | somente se ganho justificável + bundle |
| V533 | WebCodecs+Mediabunny para seek/proxy/encode | V501,V513 | codec/PTS/audio/MP4 e memória |
| V534 | Electron OSR sharedTexture experimental | V512,V515 | só se readback medido dominante e lifecycle seguro |
| V535 | OpenTimelineIO interchange opcional | V518 | fora do core render, requisito claro |
| V536 | Teste long-run 15min em hardware alvo | V527,V529 | bounded RSS/GPU/PTS/áudio/cancel/temperatura |

## Tranche T6 — Product e segurança

| ID | Mudança | Dependência | Aceite |
| --- | --- | --- | --- |
| V537 | recovery de jobs e limpeza por owner, locks/cancel idempotente | V517,V526 | kill/crash/disco cheio/reopen |
| V538 | pacote Windows limpo com licenças/BOM/FFmpeg configs | V529,V537 | instalador sem ferramentas de usuário |
| V539 | preferências "Exportar" simplificadas e modo compatibilidade | V518,V528,V538 | nenhuma escolha de thread/codec obrigatória |
| V540 | relatório final, checklists e desativação de flags de experimento | V536,V538,V539 | testes no HEAD exato e documentação | 

## Primeira sequência recomendada de commits técnicos

1. **V501 + V502:** incluir geradores de fixtures e oracle frame/pixel sem mexer UI ou dados reais.
2. **V505 + V507:** refatorar resolvedor de estado por frame; distinguir regra do transporte.
3. **V509:** snapshot de fornecedores com checksum e testes de edição concorrente.
4. **V508 + V510:** contrato de balões e camadas, sem alteração visual de produção antes de oracle.
5. **V512 + V514 + V515:** primeiro MP4 serial real.
6. **V513 + V516 + V517:** mídia, áudio e verificação final.
7. **V518:** UI simples para serial.
8. **V519...V529:** preview/dados/performance/Turbo após paridade.
9. **V530...V534:** tecnologia externa só conforme custos medidos; um experimento de cada vez.
10. **V536...V540:** soak/release/rollback.

## Formato obrigatório de cada entrega

~~~md
### V5xx — [título]
Estado: planejado | implementado | testado sinteticamente | testado em Electron | aprovado PC alvo
Base/head SHA:
Arquivos alterados:
Fixture e hash:
Comandos: (testes permitidos, sem DEV AI/audits)
Paridade: esperado, observado, ROI
Codec/PTS/audio: observações
Benchmarks: cold/warm, hardware, mediana, RSS/VRAM
Falhas/risco e rollback:
Próximo item desbloqueado:
~~~

**Nota:** uma matriz pode dizer "há implementação parcial" para códigos existentes, mas a tarefa completa só fica concluída após gate específico. Evitar "todos os 40 itens" como promessa de implementação numa única mudança gigante; aplicar testes de regressão e commits pequenos.


## Extensão de escopo exigida pelo produto — V541 a V548

| ID | Tarefa obrigatória | Critério de aceite |
| --- | --- | --- |
| V541 | Catálogo de recursos do Video Studio legado, contratos/UX/undo/redo/salvamento/prints antes de rebuild | cada recurso atual coberto por fixture ou checklist verificável; nenhuma perda |
| V542 | Especificar e implementar `RenderVariant` no IR e no job digest | modos `animated` e `static-characters` não alteram Studio salvo |
| V543 | Implementar export animado end-to-end com transição e automatismos no MP4 | preview/render/MP4 iguais por frame + áudio/PTS corretos |
| V544 | Implementar export sem animações de personagem, mantendo keys authored/vídeos/áudio | cortes de pose/expressão preservados, blink/mouth/transições automáticas ausentes |
| V545 | UI de seleção dos dois modos, cancel/status/validar arquivo, fallback | simples, nenhum preset expõe workers obrigatórios nem promete multiplicador |
| V546 | Extrair módulos extensíveis para novos tipos de cena/efeitos/codec sem editar JSX monolítico | fixture adiciona layer/efeito e usa preview, print, serial e Turbo |
| V547 | Reconstrução/migração gradual ou total do Video Studio autorizada, com adaptador legado/rollback | todos os recursos atuais e projetos v1 preservados; testes Windows |
| V548 | Critério de conclusão/autonomia Codex e relatório de gates evidenciados | histórico de comandos, SHA, runtime real, benchmark, bloqueios e próximos passos |

**Dependências recomendadas:** V541 antes de eliminar legado; V542 depende de V505/V507; V543 depende de V515–V517; V544 depende de V542/V543; V545 depende de V518/V543/V544; V546 depende de V505/V510/V512, validado antes de V540; V547 é transversal e só conclui após V541/V546/V538; V548 é gate final e depende das demais.

### Evidência parcial — 2026-10-20

O smoke Electron de `scripts/video-studio/character-media-oracle-smoke.cjs` agora passa pelo `VideoStudioClipPreview` real (HTML `<video>`) e compara com o compositor Canvas em oito seeks e duas variantes. A fixture valida ROI, A-B-A, pose/expressão, source tick, ordem das layers e extensão V546; execução local passou junto com os 117 testes, typecheck e build. Evidência e hashes estão em `04_LAB_E_GATES.md`. Isto amplia V501/V502/V504, V508/V510 e V546, mas não conclui nenhum deles: faltam etapas de print/serial/Turbo, duração longa, Linux/CI neste SHA, métricas de desempenho e os demais critérios listados na tabela.

Todos os conceitos originais aprovados (Smart Scene Compiler, cache persistente, paralelismo, proxies, hardware autodetect, Smart Export, preview/export unificado e A/B open source) continuam requisitos; não reduza a tarefa a portar Turbo V4. O documento [09_MISSAO_CODEX_AUTONOMA.md](./09_MISSAO_CODEX_AUTONOMA.md) é o **brief de execução** para o agente local.

## Diário de implementação local

### 2026-10-19 — primeiro avaliador semântico de cena

- Base sincronizada: `05a262b6b851b3bf72024bebe471eb86b320d8ba`, branch `master-desenvolvimento`.
- Implementado parcialmente: `src/shared/videoSceneIR.ts` compila índices derivados de keys/transições e avalia frame absoluto. O IR declara personagem authored, intervalo/progresso de transição, mouth/blink automáticos, gaps, textos, vídeos em ticks racionais de 1/60 (inclui transforms), fundo e ordenação atual de layers. Inclui `animated` e `static-characters`; o segundo preserva keys e desliga somente automações de personagem.
- `src/shared/videoCharacterTimeline.ts` é agora a implementação comum do índice e lookup de estado authored; `characterTrack.ts` (usado pela preview) delega a ela e `videoSceneIR.ts` reaproveita o mesmo lookup/cache. O IR compila índices de intervalos por prefixo de fim para gaps, texto e vídeo, além de maps de assets/elementos.
- Testes sintéticos: `tests/video-scene-ir.test.cjs` cobre seek A-B-A, authored key boundary, transição, precedência de fala, blink, gaps, sobreposições, texto, source tick, z-order e preferência de animação. Compara seleção compilada com `resolveVideoFrameSelection()` em cada frame da fixture (incluindo intervals sobrepostos). `tests/video-timeline-index.test.cjs` verifica ordem de keys e transforms globais/legadas pelo lookup que a preview consome.
- Verificações: `npm test` (55/55), `npm run test:export:synthetic` (25/25), `npm run typecheck`, `npm run build` e `git diff --check` passaram.
- Limite: ainda não compõe transição em PNG, não resolve bytes externos pinados, não captura preview/print e não está ligado ao renderizador React ou à exportação. V505/V507/V542 permanecem parciais; nenhum gate visual ou MP4 passa por este IR ainda.

### 2026-10-19 — compilador temporal de transições compartilhado

- `src/shared/videoCharacterTransitions.ts` centraliza a regra de transição usada pelo hook do preview e pelo Scene IR. Isso remove duas implementações paralelas de janelas, keys empatadas e supressão por gaps. O preview consulta samples também em seeks pausados quando o cache assíncrono já os preparou.
- O teste de fixture compara o plano de transições de ambos os consumidores e verifica que um gap que cruza a janela cancela a interpolação.
- Estado de V505/V507: parcialmente implementado e testado em Node. A composição da transição ainda é assíncrona/React no preview e não há prova de imagem equivalente entre preview, print e exportação.

### 2026-10-19 — manifesto de dependências de vídeo (V509 parcial)

- `electron/videoExportAssets.ts` produz SHA-256 ordenado para cada arquivo de vídeo referenciado, sem incluir paths no manifesto; valida root autorizado, tamanho/tipo, ausência de link simbólico no arquivo e mudanças durante a leitura. Há verificador para retomar/finalizar contra os bytes atuais.
- `VideoLibraryStore.resolveProjectMediaDependency()` resolve a cópia de mídia do projeto salvo e recusa divergência de metadados.
- A fixture cobre deduplicação, mídia ausente, escape do root, alteração pós-snapshot e resolução do projeto dono. O pipeline de export ainda não chama esses helpers; assets Fabricator/Customizador e cópia física imutável do job continuam abertos.

### 2026-10-19 — cópia pinada de mídia em jobs (V509 parcial)

- `VideoExportJobStore.create()` copia os vídeos do manifesto para `assets/` dentro do diretório exclusivo do job e valida SHA-256 antes de gravar o manifesto. Falha durante pinagem remove só a pasta nova do job.
- `reopen()` exige arquivos pinados íntegros para aceitar checkpoints; `verifyPinnedMedia()` está disponível para o futuro runner. Manifestos antigos sem `mediaDependencies` continuam válidos.
- Ainda falta conectar a criação/retomada ao processo principal e persistir/restaurar o snapshot completo de cena e os fornecedores de imagem/modelo/pose/face. Logo, V509 permanece parcial e ainda não existe retomada de export de ponta a ponta.
