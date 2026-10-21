# EXECUTION STATUS — G-V5 AVALONIA

> **Registro de execução verificável.** Este documento controla o avanço do `PLANO_MESTRE_EXECUCAO_CODEX.md`; não substitui seus requisitos, tarefas ou gates.
>
> Os projetos C# iniciais já existem no repositório, mas a criação deste arquivo **não valida** build, testes, funcionalidades nem tarefas. Tudo começa como **PENDENTE até prova**.

## 1. Estado atual

| Campo | Valor |
| --- | --- |
| Data de criação do controle | 2026-10-20 |
| Repositório | `nestarasup-sys/G-V5` |
| Branch obrigatória | `Master-AValonia` |
| Pasta exclusiva do novo aplicativo | `master avalonia/` |
| Commit-base inspecionado antes deste arquivo | `53b7f7a97321e85063a8dd4f9635e48d36548323` |
| Último commit de implementação validado | `58a3c18` (evidência Headless de F01.09; implementação de tokens em `324d1fa`) |
| Fase ativa | **F01 — Solution .NET, contratos, módulo e CI** |
| Última tarefa VALIDADA | **F01.09** — tokens visuais e convenções MVVM |
| Próxima tarefa PENDENTE | **F01.10** — primeiro projeto de testes xUnit com Core e cenário negativo |
| Gate atual | **GATE F00: PASSOU** |
| Progresso validado neste controle | **22 / 247 tarefas (8,9%)** |
| Tarefas em execução | **Nenhuma** |
| Bloqueios conhecidos | **Nenhum confirmado** |
| Aceite Windows/GPU | **Não executado / não registrado** |

**Importante:** 22/247 representa **tarefas com evidência de validação registrada neste documento**, não a porcentagem de código já implementado. O shell, a solution, os projetos-base e os scripts de preparação podem estar presentes. O Codex deve auditar o que existe antes de implementar.

## 2. Fontes e regras de leitura

1. `AGENTS.md` — limites permanentes do Codex, proteção de legado e execução sequencial.
2. `PLANO_DO_NOVO_APP.md` — requisitos e arquitetura-fonte.
3. `PLANO_MESTRE_EXECUCAO_CODEX.md` — **247 tarefas**, IDs e gates obrigatórios.
4. **Este arquivo** — histórico de execução e retomada, atualizado após verificações.

Sempre conferir a branch e mudanças locais antes de agir. **Não modificar nada fora de `master avalonia/`.** Consultar código Electron somente em leitura. Não editar arquivos pessoais, dados antigos ou referências que não pertencem ao novo produto.

Se o Codex encontrar algo já implementado, **validar e registrar evidências**, em vez de reimplementar ou marcar como concluído por suposição. Se encontrar código alterado por outra sessão, reconciliar sem sobrescrever.

## 3. Resumo por fase (inicialmente não validado)

| Fase | Objetivo | Tarefas totais | Validadas | Estado | Gate |
| --- | --- | ---: | ---: | --- | --- |
| F00 | Auditoria do legado, baseline e sincronização | 13 | 13 | VALIDADA | PASSOU |
| F01 | Solution .NET, contratos, módulo e CI | 13 | 9 | EM_EXECUCAO | — |
| F02 | SQLite, revisões, transações e recuperação básica | 15 | 0 | PENDENTE | — |
| F03 | AssetStore, thumbnails e cache limitado | 11 | 0 | PENDENTE | — |
| F04 | Geometry Engine canônica | 11 | 0 | PENDENTE | — |
| F05 | RenderScene e SkiaRenderer independentes | 11 | 0 | PENDENTE | — |
| F06 | Fabricador I — modelos e peças | 14 | 0 | PENDENTE | — |
| F07 | Fabricador II — rig, poses e animador | 12 | 0 | PENDENTE | — |
| F08 | Fabricador III — roupas, binding e revisões | 12 | 0 | PENDENTE | — |
| F09 | Fabricador IV — cabelos, face, expressões e completação | 15 | 0 | PENDENTE | — |
| F10 | Customizador completo e CharacterResolver | 19 | 0 | PENDENTE | — |
| F11 | Studio e Scene Engine | 15 | 0 | PENDENTE | — |
| F12 | Gate vertical obrigatório e confiabilidade | 12 | 0 | PENDENTE | — |
| F13 | Base de Vídeos independente de Roteiros | 12 | 0 | PENDENTE | — |
| F14 | Roteiros, TikToks, reações e referências | 16 | 0 | PENDENTE | — |
| F15 | Endurecimento dos cinco módulos e recursos avançados | 14 | 0 | PENDENTE | — |
| F16 | Video Studio — ÚLTIMA ÁREA | 21 | 0 | PENDENTE | — |
| F17 | Distribuição, segurança de dados e legado removível | 11 | 0 | PENDENTE | — |

