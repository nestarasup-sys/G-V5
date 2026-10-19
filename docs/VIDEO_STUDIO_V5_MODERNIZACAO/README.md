# Video Studio V5 — Modernização Integral (2026-10-19)

Este diretório é o **plano estratégico independente** solicitado para modernizar TODO o Video Studio do G-V5 (edição, preview, personagens, vídeos, armazenamento e exportação). O plano antigo \`docs/AGENTE_EXPORT_V5/\` permanece como documentação **tática de exportação**, subordinada aqui em caso de divergência.

## Comece por este roteiro

1. **[00_PLANO_DIRETOR.md](./00_PLANO_DIRETOR.md)** — visão, arquitetura, P0-P6, decisões provisórias e metas.
2. **[01_ESTUDO_DE_MOTORES.md](./01_ESTUDO_DE_MOTORES.md)** — estudo profundo de FFmpeg, MLT, GES, libopenshot, PixiJS, WebCodecs/Mediabunny, Electron OSR/shared texture e concorrentes.
3. **[02_ARQUITETURA_CANONICA.md](./02_ARQUITETURA_CANONICA.md)** — RenderIR, Smart Scene Compiler, cache, transições, áudio, PTS, paridade e GPU.
4. **[03_MIGRACAO_E_DADOS.md](./03_MIGRACAO_E_DADOS.md)** — biblioteca de vídeo com cópias físicas por projeto, migração CAS/proxies, segurança, backup e recuperação.
5. **[04_LAB_E_GATES.md](./04_LAB_E_GATES.md)** — fixtures, experimentos A/B, qualidade, benchmarking e gates G0–G6.
6. **[05_DECISOES_ADR.md](./05_DECISOES_ADR.md)** — decisões, hipóteses reversíveis e critérios de adoção.
7. **[06_BACKLOG_DE_EXECUCAO.md](./06_BACKLOG_DE_EXECUCAO.md)** — 40 cartões executáveis V501–V540, com dependências.

## Estado factual e limites

**Já existe no código:** Video Studio v1 (React/Electron), timeline a 60 FPS, personagens com keyframes/transições, vídeos/áudio no preview, snapshot lógico parcial, frame raster sintético, writer BGRA, catálogo de exports e checkpoints de chunks.

**Ainda NÃO existe/foi comprovado:** MP4 serial de ponta a ponta no V5 com render real de personagens e mídia; paridade visual preview/export; FFmpeg redistribuído/sondado; API completa start/cancel/progress; Turbo 2×; CAS compartilhado seguro; PixiJS/MLT/GES/libopenshot integrados.

**Pesquisa realizada:** leitura estática dos dois repositórios no GitHub e documentação oficial de engines. **Nenhum teste runtime/GPU/FFmpeg/benchmark novo** foi executado nesta rodada. Nenhum dado real de usuário foi acessado. As alternativas de engines são candidatas, não decisões implementadas.

## Direção preferida (provisória)

- **Semântica única:** \`StudioDocument v1 → AssetManifest → RenderIR → RenderSurface → encoder\`.
- **Motor baseline:** compositor especializado no G-V5 e FFmpeg testado; PixiJS WebGL compete pela camada visual, MLT/libopenshot/GES competem por media/NLE se houver benefício.
- **Melhorias maiores:** preview 2D determinístico, cache por estado, mídia correta por PTS, controle de memória/GPU, Smart Export, serial robusto, Turbo com fallback e retenção segura de dados.
- **Não há promessa de velocidade em "x"** antes de medições; "Turbo 2×" denota até dois trabalhadores simultâneos.

## Governança

Escrita **somente** em \`nestarasup-sys/G-V5/master-desenvolvimento\`. Editor V4 \`oai/aggressive-export-v5\` é referência de leitura. Não usar mídia, personagens ou projetos privados em CI; não executar DEV AI e auditorias desativadas. Não tocar em master, pastas do usuário ou trabalhos concorrentes.

A implementação deve avançar em commits pequenos, com PR/merge apenas quando autorizado, gates sintéticos/Electron/PC alvo e rollback por feature flag. A documentação original e os fatos antigos ficam em [../AGENTE_EXPORT_V5/README.md](../AGENTE_EXPORT_V5/README.md) e [../AGENTE_EXPORT_V5/DIARIO.md](../AGENTE_EXPORT_V5/DIARIO.md).
