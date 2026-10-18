# Handoff técnico ao Codex — validação real da Etapa A, IPC Electron e regressão Studios

**Versão:** 2026-10-18. **Objetivo:** delegar SOMENTE trabalho dependente de checkout completo, execução Electron no SO-alvo, profiling e verificação de IPC real. A revisão arquitetural, implementação do runner inicial, registro das auditorias e testes sintéticos foram realizados pelo autor desta branch. **Este arquivo é uma instrução pronta para o Codex; sua existência NÃO significa que Codex foi invocado ou que as tarefas foram executadas.**

**Repository:** `https://github.com/nestarasup-sys/G-V5`  
**Branch base da implementação:** `chore/dev-ai-baseline-2026-10-18` — identificar SHA exato por `git rev-parse HEAD` antes de começar.  
**Documentação normativa:** `docs/PLANO_ESTRUTURA_PROJETO_E_DADOS.md`; `docs/refactor/{README,INVENTARIO_E_EVIDENCIAS,ROADMAP_EXECUTAVEL,ISOLAMENTO_STUDIOS_E_DEV_AI,DADOS_E_RECUPERACAO,QUALIDADE_E_OPERACAO}.md`; `docs/refactor/AUDITORIAS/BASELINE_DEV_AI_2026-10-18.md`.  
**Incidente histórico obrigatório:** commit `e352f04`, regressão Video Studio → Studio normal.

## 0. Mandato e limites — Leia antes de executar

Você deve agir como engenheiro sênior responsável por uma validação de segurança e regressão real, não como executor cego de checklist. Não simplifique os testes para que fiquem verdes. Tenha autonomia para refatorar módulos de teste, criar fixtures, instalar ferramentas locais estritamente necessárias e corrigir defeitos de harness, mas não faça alteração em dados reais, não navegue automaticamente no perfil pessoal de `userData`, não execute exclusões/migrações de conteúdo do usuário e não conecte serviços externos para armazenar código, mídia, screenshots ou logs. Não faça push, merge, release, update da branch `master` ou publicação. Produza commits locais em uma branch sua, sem forçar ref. Se a plataforma não permitir execução local, registre `unsupported`/bloqueio e não invente evidência.

**Três classes de estado:** `CONFIRMADO EM EXECUÇÃO` (com comando, código de saída, ambiente, SHA, artefato), `OBSERVADO ESTATICAMENTE` (arquivo/linha sem executar) e `NÃO COMPROVADO` (hipótese/limitação). Nunca tratar código compilando como prova de isolamento, hash ou desempenho. Checklist só recebe `[x]` quando critério e evidências completos.

**Privacidade:** fixture de imagem/vídeo/áudio deve ser gerada localmente (padrões de cores e sinais sintéticos, sem imagens de pessoas, sem fotografias, sem nomes identificáveis), com seed controlada. O root de relatórios deve estar em `out/dev-ai/runs/<run-id>`; `out/` está no `.gitignore`. Não adicionar traces/capturas pessoais ao Git. Nunca configurar `npm audit` ou telemetria que envie inventários/arquivos privados sem consentimento explícito.

## 1. Primeiro diagnostique o ambiente e a branch

1. Faça `git status --short`, `git rev-parse HEAD`, `node --version`, `npm --version`, identifique OS, arquitetura, máquina de teste, GPU, display/headless, `ffmpeg`/codecs, disponível de disco/RAM; anote tudo no relatório local (dados técnicos não privados). Se há mudanças não commitadas, não faça `git reset --hard`/clean; isole seu próprio worktree ou pare.
2. Leia integralmente plano principal, roadmap, matriz ISO e relatório de baseline antes de editar. Inspecione `scripts/dev-ai/{baseline,catalog,boundary-scan}.cjs`, `tests/dev-ai-baseline.test.cjs`, `scripts/audit-studio-isolation.cjs`, `electron/{main,preload}.ts`, `src/shared/studio.ts`, `src/renderer/src/ui/{App.tsx,styles.css}` e os dois editores de Studio. Documente quais linhas são evidências e onde o código atual divergiu do snapshot anterior.
3. Confirme a instalação mínima e lockfile. Executar `npm ci` no checkout limpo e em ambiente de confiança é permitido, mas observe `postinstall` instalando Electron; anote rede e versões, use cache local quando possível e não edite `package-lock.json` por acidente. Não altere Electron/React/TypeScript só para esconder erro antes de identificar a causa.
4. Rode `npm test`, `npm run typecheck`, `npm run build`, `npm run audit:list`, `npm run audit:boundaries`, `npm run audit:fast`, `npm run audit:isolation`. Para cada comando, armazene código de saída, arquivo local de stderr/stdout redigido, duração, SHA, Node/Electron/Chromium e SO no relatório. Se uma etapa falhar: reduza a causa, corrija a menor mudança e reexecute as relacionadas, sem declarar verde se o erro foi apenas mascarado.
5. `audit:boundaries` é **informativo**. Classifique TODAS as arestas cross-feature conforme `R-02`: helper puro/contrato a extrair, UI privada indevidamente importada, violação de ownership, dependência apenas de tipo. Não force um lint estrito que falhe por legado antes de registrar allowlist com justificativa/owner e data. Evoluir para AST TypeScript somente quando matcher atual demonstrar falso negativo ou falso positivo.
6. Verifique o comportamento do shell e dos estilos após navegar Studio → Video Studio → Studio. O script atual usa preload sintético, e o resultado deve trazer `realIpcCovered:false`. **Não deixe esse teste ser rotulado como cobertura de persistência real.**