**Total: 247 tarefas, 18 fases.** Os nomes, IDs, descrições e critérios exatos ficam no Plano Mestre. Não duplicar aqui 247 descrições e correr o risco de desatualizar duas fontes de verdade.

## 4. Registro de tarefas — somente evidências reais

Adicionar uma linha ao concluir ou bloquear cada tarefa. A linha inicial abaixo apenas indica por onde começar; não confirma execução.

| ID | Estado | Commit de entrega | Verificação realizada e resultado | Evidências/arquivos | Observações |
| --- | --- | --- | --- | --- | --- |
| **F00.01** | **VALIDADA** | `a8637b0` | `git branch --show-current` = `Master-AValonia`; árvore limpa antes da tarefa; `HEAD` = `09a93fb75de0472c7d013822df073100b59c3493`; `git fetch origin` e `origin/Master-AValonia` iguais; divergência `0 0`; pasta `master avalonia` existe | comandos registrados no histórico da sessão | Sem mudanças concorrentes detectadas |
| **F00.02** | **VALIDADA** | `481da4f` | Solution lista 12 projetos. `git ls-files`/`rg --files` encontraram 6 arquivos C# de produto, todos no shell, 12 `.csproj`, 2 launchers `.bat`, 1 helper `.ps1`, `global.json`, `NuGet.Config`, props centralizados e `.gitignore`. Nenhum arquivo C# nos 11 projetos-library; são shells vazios no estado atual. | `dotnet sln GV5.sln list`; `rg --files`; `git ls-files`; inspeção de `*.bat`, `*.ps1`, JSON, NuGet.Config e props | A lacuna com a regra de não manter bibliotecas vazias foi documentada em F00.04 |
| **F00.03** | **VALIDADA** | `068ea6f` | `cmd /c Preparar.bat` exit 0; reportou SDK `10.0.402` e ambiente pronto. `.tools/dotnet/dotnet.exe --info` confirmou Windows x64, SDK 10.0.402. `dotnet restore GV5.sln` teve todos os projetos atualizados. `dotnet build GV5.sln -c Release --no-restore --verbosity minimal` passou com 0 warnings/0 errors. Nenhum projeto de testes está na solução; portanto não foi executado `dotnet test`. | saída dos comandos nesta sessão; assemblies Release em `src/*/bin/Release/net10.0` (ignorados pelo Git) | Shell foi compilado, não iniciado nem verificado visualmente nesta tarefa |
| **F00.04** | **VALIDADA** | `bf36210` | Plano arquitetural comparado à estrutura rastreada. Confirmados: shell Avalonia/MVVM com navegação conceitual; oito arquivos de código/interface em `GV5.App`; 11 projetos library sem fontes; ausência de engine, SQLite, renderer, jobs, testes e módulos futuros. Discrepâncias e trabalho inicial existente registrados. | `docs/architecture/BASELINE_IMPLEMENTATION.md`; `GV5.sln`; `src/*`; `README.md`; `global.json`; `Directory.Packages.props` | Build do shell não prova runtime visual nem função de produto; não executar nem alterar legado |
| **F00.05** | **VALIDADA** | `b7c70d1` | O `EXECUTION_STATUS.md` preexistente foi conferido e atualizado: branch, HEAD do checkpoint, última tarefa validada, primeira pendência, contadores de fase, commits F00.01–F00.04, ambiente/SDK, comandos de preparação/restore/build e limites de validação. | Este arquivo; comparado com `PLANO_MESTRE_EXECUCAO_CODEX.md` e saída atual de `git status`, `git branch` e `git rev-parse` | Controle já existia na branch; correções registradas sem recriar nem apagar histórico |
| **F00.06** | **VALIDADA** | `2f80e29` | Leitura somente dos cinco contratos legados indicados no Plano Mestre: tipos e fronteiras para Fabricador; Customizer e overrides por personagem; Studio e Video Studio; Roteiros e Base de Vídeos; validação de fluxo de assets/roupas. | Legado `src/shared/fabricator.ts`, `customizer.ts`, `studio.ts`, `roteiros.ts`, `assetFlow.ts` (somente leitura) | Contratos TypeScript não provam que cada operação IPC é implementada corretamente; implementação será inventariada nas tarefas seguintes |
| **F00.07** | **VALIDADA** | `47e5929` | Inventário cobre modelos/peças e rig; chroma e histórico; poses e seleção para export; animadores corporal/facial; roupas e binding; rosto/olhos/expressões; cabelos e extras; além da persistência JSON+assets e fronteiras IPC. | `docs/legacy-contracts/FABRICADOR_INVENTARIO.md`; fontes legadas citadas no próprio inventário, todas consultadas somente para leitura | Nenhum arquivo de `app-data/` ou mídia pessoal foi aberto; capacidades descritas a partir do código, não de smoke visual/runtime |
| **F00.08** | **VALIDADA** | `44ed8c0` | Inspeção estática documentou entradas, saídas, responsabilidades, persistência e limites para Customizador, Studio, Base de Vídeos, Roteiros, Video Studio e Opções. `git diff --check` passou. | `docs/legacy-contracts/OUTRAS_AREAS_INVENTARIO.md`; contratos `src/shared/*`; páginas React e handlers/serviços Electron consultados somente para leitura | Não houve execução de UI, migração ou restauração nesta tarefa; nenhum dado pessoal foi aberto |
| **F00.09** | **VALIDADA** | `85e39d6` | Matriz com 47 linhas funcionais; cada linha tem evidência do legado, estado do novo app e lacuna/critério de evidência. Todas permanecem `PENDENTE` até implementação comprovada. `git diff --check` passou; link relativo da baseline conferido. | `docs/legacy-contracts/MATRIZ_PARIDADE.md`; inventários do Fabricador e das demais áreas; `docs/architecture/BASELINE_IMPLEMENTATION.md` | Contagem refere-se a funcionalidades documentadas, não a funcionalidades implementadas; nenhuma tela/teste de produto foi alegada |
| **F00.10** | **VALIDADA** | `4509a9f` | Documentados schemas e campos opcionais dos principais documentos JSON/catálogos, tabelas e migrations SQLite (até user_version 16), relações/identidades de IDs, compatibilidade conhecida e fatos impossíveis de concluir sem dados reais. `git diff --check` passou. | `docs/legacy-contracts/FORMATOS_E_IDS_ELECTRON.md`; tipos `src/shared/*`; validadores/armazenamento legado citados no documento | Detectado registro duplicado de migration version 10; dados reais não foram inspecionados e o formato de documentos desconhecidos continua explicitamente sem confirmação |
| **F00.11** | **VALIDADA** | `0477fb5` | ADR define unidade, origem/eixos, graus/sentido, pivô, ordem de matriz, crop, zoom/pan e cor/alpha, com compatibilidade do legado e verificações futuras explícitas. `git diff --check` passou. | `docs/decisions/ADR-0001-coordinate-and-rendering-contract.md`; plano e fontes legadas citadas na ADR | Decisão contratual aprovada para a engine; sem implementação, golden ou prova visual nesta tarefa |
| **F00.12** | **VALIDADA** | `fe2e850` | Fixture sintética JSON foi parseada e suas invariantes de referência validadas: 6 partes, 5 juntas, 2 poses, IDs de modelo/roupa/personagem/cena consistentes. `git diff --check` passou. | `tests/Fixtures/vertical-flow/fixture.json`; `tests/Fixtures/vertical-flow/README.md` | É especificação sintética, não builder/PNG/golden; fluxo vertical real fica pendente para F01–F05 e ainda não foi executado |
| **F00.13** | **VALIDADA** | `82362a2` | Restore terminou com exit 0; build Release passou com 0 avisos/erros; `GV5.App` iniciou, exibiu título `G-V5 Avalonia` e permaneceu `Responding=True` por ~10 s. `git diff --check` passou. | `docs/gates/GATE-F00.md`; solução e outputs Release locais | Inspeção visual não executada; não há projeto C# de testes; gate fecha apenas baseline e shell, não funcionalidades de produto |
| **F01.01** | **VALIDADA** | `efd0cd3` (evidência e decisão; sem mudança de código) | `global.json` fixa SDK `10.0.402` sem roll-forward; projetos usam `net10.0`; `Directory.Packages.props` centraliza Avalonia `12.1.4` e dependências. Restore real terminou com exit 0 e build Release real passou com 0 avisos/erros no Windows x64. Nenhum desvio de versão encontrado. | `global.json`; `Directory.Build.props`; `Directory.Packages.props`; `src/GV5.App/GV5.App.csproj`; outputs/comandos em `docs/gates/GATE-F00.md` e histórico deste checkpoint | Nenhuma versão alterada; a compatibilidade comprovada cobre o shell/projetos atuais, não os módulos futuros |
| **F01.02** | **VALIDADA** | `4faf9a1` (código do instalador; sem mudança de código) | `Preparar.bat` executado duas vezes no workspace com espaços: exit 0 nas duas. Cópia isolada do `Preparar.ps1` baixou SDK oficial 10.0.402 em caminho com espaços; SHA-512 independente do manifesto oficial conferiu (`AE4FD528CB7E9F6AF6AAF7DE36715A69F761F183744F1BB3025D19F5A92447090EC561410E46266C1D10A63781ED6F3DE771760BC76C876D87DAABC367B898CD`). Segunda execução preservou tamanho/hash/timestamp do archive e não reinstalou template. Manifesto sintético sem SDK produziu erro explícito esperado. | `Preparar.bat`, `tools/Preparar.ps1`; teste isolado em `.tools/validation/F01.02 SDK sandbox with spaces` e `.tools/validation/F01.02 failure sandbox with spaces` (ignorados pelo Git) | Código não precisou de alteração. Pedido de remoção recursiva dos dois sandboxes foi bloqueado pela ferramenta; ficam preservados no caminho local indicado. SDK principal não foi tocado |
| **F01.03** | **VALIDADA** | `d3afdd9` (scripts/projeto verificados; sem mudança de código) | `cmd.exe /d /c Desenvolver.bat` usou SDK local, carregou `dotnet watch`, restaurou 12 projetos e compilou Debug com 0 avisos/erros; `GV5.App` abriu e respondeu com título `G-V5 Avalonia`, encerrado por Ctrl+C. Sandbox sem SDK retornou exit 1 e mensagem `Execute Preparar.bat primeiro para baixar o SDK local.` `dotnet publish` Release produziu `GV5.App.exe` sem incluir nenhum `.bat`. | `Desenvolver.bat`, `tools/ambiente.bat`, `src/GV5.App/GV5.App.csproj`; saída publish em `.tools/validation/F01.03 publish output with spaces` | Inspeção visual não realizada. O sandbox de erro e o publish temporário ficam em `.tools/validation/` (ignorados pelo Git); nenhuma instalação principal foi alterada |
| **F01.04** | **VALIDADA** | `a582656` (auditado; sem mudança de código) | XML dos 12 `.csproj` conferido: 6 PackageReferences e 6 versões centrais, sem versões inline ou package sem registro. `dotnet sln list` corresponde exatamente aos 12 projetos no disco (0 faltantes/órfãos). `git check-ignore --no-index` confirmou `.tools`, `.packages`, `bin`, `obj` ignorados e `src/GV5.App/Program.cs` não ignorado. `git diff --check` passou. | `.gitignore`; `Directory.Packages.props`; `Directory.Build.props`; `GV5.sln`; todos os `src/**/*.csproj` | Auditoria estática; nenhuma regra global foi ampliada e nenhuma fonte foi alterada |
| **F01.05** | **VALIDADA** | `9b8d250` | Harness C# temporário executou **120 assertions** para os nove IDs (`ModelId`, `PoseId`, `WardrobeId`, `FaceId`, `HairId`, `CharacterId`, `SceneId`, `VideoId`, `RoteiroId`) e `Revision`: geração, unicidade, round-trip, parsing válido/inválido/nulo/vazio, defaults inválidos, rejeição de `Guid.Empty`, revisão inicial/ordenação/incremento, valores não positivos e overflow. Harness terminou com `PASS`, 0 warnings/0 errors. `GV5.Core` e a solution Release compilaram com 0 warnings/0 errors; `git diff --check` passou. | `src/GV5.Core/Identity/EntityIds.cs`; execução isolada em `.tools/validation/F01.05 typed ids` (ignorada pelo Git) | Tipos são structs distintos com `Guid`; revisão começa em 1 e é positiva. `dotnet test` ainda não existe/não foi executado; criação da suíte xUnit está planejada em F01.10. Testes visuais não se aplicam |
| **F01.06** | **VALIDADA** | `8f608b3` | Harness C# temporário executou **14 assertions** cobrindo sucesso/falha de `Result<T>`, acesso inválido a valor, erros nulos, códigos inválidos, mensagens vazias, fluxo de `Conflict` através de command handler, query handler e cancelamento propagado como `OperationCanceledException`. Passou sem avisos/erros. `dotnet build GV5.sln -c Release --no-restore --verbosity minimal` passou com 0 warnings/0 errors após corrigir colisão entre namespace `GV5.Application` e tipo Avalonia `Application`. `git diff --check` passou. | `src/GV5.Application/Contracts/{ApplicationError,Result,RequestHandlers}.cs`; `src/GV5.App/App.axaml.cs`; harness em `.tools/validation/F01.06 result contracts` (ignorado pelo Git) | Erros esperados retornam `ApplicationErrorCode`; cancelamento usa `CancellationToken`/Task padrão e não é mascarado como falha de negócio. Sem mediator ou DI; estes ficam fora do escopo de F01.06. A suíte xUnit segue pendente em F01.10 |
| **F01.07** | **VALIDADA** | `1c6ac0e` | Restore de `GV5.sln` passou; `dotnet list package` confirmou `Microsoft.Extensions.DependencyInjection` e Abstractions em `10.0.13`. Build Release da solution passou com 0 warnings/0 errors. Busca estática em `src/GV5.App/Views` e `ViewModels` não encontrou criação direta de repositórios, `IServiceProvider` ou service locator. `git diff --check` passou. A tentativa inicial de executar `GV5.App.exe` diretamente mostrou o aviso para instalar o runtime .NET 10 e foi invalidada como prova de inicialização; o app foi reaberto pelo SDK portátil e respondeu com título `G-V5 Avalonia`. | `src/GV5.App/Composition/AppComposition.cs`; `src/GV5.App/App.axaml.cs`; `src/GV5.App/GV5.App.csproj`; `Directory.Packages.props`; `docs/decisions/ADR-0002-desktop-service-composition.md` | Provider valida registros/escopos no startup e é descartado no encerramento do Avalonia. Ainda não há repositórios reais para registrar. Dependência e versão justificadas no ADR. Executar o `.exe` sozinho requer runtime .NET 10 instalado; publicação autocontida fica para a fase de distribuição |
| **F01.08** | **VALIDADA** | `2766f24` | Restore e build Release da solution passaram; build com 0 warnings/0 errors. Harness temporário executou **16 assertions** cobrindo registro das duas áreas, rota padrão, validação de duplicadas/vazias/desconhecidas e troca dos ViewModels. Executado pelo SDK portátil (`.tools/dotnet/dotnet.exe run --project src/GV5.App/GV5.App.csproj -c Release --no-build`): Windows abriu com título `G-V5 Avalonia`; a inspeção UI confirmou a View do Fabricador, clique em Customizador e renderização da View/ViewModel do Customizador. `git diff --check` passou. | `src/GV5.Application/Contracts/ModuleRoute.cs`; `src/GV5.App/Navigation/`; `src/GV5.App/Composition/AppComposition.cs`; Views/ViewModels e rotas de `src/GV5.Modules.Fabricador` e `src/GV5.Modules.Customizador`; harness `.tools/validation/F01.08 module routing` (ignorado pelo Git) | Registro é estático no composition root; Views recebem estado por DataTemplates tipados; não há plugin dinâmico. UI verificada no Windows via Computer Use. Módulos ainda não executam operações de domínio; persistência/edição pertence às fases posteriores |
| **F01.09** | **VALIDADA** | `324d1fa`, `58a3c18` (teste e evidência) | Tokens de cor, tipografia, espaçamento e raio estão em `GV5Tokens.axaml`, usados no shell e nas Views; estilos de navegação centralizados e convenções MVVM documentadas. `TestarHeadless.bat` passou: 3/3 testes, 0 erros/falhas/avisos; captura por Skia em memória mostrou o shell real (1100×700), e a asserção confirmou o brush dinâmico de navegação `#211B2B`. SHA-256 do PNG: `6BA1929E749D6E63616CECCF33EBF4B4ED60EFF6D091B3DF7A0AE5E9EB6B5FDE`. Build Release da solution passou com 0 warnings/0 errors; `git diff --check` passou. | `src/GV5.App/Theme/{GV5Tokens,GV5Styles}.axaml`; `src/GV5.App/App.axaml`; Views do shell/Fabricador/Customizador; `docs/architecture/MVVM_CONVENTIONS.md`; captura em `tests/GV5.Headless.Tests/bin/Release/net10.0/TestResults/headless/shell.png` (ignorada pelo Git) | Teste inteiramente headless e sem interação física; captura avalia pixels/estilos do shell, não substitui validação GPU ou visual em janela real, que segue NÃO TESTADA. A tentativa inicial encontrou `Bitmap.Save(Stream, int?)` obsoleto; foi substituída por `PngBitmapEncoderOptions.Default`. F01.10 liberada |

