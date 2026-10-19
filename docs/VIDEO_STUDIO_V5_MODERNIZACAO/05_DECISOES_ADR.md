# ADR — Registro de decisões e hipóteses da modernização Video Studio
Data: 2026-10-19 · ADRs propostos/aceitos como **orientação de pesquisa**, não código entregue.

## Convenção

Status possíveis: `DECIDIDO — diretriz`, `PROVISÓRIO — experimento pendente`, `ADIADO`, `REJEITADO por ora`, `APROVADO em benchmark`. Nenhum candidato foi "aprovado em benchmark" nesta rodada. O impacto e rollback precisam ser revisados a cada experimento.

### ADR-001 — Separar a nova estratégia do plano antigo de export
**Status:** DECIDIDO — diretriz.
**Contexto:** objetivo passou de portar Turbo V4 para modernizar todo Video Studio V5.
**Decisão:** `00_PLANO_DIRETOR.md` é o plano estratégico canônico; `docs/AGENTE_EXPORT_V5/PLANO_MESTRE.md` continua como plano de implementação de export serial/Turbo subordinado.
**Consequências:** os trabalhos de timeline/preview, biblioteca, estabilidade e desktop packaging fazem parte do escopo.
**Rollback:** nenhum efeito em runtime; atualizar cross-references se estratégia mudar.

### ADR-002 — Não importar editor open source completo
**Status:** DECIDIDO — diretriz.
**Alternativas:** fork de Shotcut/Kdenlive/OpenShot/Olive vs bibliotecas próprias.
**Decisão:** reter UI/contrato G-V5; testar MLT/GES/libopenshot como *serviços* em processos isolados, não transplantar seus projetos/UI.
**Razão:** mismatch de personagens, expressões, roupas, fontes, timelines e licenças.
**Reabrir se:** produto passar a exigir tracks NLE genéricas que superem a vantagem do compositor especializado.

### ADR-003 — FFmpeg + RenderIR canônico é baseline líder
**Status:** PROVISÓRIO — experimento pendente.
**Decisão candidata:** usar FFmpeg para streams, áudio, codec e MP4, mas compositor especializado V5 para arte e estados.
**Por quê:** V5 tem grande parte do conteúdo controlado por estados de personagens estáticos/dinâmicos; pipeline de vídeo genérica não entende isso.
**Alternativas:** MLT/GES/libopenshot.
**Gate:** serial real, 30/90s paridade/PTS, Windows pacote, custo menor ou razoável; se falhar, reabrir comparação.

### ADR-004 — PixiJS somente após oráculo de tipografia
**Status:** PROVISÓRIO — experimento pendente.
**Decisão:** construir spike WebGL com PNG/roupa/pose e balões; **não** substituir DOM/CSS até layout ser idêntico ou diferença ser corrigida na semântica compartilhada.
**Alternativas:** compositor HTML Offscreen, Canvas2D com specs unificadas, Skia/native 2D (não investigado profundamente).
**Gate:** glyph layout, tail, antialias, pixel geometry, alpha, memória, readback, Windows drivers.
**Rollback:** feature flag compositor legado/OSR.

### ADR-005 — Fonte de verdade é frame absoluto + assets pinned
**Status:** DECIDIDO — diretriz.
**Decisão:** RenderIR por `frame n`, snapshots externos por hash de bytes e versão; preview/print/export usam o mesmo evaluator.
**Risco mitigado:** transição só em `playing`, frame stale, troca de roupa/face durante job, viewport CSS.
**Gate:** seek A-B-A, testes de 15 frames de transição, renderer/cor/texto e troca concorrente de mídia.
**Rollback:** preservar schema autoral v1; novo IR/cache totalmente derivado.

### ADR-006 — Biblioteca de vídeos: não apagar cópias legadas
**Status:** DECIDIDO — diretriz; CAS permanece PROVISÓRIO.
**Evidência:** `VideoLibraryStore.attach()` faz cópia de original para projeto; há migração/cópias de recuperação.
**Decisão:** shadow CAS e proxy são opcionais e reversíveis; GC só de cache derivado; hardlink não é pressuposto; backup/portable antes de qualquer dedup física.
**Gate:** refcount/tombstone/projects/remover/backup/offline/move appdata.
**Rollback:** leitor legado com arquivos de projeto intactos.

### ADR-007 — Encoder por capability probe, nunca por nome
**Status:** DECIDIDO — diretriz.
**Decisão:** `h264_mf`, `h264_amf`, `h264_nvenc`, `h264_qsv` ou CPU só após executar encode/decode curto com binário real, driver e configuração final no PC/pacote. FFmpeg licencia/configuração verificadas.
**Alternativas:** WebCodecs para subfunção avaliada.
**Gate:** qualidade, conformidade, estabilidade, GOP e fallback CPU.
**Rollback:** o job retorna modo serial/CPU sondado; output anterior preservado.

### ADR-008 — Turbo 2× é um recurso condicional
**Status:** DECIDIDO — diretriz.
**Decisão:** serial serve como oráculo; 2 workers apenas se contagem/PTS/paridade/áudio/hardware forem provados; 3+ só após benchmark e orçamento RAM.
**Gate:** chunks fora de ordem (manifest v2), concat compatível, áudio único, cancel, crash, cold/warm; chamar Turbo 2× não equivale a prometer dobro de throughput.
**Rollback:** serial automático e relatório diagnóstico sanitizado.

