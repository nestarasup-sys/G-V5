# PLANO DIRETOR — Modernização Integral do Video Studio G-V5
> Documento **estratégico e executável, separado** do antigo plano de exportação. Versão 1.0 · 2026-10-19.
>
> Repositório de escrita: `nestarasup-sys/G-V5`, branch `master-desenvolvimento`.
> Referência histórica de desempenho: `nestarasup-sys/EDITOR-V4`, branch `oai/aggressive-export-v5`, **somente leitura**.
> Base inspecionada desta investigação: G-V5 `7352d748fcd482545f49ac0d546886e9be195108`; pode avançar após commits de documentação. Resultados descritos como "proposta" não foram executados.

## 0. Visão do produto

Transformar o Video Studio num editor de reação/animação 2D com **preview responsivo, paridade visual por frame, mídia robusta, MP4 confiável, cache eficiente e exportação autoajustável ao hardware**, sem abandonar o fluxo autoral do G-V5. O objetivo **não** é copiar o V4, substituir o Fabricador/Customizador ou importar um aplicativo de edição completo. V4 fornece ideias comprovadas para cenários V4, não metas ou dependências obrigatórias no V5.

**Problema real:** o G-V5 já tem timeline, personagens e composição visual, mas hoje o preview depende de React/DOM, RAF, geração assíncrona de arte e HTMLVideo. O domínio export separado tem snapshot sintético, writer, catálogo e checkpoints, mas não produz MP4 real. Os motores externo e nativo não compartilham um contrato visual canônico completo.

## 1. Princípios de engenharia

1. **Uma semântica visual, várias apresentações:** a mesma função absoluta `evaluateFrame(job, n)` alimenta preview canônico, still/print, serial e Turbo. O resultado depende de documento+dependências+versões+frame, não de `playing`, estado assíncrono não drenado, tamanho da janela ou ordem dos seeks.
2. **Projetos V5 seguem válidos:** `StudioDocument`/`VideoTimelineDocument` v1 permanecem entrada. Novos manifests e formatos de cache são *derivados*, versionados, reversíveis, fora dos documentos autorais.
3. **Primeiro correto, depois rápido:** guardar baseline, implementar um MP4 serial funcional, validar a reprodução, então cache/Turbo/hardware sem esconder perdas de qualidade.
4. **Tecnologia escolhida por experimento:** FFmpeg+composição especializada é a hipótese líder; PixiJS WebGL, MLT, GES, libopenshot e WebCodecs/Mediabunny competem em protótipos controlados. Não comprometer a produção sem gates.
5. **Custos explícitos:** tempo frio/quente, CPU, GPU, VRAM, RSS, disco, p95 de seek/preview, consumo de memória e qualidade de pixels. Evitar alegar "2×" de throughput sem medição.
6. **Segurança de dados:** nenhum projeto/arte/fundo privado em CI; testes geram mídias e atores sintéticos; export nunca altera bibliotecas/Studio. Workflows DEV AI e auditorias desativados não devem ser executados.
7. **Usabilidade:** usuário escolhe qualidade/destino, não threads e encoder. Autotuner conservador com override somente em diagnóstico interno.
8. **Fallback por camada:** compositor experimental -> referência canônica; encoder GPU -> encoder CPU verificado; Turbo -> serial; proxy defeituoso -> mídia original; cache corrompido -> regenerar.

## 2. Diagnóstico comprovado no código (outubro/2026)

