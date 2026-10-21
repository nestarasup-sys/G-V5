# G-V5 Avalonia — PLANO MESTRE DE EXECUÇÃO DO CODEX

**Tipo:** roteiro operacional normativo, sequencial, com testes, gates e estado retomável.  
**Especificação de origem:** `PLANO_DO_NOVO_APP.md`, na mesma pasta; ler ambos antes de codificar.  
**Repositório:** `nestarasup-sys/G-V5`. **Branch exclusiva:** `Master-AValonia`.  
**Nova raiz:** `master avalonia/` (espaço e minúsculas intencionais). **Tudo fora é legado de referência.**  
**Stack:** C# + .NET 10, Avalonia, SDK portátil local, launchers `.bat`, SQLite e SkiaSharp quando necessário. Visual Studio é opcional.  
**Ordem imutável das áreas:** **Fabricador → Customizador → Studio → Base de Vídeos → Roteiros → Video Studio por último.**

> O plano-fonte contém os requisitos e a visão arquitetural. Este documento determina **a execução**. Nunca substituir a visão por simplificações ou marcar algo pronto só porque compilou.

## 0. COMO O CODEX DEVE TRABALHAR — INSTRUÇÃO PERMANENTE

**Meta vigente:** paridade funcional completa, interface familiar e melhorada — não pixel-perfect. F06 liberada tecnicamente; F09.01–F09.06 validadas localmente; próxima tarefa F09.07. Não deixar controle do legado ausente nem marcar tarefas concluídas sem implementação, persistência e testes.

1. Antes de qualquer edição: confirmar `git branch --show-current` = `Master-AValonia`, ler `git status --short` e conferir HEAD local. Consultar o remoto somente após autorização explícita do usuário; reconciliar mudanças concorrentes sem sobrescrever trabalho. **Nunca dar force push nem apagar trabalho em andamento.**
2. Ler este arquivo, `PLANO_DO_NOVO_APP.md`, `README.md`, `global.json` e `EXECUTION_STATUS.md`. Se não houver status, criá-lo na tarefa F00.05.
3. Encontrar a **primeira tarefa PENDENTE** cuja predecessora foi VALIDADA. Executar exclusivamente ela. Pode subdividir a tarefa sem mudar seu objetivo. Não antecipar outras fases.
4. Antes de criar projeto/arquivo, verificar se já existe e funciona; a pasta já possui `GV5.sln`, projetos iniciais e `Preparar.bat`/`Desenvolver.bat`. Não destruir esse trabalho.
5. Para cada tarefa: identificar arquivos e contratos afetados → implementar comportamento real → testar positivo e negativo → compilar → registrar evidência → atualizar o status → commit coeso na branch → próxima tarefa.
6. Quando faltar Windows real, GPU ou dados privados, executar testes sintéticos primeiro e registrar a revisão local reproduzível. **Bloquear apenas se faltar comprovação funcional essencial**; aparência/captura ou folha pessoal pendentes podem ficar para G2/F12/aceite final (ADR-0006). Não falsificar gate.
7. Se falhar build, teste, schema, visual, salvamento ou arquitetura: consertar antes de avançar. Se houver impasse técnico, registrar comando, erro, causa provável, tentativa e condição de desbloqueio.
8. Se descobrir que a tarefa contradiz o contrato real, registrar `docs/decisions/ADR-XXXX.md` com motivo e alteração controlada do plano. Não improvisar mudanças silenciosas.
9. Todo fim de sessão: informar `último ID validado, próximo ID, commit, testes, limitações, bloqueios e evidências`. Não estimar porcentagens sem denominador verificável.

**Estados permitidos:** `PENDENTE`, `EM_EXECUCAO`, `BLOQUEADA`, `VALIDADA`. Uma tarefa nunca é VALIDADA por intenção, somente após evidência.

### Restrições absolutas

- **Não editar, mover ou excluir arquivos fora de `master avalonia/`.** Legado fora da pasta é somente leitura, mesmo dentro da branch. Não apagar o Electron até pedido explícito.
- **Nenhuma dependência runtime/build de algo fora da pasta**, inclusive assets/scripts/dados originais. Código novo compila num checkout isolado apenas com a pasta nova e dependências declaradas.
- Nunca ler/escrever **app-data pessoal** em testes ou CI; fixtures sintéticas e diretórios temporários. Importador legado futuro lê apenas cópias informadas.
- Não usar Electron, React, Node, Chromium, WebView, Avalonia Pro/MediaPlayer pago ou serviço online obrigatório.
- Core, Geometry, Characters, Scene, Rendering, Assets, Data e Jobs **não dependem de Avalonia**. Módulos não importam View/controle/ViewModel de outros módulos.
- UI não executa SQL, acesso pesado a disco, decode nem composição cara no thread gráfico. Não colocar regras de personagem na View.
- Não criar bibliotecas vazias para "cumprir estrutura"; cada projeto/contrato deve nascer com consumidor e teste reais.
- Não dizer "pronto" por screenshot estática, classe vazia, interface fake, método mockado ou smoke que não testa comportamento.
- Não trocar versões fixadas do SDK/NuGet sem ADR, compatibilidade verificada, build e testes.
- **Fidelidade visual pragmática (ADR-0006):** conservar aparência familiar do Gacha 5, **todos os botões e funcionalidades**, permitindo pequenas mudanças visuais. Captura/golden de UI é referência para acabamento, não bloqueio automático de gate técnico. Referência: somente Gacha 5 Electron, nunca Editor V4. Preservar 247 IDs.
- Não iniciar timeline/playback/export do Video Studio antes dos gates do Fabricador, Customizador, Studio, Base e Roteiros.

### Artefatos de acompanhamento (criar quando a tarefa pedir)

