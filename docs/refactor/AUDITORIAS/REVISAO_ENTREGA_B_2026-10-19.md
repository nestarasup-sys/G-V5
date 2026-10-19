# Revisão técnica da Entrega B — 2026-10-19

## Escopo e estado da árvore

- Checkout: `C:\TRABALHO 2\OUTROS\GACHA NYMI V5`.
- Branch: `master-desenvolvimento`.
- SHA auditado: `cde43a930754fa82f3aa368089d7162c5bae918f`.
- Atualização local: fast-forward de `origin/master-desenvolvimento`; sem alterações anteriores pendentes.
- Nenhum dado de personagem ou biblioteca real foi aberto ou alterado. As auditorias Electron usaram sandbox e fixtures sintéticas em `out/dev-ai/runs/`.
- Nenhum status AF/ISO foi marcado como concluído nesta revisão.

## O que os testes realmente percorrem

### Autoria de asset pela interface

`scripts/dev-ai/asset-ui-authoring.cjs` abre o app compilado e interage com Fabricador e Customizador no DOM React. A importação de modelo usa o botão real e o handler `fabricator:import-model`; apenas o seletor de arquivo nativo é interceptado para devolver o PNG sintético. O Worker de modelo, os Workers de roupa, os handlers de produção, o preload e o IPC principal continuam reais. Poses são criadas, giradas e salvas por botões; a folha de roupa usa `input[type=file]` + evento `change`; o personagem é criado pelo formulário e a camisa é equipada pelo catálogo.

O segundo processo Electron verifica persistência após reinício. Esse cenário comprova somente os passos sintéticos documentados em `ENTREGA_B_AUTORIA_UI_2026-10-19.md`; não cobre a matriz AF inteira.

### Fluxos programáticos e níveis de evidência

`scripts/dev-ai/studio-ipc-driver.cjs` também chama APIs `window.desktop.*` diretamente para semear documentos e ativos, variar pose, salvar e verificar namespaces. Nesses casos o IPC e o filesystem de sandbox são reais, mas as ações não são autoria pela interface. `scripts/audit-studio-isolation.cjs` usa janela Electron oculta com preload de fixture, não o IPC real. Portanto seus resultados são evidência de layout/isolamento visual limitado, não substituto de uma interação end-to-end.

Os PNGs do runner vêm de uma fixture raster sintética determinística; capturas/relatórios existem no disco dentro do `out/` ignorado. Captura em arquivo não equivale automaticamente a inspeção visual humana nem a igualdade canônica entre os três ambientes.

## Linha de base local

| Comando | Resultado |
| --- | --- |
| `npm test` | Passou: 26 aprovados, 0 falhas, 2 ignorados. Um caso não altera `out/` preexistente; outro foi ignorado porque o SO bloqueou a criação de symlink. |
| `npm run typecheck` | Passou. |
| `npm run build` | Passou; gerou main, preload, renderer e Workers em `out/`. |
| `npm run audit:boundaries:gate` | Passou: 22 arestas observadas, 10 legadas permitidas, nenhuma regressão nova. Isso não aprova arquiteturalmente o débito legado. |
| `npm run audit:all` | **Falhou** apenas em `studio-ipc-real`; as auditorias rápidas, transformações, cabelo, mídia, wardrobe e `studio-isolation` passaram. |

Relatório integral sintético do `audit:all`: `out/dev-ai/runs/2026-10-19T05-50-28-665Z-39e4901a-f1db-4de0-bc6c-87e3c9f03398/report.json`.

### Falha que bloqueia a conclusão

No raster do Customizador para a pose 2, o ator sintético A com ajustes individuais apresentou bounds das quatro camadas medidos iguais à pose 1, enquanto o oráculo esperava a pose 2; o ator B sem deltas passou. Exemplo: sapato A medido `362,1286,73x44`, esperado `345,1264,78x69`; cabelo frontal medido `491,82,145x88`, esperado `519,88,156x109`. A fase encerrou antes dos relatórios posteriores do IPC/AF-13.