## 2. Trabalho principal que falta: harness de integração IPC real

**Problema:** `scripts/audit-studio-isolation.cjs` monta `BrowserWindow` oculta com `fixture-preload.cjs` gerado no sandbox, fornecendo `window.desktop.*` in-memory. Isso verifica layout, mas não valida handlers `ipcMain` de `electron/main.ts`, checagem de sender, diretórios efetivos ou corrupção/swap de namespace.

**Proposta preferida:**

- Criar **adapter Electron real** separado do teste visual mockado, e um mecanismo de injeção test-only da raiz de dados **antes** de registrar qualquer handler / executar `app.whenReady()`. Não confiar em argumento do renderer para escolher root; usar config validada em main e disponível apenas em processo de teste iniciado pelo runner. Ter `app.setPath('userData',sandbox)` e `sessionData` ANTES do boot, com marcador `.dev-ai-sandbox.json` e paths canônicos.
- Não importar `electron/main.ts` no mesmo processo Node normal sem considerar dependências de Electron, momento de preload/registrar protocolo e side effects. Investigue se é melhor extrair `createMainWindow`, `registerStudioWorkspace` e `DataRoot` para módulos injetáveis, sem alterar contrato de canal. Faça a menor extração para teste real.
- Implementar dois modos claramente separados: `fixture-preload` = visual/layout rápido; `production-preload` = IPC integral e filesystem sintético. O relatório `adapter` e `realIpcCovered` devem deixar inequívoco qual modo rodou.
- Criar fixture de duas bibliotecas com documentos **com mesmo ID UUID** para desafiar ownership e com IDs distintos para cenários comuns. Preparar PNG sintético de poucos pixels, personagem sintético e vídeo curto quando necessário. Calcular hash SHA-256 de cada namespace, antes/depois dos comandos. Depois de `studio:save`, verificar que `studios/Video Studio/` permaneceu byte a byte idêntico; e o contrário em `video-studio:save`. Simular deleção e restauração apenas dentro do sandbox.
- Invocar pelo renderer real: `window.desktop.listStudios/saveStudio/deleteStudio` e `listVideoStudios/saveVideoStudio/deleteVideoStudio` com documento válido do schema atual, e chamadas malformadas (ID inválido, campos `dataUrl` excessivos, documento sem schema, caracteres de traversal, arrays acima do limite). Checar rejeição e ausência de escrita fora do root, sem falsificar respostas. Em caso de dependências externas, relatar erro `unsupported`, nunca trocar por mock e chamar de integração.
- Registrar `requestId` caso já exista; se não, **não** inventar ID no relatório. Relatar duração wall clock de cada operação, path relativo, hash antes/depois, canais exercitados e exceções sanitizadas, sem path absoluto nem conteúdo de imagem/vídeo.
- Testar entrada em Video Studio, salvar roteiro, navegar para Studio normal, salvar cena, fechar a janela e reabrir usando **mesma raiz sintética**, conferir que a lista de cada namespace contém seu documento e nenhuma escrita atravessou. Uma segunda execução em root novo deve iniciar sem resíduos.
- Testar cancelamento durante `list/save` concorrentes, clique rápido de navegação e close antes do fim das Promises; medidas `before-quit` esperam filas. Não assumir atomicidade de manifests+assets: registrar falhas demonstradas e encaminhar para R-08.
- Adicionar teste que tente navegar frame não autorizado, abrir URL externa e passar argumento de arquivo fora de sandbox. Este é teste negativo de segurança, que não precisa modificar segurança de produção nesta etapa.