| Evidência | Consequência |
|---|---|
| `VideoStudioEditor.tsx` usa RAF e samples condicionados a `videoPlaying`; `useCharacterTransitions.ts` condiciona `samples` a `playing` | Reproduzir N arbitrário não equivale ao estado da preview tocando; criar timeline evaluator canônico. |
| `transitionRenderer.ts` consulta Fabricador/Customizer em tempo de render | Snapshot do Studio congelado não fixa conteúdo de fornecedores externos; materializar manifesto de bytes/dependências. |
| `VideoStudioEditor.css`: texto `font-size:clamp(9px,1.4vw,18px)`, balões por DOM; `makeCanvasPrint()` redesenha texto com Canvas 2D e regras próprias | Risco confirmado de **implementações de layout divergentes**; geometria/tipografia em coordenadas de palco e oráculo visual; não presumir prints equivalentes. |
| `VideoStudioEditor.tsx`: vídeo `z-index:1` e elementos `zIndex + 2`; clipes `<video>` | Semântica de camadas para vídeo é específica; compilador não pode supor mixer de trilhas genérico ou z-order arbitrário. |
| `videoMediaPlayback.ts` usa `currentTime` e tolerância de drift | Playback nativo não é decoder frame-exato para export; usar PTS/decoder controlado. |
| `videoLibrary.ts` mantém original + `copyVerified` em `projectMediaPath` no attach | Há cópias físicas por projeto. Não converter para CAS/global sem migração, integridade, isolamento, delete e backup testados. |
| `videoExportSnapshot.ts` resolve texto/gaps/vídeos/blink, não pixels/estado completo | Fundação parcial. |
| `videoCharacterTimeline.ts` contém o índice/lookup absoluto usado por `characterTrack.ts` e por `videoSceneIR.ts`; IR também indexa gaps/text/video por intervalos | Resolve estado authored comum aos dois caminhos e passa comparação contra seletor legado em fixture; IR ainda não substitui composição/transição raster da preview e não resolve assets externos. |
| `videoRawFrameWriter.ts`, `videoExportJobs.ts`, `videoExports.ts` | Infra de transporte, checkpoint e catálogo, mas ainda sem renderer real, FFmpeg comprovado, FFprobe, API start/cancel/progress. |
| `package.json`: Electron/React/sharp, sem FFmpeg empacotado | Não existe encoder disponível garantido no instalador. |

Mais detalhes auditáveis em [01_ESTUDO_DE_MOTORES.md](./01_ESTUDO_DE_MOTORES.md) e [02_ARQUITETURA_CANONICA.md](./02_ARQUITETURA_CANONICA.md).

## 3. Arquitetura-alvo, separando plano lógico de tecnologia

```text
               Studio V5 v1 + bibliotecas existentes
                              │
                        Preflight + Snapshot
                      ┌───────┴────────┐
                      │ AssetManifest  │ (bytes/PTS/hash/licenças)
                      └───────┬────────┘
                              ▼
                    Smart Scene Compiler
                 eventos, intervalos, layers,
                 clocks, animações, áudio, ROI
                              │
                  Render IR versionado/imutável
             ┌────────────────┴─────────────────┐
             ▼                                  ▼
       Preview canônico                    Export Scheduler
   UI/transport separado             serial / chunks / cache
             │                                  │
      compositor 2D                     compositor 2D / media
       determinístico                   decoder com PTS exato
             │                                  │
         still/print                   encoder sondado FFmpeg
             │                                  │
             └──────────── teste paridade ──────┤
                                                ▼
                                        audio mix uma vez
                                         verificação final
                                     publicação transacional
```

**Três fronteiras independentes:**
- **A. Editor / domínio**: salvar, editar, voltar, preview. Somente leitura de `JobSpec` no export.
- **B. Render/compilação**: `RenderIR` por frame e por intervalo, plano de dependências, sort de camadas, pixel/layout contracts.
- **C. Media/entrega**: decode VFR, encoder, streams, concat, áudio, FFprobe, retry, cache, worker ownership.

## 4. Sequência de execução (gates vinculantes)