Isso **não é ainda prova suficiente de bug de produção**: no código versionado, a mudança de `poseSlot` desse caso acontece por chamada direta de IPC enquanto a janela permanece aberta, não pelo controle de pose da interface. A UI pode conservar estado em memória que uma escrita externa pelo IPC não atualiza. O oráculo é útil porque recusou falsamente declarar equivalência; a causa precisa ser isolada repetindo a mudança exclusivamente pelo seletor de pose React e aguardando o recálculo de cada camada. Uma tentativa exploratória por UI gravou `poseSlot: 2` para A, mas seu predicado de espera expirou, portanto não foi promovida a evidência aprovada. As alterações exploratórias no driver foram revertidas.

O run completo não validou autoria integral e comparações entre Studio normal e Video Studio depois dessa falha. Os resultados de CI em SHA anterior não substituem uma execução aprovada neste SHA.

## Dependência de seletores e esperas

- O driver usa seletores CSS internos (`.model-primary-button`, `.wardrobe-component-row`, `.character-card`) e texto visível; renomear classes pode quebrar o teste sem alterar contrato acessível.
- Algumas operações usam polling por condição, o que é melhor que um atraso fixo isolado, mas várias expressões repetem `setTimeout(50–180ms)`.
- `asset-ui-authoring.cjs::shot` espera dois `requestAnimationFrame` e mais 250 ms fixos. Isso não demonstra que o compositor estabilizou. O driver já possui `captureSettled`, que compara capturas consecutivas; o caminho de autoria não usa esse mecanismo.
- Os oráculos de raster verificam limites de cores/máscaras com tolerâncias; não comparam toda a composição canônica e ordem de camadas entre todas as áreas.

## Proteção de dados e limites

As auditorias DEV AI normais limitam os resultados a `out/dev-ai/runs/<run-id>`, exigem marcador sintético, recusam symlinks e caminhos não canônicos, definem `userData`/`sessionData` temporários no processo main e usam nomes/IDs reservados para fixtures. O caso de raiz inválida verifica rejeição. Exclusões em `studio-ipc-driver.cjs` apontam para caminhos criados dentro desse sandbox. A validação testa APIs selecionadas, não observa globalmente todas as escritas do processo.

O relatório declara rede como `not-invoked-by-runner; NOT OS-level blocked`. Logo, não se deve afirmar isolamento de rede do sistema operacional. A execução atual também não valida perfis ou diretórios reais do usuário, nem autoriza um teste privado.

## Cobertura AF-01…AF-20

Nenhum requisito pode ser fechado integralmente por esta revisão. Evidência parcial atual:

- **AF-01/02/07:** autoria UI sintética de um modelo com dez recortes, duas poses e personagem novo; não cobre IDs embaralhados, vinte movimentos, todos os bindings ou restart do ciclo completo de alterações individuais.
- **AF-03/04/06:** compatibilidade legada possui auditoria lógica parcial; falta fluxo UI completo 1.0/2.0, fallback diagnosticado e migração reversível demonstrada.
- **AF-05:** o teste de autoria liga um sapato sintético à canela esquerda; não cobre sapato direito e a matriz de origens deformadas.
- **AF-08/09:** há dois atores sintéticos com um conjunto compartilhado e teste de geometria de duas poses; 100 alternâncias, edição integral por UI e reinício após ambas as alterações não foram comprovados.
- **AF-10/11/12:** fixtures incluem cabelo, rosto e acessórios; verificações de raster cobrem só subconjuntos e a geometria do ator A na pose 2 falhou. Proporções, camadas completas e variantes permanecem pendentes.
- **AF-13:** permanece aberto. Não houve aprovação do conjunto completo de capturas, geometria, camada, persistência e restart nos três ambientes neste SHA.
- **AF-14/15/16/17/18/19/20:** refresh/version pinning, crash recovery, erros visíveis de referência, lifecycle completo, legado de cenas, mídia/expressões em vídeo e pilhas de camadas em dois DPIs não têm a evidência integral exigida.