**Critérios de aceite:** pelo menos 10 mutações válidas em cada namespace, 0 writes fora do sandbox, todas chamadas rejeitadas que devem falhar de fato falhando, hashes do namespace não alvo inalterados, abertura após restart confirmada, script de execução reprodutível sem janela visível, e artefatos locais com SHA/versão/duração. Documentar limites não cobertos (filesystem link, Windows lock, codec, sessão Chromium).

## 3. Regressão de estado/CSS/atalhos/lifecycle

Construir ou expandir suites `ISO-01` a `ISO-15` do documento normativo, não uma série de snapshots de tela disfarçados de teste funcional.

- Estado: abrir cena do Studio, definir seleção, inspector e zoom; no vídeo alterar playhead, faixa, seleção e undo; voltar e verificar que os estados permitidos pela política de restore não vazam. O app pode desmontar ambos os editores; leia os efeitos e confirme se um restore é intencional por usuário. Não mexer na UX para acomodar teste antes de definir comportamento esperado.
- CSS: capturar computed styles de roots/inspector/canvas/timeline/topbar e screenshot em `1440x900` e outro viewport representativo; fixar DPR, fontes, animações e zoom; repetir 100 alternâncias e diferenciar variação esperada de vazamento. Incluir alteração controlada de regra `.video-studio-*` em fixture/test build e garantir que o Studio normal não muda; se mudar, mapear seletor causador com origem/linha/override.
- Keyboard: testar `Escape`, `Delete`, `Ctrl+Z`, `Space`, Tab e atalhos específicos, com foco em input e modal, e medir quantas vezes handlers do workspace ativo/inativo foram executados. Testar chamadas tardias após mudança de rota; não registrar handlers invasivos em global sem disposer.
- Lifecycle: instrumentar contadores de listeners, timers, RAF, ResizeObservers, workers, MediaElements, objectURLs. Capturar antes/depois de 100 navegações, verificar que volta ao baseline depois de GC/quiescência, observando ruído e não confundindo cache de Chromium com leak. Certificar que fechar vídeo pausa áudio e retira frame update quando o editor deixa de existir.
- Persitência: editar e salvar Studio normal e roteiro de vídeo com IPC real, comparar diretórios e reabrir. Não substituir checagem real por inspeção visual do texto 'Salvamento automático' da topbar; o texto atual é estático e precisa de ticket próprio.
- Áreas não alteradas: smoke de Customizer, Fabricador e Opções sempre que `App.tsx`, `styles.css`, preload ou `shared` mudarem. Acessibilidade de foco e estados de erro conta mesmo quando app 'aparenta funcionar'.
- Visual: screenshots com `show:false` são ocultas, mas não equivalem a `offscreen:true`. Se testar pintura offscreen real, reportar o backend e a comparação entre os dois modos. Em CI Linux, Xvfb/software rendering podem ser requisitos explícitos. Codec e GPU podem dar screenshot diferente; classificar `unsupported`, não passar o teste sem conteúdo visível.

**Critérios de aceite:** matriz de cobertura associando ISO-ID → arquivo teste → adapter → fixture → evidência → resultado → limitações, com no mínimo uma prova de falha se propositalmente se desliga o isolamento (mutant test controlado que depois deve ser restaurado).

## 4. Baseline de desempenho com números, não opinião

Construir fixtures pequenas/médias/grandes de Studio/Video/Customizer/Fabricador. Para cada fixture, usar somente mídia sintética local e definir resoluções, personagens, quantidade de elementos/clipes/frames e codecs; nunca importar mídia privada para runner. Coletar 20 execuções em mesmas condições por cenário, separando cold/warm starts:

1. Electron `process-start → primeiro paint interativo` e primeira rota utilizável.
2. Studio normal abrir → primeiro preview visível; arraste e inspector; save request → commit concluído.
3. Video Studio abrir, carregar biblioteca, seek de timeline em offsets fixos, playback 10s, frame-to-paint e consumo de recursos após pause.
4. Navegação Studio ↔ Vídeo 100 vezes e idle 5 min; RSS pico/mediana, heap, handles e presença de workers/RAF/timers não liberados.
5. Importação de 1/10/100 imagens e vídeos curtos de fixture; bytes/s, CPU e memória; testar close/cancelamento seguro.
6. Inspecionar tamanho do bundle por entrada e oportunidades de lazy/chunks; não otimizar apenas por contagem de bytes.

Reportar `p50`, `p95`, `N`, unidades, CPU, RAM, SO, GPU, Electron/Chromium, flags, SHA, IDs/hashes de fixture, viewport e fonte. Não comparar Linux/headless software com Windows GPU como se fosse regressão. **Não alterar arquitetura ou stack** para suposto ganho sem benchmark reproduzível.

