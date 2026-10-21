# Convenções de interface e MVVM do G-V5

Estas regras mantêm a interface separada da lógica de produto. Elas descrevem o padrão mínimo da solução atual; não criam uma biblioteca de controles nem uma camada global de navegação.

## View (XAML/Avalonia)

- Define layout, estilos, binding e templates de dados.
- Encaminha ações para commands do ViewModel; não contém regras de personagem, validação de domínio, SQL, I/O, importação nem composição de imagens.
- Code-behind fica restrito a `InitializeComponent` e à ponte de input que realmente depender de um controle específico.
- Não constrói ViewModels, repositórios ou serviços. O composition root ou templates tipados resolvem a instância.
- Usa recursos `Gv5*` de `src/GV5.App/Theme/GV5Tokens.axaml`; não cria versões locais de cor, tipografia, espaçamento ou raio já definidos ali.

## ViewModel

- É uma classe C# pequena, observável quando a View precisa acompanhar mudanças (`ObservableObject` / `CommunityToolkit.Mvvm`).
- Expõe estado para apresentação e commands que representam intenções do usuário.
- Recebe dependências pelo construtor; não conhece `Control`, `Window`, XAML, `IServiceProvider` nem armazenamento concreto.
- Coordena casos de uso em `GV5.Application`; apresenta `Result<T>`/erros esperados sem transformar cancelamento em sucesso.
- Ao adicionar I/O ou trabalho longo, usa APIs assíncronas e `CancellationToken`; não bloqueia thread de UI.
- Não copia estado de domínio em coleções globais. Estado de tela temporário permanece no escopo do ViewModel apropriado.

## Application, Core e composição

- Commands/queries e contratos ficam em `GV5.Application`; invariantes e tipos do produto ficam em `GV5.Core`.
- `GV5.App/Composition/AppComposition.cs` é o composition root desktop: registra serviços, rotas e criação de janelas/ViewModels.
- `MainViewModel` navega por identificadores de rota e uma fábrica de páginas; ele não busca serviços globalmente.
- Um módulo não importa View, ViewModel ou controle de outro módulo. Integrações de produto usam contratos de Application/Core.
- Não adicionar mediator, container manual, event bus ou abstração genérica sem consumidor e necessidade demonstrada.

## Padrão aplicado agora

- `MainWindow.axaml` usa bindings e DataTemplates estáticos para `FabricadorViewModel` e `CustomizadorViewModel`.
- Cada módulo mantém sua View e seu ViewModel no projeto próprio; a composição estática está no App.
- `FabricadorViewModel` e `CustomizadorViewModel` implementam `IModulePageViewModel` e não dependem de Avalonia.
- Views apresentam o estado recebido e permanecem sem acesso a repositórios.

## Verificação

- Teste ViewModels sem inicializar a plataforma gráfica, usando dependências falsas e casos de sucesso/falha/cancelamento.
- Teste a navegação com rotas duplicadas, ausentes e válidas.
- Mudanças visuais que alterem geometria, estado ou composição exigem execução/captura local quando o critério de aceite pedir; um build de XAML sozinho não comprova aparência.
