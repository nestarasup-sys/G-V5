# AGENTE_EXPORT_V5 — Índice de trabalho
Atualizado em 2026-10-19.

**Missão:** adaptar a engenharia do export do Editor V4 ao Video Studio nativo do G-V5, com export serial determinístico antes de Turbo 2×. Não copiar o renderizador V4 nem trocar o schema Studio V5.

**Leia nesta ordem:**
1. [PLANO_MESTRE.md](./PLANO_MESTRE.md) — decisões, fases, gates e fronteiras.
2. [AUDITORIA_CODIGO_2026-10-19.md](./AUDITORIA_CODIGO_2026-10-19.md) — evidências verificadas, hipóteses e lacunas prioritárias.
3. [CONTRATOS_ENGINE_E_TESTES.md](./CONTRATOS_ENGINE_E_TESTES.md) — API proposta, frame model, barreiras e matriz de testes.
4. [BACKLOG_EXECUTAVEL.md](./BACKLOG_EXECUTAVEL.md) — tarefas E01–E20 e ordem de entrega.
5. [DIARIO.md](./DIARIO.md) — apenas fatos realizados, SHA e resultados observados.

**Status:** componentes de fundação e testes sintéticos existem; export MP4 end-to-end, paridade visual real, IPC de execução e Turbo ainda **não** estão implementados. Exporte real só pode ser declarado após Electron/FFmpeg + probe + validação no PC alvo.

**Repositórios:** escrita exclusivamente em [G-V5/master-desenvolvimento](https://github.com/nestarasup-sys/G-V5/tree/master-desenvolvimento); referência somente leitura [EDITOR-V4/oai/aggressive-export-v5](https://github.com/nestarasup-sys/EDITOR-V4/tree/oai/aggressive-export-v5).

**Segurança:** fixtures 100% sintéticas; não ler projetos reais. Não invocar DEV AI, audits desativadas, nem sobrescrever trabalho concorrente. CI é evidência do SHA exato, não prova de export MP4 pronto.


## Plano estratégico posterior (2026-10-19)

**A missão evoluiu:** não se trata mais de apenas adaptar Turbo 2× do V4. A iniciativa é **modernizar integralmente o Video Studio V5**: preview, RenderIR, assets, áudio, vídeo, cache, dados, qualidade e exportação.

- [Novo plano diretor independente](../VIDEO_STUDIO_V5_MODERNIZACAO/00_PLANO_DIRETOR.md)
- [Estudo comparativo de motores open source](../VIDEO_STUDIO_V5_MODERNIZACAO/01_ESTUDO_DE_MOTORES.md)
- [Arquitetura de Smart Scene Compiler / RenderIR](../VIDEO_STUDIO_V5_MODERNIZACAO/02_ARQUITETURA_CANONICA.md)
- [Migração segura de dados e proxies](../VIDEO_STUDIO_V5_MODERNIZACAO/03_MIGRACAO_E_DADOS.md)
- [Laboratório de benchmarks e gates](../VIDEO_STUDIO_V5_MODERNIZACAO/04_LAB_E_GATES.md)
- [Registro de decisões ADR](../VIDEO_STUDIO_V5_MODERNIZACAO/05_DECISOES_ADR.md)
- [40 tarefas V501–V540](../VIDEO_STUDIO_V5_MODERNIZACAO/06_BACKLOG_DE_EXECUCAO.md)

Este diretório continua válido para o **subprojeto de export serial/Turbo**, subordinado ao plano novo em prioridades arquiteturais. Documentos anteriores refletem seu momento histórico; nenhum MP4 V5 novo foi implementado ou benchmarkado nesta investigação.


## Dois modos de export e reconstrução autorizada (diretriz posterior)

O escopo foi ampliado novamente: o usuário aprovou uma arquitetura expansível, inclusive substituição segura do Video Studio legado, e exigiu **dois modos de exportação**. Os critérios estão no [contrato de modos](../VIDEO_STUDIO_V5_MODERNIZACAO/07_MODOS_DE_EXPORTACAO.md), na [arquitetura modular](../VIDEO_STUDIO_V5_MODERNIZACAO/08_ARQUITETURA_EXTENSIVEL_E_RECONSTRUCAO.md) e na [missão autônoma Codex](../VIDEO_STUDIO_V5_MODERNIZACAO/09_MISSAO_CODEX_AUTONOMA.md). O modo sem animações mantém keys authored, vídeos e áudio. Continuam válidos Smart Scene Compiler, cache semântico, proxies, hardware auto, Smart Export e comparação de engines. O V4 é referência, não obrigação de portar códigos.
