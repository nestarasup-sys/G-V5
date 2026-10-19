# Entrega A — CI permanente, roadmap e Roupas Dev (2026-10-19)

## Objetivo e base

Entrega **documental e de CI** realizada na branch `master-desenvolvimento`, inicialmente no mesmo SHA da `master@3b70ceefc7f6cea5f32e87ccdf642bab0294bd94` após o [PR #3](https://github.com/nestarasup-sys/G-V5/pull/3). **Sem alteração do código de produção, schemas, perfis reais ou armazenamento nesta entrega.** O backup anterior à integração `backup/master-before-dev-ai-integration-2026-10-19` aponta para `5b848345`.

## Alterações propostas / implementadas

1. O workflow `.github/workflows/dev-ai-foundation.yml` escuta `push` de `master-desenvolvimento`, `master` e os prefixos históricos `ci/dev-ai-*` / `feat/dev-ai-*`; escuta `pull_request` com base nas duas branches principais; mantém `workflow_dispatch`.
2. Job Linux: `npm ci`, `npm test`, `typecheck`, **`npm run build` explícito**, inventário/gate AST e `audit:fast`. Windows: `npm ci`, `npm test`, `audit:all` com Electron/IPC real. Permissões somente leitura, arquivos de teste sintéticos, retenção de 7 dias, sem deploy.
3. `AGENTS.md` fixa `master-desenvolvimento` como branch de trabalho e proíbe merges na `master` sem autorização.
4. Roadmap e especificação de assets esclarecem a **UI única Roupas Dev** atual, que usa a folha original do modelo. Os formatos 1.0/2.0 permanecem legados legíveis; `edition: 2` pode ser convertido no rascunho, sem migrar em lote ou salvar sem ação do usuário.
5. Evidência manual do usuário registrada separadamente da evidência CI.

## Evidências obtidas antes da Entrega A

- Merge [PR #3](https://github.com/nestarasup-sys/G-V5/pull/3) concluído: `master` e `master-desenvolvimento` começaram em `3b70ceef`.
- [Run #39198498661](https://github.com/nestarasup-sys/G-V5/actions/runs/39198498661) da `master`: jobs Linux e Windows **success** em `3b70ceef`; não atesta resultado do SHA novo da Entrega A.
- O Fabricador atual tem uma única entrada `Roupas Dev` em `src/renderer/src/features/fabricator/FabricatorPage.tsx`; a documentação [Roupas Dev unificado](ROUPAS_DEV_UNIFICADO_2026-10-19.md) especifica a folha original e legados.
- O usuário confirmou localmente `codex/dev-ai-validation-2026-10-18@6cfd0b5` com Git sem alterações pendentes. **Relato manual:** equipou outra roupa, deslocou seu ajuste individual para fora do personagem, alternou poses e observou que **Studio e Video Studio acompanharam**. Não enviou screenshots, logs, hashes ou os assets pessoais. Não houve afirmação de save/restart nem importação de modelo e roupa novos pela UI.

## Aceites e limitações

- [x] `master-desenvolvimento` recebeu `79b2bfcd4d46ac02ed59985f91e2dfd40b667d30`; `master` permaneceu em `3b70ceefc7f6cea5f32e87ccdf642bab0294bd94`.
- [x] Evento **`push`** disparou automaticamente [GitHub Actions #39200662149](https://github.com/nestarasup-sys/G-V5/actions/runs/39200662149) para o SHA `79b2bfcd`.
- [x] Linux **success** (`npm test`, `typecheck`, `npm run build` explícito, AST/gate e `audit:fast`) e Windows **success** (`npm test`, `audit:all`, Electron/IPC real) no mesmo SHA `79b2bfcd`.
- [x] Verificação da árvore Git: nenhum caminho rastreado sob `app-data/`, `out/`, `node_modules/` ou `.env*`. Os artefatos publicados foram os sintéticos `dev-ai-unit-39200662149-1` e `dev-ai-windows-39200662149-1`; não há perfil privado envolvido.
- [x] Nenhuma falha encontrada nos dois jobs. A aprovação documentada é **específica de `79b2bfcd`** e deve ser repetida após qualquer commit, inclusive este registro documental.

**Não incluído:** mudança de comportamento de roupas/poses, migração de dados, proteção administrativa do GitHub Branch Rules, benchmarks ou fecho de matrizes AF-01..20 / ISO-01..15. Os 38 `R-xx` permanecem formalmente abertos até a evidência específica de cada um. O relato manual confirma um cenário, mas **não comprova** o fluxo inteiro Fabricador → Customizador → Studios, criação por UI, recuperação, assets legados ou save/restart.

## Continuação recomendada

**Entrega B:** automatizar no Electron real a UI Modelos → Poses → Roupas Dev unificado → Customizador com dados sintéticos, bindings por `partId`, duas poses, pré-ajustes, persistência e screenshots. **Entrega C:** confrontar o resultado nos três renderizadores, antes de remover imports de página inteira ou migrar dados.