**Estados aceitos:** `PENDENTE`, `EM_EXECUCAO`, `BLOQUEADA`, `VALIDADA`.

**Ao finalizar uma tarefa:** registrar commit, comando efetivamente executado (build/teste), resultado, evidência concreta, comportamento negativo exercitado e pendências. Só então trocar para `VALIDADA`, atualizar contadores e iniciar a próxima.

**Tarefa que ocupa mais de uma sessão:** manter `EM_EXECUCAO` com subpassos realizados e próximos. **Bloqueio:** registrar causa, comando/erro reproduzível, ambiente, tentativas e condição para desbloquear; não marcar `VALIDADA`.

**Integração manual Windows:** anexar `docs/gates/GATE-FXX.md` ou relatório com data, hardware, versão, cenário, saída e resultado. Se não foi testada, escrever **NÃO TESTADO**; CI ou compilação não substituem validação exigida.

## 5. Verificações ambientais deste controle

| Verificação | Estado inicial | Evidência a registrar |
| --- | --- | --- |
| `git branch --show-current` | VALIDADO | `Master-AValonia` |
| `git status --short` | VALIDADO | árvore limpa depois do commit de status desta tarefa |
| `git rev-parse HEAD` / remoto | VALIDADO | No início desta execução, HEAD e `origin/Master-AValonia` estavam ambos em `81c798e`. Após a validação F01.09, branch contém os commits `58a3c18` (teste Headless do tema) e o commit deste registro; sincronização remota não foi solicitada nesta execução |
| SDK portátil `.tools/dotnet` | VALIDADO | SDK `10.0.402`, Windows x64, arquitetura x64 |
| `Preparar.bat` | VALIDADO | exit 0, SDK `10.0.402`, ambiente local pronto |
| `Desenvolver.bat` | NÃO VERIFICADO NESTE CONTROLE | shell abriu ou erro reproduzível |
| `dotnet restore GV5.sln --verbosity minimal` | PASSOU | exit 0; todos os 12 projetos restaurados após adicionar Avalonia aos módulos |
| `dotnet build GV5.sln -c Release --no-restore --verbosity minimal` | PASSOU | exit 0; 12 assemblies; 0 warnings, 0 errors após a implementação inicial F01.09 |
| `TestarHeadless.bat` | PASSOU | 3/3; zero errors, failures, skipped; execução sem janela nativa; screenshot Skia gerada e inspecionada |
| `dotnet test GV5.sln -c Release` | NÃO EXECUTADO | primeiro projeto de testes xUnit com teste de Core e cenário negativo é F01.10; F01.05 foi testada por harness temporário de 120 assertions |
| CI Windows | NÃO VERIFICADO | run URL, commit, resultado |
| Teste de UI / GPU Windows | F01.09 headless Skia PASSOU; janela nativa/GPU NÃO TESTADAS | Captura em memória confirmou shell e recursos visuais em 1100×700; não abriu janela visível nem usou hardware do usuário |