- `EXECUTION_STATUS.md`: única fonte de verdade de progresso, IDs validados, commits, ambiente, bloqueios, próxima tarefa.
- `docs/legacy-contracts/MATRIZ_PARIDADE.md`: funcionalidades do Electron classificadas como pendentes / em desenvolvimento / validadas / divergentes, com link de evidência. `docs/legacy-contracts/PENDENCIAS_FUNCIONAIS_FABRICADOR.md` rastreia recursos que o shell de F06 ainda não contém e devem existir antes de fechar G2.
- `docs/decisions/ADR-XXXX.md`: decisões de unidade, convenção, banco, renderer, backend, formato.
- `docs/gates/GATE-FXX.md`: testes, screenshots/goldens quando aplicável, SHA, métricas, cenários negativos e aceite humano/local.
- `tests/Fixtures` e projetos de testes: **dados sintéticos**, sem personagens/arquivos pessoais.
- `docs/performance/BASELINES.md`: ambiente, carga de teste, medições, deltas, não promessas.
- `docs/ui-fidelity/`: contrato visual, inventário, matriz de paridade, tokens, estratégia Avalonia e critérios de aceite por módulo.

**Modelo mínimo de status:**
```markdown
# EXECUTION STATUS
Branch: Master-AValonia
HEAD: atualizar via `EXECUTION_STATUS.md` antes da retomada
Fase: F05
Última tarefa validada: F04.11
Próxima tarefa: F05.01
Gate: F04 PASSOU; G1 global em execução até F05
Ambiente/SDK/CI: `TestarLocal.bat gate` passou em 2026-10-21; ver `docs/gates/GATE-F04.md`
| Tarefa | Estado | Commit | Evidência | Pendência |
| F00.01 | PENDENTE | — | — | — |
## Bloqueios reais
## Decisões/ADRs
## Retomada exata
```

**Comandos-base:** usar `tools/ambiente.bat` / SDK em `.tools/dotnet` conforme `Preparar.bat`; a partir da pasta nova: `dotnet --info`, `dotnet restore GV5.sln`, `dotnet build GV5.sln -c Release --no-restore` e, assim que houver projetos reais de teste, `dotnet test GV5.sln -c Release`. O launcher `Desenvolver.bat` inicia `GV5.App`. Registrar o comando que *realmente* funcionou. Respeitar aspas no caminho com espaços.

### Definition of Done (aplica-se a cada checkbox)
- Código **funciona** no cenário prometido, aceita erro e não perde dados.
- Tem teste com caso positivo e negativo relevante; regressões existentes continuam verdes.
- Se persistente: reabrir/restart e revisão íntegros; se visual: comparação com golden/oráculo.
- Para UI: garantir funções reais e aparência geral reconhecível, permitindo pequenas diferenças estéticas. Capturas e aceite Windows inexistentes ficam marcados como revisão visual pendente; isso não barra engenharia independente com gate técnico verde, nem autoriza declarar paridade exata.
- Sem bloqueio da UI, recursos sem descarte ou dependência proibida.
- Compilação e testes executados com resultado registrado; CI quando disponível.
- Matriz de paridade, decisão e status atualizados.
- Commit coeso na branch **sem sobrescrever trabalho paralelo**.

### Gates globais (gate técnico é requisito para avanço; revisão visual complementa G2/F12/G7 conforme ADR-0006)
- **G0:** solução reproduzível sem legado e build + teste sintético.
- **G1:** banco versionado, asset por ID, geometria e primeiro render determinístico.
- **G2:** Fabricador inteiro conforme inventário, revisões publicadas imutáveis, round-trip visual e dados.
- **G3:** Customizador usa o mesmo renderer, overrides privados e persistência.
- **G4:** Studio monta os mesmos personagens, salva/reabre sem divergência e não importa UI das áreas anteriores.
- **G5:** Base de Vídeos e Roteiros independentes, referências estáveis e gravação incremental.
- **G6:** Video Studio apenas após G4/G5, preview/export/áudio/timeline testados.
- **G7:** app distribuível, recuperação testada, dados seguros, legado removível mediante decisão humana.

---

## 1. FASES EXECUTÁVEIS EM ORDEM
## F00 — Auditoria do legado, baseline e sincronização

**Gate:** Build inicial conferido; inventário integral, matriz de paridade, primeira fixture e status. Não escrever no legado.

- [x] **F00.01** — Confirmar branch, HEAD remoto, working tree e existência da pasta nova; registrar o SHA e mudanças concorrentes.
- [x] **F00.02** — Inventariar GV5.sln, projetos, .bat, global.json, NuGet.Config, props e todos os arquivos C# existentes; não criar duplicações.
- [x] **F00.03** — Rodar preparação portátil/restore/build atuais, registrar exatamente resultados e erros; não declarar sucesso sem execução.
- [x] **F00.04** — Comparar PLANO_DO_NOVO_APP.md com estrutura real; documentar discrepâncias e o que o Codex já implementou.
- [x] **F00.05** — Criar EXECUTION_STATUS.md com tabela de IDs/estados, ambiente, último SHA e primeira pendência.
- [x] **F00.06** — Ler somente os contratos legados: src/shared/fabricator.ts, customizer.ts, studio.ts, roteiros.ts e assetFlow.ts.
- [x] **F00.07** — Inventariar Fabricador **completo**: modelos, rig, poses, animador, roupas, cabelos, rosto, componentes, expressões, chroma, persistência.
- [x] **F00.08** — Inventariar Customizador, Studio, Base de Vídeos, Roteiros, Opções e Video Studio com responsabilidades, entradas, saídas e dados.
- [x] **F00.09** — Criar docs/legacy-contracts/MATRIZ_PARIDADE.md com uma linha por funcionalidade e coluna prova, estado e lacuna.
- [x] **F00.10** — Documentar formatos versionados do Electron e mapeamento ID/atributos; apontar campos opcionais e comportamento legado desconhecido.
- [x] **F00.11** — Registrar ADR de coordenadas, eixos, rotação, pivô, composição de matriz, alpha, crop, zoom e espaço de cores.
- [x] **F00.12** — Definir fixture sintética mínima e cenário vertical Fabricador→Customizador→Studio, sem acesso a dados pessoais.
- [x] **F00.13** — Validar o shell existente e fechar relatório baseline em docs/gates/GATE-F00.md.

**Encerramento F00:** registrar `docs/gates/GATE-F00.md` e marcar a fase validada somente se o gate acima foi comprovado. Se estiver bloqueado, documentar a evidência que falta e não iniciar F01.

---

## F01 — Solution .NET, contratos, módulo e CI

**Gate:** G0. Shell abre, restore/build/test reproduzíveis, sem dependência do legado ou inversão de projetos.

