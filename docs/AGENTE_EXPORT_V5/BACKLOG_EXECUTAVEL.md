# BACKLOG EXECUTÁVEL — Migração Turbo 2× V4 → G-V5
Atualizado: 2026-10-19. Cada cartão abaixo é uma mudança isolada recomendada. Status: **planejado** salvo anotação explícita; nenhum item deve ser marcado pronto sem SHA+teste.

## Ordem vinculante por dependência
**Primeiro correção visual e serial**, depois empacotamento/robustez, só depois otimização. O único nome de branch de escrita desta missão é master-desenvolvimento do G-V5. Editor V4 permanece somente leitura.

| ID | Prioridade | Entrega verificável | Arquivos recomendados | Gate / reversão |
| --- | --- | --- | --- | --- |
| E01 | P0 | Manifest imutável de snapshot e dependências transitivas, stable digest | src/shared/videoExportSnapshot.ts, electron/videoExport* | Teste mudança externa não altera output; rollback feature flag |
| E02 | P0 | Timeline evaluator: pose/key/gap/text/mouth/blink/transição por frame | src/shared/videoExportFrame.ts (novo), characterTrack.ts, characterTransitions.ts | 15 frames de transição e seek desordenado; não mexer no preview sem testes |
| E03 | P0 | Fixture visual sintética contendo dois atores genéricos PNG, fundo, fala, transição | tests/fixtures/export-v5 (gerar em teste) | Sem asset privado e golden com checksum |
| E04 | P0 | Preflight de mídia, paths de leitura, hash real e metadata/PTS | electron/videoExportPreflight.ts (novo) | VFR/ausente/corrupta, symlinks |
| E05 | P0 | Surface de render offscreen V5 isolada e handshake requestId | src/renderer/src/features/videoStudio/export/*, electron/videoExportRenderer.ts | Electron A-B-A sem stale |
| E06 | P0 | Frame BGRA exato + bounded transport ao writer | electron/videoRawFrameWriter.ts e novo capturador | Dimensão/stride/cancel/16MB+ RSS |
| E07 | P0 | Resolver FFmpeg redistribuível/licença/probe e fallback conhecido | electron/videoEncoderCapabilities.ts (novo) | Teste empacotado no Windows alvo |
| E08 | P0 | MP4 sintético serial real e verificador ffprobe/decode | electron/videoExportSerial.ts (novo), tests/* | 5s e 30s 60fps pixel/PTS |
| E09 | P0 | Áudio real, trim, gain, mute e mux único | src/shared/videoStudioAudioPlan.ts, electron/videoExportAudio.ts (novo) | Teste click/sine timestamps |
| E10 | P0 | Paridade V5 personagem/transição/mídia e semântica de pause | render engine/surface + tests | Oracle por frames e clusters |
| E11 | P1 | API start/cancel/status/progress tipada, só do owner | shared/studio.ts, electron/main.ts, preload.ts | Untrusted sender/reentrância/error |
| E12 | P1 | Publicação validada/atomicidade, crash recovery, output antigo intacto | electron/videoExports.ts, videoExportJobs.ts | kill/rename/disk-full |
| E13 | P1 | UI simples de export/estado, default serial, sem prometer Turbo | VideoStudioEditor.tsx ou feature filha | E2E no Electron |
| E14 | P1 | Manifest Turbo v2 com out-of-order, workers isolados, áudio único | electron/videoTurboCoordinator.ts (novo) | 2 workers invertidos e corrupt chunk |
| E15 | P1 | 2 chunks vs 1, concat stream-copy, GOP seguro | coordinator + FFmpeg probe | count PTS/borders + fallback |
| E16 | P2 | Cache semântico por state & dependency digest, LRU/custos | renderer/cache novo | cold/warm, invalidação |
| E17 | P2 | Hybrid V4 por estado/delta/foreground somente se ROI positiva | composer novo | pixel oracle + bench |
| E18 | P2 | Autosseleção 1/2 workers por CPU/GPU/RAM/IO | config interna, benchmarks | sem regressão no hardware alvo |
| E19 | P2 | CI separado: Node, Electron sintético, FFmpeg smoke/licenças | .github/workflows/video-export-*.yml | sem DEV AI e sem projeto real |
| E20 | P2 | Release gate/recovery log saneado e testes 15min | docs/AGENTE_EXPORT_V5/* | coleta local sem dados privados |

## Tranches recomendadas
- **Tranche 1 (E01–E04):** estado canônico por frame e preflight. Não tocar na UI.
- **Tranche 2 (E05–E08):** offscreen/encoder com *fixture*, MP4 curto real; nenhum personagem privado.
- **Tranche 3 (E09–E13):** paridade, áudio, cancel, biblioteca e botão com serial como fallback.
- **Tranche 4 (E14–E15):** Turbo 2× só quando serial confiável.
- **Tranche 5 (E16–E20):** otimização/Hybrid calibrado pelo PC alvo e distribuição.

## Checklist obrigatório por entrega
1. Confirmar HEAD da branch e arquivos alcançados pelo commit; nunca sobrescrever trabalho concorrente.
2. Reproduzir falha primeiro por teste pequeno e determinístico; distinguir fixture sintética de Electron real.
3. Commit só com escopo de entrega; manter mudanças de contrato versionadas e documentar migração/backcompat.
4. Registrar comando e SHA, sucesso/falha/pendente na DIARIO.md. Não alegar teste remoto sem verificar run.
5. Caso a mudança quebre paridade, manter atrás de flag experimental e retornar ao caminho serial.
6. Nunca executar scripts audit:* nem dev-ai, usar mídia/arte produzidas exclusivamente para testes.

## Estratégia de bench (sem forçar número fictício)
- 5 s: correção funcional/cancel/latência inicial; 30 s: overhead; 90 s: throughput e picos; 15 min: memória/temperatura/sync/estabilidade.
- Em cada amostra: serial cold, serial warm, 2 workers cold, 2 warm; ≥3 runs, mesma fixture, ordem alternada quando possível, controle temperatura.
- Medir tempo de preflight, resolução assets, raster, video decode, BGRA copy/IPC, ffmpeg encode, concat, áudio, ffprobe, publish; registrar medianas/p95 e divergência visual. Parar experimentos que não apresentem ROI ou que degradem qualidade.
- 2× significa dois trabalhadores e não promessa de redução de tempo pela metade. 3+ workers só se projeto longo e PC provarem vantagem.


## Backlog integral de modernização — referência posterior

Este backlog E01–E20 é o **recorte de export** e mantém validade técnica para o serial/Turbo. O usuário ampliou o objetivo para melhorar também preview, dados, renderizador, biblioteca, recursos de mídia, sincronização e UX.

O novo [backlog com 40 tarefas V501–V540](../VIDEO_STUDIO_V5_MODERNIZACAO/06_BACKLOG_DE_EXECUCAO.md) integra este recorte com [plano diretor](../VIDEO_STUDIO_V5_MODERNIZACAO/00_PLANO_DIRETOR.md). Evitar executar E14/E15/Turbo antes da unificação visual/asset manifest/serial MP4. MLT/libopenshot/GES/PixiJS/WebCodecs são **experimentos A/B**, não decisões de dependências já instaladas.

Implementações existentes de snapshot, writer/checkpoint/CI continuam parciais; *nenhum teste de MP4 ou integração nova* foi feito na rodada de pesquisa.


## Novo requisito de produto: dois modos e arquitetura aberta

O recorte E01–E20 continua tático; acrescentar [07_MODOS_DE_EXPORTACAO.md](../VIDEO_STUDIO_V5_MODERNIZACAO/07_MODOS_DE_EXPORTACAO.md) ao gate de cada tarefa e implementar `animated` + `static-characters` no **mesmo** compiler/render/export. O segundo modo elimina microanimações/interpolações de personagem mas preserva keys authored, vídeos e áudio. O novo [backlog V501–V548](../VIDEO_STUDIO_V5_MODERNIZACAO/06_BACKLOG_DE_EXECUCAO.md) é a prioridade integral, com reestruturação extensível/rebuild liberados sob testes e migração segura.
