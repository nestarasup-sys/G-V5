# Video Studio V5 — Modernização Integral

Diretório canônico da modernização do **Video Studio do G-V5**. Nesta trilha, **Roteiros e Base de Vídeos são domínios separados e ficam fora do escopo**, salvo contratos mínimos usados pelo Video Studio para consumir mídia. O caminho crítico atual é **finalizar o exportador**, endurecer estabilidade e medir otimizações de preview/export.

O plano antigo `docs/AGENTE_EXPORT_V5/` permanece como histórico/backlog tático. Em divergência, o estado real do código + CI + documentos deste diretório prevalecem.

## Ordem de leitura atual

1. **[00_PLANO_DIRETOR.md](./00_PLANO_DIRETOR.md)** — visão e arquitetura.
2. **[11_PESQUISA_OPEN_SOURCE_E_FECHAMENTO_EXPORTADOR.md](./11_PESQUISA_OPEN_SOURCE_E_FECHAMENTO_EXPORTADOR.md)** — pesquisa externa atual, matriz de engines, padrões extraídos e ordem revisada para fechar o exportador.
3. **[10_RELEASE_CHECKLIST.md](./10_RELEASE_CHECKLIST.md)** — gate final de release.
4. **[04_LAB_E_GATES.md](./04_LAB_E_GATES.md)** — fixtures, benchmarks, paridade e evidências.
5. **[05_DECISOES_ADR.md](./05_DECISOES_ADR.md)** — ADRs e hipóteses reversíveis.
6. **[06_BACKLOG_DE_EXECUCAO.md](./06_BACKLOG_DE_EXECUCAO.md)** — backlog técnico; pode conter status histórico, portanto código/CI vencem caixas antigas.
7. **[02_ARQUITETURA_CANONICA.md](./02_ARQUITETURA_CANONICA.md)** — RenderIR, Scene Compiler, cache, PTS, áudio e GPU.
8. **[07_MODOS_DE_EXPORTACAO.md](./07_MODOS_DE_EXPORTACAO.md)** — `animated` e `static-characters`.
9. **[08_ARQUITETURA_EXTENSIVEL_E_RECONSTRUCAO.md](./08_ARQUITETURA_EXTENSIVEL_E_RECONSTRUCAO.md)** — modularidade/extensibilidade.
10. **[09_MISSAO_CODEX_AUTONOMA.md](./09_MISSAO_CODEX_AUTONOMA.md)** — brief de execução autônoma.
11. **[01_ESTUDO_DE_MOTORES.md](./01_ESTUDO_DE_MOTORES.md)** — pesquisa original de engines.
12. **[03_MIGRACAO_E_DADOS.md](./03_MIGRACAO_E_DADOS.md)** — dados, mídia derivada, CAS e segurança.

## Estado factual atual — 2026-10-20

O Video Studio já não está na fase descrita pelos primeiros documentos de 2026-10-19. Já existem no código, entre outros:

- SceneIR/evaluator absoluto por frame;
- variantes `animated` e `static-characters`;
- snapshot e dependências pinadas por SHA-256;
- ExportSurface Electron;
- compositor Canvas;
- personagem, transição, blink e mouth;
- vídeo importado com pool dedicado;
- FFmpeg capability probing;
- H.264/AAC, concat, FFprobe e full decode verification;
- serial e Turbo de dois workers com fallback;
- coordinator, cancel e recovery;
- cache semântico L1 e persistente L2;
- layer cache;
- preview seek scheduler latest-only;
- proxy/waveform;
- CAS shadow;
- registry V546;
- full-engine benchmark;
- gates 90 s e 15 min;
- preparação de runtime FFmpeg LGPL;
- experimentos PixiJS e Mediabunny/WebCodecs.

Portanto, **não reconstruir fundações já existentes só porque documentos históricos ainda dizem “falta implementar”**.

## Caminho crítico atual

1. determinismo Preview/Canvas/MP4, especialmente seek A-B-A;
2. serial como oracle de correção;
3. recovery/crash torture completo;
4. memória bounded e backpressure;
5. Turbo/autotuner sem oversubscription;
6. packaging Windows limpo com FFmpeg/FFprobe próprios;
7. hardware gate no PC alvo;
8. decisões Pixi/WebCodecs/sharedTexture baseadas em medição;
9. release checklist com evidência no HEAD final.

## Direção tecnológica após nova pesquisa

O backbone preferido continua:

```text
Studio -> pinned AssetManifest -> Scene Compiler / RenderIR
       -> compositor determinístico -> scheduler serial/Turbo
       -> FFmpeg encode/audio/mux -> ffprobe/full decode -> atomic publish
```

Não trocar por uma engine NLE completa sem evidência. MLT, GES, libopenshot, Shotcut, Kdenlive, mpv, VapourSynth, AviSynth+, Natron, Blender, GStreamer e outros são usados principalmente para **extrair padrões maduros** de frame evaluation, cache, proxy, backpressure, isolamento e recovery. Consulte o documento 11.

## Regras

- Escrita apenas em `nestarasup-sys/G-V5/master-desenvolvimento`.
- Editor V4 é somente referência.
- Sem mídia/projetos privados em CI.
- Não executar DEV AI/auditorias desativadas.
- Não otimizar sacrificando frames, áudio, transições, personagem ou deterministicidade.
- Serial continua fallback e referência de correção.
- Nenhuma promessa de “2×” sem benchmark.
- sharedTexture, Pixi, WebCodecs, NodeAV ou qualquer engine externa entram somente após A/B, licença, Windows packaging e fallback.

## Definição prática de conclusão

O Video Studio não está concluído porque existe uma arquitetura ou um MP4. Está concluído quando o HEAD final provar:

- paridade/determinismo;
- MP4 H.264/AAC válido;
- serial e Turbo estáveis;
- recovery/cancel;
- 90 s/15 min;
- memória bounded;
- pacote Windows sem FFmpeg global;
- hardware alvo;
- nenhum output parcial publicado;
- decisões experimentais documentadas por dados.