- [x] **F01.01** — Fixar o SDK 10.0.402 do plano-fonte e confirmar Avalonia compatível com pacotes já instalados; documentar desvio se necessário.
- [x] **F01.02** — Testar Preparar.bat e script de instalação: download oficial com hash, idempotência, paths com espaços, falha explícita.
- [x] **F01.03** — Testar Desenvolver.bat com SDK local e saída de erro correta; garantir que launcher não faz parte do runtime final.
- [x] **F01.04** — Auditar centralização de pacotes NuGet, .gitignore e soluções; ignorar .tools/.packages/bin/obj sem ignorar código real.
- [x] **F01.05** — Definir ID tipado e Revision para Model/Pose/Wardrobe/Face/Hair/Character/Scene/Video/Roteiro, com testes.
- [x] **F01.06** — Definir Result/erros tipados, cancelamento e contratos pequenos de comandos/queries; teste de fluxo de erro.
- [x] **F01.07** — Implementar DI no composition root do App; proibir repositório construído diretamente em View.
- [x] **F01.08** — Implementar registro estático mínimo de Fabricador e Customizador no shell, incluindo rotas/Views/ViewModels reais.
- [x] **F01.09** — Definir theme/tokens visuais mínimos e padrão MVVM; não criar biblioteca de controles sem consumidor.
- [x] **F01.10** — Criar primeiro projeto de testes xUnit com versões fixadas, pelo menos um teste de Core e um cenário negativo.
- [x] **F01.11** — Criar teste de arquitetura que verifica referências de csproj: Core sem UI, módulos sem UI alheia, legado fora da solução.
- [x] **F01.12** — Criar GitHub Actions para build/test Windows, mais Linux se compatível, sem depender de arquivos fora da pasta.
- [x] **F01.13** — Validar clone limpo usando somente master avalonia e dependências declaradas; registrar GATE-F01.

**Encerramento F01:** registrar `docs/gates/GATE-F01.md` e marcar a fase validada somente se o gate acima foi comprovado. Se estiver bloqueado, documentar a evidência que falta e não iniciar F02.

---

## F02 — SQLite, revisões, transações e recuperação básica

**Gate:** Primeiro modelo persistido, reaberto, migration aplicada, conflitos detectados, falha sem perda de estado confirmado.

- [x] **F02.01** — Definir IAppDataPaths no perfil do usuário e separar database/assets/thumbnails/projects/backups/cache/logs/temp.
- [x] **F02.02** — Desenhar schema SQLite e ownership por domínio; usar tabelas relacionais principais e JSON só para atributos extensíveis.
- [x] **F02.03** — Implementar banco e conexão central com foreign keys, índices, WAL e política de escrita, sem SQL na UI.
- [x] **F02.04** — Implementar migrations numeradas/versionadas e teste de base vazia→versão atual→reabertura.
- [x] **F02.05** — Definir ModelDraft com ID/revision e repositório interface + implementação Data.
- [x] **F02.06** — Implementar create/update/get de draft e teste real de arquivo SQLite temporário.
- [x] **F02.07** — Implementar expectedRevision e teste de dois escritores com revisão divergente (Conflict).
- [x] **F02.08** — Implementar gravação de apenas deltas/entidades dirty, sem regravar arquivo completo por gesto.
- [x] **F02.09** — Expor estado Saved/Dirty/Saving/Error confirmado em UI e teste de falha de save.
- [x] **F02.10** — Implementar debounce de autosave e flush de fechamento sem sobrescrever versões recentes.
- [x] **F02.11** — Implementar checkpoint/journal de operação incompleta com recuperação do último estado consistente.
- [x] **F02.12** — Implementar backup consistente com WAL, manifesto/hashes e restore testado em cópia isolada.
- [x] **F02.13** — Implementar log estruturado mínimo/correlation ID com rotação e sem dados pessoais.
- [x] **F02.14** — Testar falta de espaço, acesso negado, schema futuro, interrupção e integrity_check em fixtures.
- [x] **F02.15** — Fechar GATE-F02 com comandos, schema e evidências de reopen/restore.

**Encerramento F02:** registrar `docs/gates/GATE-F02.md` e marcar a fase validada somente se o gate acima foi comprovado. Se estiver bloqueado, documentar a evidência que falta e não iniciar F03.

---

## F03 — AssetStore, thumbnails e cache limitado

**Gate:** Nenhum Base64 como identidade persistente; import/duplicação/recuperação e descarte de bitmap testados.

- [x] **F03.01** — Definir AssetId e contratos Import/OpenRead/GetMetadata/AddReference/ReleaseReference.
- [x] **F03.02** — Implementar importação por stream em staging, SHA-256, validação tipo/tamanho/dimensões.
- [x] **F03.03** — Publicar bytes em storage por hash com atomicidade possível e recovery quando DB/arquivo divergirem.
- [x] **F03.04** — Implementar deduplicação, referências persistentes e teste de asset único compartilhado.
- [x] **F03.05** — Implementar decode PNG/JPEG/WebP fora da UI com alpha/orientação válidos e erro tipado.
- [x] **F03.06** — Implementar cache de bitmaps LRU por orçamento de bytes com lease/ref e métricas; nunca liberar imagem em uso.
- [x] **F03.07** — Implementar ThumbnailService com recipe/hash/versão e cache em disco, geração assíncrona cancelável.
- [x] **F03.08** — Implementar query paginada e política de fetch só do visível, com prefetch limitado.
- [x] **F03.09** — Implementar lixeira/GC seguro para assets sem referências, com grace period e backup verificado.
- [x] **F03.10** — Testar cache pequeno, duplicados, arquivo corrompido, interrupção entre staging/commit, reabertura.
- [x] **F03.11** — Registrar métricas hit/miss/eviction e GATE-F03.

**Encerramento F03:** registrar `docs/gates/GATE-F03.md` e marcar a fase validada somente se o gate acima foi comprovado. Se estiver bloqueado, documentar a evidência que falta e não iniciar F04.

---

## F04 — Geometry Engine canônica

**Gate:** Geometria pura comprovada para rig, pivô, flip, transform inversa e roupa em pose.

