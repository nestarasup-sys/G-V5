# G-V5 — Testes invisíveis (Avalonia Headless)

**Infraestrutura experimental e isolada**, preparada na branch `Master-AValonia`.
Ela **não conclui tarefas do Plano Mestre** e não altera o progresso do Codex. A suite é uma ferramenta para testar a aplicação em memória durante o desenvolvimento, não a engine de render de personagens — que será implementada nas fases de Geometry/Skia.

## Objetivo
- Nunca iniciar `Desenvolver.bat` / `GV5.App` para um teste automático.
- Nunca abrir janelas do Windows, interceptar mouse/teclado físico ou colocar foco numa janela de teste.
- Reutilizar os recursos reais de `GV5.App` (XAML, style, ViewModels e módulo) com `Avalonia.Headless`.
- Habilitar `UseSkia()` + `UseHeadlessDrawing=false`, necessário para screenshots em memória.
- Isolar runner xUnit v3 do shell e da solution em andamento, sem mexer nos arquivos que o Codex está modificando.
- Rodar testes em **um único thread de testes/coleções**, limitando concorrência (CPU e RAM ainda serão usados).

## Execução (Windows)
A partir de `master avalonia/`:

```bat
Preparar.bat
TestarHeadless.bat
```

O bat carrega o SDK portátil de `.tools/dotnet` e executa:
```bat
dotnet run --project "tests/GV5.Headless.Tests/GV5.Headless.Tests.csproj" --configuration Release
```

**Não** execute `Desenvolver.bat` para headless: ele abre o aplicativo gráfico intencionalmente.

O teste de PNG grava uma screenshot **apenas** em `tests/GV5.Headless.Tests/bin/Release/net10.0/TestResults/headless/shell.png` (gerada em `bin`, ignorada por Git). Não acessa personagens privados. PNG não é golden aprovado nem prova de paridade de Fabricador/Studio.

## Testes iniciais
1. Instancia `MainWindow` com ViewModel de rotas e confere binding do botão de Customizador; executa o comando que está realmente associado ao botão.
2. Captura a janela em um PNG usando **Skia em memória**, validando dimensões e assinatura PNG.
3. Simula texto digitado em um `TextBox` sem hardware ou desktop.

Em testes headless, `window.Show()` cria **somente uma janela virtual**. Não é um HWND e não rouba foco no Windows.

## Como ampliar de maneira correta
- Geometry/Core/Data: testes C# puros sem Avalonia.
- UI: eventos de mouse/teclado via `Avalonia.Headless`, ViewModels reais e controle visual real; comparar alterações observáveis.
- Renderer de personagem: construir `RenderScene` + `SkiaRenderer` em projetos puros, gerar PNG *offscreen* e confrontar goldens; não renderizar personagens dentro do teste de UI.
- Arquivos: usar diretórios temporários sintéticos com limpeza, nunca `app-data` Electron.
- Estresse: tempo máximo, uso de memória e concorrência explícitos, sem abrir janela.
- UI/GPU real, DPI e áudio: **testes manuais separados**, quando o gate exigir, porque headless não comprova hardware real.

## Limites e validação pendente
Estes arquivos foram criados pelo agente GitHub remoto. **Não houve compilação/execução do runner neste ambiente remoto**. O Codex local deve executar `TestarHeadless.bat` com o SDK `10.0.402`, registrar o resultado real e corrigir eventuais incompatibilidades sem falsear a evidência. Esta infraestrutura não altera `EXECUTION_STATUS.md` nem sinaliza tarefa F01.11 como VALIDADA.

As versões de teste ficam em `tests/Directory.Packages.props`, que importa as versões do projeto principal e adiciona somente `Avalonia.Headless.XUnit=12.1.4` e `xunit.v3=3.2.2`. Não foram modificados `GV5.sln`, `Directory.Packages.props` da aplicação, scripts existentes ou projetos produtivos.

## Documentação oficial
- https://docs.avaloniaui.net/docs/testing/headless-xunit
- https://docs.avaloniaui.net/docs/testing/setting-up-the-headless-platform
- https://xunit.net/docs/getting-started/v3/cmdline
