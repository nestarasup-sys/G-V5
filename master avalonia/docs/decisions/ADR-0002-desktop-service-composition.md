# ADR-0002 — composição de serviços no shell desktop

- **Estado:** Aceita
- **Data:** 2026-10-20
- **Escopo:** `GV5.App` e inicialização da interface Avalonia

## Contexto

O shell criava `MainViewModel` diretamente ao abrir a janela. Isso espalha a responsabilidade de construção e dificulta trocar dependências por implementações de teste. F01.07 exige um composition root para a aplicação, sem criar repositórios nas Views.

## Decisão

Usar o contêiner padrão de `Microsoft.Extensions.DependencyInjection`, chamado somente em `GV5.App/Composition/AppComposition.cs`. `App.axaml.cs` monta o provider no início da vida desktop, resolve a janela e descarta o provider quando o app encerra. A janela recebe seu ViewModel na composição. Views e ViewModels não chamam `BuildServiceProvider`, não criam repositórios e não resolvem serviços globalmente.

Adicionar `Microsoft.Extensions.DependencyInjection` **10.0.13**, com versão centralizada em `Directory.Packages.props` e referência direta apenas em `GV5.App`. Essa é a versão estável mais recente da linha 10.0 no NuGet em 2026-10-20 e é compatível com `net10.0`. Não alterar SDK, Avalonia nem backend gráfico.

O app desktop mantém controle do ciclo de vida no Avalonia; por isso, usar `ServiceCollection` diretamente, sem introduzir `Microsoft.Extensions.Hosting` ou um host genérico nesta etapa. O provider ativa `ValidateOnBuild` e `ValidateScopes` para falhar cedo diante de registros inválidos ou escopos inconsistentes.

## Consequências

- A construção de serviços fica centralizada e as dependências futuras podem entrar por construtor.
- O shell passa a referenciar uma implementação de DI pequena e padrão da plataforma .NET.
- Nenhum serviço de persistência é registrado ainda; os projetos de dados continuam sem implementação concreta até suas tarefas.
- As Views continuam compatíveis com o preview de design do Avalonia.
- O teste de inicialização deve resolver a janela e manter o shell responsivo; testes unitários repetíveis entram na F01.10.

## Referências

- [Visão geral oficial de Dependency Injection no .NET](https://learn.microsoft.com/en-us/dotnet/core/extensions/dependency-injection/overview)
- [Pacote Microsoft.Extensions.DependencyInjection 10.0.13 no NuGet](https://www.nuget.org/packages/Microsoft.Extensions.DependencyInjection/10.0.13)
