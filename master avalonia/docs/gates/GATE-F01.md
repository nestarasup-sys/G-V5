# GATE-F01 — solution .NET, fronteiras e CI

- **Resultado:** PASSOU para G0/F01.
- **Data:** 2026-10-21.
- **Branch:** `Master-AValonia`.
- **HEAD validado:** `715bee517665fe4a8809ae740b347d07324658bb`.
- **Ambiente:** Windows x64; .NET SDK `10.0.402`; Avalonia conforme versões centrais do repositório.
- **Escopo:** build, fronteiras declaradas dos projetos, testes sintéticos, execução headless do shell e independência do checkout nativo em relação à raiz/legado. Não declara funcionalidades finais do Fabricador ou Customizador.

## Critérios e evidências

| Critério | Resultado/evidência |
| --- | --- |
| Branch, remoto e escopo | Branch `Master-AValonia`; clone no commit `715bee5`. A autorização excepcional abrange somente `.github/workflows/native-avalonia.yml`; todos os demais arquivos editados ficam em `master avalonia/`. |
| Checkout isolado | Clone shallow com sparse checkout exato `/master avalonia/`, em `master avalonia/.tools/f01-13-clean-clone/`; apenas `.git/` e `master avalonia/` aparecem na raiz física do clone. Sem checkout físico de legado ou arquivos da raiz. Diretório inteiro está ignorado por `master avalonia/.gitignore`. |
| SDK declarado | `global.json` fixa .NET `10.0.402`; o SDK portátil correspondente foi copiado para o ambiente temporário do clone após o download de bootstrap ficar sem progresso (arquivo de 0 bytes). `dotnet --version` no clone retornou `10.0.402`. O teste não confunde falha de download com sucesso de bootstrap. |
| Restore limpo | `.tools/dotnet/dotnet.exe restore GV5.sln --verbosity minimal`, em clone sem `.packages` previamente populado, terminou com exit 0; os projetos da solution restauraram pacotes a partir das referências/feeds declarados. |
| Build Release | `.tools/dotnet/dotnet.exe build GV5.sln -c Release --no-restore --verbosity minimal` terminou com exit 0, 0 avisos e 0 erros; `GV5.App` e projetos referenciados compilaram no clone. |
| Testes Core/Arquitetura | `.tools/dotnet/dotnet.exe test GV5.sln -c Release --no-build --verbosity minimal`: 3 Core + 4 Arquitetura aprovados, 0 falhas. |
| Testes de shell Headless | `.tools/dotnet/dotnet.exe run --project tests/GV5.Headless.Tests/GV5.Headless.Tests.csproj --configuration Release`: 3 aprovados, 0 falhas; inclui instanciação headless e render Skia para PNG, sem janela de desktop. |
| CI reproduzível | [GitHub Actions run 39528951140](https://github.com/nestarasup-sys/G-V5/actions/runs/39528951140) concluiu Windows e Ubuntu com sucesso: restore, build Release, 7 testes da solution e Headless. A action usa `global.json`; o projeto Headless restaura suas dependências no próprio comando `dotnet run`. |
| Fronteiras arquiteturais | F01.11: 4 testes positivos/negativos verificam referências Core/módulos, solution e rejeição de caminhos fora da raiz nativa. Evidências e limitações estão registradas em `EXECUTION_STATUS.md`. |
| Integridade Git | `git diff --check` passou antes do registro do gate; working tree do clone permaneceu sem alterações rastreadas após build/testes. Nenhum dado de usuário foi usado. |

## Limites e pendências que não bloqueiam G0

- A preparação automática do SDK em um clone vazio não foi comprovada nesta rodada: o download oficial iniciado pelo `Preparar.ps1` permaneceu em 0 bytes; para completar o teste do código limpo, foi usado o SDK local já instalado na mesma versão exata do `global.json`. Investigar conectividade/robustez do bootstrap quando a tarefa de preparação for revisitada.
- O shell foi exercitado com Avalonia Headless; esta rodada não abriu janela real nem validou aparência, interação nativa ou GPU. Os testes/headless são intencionais para a validação desta etapa.
- O clone limpo confirma build e testes da estrutura; não representa aceite funcional das áreas ainda pendentes.

## Conclusão

F01.13 passou. F01 está concluída (13/13 tarefas) e G0 pode ser marcado como PASSOU: o checkout nativo isolado restaura, compila e testa sem arquivos físicos da raiz/legado. A próxima fase é F02 — SQLite, revisões, transações e recuperação básica.