Os valores acima descrevem **este controle**, não negam testes que o Codex possa ter feito antes. Na F00, verificar evidências existentes e atualizá-los.

## 6. Bloqueadores reais

**Nenhum confirmado na criação.** Se surgir:

```text
ID: LOCAL-VALIDATION-001 (exemplo; não criar bloqueio fictício)
Tarefa:
O que falhou:
Comando/erro:
Ambiente:
Tentativas:
Precisa de ação do usuário?:
Condição objetiva de desbloqueio:
```

**Não avançar além do gate que depende da verificação bloqueada.** Podem ser feitos apenas ajustes/testes diretamente relacionados à tarefa corrente, sem pular a sequência.

## 7. Decisões e desvios aprovados

Ainda não há entradas registradas neste controle. Toda mudança material do roteiro ou arquitetura deve apontar para um ADR em `docs/decisions/`, com justificativa, risco, contrato alterado, impacto nos testes e commit. Não trocar stack/backend apenas por conveniência.

## 8. Registro de checkpoints

| Data | HEAD/commit | Último ID validado | Gate | Resumo |
| --- | --- | --- | --- | --- |
| 2026-10-20 | `d3afdd9` | F01.04 | GATE F00 passou | 13 tarefas F00 e F01.04 validadas; launcher, NuGet centralizado, solution e ignores conferidos |
| 2026-10-20 | `9b8d250` | F01.05 | GATE F00 passou | Nove IDs tipados e Revision implementados; 120 assertions e build Release passaram |
| 2026-10-20 | `8f608b3` | F01.06 | GATE F00 passou | Resultados/erros tipados e handlers de command/query com cancelamento; 14 assertions e build Release passaram |
| 2026-10-20 | `1c6ac0e` | F01.07 | GATE F00 passou | Composition root com provider validado, DI centralizado, inicialização Windows responsiva e auditoria de Views/ViewModels |
| 2026-10-20 | `2766f24` | F01.08 | GATE F00 passou | Rotas estáticas, Views/ViewModels dos dois módulos, 16 assertions e navegação Windows confirmada |
| 2026-10-20 | `324d1fa` | F01.08 validada; F01.09 em execução | GATE F00 passou | Tokens visuais iniciais e convenções MVVM compilam; falta captura visual após interrupção do Computer Use pelo usuário |
| 2026-10-20 | `58a3c18` | F01.09 | GATE F00 passou | Teste Headless com captura Skia conferiu o tema e o brush dinâmico da navegação; 3/3 testes, build Release sem warnings/erros; validação de janela/GPU continua pendente |