- [x] **F04.01** — Implementar tipos puros Point/Rect/Matrix/Transform2D e validação NaN/Infinity.
- [x] **F04.02** — Formalizar espaços model/scene/view e conversões ida/volta em código + testes.
- [x] **F04.03** — Implementar ordem de transformações, rotação com pivô e escalas não uniformes.
- [x] **F04.04** — Implementar flip X/Y e rotação negativa/extrema preservando geometria.
- [x] **F04.05** — Implementar hierarquia pai/filho e matriz local/global com âncoras.
- [x] **F04.06** — Implementar joints, bones e propagação de movimento com ciclos rejeitados.
- [x] **F04.07** — Implementar hit testing em coordenadas transformadas, bounds/crop e z-order.
- [x] **F04.08** — Implementar snap/guides como lógica independente de UI/documento.
- [x] **F04.09** — Implementar matemática de WardrobeBinding e fixtures neutro/rotacionado/espelhado.
- [x] **F04.10** — Testar precisão, determinismo e reversão de transforms; comparar casos do legado.
- [x] **F04.11** — Benchmarkar sinteticamente 10/100/1000 peças e registrar GATE-F04.

**Encerramento F04:** registrar `docs/gates/GATE-F04.md` e marcar a fase validada somente se o gate acima foi comprovado. Se estiver bloqueado, documentar a evidência que falta e não iniciar F05.

---

## F05 — RenderScene e SkiaRenderer independentes

**Gate:** G1. PNG transparente determinístico, primeiro personagem sintético renderizado, sem lógica de composição na View.

- [x] **F05.01** — Definir RenderScene/RenderLayer imutáveis (AssetId, transform, crop, alpha, blend, flip e z-order).
- [x] **F05.02** — Implementar builder de cena de partes corporais seguindo layer order explícita.
- [x] **F05.03** — Adicionar SkiaSharp e SkiaRenderer raster CPU headless com descarte correto de superfícies.
- [x] **F05.04** — Renderizar uma peça PNG transparente em tamanho de fixture com golden aprovado.
- [x] **F05.05** — Renderizar múltiplas partes, crop/rotation/opacity/flip e gerar comparador visual de PNG.
- [x] **F05.06** — Criar adaptador de apresentação Avalonia sem resolver personagens ou decodificar assets em Render().
- [x] **F05.07** — Implementar overlays visuais de seleção/pivôs/grids separados do conteúdo persistido.
- [x] **F05.08** — Implementar versão de entrada e cancelamento para descartar resultado atrasado de preview.
- [x] **F05.09** — Implementar invalidação incremental por assinatura, somente depois de teste de equivalência com render completo.
- [x] **F05.10** — Medir primeira prévia, render quente/frio, bytes retidos e diferenças de alpha/cor.
- [x] **F05.11** — Registrar limites CPU/GPU e evitar GRContext independente prematuro; fechar GATE-F05.

**Encerramento F05:** registrar `docs/gates/GATE-F05.md` e marcar a fase validada somente se o gate acima foi comprovado. Se estiver bloqueado, documentar a evidência que falta e não iniciar F06.

---

## F06 — Fabricador I — modelos e peças

**Gate técnico:** Import→editar→undo→salvar→reabrir→publicar no pipeline real SQLite/AssetStore/render, com folha sintética representativa e testes negativos. **Aceite de produto complementar:** usar folha real do usuário no Windows e revisar aparência/saída; registrar pendências para G2/F12/entrega final.

- [x] **F06.01** — Definir modelo, slots/IDs, partes, ordem, sourceTransform e drafts versionados.
- [x] **F06.02** — Criar/renomear/duplicar/listar drafts com persistência real.
- [x] **F06.03** — Importar folha de imagem com prévia e validação antes de publicar asset.
- [x] **F06.04** — Portar chroma/crop mínimo com worker cancelável e testes de borda/transparência.
- [x] **F06.05** — Separar peças em assets e metadados com round-trip verificável.
- [x] **F06.06** — Mostrar modelo pelo FabricatorCanvas reutilizando RenderScene/SkiaRenderer.
- [x] **F06.07** — Implementar selecionar/hit test, zoom/pan, overlays e estado da ferramenta.
- [x] **F06.08** — Implementar mover, escalar e rotacionar peças por commands; sem alterar cada mousemove no banco.
- [x] **F06.09** — Implementar layer order, ocultar/exibir e operações de seleção.
- [x] **F06.10** — Implementar Undo/Redo coalescido: drag contínuo vira uma única ação.
- [x] **F06.11** — Implementar autosave e estado de save com conflitos de revisão.
- [x] **F06.12** — Implementar publicação imutável de modelo + testes de manutenção da revisão antiga.
- [x] **F06.13** — Testar import inválido, falta de asset, reopen, PNG e comparar com legado.
- [x] **F06.14** — Registrar GATE-F06 e matriz de paridade de modelos.

**Encerramento F06 — ADR-0006:** F06.01–F06.14 têm evidências registradas, e o último gate local anterior passou 198 testes com pipeline real e fixture sintética. **F07 LIBERADA TECNICAMENTE**; folha pessoal, comparação independente do worker, screenshots e validação Windows continuam pendentes para G2/F12/aceite final. Não confundir essas pendências com teste realizado; falhas funcionais essenciais seguem bloqueantes.

---

## F07 — Fabricador II — rig, poses e animador

**Gate:** Rig/pose/animação do Fabricador persistem, não alteram fontes, têm previsibilidade visual.

