# Inventário AST e contenção das dependências entre features

**Data:** 2026-10-18. **Origem verificável:** job Linux `Unit tests / architectural inventory` do [GitHub Actions #39175622079](https://github.com/nestarasup-sys/G-V5/actions/runs/39175622079), executado após implementar o parser TypeScript AST. Scanner: `scripts/dev-ai/boundary-ast.cjs`, política de dívida: `scripts/dev-ai/feature-boundary-debt.json`, gate: `scripts/dev-ai/feature-boundary-gate.cjs`. O scanner antigo de regex permanece como comparação informativa.

## Resultado executado

- **73 fontes varridas**, **222 arestas de imports**, **22 ocorrências runtime entre features**, **0 imports cross-feature exclusivamente type-only**, **0 imports relativos não resolvidos**.
- As 22 ocorrências representam **10 pares únicos** entre arquivo consumidor e arquivo fornecedor, com 22 posições de origem; várias funções importam dinamicamente `CustomizerPage.tsx` repetidas vezes.
- O gate **não autoriza essas dependências**: simplesmente impede que novas arestas ou mais ocorrências sejam introduzidas sem revisão, permitindo que a dívida diminua progressivamente.
- Um novo import runtime/type-only fora da baseline ou um aumento de ocorrências numa aresta existente falha `npm run audit:boundaries:gate`. O teste de regressão do gate inclui novo import, aumento, redução e política duplicada.
- A auditoria não encontra efeitos colaterais de imports computados nem determina se CSS, timer, worker ou evento de outra feature vaza em runtime. Não é uma prova de isolamento.

## Arestas confirmadas e classificação proposta

Todos os caminhos da tabela são relativos a `src/renderer/src/features/`. **Owner atual** é a feature destino; **owner desejado** indica a separação arquitetural proposta, não uma mudança já feita. A coluna `n` corresponde às ocorrências capturadas pelo AST.

| Origem | Dependência de destino | n | Classificação / decisão de migração |
| --- | --- | ---: | --- |
| `customizer/CustomizerPage.tsx` | `fabricator/usePreviewBackground.ts` | 1 | Hook privado cruzado; extrair contrato para serviço comum de prévia |
| `customizer/CustomizerPage.tsx` | `fabricator/DesignWorkspace.tsx` | 1 | UI de workspace privado usada por outra feature; criar contrato/componente reutilizável com owner explícito |
| `customizer/CustomizerPage.tsx` | `fabricator/wardrobe/poseTransform.ts` | 1 | Extrair transformação pura da pose para capability compartilhada |
| `customizer/CustomizerPage.tsx` | `fabricator/face/eyeInteriorMask.ts` | 1 | Extrair manipulação de imagem pura para biblioteca compartilhada com testes |
| `customizer/bodyShape.ts` | `fabricator/models/rig.ts` | 1 | Geometria corpo/rig cruzada; separar representação compartilhada de backend Fabricador |
| `fabricator/AnimatorWorkspace.tsx` | `customizer/bodyShape.ts` | 1 | Inversão de ownership de geometria; reutilizar interface shared após extração |
| `studio/StudioPage.tsx` | `customizer/CustomizerPage.tsx` | **6** | Import dinâmico de **página inteira** para obter renderização; extrair serviço de renderização de personagens, sem montar outra UI |
| `videoStudio/VideoStudioEditor.tsx` | `studio/expressionTransforms.ts` | 1 | Helper de expressão não deve pertencer exclusivamente ao Studio normal; mover função pura para shared |
| `videoStudio/VideoStudioEditor.tsx` | `customizer/CustomizerPage.tsx` | **8** | Oito imports dinâmicos de página; alto risco de side effects, acoplamento e duplicação; migrar para capability de render |
| `videoStudio/transitionRenderer.ts` | `customizer/CustomizerPage.tsx` | 1 | Utilitário de render não deveria depender do componente de página do Customizer |

**Total:** 22 ocorrências, 10 pares únicos. Nenhuma dessas dependências foi eliminada nesta rodada. Eliminação precisa de baseline visual, IPC, testes de expressão e renderização antes/depois, validação de regressão em todos os workspaces e rollback. Não mover tudo em bloco apenas para 'limpar' a contagem.

## Roadmap de extração sugerido

1. **Primeiro:** isolar funções de renderização reutilizadas do `CustomizerPage.tsx` (15 imports dinâmicos vindos de Studio/Video Studio/transitionRenderer) em serviço de render puro e testado. Antes, mapear exports, dependências React/DOM e lazy-loading. Garantir que nenhuma mudança afete faces, animação, roupas ou expressões.
2. Extrair `studio/expressionTransforms.ts` para `src/renderer/src/shared/` ou `src/shared/` conforme dependências DOM, mantendo imports antigos temporariamente como delegação explícita. Reexecutar `audit-expression-transforms`, Studio e Video Studio visual.
3. Separar helpers puros de corpo/rig/pose/máscara. Preservar coordenadas e formato de transformação com testes numéricos e imagens sintéticas.
4. Só depois migrar `DesignWorkspace`/hooks que dependem de React e contextos proprietários. Qualquer alteração em Customizer ou Fabricador exige smoke real de edição/persistência, ainda não implementado.
5. Registrar decréscimo de arestas no AST e reduzir entradas na baseline. O gate permite redução sem exigir mudanças de manifesto na mesma PR; entradas órfãs são reportadas para limpeza após confirmação.

## O que o gate protege e o que não protege

`npm run audit:boundaries:gate` é **um gate de prevenção de crescimento**, não um scanner completo de segurança. Ele usa caminhos, tipo de import e número de ocorrências para comparar com `feature-boundary-debt.json`. Alteração de nomes/pastas com novas arestas precisa migrar o manifesto conscientemente. A baseline registra todas as dependências como **dívida técnica**, nunca como autorização automática.

O gate não avalia uso de CSS global, RAF, listeners, atalhos, workers, rotas, imports de entrada para UI nem estado do `App.tsx`. Esses itens permanecem vinculados a R-02 e R-05 e exigem testes de comportamento reais.

## Evidência e rollback

- Executar `npm ci && npm test && npm run audit:boundaries:ast && npm run audit:boundaries:gate`.
- Comparar resultados com o output AST versionado implicitamente pela baseline e com o run de CI do mesmo SHA.
- Em caso de falha, investigar e remover a nova aresta ou aprovar explicitamente uma revisão de arquitetura, com ADR, owner, evidência e tests. **Não** elevar automaticamente `maxOccurrences`.
- Rollback do gate: revert dos arquivos de CI/catálogo, sem alterar dados de usuário; nenhuma migração de documentos ou biblioteca pessoal ocorreu.

**Aceite pendente:** documentação e classificação de CSS, eventos, timers, RAF, stores, persistência e topbar. R-02 só deve ser marcado completo quando todos esses aspectos tiverem owner e evidência de validação.