ISO também permanece parcial: isolamento visual usa preload fixture e o teste IPC usa sandbox real, mas a matriz ISO-01…15, operação de mídia e os cenários de lifecycle/permissões em toda a aplicação não foram concluídos.

## Prioridades e correções propostas

1. **P0 — tornar o teste de pose E2E válido.** Alterar pose somente pelo seletor React; confirmar via acessibilidade/estado persistido, `previewLoading` concluído e mudança de raster das quatro camadas. Falhar com diagnóstico individual da camada, pose esperada/observada e SHA. Não converter diferença em tolerância maior.
2. **P0 — investigar a divergência real depois da execução válida.** Se reproduzir pelo seletor da UI, traçar `selectedArtworkProject`/pose → bounds da peça → `wardrobeAdjustmentMatrix` e transform head-local → URL da camada; corrigir no pipeline compartilhado e adicionar regressão sintética por pose/actor. Preservar deltas por personagem e imutabilidade da biblioteca Fabricador.
3. **P1 — reduzir fragilidade de automação.** Preferir roles/nome acessível ou `data-testid` estável em controles críticos; centralizar locator e diagnóstico. Substituir screenshot com atraso fixo por `captureSettled` ou critério de estabilidade equivalente.
4. **P1 — declarar evidência por adapter.** Cada fase deve reportar explicitamente React UI, Worker real, preload real/fixture, IPC real/mocks, writes, capturas e lacunas. `pass` deve depender de artefato esperado; captura ausente/instável é `fail` ou `inconclusive`, nunca pass.
5. **P1 — completar AF progressivamente.** Priorizar casos completos de autoria, overrides por personagem, bindings direito/esquerdo e comparação entre três ambientes, incluindo restart, antes de expandir para toda a matriz. Manter todos AF/ISO abertos até seus próprios critérios do documento de fluxo.
6. **P2 — endurecer o runner sem contaminar dados.** Avaliar bloqueio de rede no nível do processo/ambiente suportado e instrumentação de writes externas; não anunciar essas garantias antes de testes negativos em Windows e Linux no mesmo SHA.

## Fechamento desta rodada

Arquivos de produto/teste não foram alterados nesta revisão. O único novo arquivo é este relatório. Árvore deve permanecer limpa após o commit documental local; nenhum push, PR, merge ou alteração na `master` foi feito. Próximo passo: corrigir o adapter E2E de pose no mesmo `master-desenvolvimento` e executar CI Windows/Linux no mesmo SHA antes de tratar qualquer divergência de raster como resolvida.

## Complemento — Prompt 2 local (2026-10-19)

O adapter E2E foi ampliado em `scripts/dev-ai/asset-ui-authoring.cjs`; a descrição e os limites atuais estão em [ENTREGA_B_AUTORIA_UI_2026-10-19.md](ENTREGA_B_AUTORIA_UI_2026-10-19.md). A verificação local `npm run audit:all` passou em `2026-10-19T06-30-58-800Z-73311523-403a-459a-ac32-6354deaf3a68`, incluindo a auditoria IPC real. A divergência anterior de pose no `audit:all` não se reproduziu neste run. Isso não substitui uma investigação da diferença entre captura programática e UI real de pose 2, nem fecha AF/ISO.

Correções encontradas por esta ampliação: classificação do Worker de modelos para distinguir antebraços e partes da perna; rejeição pré-escrita de formatos/bytes incompatíveis na importação do modelo; e novo teste UI de save/load de nove roupas, pose 1/2 e reinício. PNGs, relatórios e dados de execução permaneceram sintéticos dentro de `out/` ignorado. As métricas de cobertura seguem parciais: AF-01…AF-09 continuam abertos, sem golden visual cross-Studio, sem dados reais e sem aprovação CI Linux/Windows no mesmo SHA.