- [x] **F07.01** — Inventariar rig legado, joints, anchors, sourceTransforms e as regras de fixed joint. Evidência: docs/legacy-contracts/F07_RIG_DETALHADO.md; ver EXECUTION_STATUS.
- [x] **F07.02** — Implementar editor de criar/editar/remover joints, rejeitando ciclos e refs inválidas. Evidência local e persistência: `EXECUTION_STATUS.md`.
- [x] **F07.03** — Implementar mover hierarquia a partir do pivô e recalcular descendentes corretamente. Evidência de transforms, anchors, juntas fixas/livres e undo: `EXECUTION_STATUS.md`.
- [x] **F07.04** — Exibir guias/handles de junta e snap sem acoplar geometria ao controle. Evidência local e fluxo headless de snap/undo/persistência: `EXECUTION_STATUS.md`.
- [x] **F07.05** — Definir PoseDraft e poses publicadas referenciando revisão exata do modelo. Evidência de contrato e rejeição de dados inválidos: `EXECUTION_STATUS.md`.
- [x] **F07.06** — Implementar editor de pose (mover/rotacionar bone) e visualização pela engine. Sessão ligada ao ViewModel e canvas, testes SQLite/headless em `EXECUTION_STATUS.md`.
- [x] **F07.07** — Implementar salvar/carregar/duplicar/publicar pose e thumbnails lazily.
- [x] **F07.08** — Implementar Undo/Redo de rig/pose e persistência com revisão.
- [x] **F07.09** — Definir contrato mínimo de animação do Fabricador (frames, keys, easing e rig).
- [x] **F07.10** — Implementar animações básicas do Fabricador com editor e prévia sem Video Studio.
- [x] **F07.11** — Testar pose→animação→reopen e personagens sintéticos com braços/pivôs extremos.
- [x] **F07.12** — Fechar GATE-F07 e atualizar inventário de animações ainda pendentes.

**Encerramento F07:** registrar `docs/gates/GATE-F07.md` e marcar a fase validada somente se o gate acima foi comprovado. Se estiver bloqueado, documentar a evidência que falta e não iniciar F08.

---

## F08 — Fabricador III — roupas, binding e revisões

**Gate:** Roupas ajustadas permanecem conectadas ao corpo em todas as poses; publicação não muda consumidores silenciosamente.

- [x] **F08.01** — Inventariar categorias/edições de roupas, WardrobeBinding e ajustes do legado V1/V2.
- [x] **F08.02** — Definir WardrobeSet e WardrobeComponent com binding local ao osso e revisão.
- [x] **F08.03** — Implementar importação de recortes de roupa via AssetStore com transparência e preview.
- [x] **F08.04** — Implementar associação da peça ao bone e editor de offset/escala/rotação.
- [x] **F08.05** — Implementar propagação de transform de roupa para poses diferentes e espelhamento.
- [x] **F08.06** — Implementar camadas de roupa/itens sobre cabelo conforme regras explícitas.
- [x] **F08.07** — Implementar ajustes não destrutivos e undo/redo por componente.
- [x] **F08.08** — Implementar catálogo com thumbnails/consulta paginada por modelo/categoria.
- [x] **F08.09** — Implementar publicar revisão imutável e vincular dependências reversas.
- [x] **F08.10** — Implementar consulta quem usa roupa/modelo/pose e bloqueio de exclusão destrutiva.
- [x] **F08.11** — Criar goldens para manga, calça, saia, cabeça e pose rotacionada.
- [x] **F08.12** — Executar auditorias de wardrobe/pose e evidenciar divergências em GATE-F08.

**Encerramento F08:** registrar `docs/gates/GATE-F08.md` e marcar a fase validada somente se o gate acima foi comprovado. Se estiver bloqueado, documentar a evidência que falta e não iniciar F09.

---

## F09 — Fabricador IV — cabelos, face, expressões e completação

**Gate:** G2. Todos os fluxos reais do Fabricador revisados, persistentes e sem tela fake. **Obrigatório conferir e solucionar pendências funcionais de Modelos/Fabricador em docs/legacy-contracts/PENDENCIAS_FUNCIONAIS_FABRICADOR.md**; pequenas diferenças estéticas são permitidas conforme ADR-0006, funções/botões ausentes não.

- [x] **F09.01** — Inventariar cabelos: front/back/rear/ponytail/ahoge, paletas, masks e alterações.
- [x] **F09.02** — Implementar import/crop/chroma de cabelo com original preservado e worker.
- [x] **F09.03** — Implementar painel de camadas, ordenação, recoloração por roles e publicação.
- [x] **F09.04** — Inventariar face: sheets, peças, olhos/pupilas/brows/nose/mouth, detalhes, head extras.
- [x] **F09.05** — Implementar processador de folhas faciais e splitting/masks com goldens.
- [x] **F09.06** — Implementar catálogo de componentes faciais por modelo com transform independente.
- [ ] **F09.07** — Implementar montagem de rosto com esquerda/direita, linkedSides, nariz, boca aberta/fechada.
- [ ] **F09.08** — Implementar detalhes faciais e acessórios com z-order explícito.
- [ ] **F09.09** — Implementar efeitos (shadow, blush, mouth blush) e parâmetros testáveis.
- [ ] **F09.10** — Implementar coleção/presets de expressões e referência de transform/cor.
- [ ] **F09.11** — Implementar publicação/revisão de hair, face e expression e grafo de dependências.
- [ ] **F09.12** — Integrar cabelo/face/roupa/body ao builder único e comparar goldens completos.
- [ ] **F09.13** — Completar funcionalidades de animações que ficaram apontadas em F07, sem construir timeline de vídeo.
- [ ] **F09.14** — Testar salvar/reabrir/import inválido/cancelamento de cada subárea e fechar gaps de paridade.
- [ ] **F09.15** — Fechar GATE-F09/G2 com auditoria de **todas** as subáreas do Fabricador.

**Encerramento F09:** registrar `docs/gates/GATE-F09.md` e marcar a fase validada somente se o gate acima foi comprovado. Se estiver bloqueado, documentar a evidência que falta e não iniciar F10.

---

## F10 — Customizador completo e CharacterResolver

**Gate:** G3. Um personagem com roupas/pose/rosto/cabelo reaparece idêntico; alterações privadas não modificam Fabricador.