### ADR-009 — WebCodecs/Mediabunny para laboratório
**Status:** PROVISÓRIO — experimento pendente.
**Decisão candidata:** usar em preview/proxy/encode curto se reduzir seek/decode com fidelity e container corretos.
**Risco:** WebCodecs não muxa; Mediabunny (MPL-2.0) complementa container, não garante codec/hardware.
**Gate:** H.264 real disponível, VFR/B-frames, Audio/PTS, VideoFrame lifecycle, memória, Windows.
**Rollback:** FFmpeg/proxy existente.

### ADR-010 — Não apostar em zero-copy GPU antes de profiling
**Status:** ADIADO.
**Contexto:** Electron offscreen useSharedTexture é experimental e requer ponte nativa.
**Decisão:** bitmap/OSR primeiro; medir `readbackMs`, custos de cópia e codecs; só pesquisar shared GPU texture/Direct3D11VA se gargalo dominante.
**Gate:** bridge independente, GPU device compatibility, release lifecycle e failback.
**Rollback:** bitmap e CPU encode.

### ADR-011 — Política de CI, privacidade e mudanças de dados
**Status:** DECIDIDO — diretriz.
**Decisão:** nenhuma fixture pessoal ou media real em CI; não executar DEV AI e auditorias desativadas; não publicar artifacts sem decisão; registrar GH SHA/testes executados e distinção G0-G6; não modificar master/V4.
**Gate:** revisão de paths, workflow scope, saneamento de logs e privacy.
**Rollback:** desligar workflow novo se violar política.

### ADR-012 — Preservar semântica visual existente e fixar especificação
**Status:** PROVISÓRIO quanto a compatibilidade estética de cada canto.
**Evidência:** balões DOM usam font-size vw e print usa regras Canvas2D próprias; vídeo atualmente z=1, personagens = zIndex+2.
**Decisão candidata:** "preview canônico" em palco fixo 1920×1080, resolvido pelo IR; UI apenas escala. Preservar intenção visual antes de melhorar desenho/algoritmo de layout. Qualquer mudança proposital de balão passa por versão do renderer e testes de regressão.
**Gate:** comparações de balão, fala, pensamento, narrador, efeitos e clipping, além de 4 tamanhos de janela e 2 DPR.
**Rollback:** manter CSS/editor e Print legado atrás de feature flag até estabilizar.

## Decisões não tomadas

- Bibliotecas finais instaladas em `package.json`: nenhuma nesta rodada.
- Encoder padrão de distribuição, LGPL/GPL definitivo e licença de pacote: **não decidido**.
- Datas, performance estimada em x vezes, número de workers e limite de VRAM/RAM: **não decidido**, dependem de benchmark.
- Intercâmbio OpenTimelineIO, filters NLE avançados, render 4K e formatos de projeto v2: **fora da implantação inicial**.

## Como atualizar um ADR

Ao aprovar/rejeitar experimento, adicionar:
1. SHA da implementação e da fixture, nome do backend e comandos;
2. ambiente/hardware/binários/licenças;
3. registros de paridade, PTS, áudio, cancel e FPS/tempo/RSS;
4. decisão e reversão/feature flag;
5. data e link para relatório em `04_LAB_E_GATES.md` ou diário correspondente.

**Nunca** converter uma hipótese em decisão por autoridade de um editor conhecido ou pela palavra "GPU".


### ADR-013 — Dois modos, um único pipeline
**Status:** DECIDIDO — contrato de produto, implementação pendente.
**Decisão:** `RenderVariant` diferencia `animated` de `static-characters`. Completo usa transições e automatismos elegíveis; estático preserva estado authored por key, vídeo importado, áudio e balões e elimina interpolações de personagem, blink e mouth automáticos. Sem mutação da timeline.
**Justificativa:** rapidez sem destruição das reações; evita engines duplas.
**Gate:** fixture visual comparativa, PTS/áudio, determinismo e hash de variante. [Contrato](./07_MODOS_DE_EXPORTACAO.md).

### ADR-014 — Reconstrução interna liberada com equivalência de produto
**Status:** DECIDIDO — diretriz, engenharia pendente.
**Decisão:** pode reconstruir/substituir Video Studio antigo, reorganizar módulos e introduzir registries; não eliminar código velho antes da prova de equivalência/compatibilidade e rollback. Preservar projetos v1, bibliotecas, Undo/Redo/Autosave.
**Alternativa:** refactor incremental; default mais seguro. Rebuild completo só se custo/benefício demonstrado.
**Gate:** catálogo de recursos legado, migração, golden fixtures e smoke no app Windows. [Arquitetura](./08_ARQUITETURA_EXTENSIVEL_E_RECONSTRUCAO.md).

### ADR-015 — Extensibilidade e independência da engine são gate de aceitação
**Status:** DECIDIDO — diretriz, implementação pendente.
**Decisão:** layer/animation/render variant/decoder/encoder plugáveis por interfaces tipadas internas, RenderIR canônico e compatibilidade versionada. Registro interno, sem carregar plugins arbitrários inseguros.
**Gate:** implementar camada/efeito sintético novo sem mudar lógica espalhada no editor e no export; testes passam nos dois modos.

### ADR-016 — Autonomia persistente, conclusão baseada em provas
**Status:** DECIDIDO — operacional.
**Decisão:** Codex sincroniza `master-desenvolvimento` com segurança, lê [missão](./09_MISSAO_CODEX_AUTONOMA.md), trabalha em ciclos test/implement/benchmark/commit até passar G0-G6 e V541–V548 ou registrar bloqueio real; não tratar documentação/CI Node como export pronto. Nenhum `git reset --hard`/force push ou perda de dados.