### Fase P0 — Baseline e bancada isolada
- [ ] Validar HEAD, scripts permitidos, libs e ambiente; colher métricas do *preview atual*, do print atual e dos testes sintéticos.
- [ ] Gerar fixtures autorais com PNG alfa, duas figuras genéricas, fundo, balão com letras, 15 frames de transição, blink e boca, vídeo de timestamp, áudio click+tone. *Nunca* fixture real.
- [ ] Mapear cobertura por ação: ler/seek/split/duplicar/salvar/reabrir/exportar/cancelar.
- [ ] Harness com oracle de frames e JSON de métricas; artefatos sintéticos apenas em job controlado.
**Gate P0:** quadro e áudio esperados especificados; baseline reproduzível, sem tocar runtime real.

### Fase P1 — Semântica única e fidelidade do preview
- [ ] Implementar `RenderIR` absoluto a partir de `VideoTimelineDocument`, com transições e efeitos por quadro, prioridade e identidade de layers.
- [ ] Fixar palco lógico 1920×1080, texto/balloons/linha/quebra/fontes/alpha e posição de personagem, sem viewport-dependent units na camada canônica.
- [ ] Resolver e materializar dependências transitivas (pose, roupas, presets, faces, PNGs, vídeo); versionar hashes sem alterar o schema do projeto.
- [ ] Oferecer `preview canonical` experimental; preservar UI/editor e fazer A/B por amostras PNG. Unificar também `Print` em etapa posterior.
**Gate P1:** transição, seek reverso, pausa, blink, boca, clip e mudança de janela dão mesmo frame lógico; não aceitar tolerância para estado errado.

### Fase P2 — MP4 serial real
- [ ] `ExportSurface` V5 isolada (não `ExportSurface` do V4) com requestId, barriers de assets/presentation/readback e cleanup.
- [ ] FFmpeg locator+probe real no Windows alvo, encoder CPU confiável + HW candidatos após sonda, container e saída temporária.
- [ ] Produzir MP4 pequeno com áudio correto, validar count/PTS/codec/BT.709/range/duração por FFprobe + decode completo.
- [ ] Job API start/cancel/status/progress com trusted sender e owner; publicar apenas saída validada.
**Gate P2:** serial confiável em Windows/instalador; cancel/crash/disco cheio não publicam parcial.

### Fase P3 — Preview e mídia escaláveis
- [ ] Proxy thumb/scrub e áudio waveform em cache derivado com invalidation; originals intactos.
- [ ] Índices de timeline eficientes, debounce de operações editoriais, evitar reconstruções caras e renders async concorrentes.
- [ ] Gestão de buffers/texturas por orçamento, prioridade de frames perto do playhead, cancel de seeks obsoletos.
- [ ] Avaliar biblioteca de conteúdo compartilhado sem quebrar cópias de projeto existentes.
**Gate P3:** p95 de seek e fluidez sob carga melhorados em A/B; memória estável; aberturas/salvamentos retrocompatíveis.

### Fase P4 — Smart Export e Turbo
- [ ] Analisar invariâncias por layer: fundo, arte, boca, transições, video decode e texto.
- [ ] Cache semântico com chave forte de estado+assets+rendererVersion+color config, LRU por bytes; nunca cache de pixel baseado só no nome de expressão.
- [ ] Planejar ranges independentes [start,end) com pre-roll de decode e lookback/lookahead de transições sem perder frame de borda.
- [ ] Comparar serial vs 2 workers e somente então 3+, com hash/PTS/concat stream-copy, áudio mixado uma vez e fallback.
**Gate P4:** qualidade e limites físicos mantidos, ganho medido cold e warm; o nome "Turbo 2×" significa concorrência, não velocidade garantida.

### Fase P5 — Seleção de engine por evidência
- [ ] Experimento A: compositor nativo V5/Canvas vs PixiJS WebGL. Comparar layout/tipografia/alpha e readback GPU→CPU.
- [ ] Experimento B: FFmpeg puro / graph vs MLT / GES / libopenshot em projeto equivalente de mídia simples, medindo custo de integração.
- [ ] Experimento C: WebCodecs/Mediabunny para preview/proxy/encode isolado; confirmar mux, áudio e codecs efetivos.
- [ ] Experimental: shared GPU textures Electron (API experimental), se custo BGRA for dominante e houver manutenção C++ viável.
**Gate P5:** somente integrar candidato que passe requisitos e bata baseline sob avaliação objetiva; **não** migrar tudo para uma biblioteca por preferência.