- [ ] **F10.01** — Inventariar schema completo do customizer.ts e overrides legados, proporções e limites.
- [ ] **F10.02** — Definir Character com IDs/revisões publicadas e modificadores privados, sem Base64.
- [ ] **F10.03** — Implementar CharacterResolver puro (model, pose, wardrobe, hair, face, expression, overrides).
- [ ] **F10.04** — Construir ResolvedCharacter→RenderScene com **o mesmo** renderer usado no Fabricador.
- [ ] **F10.05** — Implementar CRUD/catálogo paginado/duplicação/lixeira de personagens.
- [ ] **F10.06** — Implementar ViewModel e canvas do Customizador sem importar Views de Fabricador.
- [ ] **F10.07** — Implementar escolha de modelo/pose e proporções/body dimensions com validação.
- [ ] **F10.08** — Implementar overrides de partes, escala, rotação, visibilidade e layer order.
- [ ] **F10.09** — Implementar seleção de roupas e ajustes/cor privados por componente.
- [ ] **F10.10** — Implementar seleção/cor de cabelo por papel, parte e modelo.
- [ ] **F10.11** — Implementar face completa, nariz, boca, pupila, expressões, efeitos e linkedSides.
- [ ] **F10.12** — Implementar acessórios de cabeça e ordenação correta de camadas.
- [ ] **F10.13** — Implementar modifiers ordenados e edição não destrutiva (sem alterar revisões globais).
- [ ] **F10.14** — Implementar undo/redo, debounce/autosave, estado de conflito e reopen.
- [ ] **F10.15** — Implementar invalidação seletiva por dependência e comparar output com full render.
- [ ] **F10.16** — Implementar inspeção/atualização opt-in de revisão usada por personagem.
- [ ] **F10.17** — Testar dois personagens compartilhando asset sem duplicar bytes.
- [ ] **F10.18** — Testar que editar personagem não altera hashes/revisões do Fabricador.
- [ ] **F10.19** — Validar renderer, round-trip, goldens e GATE-F10/G3.

**Encerramento F10:** registrar `docs/gates/GATE-F10.md` e marcar a fase validada somente se o gate acima foi comprovado. Se estiver bloqueado, documentar a evidência que falta e não iniciar F11.

---

## F11 — Studio e Scene Engine

**Gate:** G4. Personagem idêntico ao Customizador dentro da cena e após restart, sem dependências de UI de outra área.

- [ ] **F11.01** — Inventariar documentos/camadas/elements/fala/pensamento/texto/overrides do Studio legado.
- [ ] **F11.02** — Definir SceneDocument + SceneElement com IDs, revisões, transform/z-order.
- [ ] **F11.03** — Implementar editor de cena e coordenadas próprias, zoom/pan sem alterar dados.
- [ ] **F11.04** — Implementar Background/Image/Object com AssetId na engine compartilhada.
- [ ] **F11.05** — Implementar inserir personagem do CharacterResolver sem importar UI de Customizador.
- [ ] **F11.06** — Implementar seleção/hit test/mover/escalar/rotacionar/flip/bloquear e ordenação.
- [ ] **F11.07** — Implementar elementos de fala, pensamento e texto como entidades próprias.
- [ ] **F11.08** — Implementar overrides de pose/face/expressão **locais** da cena.
- [ ] **F11.09** — Implementar estados faciais idle/blink/talk sem mudança indesejada de geometria.
- [ ] **F11.10** — Implementar import de backgrounds/objetos com CAS e miniaturas.
- [ ] **F11.11** — Implementar listagem, CRUD, duplicação e abertura de projetos de Studio.
- [ ] **F11.12** — Implementar undo/redo, autosave por elemento e alerta de save pendente.
- [ ] **F11.13** — Testar persistir/reabrir cena com goldens de personagem e balão.
- [ ] **F11.14** — Testar que nova revisão do Fabricador não muda cena com revisão fixada.
- [ ] **F11.15** — Testar proibição de referência à UI de Fabricador/Customizador e registrar GATE-F11/G4.

**Encerramento F11:** registrar `docs/gates/GATE-F11.md` e marcar a fase validada somente se o gate acima foi comprovado. Se estiver bloqueado, documentar a evidência que falta e não iniciar F12.

---

## F12 — Gate vertical obrigatório e confiabilidade

**Gate:** Fluxo Fabricador→Customizador→Studio aprovado no PC Windows. Só depois Base de Vídeos/Roteiros.

- [ ] **F12.01** — Criar fixture vertical sintética (modelo, rig, pose, roupa, cabelo, rosto, personagem, cena).
- [ ] **F12.02** — Executar criar/publicar no Fabricador→instanciar no Customizador→abrir no Studio.
- [ ] **F12.03** — Encerrar processo completamente e reabrir, comparando IDs/revisions e PNG.
- [ ] **F12.04** — Publicar revisão nova e verificar que dependentes antigos não mudam silenciosamente.
- [ ] **F12.05** — Simular falha entre staging/arquivo/transaction e provar recuperação.
- [ ] **F12.06** — Testar autosave sob drag rápido, fechamento, cancelamento e conflito de versões.
- [ ] **F12.07** — Executar backup e restore isolados do conjunto de banco/arquivos.
- [ ] **F12.08** — Medir latency de drag, memória/bitmap/cache e primeira prévia em cenário fixo.
- [ ] **F12.09** — Testar DPI 100/125/150/200%, teclado, mouse, troca de monitor e modo seguro se disponível.
- [ ] **F12.10** — Executar teste manual de Windows/GPU/asset autorizado com roteiro reproduzível.
- [ ] **F12.11** — Corrigir discrepâncias relevantes; registrar resultado e evidências em GATE-F12.
- [ ] **F12.12** — Bloquear avanço se somente CI passou sem a validação local exigida pelo gate.

**Encerramento F12:** registrar `docs/gates/GATE-F12.md` e marcar a fase validada somente se o gate acima foi comprovado. Se estiver bloqueado, documentar a evidência que falta e não iniciar F13.

---

## F13 — Base de Vídeos independente de Roteiros

**Gate:** Importar/catalogar/buscar/reabrir vídeo por ID; integridade de biblioteca e duplicatas comprovada.

- [ ] **F13.01** — Inventariar fluxo de Base de Vídeos legado e contratos de metadados.
- [ ] **F13.02** — Definir VideoId/VideoAsset com hash, localização, duração, FPS, codec, áudio, thumb e tags.
- [ ] **F13.03** — Implementar schema/repositório/paginação/busca sem dependência do Roteiros.
- [ ] **F13.04** — Implementar import staging, deduplicação e referências a original.
- [ ] **F13.05** — Implementar probing de mídia via adaptador/FFprobe controlado (não Video Studio).
- [ ] **F13.06** — Implementar thumbnails/categorias/tags/ordenação e metadata lazy.
- [ ] **F13.07** — Implementar UI virtualizada de catálogo, detalhes e import em lote.
- [ ] **F13.08** — Implementar relink por hash e detecção de arquivo ausente/corrompido.
- [ ] **F13.09** — Implementar remoção de referência versus deleção do asset compartilhado.
- [ ] **F13.10** — Testar import→reopen→busca→remover sem perder outros consumidores.
- [ ] **F13.11** — Stress de 5000 registros, vídeo inválido, arquivo duplicado, import cancelado.
- [ ] **F13.12** — Registrar GATE-F13 com evidência de biblioteca real.

