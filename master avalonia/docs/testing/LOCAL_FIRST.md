# G-V5 — Ciclo de validação local-first

**Decisão:** desenvolvimento e validação frequentes **no PC Windows do usuário**, não nas máquinas do GitHub. O usuário autorizou utilização de CPU/RAM locais. Testes automáticos são headless por padrão, preservando teclado, mouse, foco e a área de trabalho.

## Fluxo correto para o Codex

1. Continuar seguindo o `PLANO_MESTRE_EXECUCAO_CODEX.md` e o `EXECUTION_STATUS.md` existentes. Não atualizar contagens por causa desta infraestrutura.
2. Após tarefa ou mudança funcional, executar `TestarLocal.bat rapido` a partir de `master avalonia/`. Compila Debug incremental, testa a solution e executa a suíte Headless Avalonia. Se falhar, corrigir antes de avançar.
3. Para uma verificação isolada da UI, executar `TestarLocal.bat headless` ou `TestarHeadless.bat`. Eles não lançam a janela gráfica do G-V5.
4. Ao finalizar uma fase, executar `TestarLocal.bat gate`: restaura dependências, compila Release, roda testes .NET e Headless. Adicionar cenário de persistência/PNG/real Windows específico da fase, conforme gate.
5. Somente após verificação real, preencher `docs/gates/GATE-FXX.md`, commits e evidências em `EXECUTION_STATUS.md`. Fazer push do relatório do gate dispara GitHub Actions automaticamente.
6. Validar resultados remotos Windows e Ubuntu; Ubuntu é complementar. Não aguardar CI a cada commit de implementação. Se um gate exigir Windows/GPU/interação real, executar ou registrar pendência local: headless não equivale a hardware real.
7. Prosseguir nas fases sequenciais; não antecipar Video Studio.

## O que dispara a GitHub Action

Arquivo: `../../.github/workflows/native-avalonia.yml`, localizado obrigatoriamente na raiz GitHub do repositório (única exceção de infraestrutura fora de `master avalonia/`).

| Evento | Comportamento |
| --- | --- |
| Push com C# / testes / status de tarefa | **Não** dispara CI automaticamente |
| Push que atualize `master avalonia/docs/gates/**` | Dispara CI Windows + Ubuntu |
| Alteração no próprio workflow | Dispara CI para validar o workflow |
| Pull request contra `Master-AValonia` alterando arquivos do novo app | Dispara CI |
| `workflow_dispatch` | Disparo manual, sujeito à disponibilidade da ação no GitHub (workflows manuais normalmente precisam constar na branch padrão) |

**Por quê?** Commits pequenos deixam de criar restore/build remoto para cada mudança. O Codex recebe feedback imediatamente do SDK local com caches quentes, e o GitHub valida checkpoints em máquinas limpas. A alternância não elimina CI; reduz sua frequência.

## Comandos disponíveis

```bat
cd /d "D:\CAMINHO\DO\REPOSITORIO\master avalonia"
Preparar.bat
TestarLocal.bat rapido
TestarLocal.bat gate
TestarLocal.bat headless
```

O caminho acima é **ilustrativo**, não um caminho fixo no código. O script usa `%~dp0`, `tools\ambiente.bat`, SDK `.tools\dotnet` e caches locais; ele aceita execução a partir de qualquer diretório.

### O que cada modo executa

- **rapido**: `dotnet build GV5.sln -c Debug`; `dotnet test GV5.sln -c Debug --no-build`; `dotnet run --project tests/GV5.Headless.Tests/GV5.Headless.Tests.csproj -c Debug`.
- **gate**: restore da solution e do projeto Headless; build Release da solution; `dotnet test GV5.sln -c Release --no-build`; execução Headless Release.
- **headless**: chama `TestarHeadless.bat`, isolando testes da UI.

O resultado de cada passo se propaga por `ERRORLEVEL`. Build falhou? A sequência encerra com erro, sem imprimir PASSOU. Não há `GV5.App.exe`, `dotnet watch` nem abertura de janelas nesses fluxos. O runner gera janelas **virtuais em memória**, sem ativar o desktop.

## Limitações e responsabilidade

- O script invoca testes da solution existentes; testes específicos de novos projetos precisam ser adicionados à solution ou encadeados no runner conforme as futuras fases. A suíte Headless é um projeto separado e já é chamada explicitamente.
- A primeira execução pode restaurar pacotes; execuções seguintes reaproveitam caches. O uso de CPU/RAM é liberado pelo usuário e pode ser alto em benchmarks.
- Não existe garantia de que o script já tenha passado: este ajuste foi feito via GitHub, **sem execução no Windows local nesta rodada**. O Codex deverá rodá-lo, corrigir incompatibilidades e registrar os resultados reais.
- Não misturar mudança de infraestrutura com implementações da fase atual ou apagar logs de progresso.