### Fase P6 — Distribuição/operacionalização
- [ ] Matriz Windows target clean-install, codecs, fontes, drivers, GPU e modo software.
- [ ] Recuperação de jobs órfãos/checkpoints, orçamento de disco, backup/ref-count de mídia e retirada de proxies.
- [ ] UX sem opções técnicas por padrão, diagnósticos sanitizados e modo de compatibilidade.
- [ ] CI por camadas: puro, Electron sintético, FFmpeg real, hardware local. Sem executar auditorias desligadas.
**Gate P6:** pacote funciona sem ferramentas globais extras, reproducibilidade e rollback.

## 5. Decisões provisórias

| Decisão | Posição inicial | Regra de revisão |
|---|---|---|
| Motor padrão | V5 RenderIR + compositor especializado + FFmpeg sondado | Trocar apenas se MLT/GES/libopenshot vencerem paridade+perf+manutenção |
| Engine visual | reusar composição atual inicialmente; PixiJS WebGL como candidato A/B | WebGL não é prova de pixel-idêntico a CSS |
| Codificação | CPU estável sondada; GPU candidata por hardware | fallback + prova de cor/PTS/qualidade |
| Frame clock | inteiros 60fps / timestamps racionais | N nunca vem de `currentTime` do preview |
| Cache | derivado, endereçado por hashes de conteúdos e versões | invalidação em qualquer dependência |
| Turbo | 1 worker primeiro, dois se comprovado | 3+ só com ganho repetível e memória |
| Biblioteca de vídeo | preservar originais e cópias por projeto enquanto migração for planejada | CAS compartilhado só com testes de perda/backup/delete |
| Remotion/Olive/OBS/OTIO | referência/uso específico, **não** backend de produção neste momento | necessidade e licença podem reabrir ADR |

## 6. Qualidade e métricas — nenhum número de speedup inventado

Indicadores de aceitação (medidos contra baseline na mesma fixture e PC):
- **Correção funcional:** 100% de frames esperados nas bordas, sem stale/duplicação indevida, decodificação completa, áudio sem deslocamento inexplicado.
- **Paridade:** diferenças visualmente explicadas/quantificadas por ROI; exigir pixels idênticos em camada sintética sem perdas; para H.264 comparar contra imagem pré-encode, separar perdas codec de erros de estado.
- **Desempenho:** p50/p95 de seek, fps real da preview, frame-misses; tempo total cold/warm, latências por estágio, memória pico e bytes de cache. Nenhuma otimização entra por observação isolada.
- **Resiliência:** falha/kill, disco cheio, mídia removida, GPU reset, fonte indisponível, cancel, retry, rollback.
- **Medição:** cenas de 5s, 30s, 90s, 180s e 15min; 3 repetições ou mais, ordem alternada, ambiente registrado; caso 15min inacessível no runner, validar no PC alvo. Comparar sempre qualidade antes de velocidade.
- **Limites:** o perfil fixo de 1920×1080×4 custa 8.294.400 bytes/frame, cerca de 475 MiB/s a 60fps. Evitar pipes e cópias extras por frame quando os gargalos comprovarem custo.

Consulte [04_LAB_E_GATES.md](./04_LAB_E_GATES.md).

## 7. Critérios para adotar motor externo (sem dogmatismo)

- [ ] Funciona com snapshot do V5 e fontes/mídia sintéticas.
- [ ] Preserva transições, layering, face/roupa/texto, temporalidade de áudio e vídeo.
- [ ] Aceita execução headless em Windows/Electron distribuído.
- [ ] Fica abaixo do orçamento medido de memória/latência e suporta cancelamento.
- [ ] License BOM completa, redistribuição e avisos viáveis.
- [ ] Reduz custo total de manutenção **e** tempo total ou melhora robustez comprovada.
- [ ] Tem fallback/rollback que preserve o projeto e export anterior.