**Encerramento F13:** registrar `docs/gates/GATE-F13.md` e marcar a fase validada somente se o gate acima foi comprovado. Se estiver bloqueado, documentar a evidência que falta e não iniciar F14.

---

## F14 — Roteiros, TikToks, reações e referências

**Gate:** G5. Documentos reabrem sem perda; digitar não regrava a biblioteca; VideoId persiste.

- [ ] **F14.01** — Inventariar estrutura de roteiro no legado: seções, TikToks, diálogo, reação, referências e export.
- [ ] **F14.02** — Definir RoteiroId/SectionId/BlockId/Revision e vínculos a CharacterId/VideoId.
- [ ] **F14.03** — Implementar schema/repositório com ownership próprio e migrations.
- [ ] **F14.04** — Implementar commands CRUD/mover/reordenar por bloco e revisão otimista.
- [ ] **F14.05** — Implementar salvar texto incremental com debounce e flush em fechamento.
- [ ] **F14.06** — Implementar listagem/busca/criar/duplicar/excluir/renomear roteiros.
- [ ] **F14.07** — Implementar editor real de seções e blocos de roteiro/TikTok/reação.
- [ ] **F14.08** — Implementar seleção de personagem por ID sem duplicar seu objeto.
- [ ] **F14.09** — Implementar seleção de vídeo por VideoId sem copiar o vídeo no roteiro.
- [ ] **F14.10** — Implementar import/export de formatos existentes com versão/validação e teste round-trip.
- [ ] **F14.11** — Implementar undo/redo de ações estruturais e texto com limite de memória.
- [ ] **F14.12** — Implementar tratamento de referências faltantes sem substituição silenciosa.
- [ ] **F14.13** — Testar remoção de vídeo referenciado e preservação do roteiro.
- [ ] **F14.14** — Testar edições rápidas/concorrentes, restart e falhas de save.
- [ ] **F14.15** — Stress de milhares de blocos, medindo tempo de digitar/query/save.
- [ ] **F14.16** — Fechar matriz de paridade e GATE-F14/G5.

**Encerramento F14:** registrar `docs/gates/GATE-F14.md` e marcar a fase validada somente se o gate acima foi comprovado. Se estiver bloqueado, documentar a evidência que falta e não iniciar F15.

---

## F15 — Endurecimento dos cinco módulos e recursos avançados

**Gate:** G4/G5 mantidos; app sólido para começar última área (Video Studio).

- [ ] **F15.01** — Revisar dependências, evitar classes gigantes e duplicação; quebrar acoplamentos com teste de arquitetura.
- [ ] **F15.02** — Consolidar DesignSystem e acessibilidade, DPI, atalhos, foco e estados de erro.
- [ ] **F15.03** — Implementar opções mínimas (tema/cache/data-root/preferências) separadas do domínio.
- [ ] **F15.04** — Implementar layouts/workspaces ajustáveis com restauração segura após primeiro fluxo vertical.
- [ ] **F15.05** — Implementar safe mode que ignora caches e última abertura falha sem corromper projeto.
- [ ] **F15.06** — Implementar inspetor read-only de integridade e reparo assistido por proposta revisável.
- [ ] **F15.07** — Especificar pacote portátil .gv5project com manifesto/hashes/closure; implementar export/import seguro.
- [ ] **F15.08** — Criar importador GV5.Legacy.Electron **isolado** sem dependência runtime do app e sem escrever em fontes.
- [ ] **F15.09** — Testar dry run, mapping de IDs, migração sintética e relatório de itens não migrados.
- [ ] **F15.10** — Criar painel de diagnósticos somente dev, com métricas e privacidade.
- [ ] **F15.11** — Benchmarkar 100 personagens, 1000 poses, 5000 assets e ciclos de abrir/fechar.
- [ ] **F15.12** — Revisar licenças Avalonia/NuGet/Skia/media e fixar notices de distribuição.
- [ ] **F15.13** — Documentar como adicionar módulo novo sem editar telas de outros módulos; provar com módulo de teste.
- [ ] **F15.14** — Executar smoke/navegação/restore/retensão de recursos e fechar GATE-F15.

**Encerramento F15:** registrar `docs/gates/GATE-F15.md` e marcar a fase validada somente se o gate acima foi comprovado. Se estiver bloqueado, documentar a evidência que falta e não iniciar F16.

---

## F16 — Video Studio — ÚLTIMA ÁREA

**Gate:** G6. Preview, timeline, áudio, export e persistência com fidelity. Só iniciar depois de F15 VALIDADA.

- [ ] **F16.01** — Inventariar timeline/track/clip/character/transition/audio/export do legado e matriz de paridade.
- [ ] **F16.02** — Definir modelos puros de Timeline e invariantes de timing, duração, fps e frames.
- [ ] **F16.03** — Implementar avaliação temporal de clips/keys que emite RenderScene sem UI.
- [ ] **F16.04** — Testar keyframes/transições, cortes e FPS distintos, incluindo limites de clip.
- [ ] **F16.05** — Definir IMediaPlayback/IFrameDecoder/IAudioClock/IExportPipeline sem dependência Avalonia Pro.
- [ ] **F16.06** — Fazer PoC documentado no Windows dos backends viáveis (Media Foundation/LibVLC/libmpv) com overlays, seek, consumo e licença.
- [ ] **F16.07** — Escolher um backend de playback por medição e documentar ADR, sem criar vários backends em produção.
- [ ] **F16.08** — Implementar frame decoding preciso, thumbnail temporal e waveform.
- [ ] **F16.09** — Implementar clock/áudio sincronizado, volume, seek e política de atraso.
- [ ] **F16.10** — Implementar TimelineControl virtualizado, move/trim/split, tracks e zoom.
- [ ] **F16.11** — Implementar tracks de vídeo, áudio, personagem, imagem, texto e efeitos.
- [ ] **F16.12** — Implementar estados/expressões/poses de personagem por keyframes sem reimplementar CharacterResolver.
- [ ] **F16.13** — Compor vídeo + personagens + balões/seleção/guides sem limitação de airspace.
- [ ] **F16.14** — Implementar preview cancelável, cache e scrubbing com medição real.
- [ ] **F16.15** — Implementar CRUD/round-trip do projeto Video Studio com refs e versões.
- [ ] **F16.16** — Implementar export job via backend/FFmpeg com cancelamento, progresso, erro e staging seguro.
- [ ] **F16.17** — Compartilhar avaliação de timeline/scene entre preview/export e comparar PNG dos frames.
- [ ] **F16.18** — Testar áudio presente/ausente, codec não suportado, mídia faltante e falha de encoder.
- [ ] **F16.19** — Testar edição/projeto grande/retomada depois de restart/export interrompido.
- [ ] **F16.20** — Executar soak/benchmarks com fixtures e validação real Windows GPU/áudio.
- [ ] **F16.21** — Conferir matriz de paridade e fechar GATE-F16/G6.

