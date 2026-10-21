# Baseline da implementação Avalonia

Data da inspeção: 2026-10-20  
Branch: `Master-AValonia`  
HEAD inspecionado: `068ea6f`  
Escopo: somente arquivos rastreados e configuração em `master avalonia/`; nenhum dado do usuário foi consultado.

Este documento compara a arquitetura descrita em `PLANO_DO_NOVO_APP.md` com o estado verificável do código. A solution compilar não significa que os módulos ou fluxos do produto estejam funcionais.

## Estado observado

- `GV5.sln` contém 12 projetos: `GV5.App`, `GV5.Application`, `GV5.Assets`, `GV5.Characters`, `GV5.Core`, `GV5.Data`, `GV5.Geometry`, `GV5.Jobs`, `GV5.Modules.Customizador`, `GV5.Modules.Fabricador`, `GV5.Rendering` e `GV5.Scene`.
- Existem 12 arquivos `.csproj` e oito arquivos de código/interface rastreados (`.cs`/`.axaml`), todos dentro de `GV5.App`. Os outros 11 projetos não contêm arquivos-fonte C# ou Avalonia fora de `bin/obj`.
- `GV5.App` tem a janela inicial, `MainViewModel`, inicialização Avalonia e referências de projeto. O shell oferece navegação entre Fabricador e Customizador e mostra texto de estrutura inicial; não implementa criação, edição, composição ou persistência de modelos/personagens.
- `global.json` fixa SDK `10.0.402`; `Directory.Packages.props` centraliza Avalonia `12.1.4` e CommunityToolkit.Mvvm `8.4.2`. Não há referência de pacote SQLite, SkiaSharp ou provedor de mídia nesta estrutura inicial.
- `README.md` descreve corretamente a solution como inicial e separa a aplicação temporária usada na validação de templates do produto em `src/`.
- A preparação portátil, o restore e o build Release foram executados em F00.03; o resultado comprova compilação do shell, não execução visual da janela nem funcionalidades de produto.

## Comparação com o plano

| Área/contrato planejado | Estado real na inspeção | Diferença e consequência |
| --- | --- | --- |
| Shell Avalonia + MVVM | Inicialização, janela e navegação básica existem em `GV5.App`. | Navegação aponta para descrições estáticas; faltam Views/ViewModels reais de módulos. |
| Core e Application | Projetos listados na solution. | Sem tipos de domínio, casos de uso, contratos ou testes. |
| Geometry, Assets, Characters, Scene e Rendering | Projetos listados na solution. | Sem engine implementada, tipos, armazenamento, resolução de personagem, cena ou renderer. |
| Data/SQLite | `GV5.Data` é um projeto de biblioteca sem fontes. | Sem `IAppDataPaths`, schema, SQLite, migrations, transações, backup ou repositórios. |
| Jobs | Projeto listado, sem fontes. | Sem fila, cancelamento, progresso ou execução de tarefas em segundo plano. |
| Fabricador e Customizador | Projetos-base referenciados pelo App. | Não há implementação nos projetos; as áreas são apenas destinos conceituais do shell. |
| Design System, Diagnostics e módulos Studio/Base de Vídeos/Roteiros/Video Studio | Ainda não existem projetos na solution. | São partes do mapa arquitetural, a criar quando houver consumidor conforme a ordem do plano. |
| Testes, fixtures e benchmarks | Não há projetos de teste ou benchmark na solution atual. | Ainda não há provas automatizadas de domínio, arquitetura, persistência ou desempenho. |
| Limites das bibliotecas | Há 11 projetos sem fonte C#/Avalonia, contra a regra de não manter bibliotecas vazias. | Discrepância de baseline para resolver com a sequência do Plano Mestre: adicionar contratos e consumidores por fatias, ou justificar uma mudança controlada; não preencher com classes sem função. |

## O que já está implementado

O trabalho existente estabelece a solução .NET/Avalonia, o SDK portátil, os scripts locais, o shell inicial e os projetos/referências-base. A tela inicial apresenta a navegação Fabricador/Customizador. Isso é scaffolding de desenvolvimento, não paridade com o Electron e não um fluxo vertical persistente.

As tarefas F00.01–F00.03 validaram branch e baseline, inventário, preparação portátil, restore e build Release. A revisão da estrutura e das lacunas acima pertence à F00.04. Nenhuma área do G-V5 está declarada pronta por este documento.

## Fontes verificadas

- `GV5.sln`, `src/*/*.csproj`, `src/GV5.App/**`, `global.json`, `Directory.Packages.props`, `README.md`.
- Inventário por `git ls-files` e busca em `src/`, excluindo saídas geradas `bin/obj`.
- `dotnet sln GV5.sln list` e validações de preparação/restore/build registradas em `EXECUTION_STATUS.md`.
