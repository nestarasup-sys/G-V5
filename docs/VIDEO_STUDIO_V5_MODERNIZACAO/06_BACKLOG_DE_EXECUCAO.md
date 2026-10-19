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

Todos os conceitos originais aprovados (Smart Scene Compiler, cache persistente, paralelismo, proxies, hardware autodetect, Smart Export, preview/export unificado e A/B open source) continuam requisitos; não reduza a tarefa a portar Turbo V4. O documento [09_MISSAO_CODEX_AUTONOMA.md](./09_MISSAO_CODEX_AUTONOMA.md) é o **brief de execução** para o agente local.