**Encerramento F16:** registrar `docs/gates/GATE-F16.md` e marcar a fase validada somente se o gate acima foi comprovado. Se estiver bloqueado, documentar a evidência que falta e não iniciar F17.

---

## F17 — Distribuição, segurança de dados e legado removível

**Gate:** G7. Versão Windows distribuível testada; apenas o usuário autoriza excluir o legado.

- [ ] **F17.01** — Auditar solução/launcher/runtime para dependências externas implícitas (legado, caminhos absolutos, PC).
- [ ] **F17.02** — Publicar executável Windows, especificando self-contained/framework-dependent e recursos necessários.
- [ ] **F17.03** — Testar máquina/perfil limpo, espaço no caminho, permissões e ausência de Visual Studio.
- [ ] **F17.04** — Versionar app/schema, updater/rollback planejado e regras de compatibilidade.
- [ ] **F17.05** — Testar backup/restore/recuperação do ambiente inteiro com hashes.
- [ ] **F17.06** — Rodar suíte integrada dos seis módulos com dados sintéticos e cenário real autorizado.
- [ ] **F17.07** — Medir cold start, memórias em ciclos, caches, falhas e estresse de dados.
- [ ] **F17.08** — Auditar licença e avisos de bibliotecas, FFmpeg, codecs e distribuição.
- [ ] **F17.09** — Criar relatório final de compatibilidade, falhas conhecidas, métricas, SHA e release notes.
- [ ] **F17.10** — Provar que **somente** master avalonia é suficiente para build e execução.
- [ ] **F17.11** — Registrar aceitação e **não** excluir legado sem nova autorização explícita.

**Encerramento F17:** registrar `docs/gates/GATE-F17.md` e marcar a fase validada somente se o gate acima foi comprovado. Se estiver bloqueado, documentar a evidência que falta e não iniciar F18.

---

## 2. MAPA DE DEPENDÊNCIAS E MARCOS

| Fases | Marco obrigatório | Próxima área liberada |
| --- | --- | --- |
| F00–F01 | G0: setup, contratos e CI | Plataforma |
| F02–F05 | G1: SQLite/assets/Geometry/Skia com fixtures | Fabricador |
| F06–F09 | G2: Fabricador completo e revisões imutáveis | Customizador |
| F10 | G3: personagem com overrides privados | Studio |
| F11–F12 | G4: fluxo vertical persistente e verificação Windows | Base de Vídeos |
| F13–F14 | G5: biblioteca separada e Roteiros íntegros | Endurecimento |
| F15 | cinco módulos maduros e teste arquitetural | Video Studio |
| F16 | G6: timeline, mídia, preview/export testados | Release |
| F17 | G7: distribuição, dados e paridade | Legado pode ser avaliado para exclusão |

**Escolha deliberada:** execução F00→F17 linear. Algumas bibliotecas são tecnicamente independentes, mas o agente **não** paraleliza fases para não criar integrações prematuras. Testes/fixes de uma fase podem exigir pequenas alterações de uma camada anterior, com regressões obrigatórias.

## 3. EVIDÊNCIA EXIGIDA POR TIPO DE TAREFA

| Tipo | Evidência mínima |
| --- | --- |
| Contrato / arquitetura | teste que falha sob dependência proibida, diff `.csproj`/ADR |
| Dados | schema + migration + create/update/reopen + falha/conflito |
| Asset | import por hash + dedup + bytes/alpha + recuperação |
| Geometria | fixture numérica com resultado esperado e caso extremo |
| Rendering | PNG golden, diff pixel/alpha/crop e cenário de input |
| UI | caso funcional guiado de criar/editar/reabrir; teste headless onde viável |
| Undo/redo | sequência ação→undo→redo com estado igual ao inicial/final |
| Jobs | cancelamento, limite de concorrência, resultado stale ignorado |
| Performance | carga, hardware, comandos, mediana/P95, memória, baseline |
| Importação | dry run, idempotência, mapeamento ID e original intacto |
| Gate | checklist de funcionalidades + evidência CI/Windows + riscos |

## 4. REGRAS PARA A PRÓXIMA SESSÃO

**Prompt mínimo para o Codex:**

> Trabalhe exclusivamente na branch Master-AValonia, dentro de `master avalonia/`. Leia primeiro `PLANO_DO_NOVO_APP.md`, `PLANO_MESTRE_EXECUCAO_CODEX.md` e `EXECUTION_STATUS.md`. Reconcile mudanças recentes de outro agente. Execute **a primeira tarefa pendente validável**, na ordem fixa. Não implemente Video Studio antes dos gates. Teste, registre evidência e status, commite sem sobrescrever trabalho paralelo e informe a próxima tarefa. Não faça perguntas se puder resolver pela especificação; nunca invente aprovação de testes ou dados privados.

**Fidelidade:** um resultado diferente do legado pode ser uma melhoria legítima, mas precisa ser descrito, deliberado e aprovado quando altera comportamento visível ou formato. A ausência de material real exige bloco de validação local, não teste artificial que declara paridade.

**Fim do plano.**