Após concluir um lote ou fase, adicionar uma linha. Não inflar contador só porque o commit contém múltiplos arquivos; contar apenas tarefas comprovadas.

## 9. Retomada obrigatória para a próxima sessão Codex

1. Atualizar branch/remoto com segurança, sem force push e sem sobrescrever trabalho local de outra sessão.
2. Ler `AGENTS.md`, `PLANO_DO_NOVO_APP.md`, `PLANO_MESTRE_EXECUCAO_CODEX.md` e este arquivo.
3. Inspecionar evidências reais da última tarefa validada; caso não existam, corrigir seu estado.
4. **Retomar F01.10**: criar a suíte xUnit inicial com teste de Core e cenário negativo; aproveitar o runner Headless sem misturar Avalonia nos testes puros de domínio.
5. Continuar automaticamente pelas tarefas seguintes **uma de cada vez**, em lotes flexíveis de aproximadamente 3–8 tarefas relacionadas, enquanto todos os gates pertinentes passam.
6. Atualizar o registro e commitar entregas reais na branch `Master-AValonia`; não desenvolver Video Studio antecipadamente.
7. Ao encerrar, informar: **branch, HEAD, último ID VALIDADO, próximo ID PENDENTE, commits, comandos verdes, evidências, bloqueios e condição de desbloqueio**.

### Prompt de retomada

> Siga `master avalonia/AGENTS.md` e `master avalonia/PLANO_MESTRE_EXECUCAO_CODEX.md`. Consulte este `EXECUTION_STATUS.md`, confira branch e HEAD atuais e execute a primeira tarefa pendente em sequência, com testes, evidências e commits. Continue pelas próximas tarefas enquanto houver condições, mas nunca pule gates nem declare validações não realizadas. Preserve integralmente o legado Electron.