**Se não satisfizer, usar apenas como referência ou integração opcional**, não transplantar UI nem dependências nativas automaticamente.

## 8. Governança, evidências e continuidade

- **Documentos deste plano**: [01_ESTUDO_DE_MOTORES.md](./01_ESTUDO_DE_MOTORES.md), [02_ARQUITETURA_CANONICA.md](./02_ARQUITETURA_CANONICA.md), [03_MIGRACAO_E_DADOS.md](./03_MIGRACAO_E_DADOS.md), [04_LAB_E_GATES.md](./04_LAB_E_GATES.md), [05_DECISOES_ADR.md](./05_DECISOES_ADR.md).
- **Plano de export antigo:** [../AGENTE_EXPORT_V5/PLANO_MESTRE.md](../AGENTE_EXPORT_V5/PLANO_MESTRE.md) continua como backlog tático do *pipeline de export*, subordinado a este plano integral quando houver divergência.
- **Diário:** [../AGENTE_EXPORT_V5/DIARIO.md](../AGENTE_EXPORT_V5/DIARIO.md) registra mudanças com SHA/testes exatos; plano não se torna feature por ser escrito.
- **Alçada:** commits só em `master-desenvolvimento` do G-V5, sem alterar `master`, V4, mídia privada, DEV AI ou auditorias desligadas.
- **Controle:** cada tranche gera issues/tarefas executáveis com teste, artefato sintético, benchmark, decisão e plano de rollback. Não misturar "teste Node" com "MP4 Windows validado".

## 9. Primeira onda técnica recomendada

**Começar pelas fontes de verdade em vez de importar engines:** produzir uma fixture de 2 personagens+balão+vídeo+áudio e implementar `RenderIR` com snapshot de arte e estado absoluto; corrigir diver­gência temporal de transição/boca/texto; capturar still na mesma superfície; depois MP4 serial H.264 real com FFmpeg. Paralelamente (sem bloquear essa trilha) executar três spikes A/B: PixiJS, MLT e WebCodecs/Mediabunny. Isso permite aproveitar rapidamente os componentes existentes sem fixar um backend prematuramente.

**Status em 2026-10-19:** documento novo; todas as caixas são pendências futuras salvo quando explicitamente indicadas como código já existente. Não há teste nem benchmark novo de runtime executado durante esta rodada documental.


## Adendo de requisitos do produto e autorização técnica (2026-10-19)

**A direção desta versão inclui explicitamente TODAS as ideias da proposta "Video Studio Engine V5 — Nova Geração":** combinar tecnologias open source por evidência; compositor de personagens acelerado com PixiJS/WebGL caso vença A/B; MLT/GES/libopenshot como alternativas de mídia; FFmpeg + Smart Scene Compiler como baseline; renderização por mudanças visuais sem pular frames CFR; cache semântico persistente compartilhável por digest; preview e export com mesmo estado/cena; paralelismo por chunks; proxies; recuperação por checkpoints; hardware/autotuner; medição invisível ao usuário; Smart Export por complexidade/cena; processamento GPU/CPU com fallback e estabilidade em vídeos longos.

