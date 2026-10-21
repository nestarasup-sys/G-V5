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
| HEAD de execução do Codex | `a8637b0` (checkpoint local após validar F00.01; F00.02 inventário em curso) |
| Fase ativa | **F00 — Auditoria do legado, baseline e sincronização** |
| Última tarefa VALIDADA | **F00.02** — inventário de solution, projetos, scripts, configuração e arquivos C# |
| Próxima tarefa PENDENTE | **F00.03** |
| Gate atual | **GATE F00: PENDENTE** |
| Progresso validado neste controle | **2 / 247 tarefas (0,8%)** |
| Tarefas em execução | **Nenhuma registrada** |
| Bloqueios conhecidos | **Nenhum confirmado; ambiente local ainda não auditado** |
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
| F00 | Auditoria do legado, baseline e sincronização | 13 | 2 | EM_EXECUCAO | — |
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
| **F00.02** | **VALIDADA** | a registrar no checkpoint de commit | Solution lista 12 projetos. `git ls-files`/`rg --files` encontraram 6 arquivos C# de produto, todos no shell, 12 `.csproj`, 2 launchers `.bat`, 1 helper `.ps1`, `global.json`, `NuGet.Config`, props centralizados e `.gitignore`. Nenhum arquivo C# nos 11 projetos-library; são shells vazios no estado atual. | `dotnet sln GV5.sln list`; `rg --files`; `git ls-files`; inspeção de `*.bat`, `*.ps1`, JSON, NuGet.Config e props | Discrepância a confrontar em F00.04: projetos vazios versus regra de não criar bibliotecas vazias |

**Estados aceitos:** `PENDENTE`, `EM_EXECUCAO`, `BLOQUEADA`, `VALIDADA`.

**Ao finalizar uma tarefa:** registrar commit, comando efetivamente executado (build/teste), resultado, evidência concreta, comportamento negativo exercitado e pendências. Só então trocar para `VALIDADA`, atualizar contadores e iniciar a próxima.

**Tarefa que ocupa mais de uma sessão:** manter `EM_EXECUCAO` com subpassos realizados e próximos. **Bloqueio:** registrar causa, comando/erro reproduzível, ambiente, tentativas e condição para desbloquear; não marcar `VALIDADA`.

**Integração manual Windows:** anexar `docs/gates/GATE-FXX.md` ou relatório com data, hardware, versão, cenário, saída e resultado. Se não foi testada, escrever **NÃO TESTADO**; CI ou compilação não substituem validação exigida.

## 5. Verificações ambientais — ainda não executadas neste controle

| Verificação | Estado inicial | Evidência a registrar |
| --- | --- | --- |
| `git branch --show-current` | VALIDADO | `Master-AValonia` |
| `git status --short` | VALIDADO | limpo antes de F00.01; mudanças atuais são somente o registro de execução |
| `git rev-parse HEAD` / remoto | VALIDADO | baseline F00.01: `09a93fb75de0472c7d013822df073100b59c3493`, divergência `0 0` |
| SDK portátil `.tools/dotnet` | NÃO VERIFICADO | `dotnet --info` e versão de `global.json` |
| `Preparar.bat` | NÃO VERIFICADO NESTE CONTROLE | instalação idempotente, hash e código de saída |
| `Desenvolver.bat` | NÃO VERIFICADO NESTE CONTROLE | shell abriu ou erro reproduzível |
| `dotnet restore GV5.sln` | NÃO EXECUTADO NESTE CONTROLE | log ou resumo de saída |
| `dotnet build GV5.sln -c Release --no-restore` | NÃO EXECUTADO NESTE CONTROLE | erros/warnings e resultado |
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
| 2026-10-20 | `a8637b0` | F00.02 | F00 em execução | F00.01 confirmou branch/HEAD sincronizados; inventário achou 12 projetos e 6 arquivos C# de produto, todos no shell |

Após concluir um lote ou fase, adicionar uma linha. Não inflar contador só porque o commit contém múltiplos arquivos; contar apenas tarefas comprovadas.

## 9. Retomada obrigatória para a próxima sessão Codex

1. Atualizar branch/remoto com segurança, sem force push e sem sobrescrever trabalho local de outra sessão.
2. Ler `AGENTS.md`, `PLANO_DO_NOVO_APP.md`, `PLANO_MESTRE_EXECUCAO_CODEX.md` e este arquivo.
3. Inspecionar evidências reais da última tarefa validada; caso não existam, corrigir seu estado.
4. **Começar por F00.01** (enquanto não houver validação registrada): confirmar branch, HEAD, working tree e possíveis mudanças concorrentes.
5. Continuar automaticamente pelas tarefas seguintes **uma de cada vez**, em lotes flexíveis de aproximadamente 3–8 tarefas relacionadas, enquanto todos os gates pertinentes passam.
6. Atualizar o registro e commitar entregas reais na branch `Master-AValonia`; não desenvolver Video Studio antecipadamente.
7. Ao encerrar, informar: **branch, HEAD, último ID VALIDADO, próximo ID PENDENTE, commits, comandos verdes, evidências, bloqueios e condição de desbloqueio**.

### Prompt de retomada

> Siga `master avalonia/AGENTS.md` e `master avalonia/PLANO_MESTRE_EXECUCAO_CODEX.md`. Consulte este `EXECUTION_STATUS.md`, confira branch e HEAD atuais e execute a primeira tarefa pendente em sequência, com testes, evidências e commits. Continue pelas próximas tarefas enquanto houver condições, mas nunca pule gates nem declare validações não realizadas. Preserve integralmente o legado Electron.
