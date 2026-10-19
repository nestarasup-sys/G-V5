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
