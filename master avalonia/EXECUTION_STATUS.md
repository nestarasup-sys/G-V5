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
| HEAD de execução do Codex | `4509a9f` (entrega F00.10; checkpoint a registrar) |
| Fase ativa | **F00 — Auditoria do legado, baseline e sincronização** |
| Última tarefa VALIDADA | **F00.10** — formatos versionados e mapeamento de IDs do Electron |
| Próxima tarefa PENDENTE | **F00.11** |
| Gate atual | **GATE F00: PENDENTE** |
| Progresso validado neste controle | **10 / 247 tarefas (4,0%)** |
| Tarefas em execução | **Nenhuma registrada** |
| Bloqueios conhecidos | **Nenhum confirmado** |
| Aceite Windows/GPU | **Não executado / não registrado** |

**Importante:** 0/247 representa **tarefas com evidência de validação registrada neste documento**, não a porcentagem de código já implementado. O shell, a solution, os projetos-base e os scripts de preparação podem estar presentes. O Codex deve auditar o que existe antes de implementar.

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
| F00 | Auditoria do legado, baseline e sincronização | 13 | 10 | EM_EXECUCAO | — |
| F01 | Solution .NET, contratos, módulo e CI | 13 | 0 | PENDENTE | — |
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

**Estados aceitos:** `PENDENTE`, `EM_EXECUCAO`, `BLOQUEADA`, `VALIDADA`.

**Ao finalizar uma tarefa:** registrar commit, comando efetivamente executado (build/teste), resultado, evidência concreta, comportamento negativo exercitado e pendências. Só então trocar para `VALIDADA`, atualizar contadores e iniciar a próxima.

**Tarefa que ocupa mais de uma sessão:** manter `EM_EXECUCAO` com subpassos realizados e próximos. **Bloqueio:** registrar causa, comando/erro reproduzível, ambiente, tentativas e condição para desbloquear; não marcar `VALIDADA`.

**Integração manual Windows:** anexar `docs/gates/GATE-FXX.md` ou relatório com data, hardware, versão, cenário, saída e resultado. Se não foi testada, escrever **NÃO TESTADO**; CI ou compilação não substituem validação exigida.

## 5. Verificações ambientais deste controle

| Verificação | Estado inicial | Evidência a registrar |
| --- | --- | --- |
| `git branch --show-current` | VALIDADO | `Master-AValonia` |
| `git status --short` | VALIDADO | árvore limpa após commit F00.04 (`bf36210`) |
| `git rev-parse HEAD` / remoto | VALIDADO | HEAD `4509a9f`; após `git fetch origin`, branch local 12 commits à frente de `origin/Master-AValonia`, remoto sem commits novos |
| SDK portátil `.tools/dotnet` | VALIDADO | SDK `10.0.402`, Windows x64, arquitetura x64 |
| `Preparar.bat` | VALIDADO | exit 0, SDK `10.0.402`, ambiente local pronto |
| `Desenvolver.bat` | NÃO VERIFICADO NESTE CONTROLE | shell abriu ou erro reproduzível |
| `dotnet restore GV5.sln` | PASSOU | todos os projetos atualizados para restauração |
| `dotnet build GV5.sln -c Release --no-restore` | PASSOU | 0 warnings, 0 errors |
| `dotnet test GV5.sln -c Release` | NÃO EXECUTADO NESTE CONTROLE | total executado; não inferir que há testes |
| CI Windows | NÃO VERIFICADO | run URL, commit, resultado |
| Teste de UI / GPU Windows | NÃO EXECUTADO NESTE CONTROLE | ambiente, cenário e observação |

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
| 2026-10-20 | `4509a9f` | F00.10 | F00 em execução | Inventários, matriz e formatos versionados/IDs registrados; dados pessoais permaneceram intocados |

Após concluir um lote ou fase, adicionar uma linha. Não inflar contador só porque o commit contém múltiplos arquivos; contar apenas tarefas comprovadas.

## 9. Retomada obrigatória para a próxima sessão Codex

1. Atualizar branch/remoto com segurança, sem force push e sem sobrescrever trabalho local de outra sessão.
2. Ler `AGENTS.md`, `PLANO_DO_NOVO_APP.md`, `PLANO_MESTRE_EXECUCAO_CODEX.md` e este arquivo.
3. Inspecionar evidências reais da última tarefa validada; caso não existam, corrigir seu estado.
4. **Começar pela primeira tarefa PENDENTE indicada acima (F00.11)**; não repetir tarefas validadas sem evidência em contrário.
5. Continuar automaticamente pelas tarefas seguintes **uma de cada vez**, em lotes flexíveis de aproximadamente 3–8 tarefas relacionadas, enquanto todos os gates pertinentes passam.
6. Atualizar o registro e commitar entregas reais na branch `Master-AValonia`; não desenvolver Video Studio antecipadamente.
7. Ao encerrar, informar: **branch, HEAD, último ID VALIDADO, próximo ID PENDENTE, commits, comandos verdes, evidências, bloqueios e condição de desbloqueio**.

### Prompt de retomada

> Siga `master avalonia/AGENTS.md` e `master avalonia/PLANO_MESTRE_EXECUCAO_CODEX.md`. Consulte este `EXECUTION_STATUS.md`, confira branch e HEAD atuais e execute a primeira tarefa pendente em sequência, com testes, evidências e commits. Continue pelas próximas tarefas enquanto houver condições, mas nunca pule gates nem declare validações não realizadas. Preserve integralmente o legado Electron.
