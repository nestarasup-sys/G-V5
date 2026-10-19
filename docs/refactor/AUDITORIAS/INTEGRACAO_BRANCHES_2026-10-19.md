# Preparação de integração DEV AI → master (2026-10-19)

## Objetivo e política

Consolidar a infraestrutura DEV AI e o fluxo Fabricador Dev → Customizador → Studio / Video Studio **sem mesclar indiscriminadamente todas as branches históricas**.

- **`master` original:** `5b8483454757f4cc9606c626471aabbeccf35daa`.
- **Ponto de recuperação:** `backup/master-before-dev-ai-integration-2026-10-19`, referenciando exatamente o SHA acima.
- **Fonte escolhida para a candidata:** `codex/dev-ai-validation-2026-10-18`, commit `6cfd0b5f586207fda95e483f513dda752715d9d1`.
- **Branch candidata:** `feat/dev-ai-integracao-2026-10-19`.
- **Regra:** não fazer merge na `master` antes de CI no SHA candidato, inspeção de diferenças e aceite explícito do usuário. Não excluir branches antigas nesta etapa.

## Genealogia verificada via GitHub Compare API

- `master...codex/dev-ai-validation-2026-10-18`: **ahead 58 / behind 0**, 61 arquivos distintos comparados ao estado da `master`. Logo, a `master` atual é ancestral da candidata e a integração **não exige 9 merges sequenciais**.
- A linha `ci/dev-ai-foundation-hardening` → `feat/dev-ai-foundation-asset-flow` → `feat/dev-ai-raster-asset-flow` → `feat/dev-ai-raster-continuation` → `codex/finalizar-dev-ai-local` contém desenvolvimento incremental anterior.
- `codex/dev-ai-validation-2026-10-18` **divergiu no histórico** de `codex/finalizar-dev-ai-local`, porque houve transferência de código a uma pasta original, documentada em `AUDITORIAS/TRANSFERENCIA_PASTA_ORIGINAL_2026-10-19.md`. Não assumir ancestralidade linear entre as duas.
- Comparando os blobs de arquivos de `master` → `codex/finalizar-dev-ai-local`, dos **51 arquivos afetados** 42 têm o mesmo conteúdo na candidata e **9 diferem**. Essas diferenças requerem revisão de semântica/regressões, não restauração automática de versões antigas.

## Nove arquivos com versões diferentes: revisão direcionada

1. `electron/main.ts`
2. `scripts/audit-wardrobe-flow.mjs`
3. `scripts/dev-ai/asset-flow-raster-fixture.cjs`
4. `scripts/dev-ai/raster-geometry.cjs`
5. `scripts/dev-ai/studio-ipc-driver.cjs`
6. `src/renderer/src/features/customizer/CustomizerPage.tsx`
7. `src/renderer/src/features/fabricator/wardrobe/WardrobeWorkspace.tsx`
8. `src/renderer/src/features/fabricator/wardrobe/boneSelection.ts`
9. `tests/dev-ai-raster-fixture.test.cjs`

As mudanças recentes incluem ajustes por referencial do osso na troca de poses, proteção da cobertura dos joelhos, unificação de Roupas Dev e tentativa de paridade visual. Ver `AUDITORIAS/AF13_EQUIVALENCIA_2026-10-19.md` e `AUDITORIAS/ROUPAS_DEV_UNIFICADO_2026-10-19.md`. Os próprios relatórios ainda exigem conferência visual no aplicativo: **AF-13 não está fechado**.

## Gates de aceite da candidata

- [ ] `npm ci`, `npm test`, `npm run typecheck`, `npm run build` no SHA candidato.
- [ ] `npm run audit:all`, `npm run audit:boundaries:gate` e validação real Electron/IPC/visual no Windows.
- [ ] Testes de base/arquitetura no Linux (GitHub Actions).
- [ ] Revisar os nove arquivos de divergência e garantir que as mudanças incrementais úteis permanecem presentes.
- [ ] Testar Roupas Dev unificado, inclusão de roupas de versões anteriores, bindings, preview da folha de origem e transporte de transforms entre poses.
- [ ] Investigar cobertura dos joelhos e paridade do personagem entre Customizador, Studio e Video Studio, incluindo imagens canônicas e persistência.
- [ ] Verificar compatibilidade de dados anteriores, proteção de bibliotecas e rollback por referência.
- [ ] Verificar que não há dados pessoais, screenshots ou evidências privadas rastreadas.
- [ ] Obter autorização do usuário antes de efetivar o merge à `master`.

A execução remota deste SHA ainda não foi declarada aprovada quando este relatório foi escrito. O workflow atual usa gatilho `push` em `feat/dev-ai-*`, portanto a atualização desta branch candidata deve iniciar a auditoria; verificar o status real antes de considerar o gate verde.

## Estritamente fora de escopo neste estágio

Branches históricas antigas que não participam do desenvolvimento DEV AI atual **não serão fundidas nem excluídas**. Correções antigas não comprovadamente ausentes não devem ser reaplicadas. Backups e perfis reais de personagens ficam fora do Git e da CI.

## Resultado esperado

Um único Pull Request **rascunho** da candidata para `master`, com gates verificáveis e sem merge automático. Qualquer falha ou lacuna documentada vira correção específica na candidata, seguida de novo teste. A `master` continua imutável até aprovação.