## 5. Garantias do runner e revisão de segurança do próprio harness

- Runner atual sanitiza HOME/APPDATA do child, usa allowlist de suites, limita stdout/stderr e usa timeout. Isso **não bloqueia rede em nível de SO**, nem garante kill de árvore de processos no Windows. Descubra suporte a Job Objects/process tree local e policy de firewall/container; se não suportado, documentar `unsupported` com risco.
- `audit-studio-isolation.cjs` usa `fixture-preload.cjs` no diretório do run. Verificar seu marker, paths relativos, perms, symlinks, crash, falha de out/readonly, perfil `userData`/sessionData antes de `ready`, e ausência de arquivos reais tocados. Testar um symlink que aponta `out/` a diretório arbitrário; runner deve rejeitar.
- Não apagar `out/` inteiro, `app-data/` ou um perfil de usuário para 'limpar testes'. Cleanup só remove diretório cujo marker foi criado pelo próprio runner e cuja canonicalização permanece sob diretório de runs. Se limpeza falhar, logar sem apagar outras pastas.
- Garantir falsos verdes impossíveis: arquivo de fixture faltando => `unsupported` ou `failed`; captura falhou => `inconclusive`; exception => `failed`; timeout => `failed`; build falhou => suite IPC marcada `skipped` e execução global `failed`.
- Criar teste negativo de redaction usando tokens fake, paths pessoais fictícios e data URLs fake; todos devem ser excluídos de stdout/report. No relatório, não registrar IDs de usuário, nome de arquivo privado, mídia ou payload IPC.
- Auditorias legadas podem ter caminhos `out/audit-*` fixos; migrar gradualmente para root por run com marker, não habilitar todas cegamente. `audit-animator-rig.mjs` **lê APPDATA real por default** e só entra em suíte automática depois de exigir fixture e root canônico, sem comportamento legado perigoso.
- Não instalar ferramentas por moda. Para Playwright/Vitest/axe/core/snapshot analyzer/FFmpeg exigir comparação de funcionalidade, manutenção, licenças, vulnerabilidades, tamanho, permissões e compatibilidade Node/Electron. Registrar versões no lockfile e razão da adoção.

## 6. Entregáveis, documentação, testes e commits

Deixar na sua branch **todos** os itens que de fato executar:

- Código de adapter IPC real e testes automatizados, sem qualquer dependência de perfil real.
- Fixtures sintéticas versionáveis **somente se pequenas e não privadas**; mídias grandes geradas em runtime. Scripts de geração com checksum e seed.
- `npm test`, `npm run typecheck`, `npm run build` verdes, ou erro investigado e evidência reproduzível; não trocar um teste falho por `skip` sem motivo e severidade.
- Relatórios de impacto e cobertura com cada caso ISO, links para artifacts em `out` (não commit), env e SHA.
- Screenshot/diff de Studio normal antes/depois de vídeo, pelo menos uma em modo fixture e outra em IPC real se suportado.
- Relatórios `metrics.json`, `report.json` e leitura por humanos, com estado `pass/fail/inconclusive/unsupported` claro.
- Nota ADR ou revisão de decisões se uma mudança de ferramenta, stack ou arquitetura for comprovadamente melhor. Não aprovar troca de runtime por si.
- Atualizações pontuais no `docs/refactor/ROADMAP_EXECUTAVEL.md`: cada `[x]` com link para prova. Não modificar o histórico inicial para reclassificar hipóteses como fatos.
- Um commit por grupo de mudanças coerentes, com descrição e testes; registrar `git diff --stat`, `git status` e `git log -n 5`. NÃO realizar push/merge/release. No resumo, diferenciar trabalho do Codex de trabalho pré-existente da branch.

## 7. Bloqueios e decisão de parada

Pare sem mudar dados reais se não puder provar root de sandbox; se o caminho de perfil apontar para usuário real; se um teste exigir upload externo; se não houver permissões; se a ferramenta tentar baixar mídia privada; se Node/Electron incompatível; se o runner escrever em `APPDATA` real; se for necessário migrar esquema/arquivo pessoal; se uma mudança deixar o Studio normal diferente antes de entender a causa. Registre a causa e proponha alternativa **sem executar ação destrutiva**.

Ao finalizar, entregar um resumo detalhado em português com: (1) inventário atual e SHA; (2) arquivos modificados; (3) comandos com exit code e outputs redigidos; (4) bugs concretos e correções; (5) ISO matrix executada e capturas; (6) métricas p50/p95/RSS; (7) segurança e dados; (8) pontos abertos; (9) rollback; (10) próximos PRs. **Não declarar a Etapa A concluída** sem executar a validação do produto real.