**Autorizações e requisitos novos:**
1. O usuário autoriza reconstrução interna profunda do Video Studio, desde que não haja perda de funções, arquivos, projetos ou bibliotecas. Preferir substituir componentes incrementalmente atrás de adaptadores/flags; remover legado apenas após paridade e migração testadas. Ver [08_ARQUITETURA_EXTENSIVEL_E_RECONSTRUCAO.md](./08_ARQUITETURA_EXTENSIVEL_E_RECONSTRUCAO.md).
2. Extensibilidade passa a ser gate de produto: adicionar um novo tipo de elemento/efeito ao compilador e renderers por registro e interfaces, sem editar monólito JSX. Separar domínio/IR, animações, UI, renderers, mídia, codecs e jobs.
3. Dois modos de export com o mesmo pipeline e diferenças **semânticas versionadas**: [07_MODOS_DE_EXPORTACAO.md](./07_MODOS_DE_EXPORTACAO.md). O modo Sem animações preserva mudanças autorais de pose/expressão e toda a mídia/áudio, mas remove interpolações automáticas, blink e boca animada; não congela vídeos.
4. A missão local para Codex está pronta em [09_MISSAO_CODEX_AUTONOMA.md](./09_MISSAO_CODEX_AUTONOMA.md): sincronização segura de branch, implementação end-to-end e ciclo de testes/commits até os gates. Não considerar documentação, proof-of-concept, build ou CI sintético prova de finalização.
5. As tecnologias listadas são **candidatas**, não dependências obrigatórias. Codex tem liberdade para encontrar substitutos melhores e demonstrar superioridade por licenças, manutenção, visual parity, performance e Windows.
6. Nenhuma limpeza irreversível, migração de dados sem backup ou ocultação de falhas para alcançar métricas de velocidade.

**Gate adicional:** comparar os dois modos lado a lado frame-a-frame, com intermediários de transição, fala/blink, corte de key authored, vídeos em movimento, áudio correto; mesmo preset output e codec, sem artefatos ou "2×" inventados.


## Rebaseline operacional — 2026-10-20

As seções iniciais deste documento registram o diagnóstico de 2026-10-19 e permanecem úteis como histórico arquitetural, mas vários itens ali descritos como ausentes já foram implementados. Para estado atual e pesquisa externa, ler primeiro [11_PESQUISA_OPEN_SOURCE_E_FECHAMENTO_EXPORTADOR.md](./11_PESQUISA_OPEN_SOURCE_E_FECHAMENTO_EXPORTADOR.md).

### Escopo reafirmado

Esta iniciativa cobre **somente Video Studio**. Roteiros e Base de Vídeos não entram no backlog deste plano, salvo a interface mínima de mídia consumida pelo Video Studio.

### Nova ordem de prioridade

A sequência técnica atual deixa de ser “construir engine do zero” e passa a ser:

1. fechar deterministicidade/paridade A-B-A;
2. manter serial como oracle de correção;
3. completar recovery/crash/cancel;
4. medir e limitar memória/backpressure;
5. medir workers × threads para evitar oversubscription;
6. validar cache/layer cache por A/B;
7. fechar Turbo/autotuner;
8. fechar runtime/pacote Windows LGPL sem PATH;
9. executar hardware gate;
10. decidir Pixi/WebCodecs/sharedTexture por dados;
11. só então explorar bindings libav*/GPU mais profundos.

### Backbone reafirmado

```text
RenderIR específico do G-V5
  + compositor específico do G-V5
  + FFmpeg como backbone de encode/audio/mux/verify
```

MLT, GES e libopenshot continuam candidatos de laboratório/referência, **não candidatos a migração imediata**. A nova pesquisa encontrou mais valor em extrair padrões de MLT/Kdenlive/Shotcut/mpv/VapourSynth/AviSynth/Natron/GStreamer do que em importar um NLE inteiro.

### Hipóteses novas que entram no laboratório

- oversubscription entre Turbo workers e threads internas do FFmpeg;
- limite explícito de frames/buffers em voo;
- métrica de pipe/writer stall;
- RAM total incluindo subprocessos;
- estado de proxy `pending/ready/failed/stale`;
- readahead de preview adaptativo ao modo playback vs scrub;
- dirty rectangles do Electron OSR antes de um sistema custom complexo;
- NodeAV/libav* direto somente como spike pós-release se cópia/subprocesso aparecer como gargalo.

### Regra de fechamento

O exportador tem prioridade sobre novas engines. Nenhuma POC pode atrasar:

- recovery;
- clean Windows package;
- 90 s/15 min;
- hardware gate;
- output validado e publicação transacional.
