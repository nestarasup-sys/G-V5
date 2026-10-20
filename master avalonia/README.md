# Gacha Nymi Avalonia

Novo aplicativo independente em C# + .NET 10 + Avalonia. A solução inicial contém o shell Desktop e os projetos-base da plataforma, Fabricador e Customizador. As funcionalidades de produto serão implementadas por etapas, conforme o plano.

## Ambiente

Windows x64, C#, .NET SDK 10.0.402 e templates Avalonia 12.1.4. Visual Studio não é necessário.

1. Execute `Preparar.bat` para preparar ou conferir as ferramentas locais.
2. Execute `Desenvolver.bat` para compilar e iniciar o shell com `dotnet watch`.

O SDK, seu perfil e os templates ficam em `.tools/`. Pacotes restaurados ficam em `.packages/`. Essas pastas são ignoradas pelo Git. Os scripts só ajustam variáveis de ambiente do processo atual.

Para usar a CLI manualmente, abra um terminal CMD nesta pasta e execute:

```bat
call tools\ambiente.bat
dotnet --info
dotnet new list avalonia
dotnet build GV5.sln
```

Os arquivos em `.tools/validation` são uma aplicação temporária gerada para conferir a instalação e baixar as dependências do template; não são a implementação do produto. O código principal está em `src/` e os projetos são ligados por referências explícitas na solução `GV5.sln`.

Validação local realizada: SDK e templates instalados, 30 pacotes do template restaurados e projeto temporário compilado com zero erros e zero avisos. A janela não foi validada visualmente. A instalação com caches e saída temporária de compilação ocupa aproximadamente 2,73 GB; esse valor cresce conforme novos pacotes e projetos forem adicionados.

Leia [o plano de arquitetura](PLANO_DO_NOVO_APP.md) para conhecer os limites dos módulos e a ordem de reconstrução.
