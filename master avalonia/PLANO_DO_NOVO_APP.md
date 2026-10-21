# Novo Gacha Nymi — C# + Avalonia

> **Requisito permanente de produto:** reconstruir a aparência e a experiência do Gacha 5 original em Electron com a stack Avalonia, sem redesign. O contrato, inventário, matriz e critérios estão em [`docs/ui-fidelity/`](docs/ui-fidelity/CONTRATO_VISUAL_GACHA5.md). A exigência complementa as fases existentes; não altera a ordem, os IDs nem a contagem das 247 tarefas.

Status: plano de arquitetura com solução inicial criada. O shell Avalonia e os projetos-base compilam; as funcionalidades de Fabricador, Customizador e demais áreas ainda serão implementadas por etapas.

Estrutura inicial atual: `GV5.sln`, shell `GV5.App`, bibliotecas `Core`, `Application`, `Geometry`, `Assets`, `Characters`, `Scene`, `Rendering`, `Data` e `Jobs`, além dos módulos-base de Fabricador e Customizador. A janela inicial só demonstra a navegação do shell; ela não representa as áreas de produto prontas.

## Ambiente de desenvolvimento sem Visual Studio

A escolha é C# + Avalonia + SDK .NET portátil, com scripts `.bat`. O Visual Studio não será requisito. O SDK fica em `.tools/dotnet`, o perfil da CLI e os templates em `.tools/cli-home`, e o cache de pacotes em `.packages`, todos dentro desta pasta e ignorados pelo Git.

Versões iniciais fixadas: .NET SDK **10.0.402** (linha .NET 10 LTS) e templates Avalonia **12.1.4**. O `global.json` exige o SDK escolhido. O SDK inclui runtime, compilador e ferramentas de compilação; não é preciso instalar um runtime separado para desenvolver.

- `Preparar.bat`: baixa o SDK do servidor oficial, verifica SHA-512 e instala os templates Avalonia no perfil local.
- `Desenvolver.bat`: usa o SDK local e inicia `dotnet watch` para `src/GV5.App`. É launcher de desenvolvimento; o produto será executável diretamente.
- Os pacotes do aplicativo serão fixados e restaurados conforme seus projetos forem criados. Não instalar ferramentas globais, workloads móveis ou bibliotecas sem uso definido.
- `.tools` e `.packages` são arquivos locais reproduzíveis, não conteúdo para enviar ao GitHub.

A instalação inicial precisa de internet. Depois, a disponibilidade offline depende dos pacotes já restaurados. `dotnet watch` aplica as alterações suportadas e pode reiniciar o aplicativo quando necessário; isso não promete atualizar qualquer mudança sem reinício.

Fontes oficiais: [releases .NET 10](https://builds.dotnet.microsoft.com/dotnet/release-metadata/10.0/releases.json) e [instalação Avalonia](https://docs.avaloniaui.net/docs/get-started/install-avalonia).

## 1. Objetivo e fronteira do novo aplicativo

Construir um aplicativo novo em C# e Avalonia, começando pelo Fabricador e pelo Customizador. Aproveitar o conhecimento do produto e os arquivos úteis do aplicativo antigo, sem transportar sua organização interna automaticamente.

Tudo necessário para desenvolver, compilar, testar, empacotar e executar o novo aplicativo deverá existir dentro de `master avalonia`. O conteúdo externo a essa pasta será tratado como legado e referência durante a transição.

O novo aplicativo não poderá depender de código, scripts, executáveis ou dados localizados fora dessa pasta de forma implícita. Dependências externas necessárias deverão ser declaradas e instaláveis. Arquivos pessoais do usuário continuarão em uma pasta de dados independente do código.

Não existe arquitetura que impeça todos os erros. A meta é limitar o alcance de cada mudança, detectar regressões cedo e permitir recuperar dados e operações que falharam.

### Plataforma escolhida

O novo G5 é uma reconstrução de produto, não uma conversão mecânica de telas. A ordem planejada é Fabricador, Customizador, Studio, Base de Vídeos, Roteiros e Video Studio por último; Opções e demais fluxos entram quando seus modelos, responsabilidades e formatos de dados estiverem definidos.

```text
C# / .NET 10
       ↓
GV5.App e módulos Avalonia
       ↓
Avalonia: XAML, controles, binding, navegação e input
       ↓
Win32 e Skia, com GPU via Direct3D 11/ANGLE quando disponível
       ↓
Windows
```

Não há Chromium nessa pilha. No Windows, Avalonia usa APIs Win32 para serviços de janela e interação do sistema. A documentação atual descreve Skia sobre Direct3D 11 através do ANGLE como caminho de GPU padrão, com fallback por software quando a aceleração não está disponível. Isso é uma característica da plataforma, não garantia de FPS: o desenho da cena, a quantidade de trabalho por alteração e o custo da prévia continuam sob responsabilidade do G5. Referência: [Avalonia no Windows](https://docs.avaloniaui.net/docs/platform-specific-guides/windows).

Avalonia é a camada da interface e o cliente da engine do G5; não será a engine. Ela não será o lugar das regras de personagem, do esquema do banco, da codificação de vídeo ou de tarefas pesadas. XAML descreve a estrutura visual; C# liga eventos de interface a ViewModels e casos de uso. Controles especializados, como canvas e timeline, tratam input e hospedam a apresentação do resultado da engine, sem implementar as regras de domínio.

## 2. Princípios de construção

### Fidelidade visual ao Gacha 5

O visual criado pelo usuário no Gacha 5 original é a identidade do novo produto. Reproduzir cores, tipografia, dimensões, posições, hierarquia, painéis, barras, ícones, estados, menus, diálogos, navegação e comportamento visual observável. Não introduzir redesign, estilo genérico de framework ou reorganização em nome de modernização. A referência é somente o Gacha 5 original deste repositório; o Editor V4 é outro projeto e fica excluído.

Essa fidelidade define **o resultado**; não impõe reaproveitar Electron, React, DOM, CSS ou sua estrutura interna. Usar Avalonia/XAML, templates, estilos, recursos, controles especializados, MVVM e virtualização conforme apropriado à versão fixada. Atualizações técnicas de desempenho, estabilidade, acessibilidade e DPI devem preservar a aparência e os fluxos observáveis. Uma diferença visual deliberada exige aprovação explícita e registro da exceção.

Manter a rastreabilidade em `docs/ui-fidelity/`: contrato, inventário por página/subpágina, matriz de paridade, tokens extraídos do legado, estratégia Avalonia e critérios de aceite por módulo. Toda afirmação deve indicar se vem de código estático, captura real do Electron ou validação no Avalonia. Referências e estados ainda não capturados permanecem pendentes; nunca inventar cores, medidas ou screenshots.

- Uma funcionalidade possui responsabilidades e limites explícitos.
- Interface apresenta dados e encaminha ações; regras de personagem e persistência não ficam no código da tela.
- Fabricador e Customizador compartilham o mesmo modelo e motor de personagem.
- Módulos se comunicam por contratos pequenos e tipados, sem acessar tabelas ou controles internos de outros módulos.
- O disco, a importação de arquivos e a decodificação de imagens são tratados como operações que podem falhar.
- Salvar com sucesso significa que a gravação foi confirmada; a interface nunca anuncia sucesso antes disso.
- Trabalho pesado tem cancelamento, limite de concorrência e estado de progresso.
- Recursos gráficos têm orçamento de memória e descarte explícito.
- Uma mudança pode ser desfeita quando sua natureza permitir.
- Dados possuem versão e migrações verificáveis desde a primeira versão pública.
- Novas abstrações entram quando resolvem uma necessidade concreta; evitar um framework interno gigante antes do primeiro fluxo funcionar.

### Fundações transversais

Construir estas capacidades em fatias finas junto com Fabricador, Customizador e Studio. “Desde cedo” significa contratos e um primeiro fluxo confiável, aprofundados conforme casos reais surgirem; não significa criar subsistemas genéricos completos antes de usá-los.

#### Camadas de prioridade

- **Obrigatório desde o começo:** contratos e IDs estáveis, engine gráfica, coordenadas/cores canônicas, dados versionados, isolamento dos módulos e fixtures mínimas de fidelidade visual.
- **Durante Fabricador e Customizador:** grafo de dependências, publicação imutável de revisões, modificadores não destrutivos, renderização incremental, undo/redo, autosave, cache e diagnóstico.
- **Depois do primeiro fluxo vertical completo:** workspaces avançados e multi-monitor, pacote portátil `.gv5project`, inspetor/reparo avançado de projetos e ferramentas opcionais de desenvolvimento. Seus formatos e contratos podem ser planejados antes; não antecipar implementação grande.

1. **DataPlatform (`GV5.Data`):** única porta para SQLite, arquivos, AssetStore, thumbnails, hashes, migrations, backups e restauração. Nenhuma feature inventa seu formato de persistência ou caminho de arquivo. Módulos declaram seus esquemas/migrations pelos contratos centrais; a plataforma coordena transações e recuperação.
2. **Design System (`GV5.DesignSystem`):** tokens de cor, tipografia, espaçamento e estados, mais botões, painéis, dialogs, inputs, tabs, toolbars e cards reutilizáveis. Módulos podem compor controles próprios sem duplicar estilos globais.
3. **Undo/Redo por workspace:** comandos reversíveis e escopos claros desde Fabricador, Customizador e Studio. Um gesto contínuo vira uma ação; armazenar deltas quando seguros, com snapshots limitados apenas quando necessário, em vez de snapshots gigantes por padrão.
4. **Autosave e recuperação:** estado de edição `Saved`, `Dirty`, `Saving` ou `Error`, com gravação incremental e checkpoint/journal recuperável. Na próxima abertura, oferecer restauração do último estado consistente após crash; nunca declarar salvo antes da confirmação no disco.
5. **Jobs e cache compartilhados:** importação, thumbnails, chroma, render, backup e migration usam workers com progresso/cancelamento. Cache de imagens, personagens resolvidos e thumbnails usa LRU, leases/referências e orçamento em bytes com métricas de uso; nenhum cache pode crescer sem limite.
6. **Diagnóstico e modo seguro:** medir abertura de telas, render, queries, jobs, memória, cache e erros com duração/correlation ID, sem coletar conteúdo privado. Se abertura de projeto ou estado de cache falhar, iniciar um shell seguro que desabilite abertura automática, caches descartáveis e módulos não essenciais, mantendo ferramentas de recuperação.
7. **Módulos e feature flags:** registrar módulos estaticamente na composição do app; cada módulo declara rotas, serviços, comandos, queries e migrations via contratos. Feature flags mantêm trabalho incompleto desligado. Não criar um carregador dinâmico de plugins nesta fase.
8. **Importação e backup do legado:** `GV5.Legacy.Electron` entende formatos antigos e executa migrações/cópias com relatório; o app principal nunca depende do Electron. Backups versionados incluem manifesto, hashes e verificação de restore, não apenas cópia cega de pasta.
9. **Qualidade e evolução:** fixtures sintéticas canônicas (modelo simples/complexo, roupa, face, cabelo, pose) sustentam testes de regressão; testes de arquitetura bloqueiam dependências proibidas; benchmarks repetíveis cobrem 100 personagens, 1000 poses, 5000 assets, arquivos grandes e cache cheio. O CI pode crescer por fases sem exigir toda a suíte antes do primeiro fluxo.
10. **Shell e serviços do sistema:** `.bat` é launcher de desenvolvimento, nunca parte da arquitetura de runtime; o G-V5 continua sendo um executável normal. Abstrair seleção de arquivos, clipboard, notificações e consulta de hardware por interfaces como `IFilePicker`, `IClipboard`, `INotificationService` e `IHardwareInfo`.
11. **Dados e versões:** manter dados fora do executável/repositório em diretório por usuário, com `database/`, `assets/`, `thumbnails/`, `projects/`, `backups/`, `cache/`, `logs/` e `temp/`. Definir versionamento de produto (SemVer) separado das versões de schema/migrations, desde as primeiras distribuições.
12. **Ferramentas internas:** um painel de diagnóstico, oculto/desativado por padrão e habilitado explicitamente em desenvolvimento, poderá inspecionar banco, assets, cache, jobs, revisões, memória e eventos. Ele observa o sistema por APIs de diagnóstico; não altera dados de produção diretamente.

Prioridade de engenharia entre essas frentes: **dependências entre assets, revisões publicadas imutáveis e renderização incremental**. Elas devem começar durante Fabricador/Customizador, depois de assentar os contratos mínimos; workspaces avançados, pacote portátil e reparação sofisticada ficam para depois do primeiro fluxo vertical.

Filosofia do produto: **tela não é dona do sistema**. A tela apresenta estado e envia comandos; dados, engine gráfica, assets, jobs e módulos têm responsabilidades e contratos próprios.

## 3. Organização da solução e limites dos módulos

Começar como um aplicativo modular em um único processo. Criar processos adicionais apenas para trabalhos que precisem de isolamento ou que as medições justifiquem.

```text
master avalonia/
  GV5.sln
  README.md
  global.json
  Directory.Build.props
  Directory.Packages.props
  src/
    GV5.App/                    # shell Avalonia, Views, ViewModels, navegação
    GV5.Core/                   # domínio: personagens, modelos, roupas, poses, expressões
    GV5.Application/            # casos de uso, comandos e interfaces de serviço
    GV5.Geometry/               # matemática 2D, hit testing, joints, pivôs e snap
    GV5.Assets/                 # AssetId, AssetStore, decoders e caches
    GV5.Characters/             # CharacterResolver e regras de personagem
    GV5.Scene/                  # cena resolvida e composição de entidades
    GV5.Rendering/              # RenderScene, SkiaRenderer e superfícies de desenho
    GV5.Media/                  # contratos e serviços de playback/decoding de mídia
    GV5.Data/                   # DataPlatform: SQLite, arquivos, migrations e backups
    GV5.Jobs/                   # filas, workers, cancelamento e progresso
    GV5.Diagnostics/            # métricas, eventos técnicos e diagnósticos locais
    GV5.DesignSystem/           # controles, estilos, tokens visuais e temas Avalonia
    GV5.Modules.Fabricador/     # telas e fluxos próprios do Fabricador
    GV5.Modules.Customizador/   # telas e fluxos próprios do Customizador
    GV5.Modules.Studio/         # criado depois do fluxo Fabricador/Customizador
    GV5.Modules.BaseDeVideos/   # biblioteca independente de vídeos
    GV5.Modules.Roteiros/       # roteiros referenciam VideoId
    GV5.Timeline/               # modelo e avaliação temporal, sem UI/FFmpeg
    GV5.Modules.VideoStudio/    # última grande área; edição e exportação
  tests/
    GV5.Core.Tests/
    GV5.Integration.Tests/
    GV5.Desktop.Tests/
    GV5.Architecture.Tests/
    Fixtures/                   # modelos/personagens sintéticos canônicos
  benchmarks/
    GV5.Benchmarks/             # cenários repetíveis de carga e memória
  docs/
    decisions/                 # decisões curtas: motivo, alternativas e limite
    data/                      # esquema, migrações e recuperação
  tools/
    GV5.Legacy.Electron/        # importador isolado; não é dependência do app
    # ferramentas reproduzíveis de desenvolvimento
```

Essa lista é um mapa de responsabilidades, não uma ordem para criar projetos vazios. A engine é esse conjunto de bibliotecas C#/.NET, sem um monólito obrigatório chamado Engine. Primeiro estabelecer a plataforma compartilhada e construir Fabricador e Customizador. Depois avançar por Studio, Base de Vídeos, Roteiros e, por último, Video Studio. `GV5.Timeline` e `GV5.Media` podem existir como contratos pequenos antes, mas sua implementação específica para edição de vídeo fica bloqueada até a etapa final. `GV5.DesignSystem` concentra tokens e componentes visuais, sem regras de negócio. `GV5.Legacy.Electron` é uma ferramenta de importação isolada, não referenciada nem distribuída pelo app.

Direção das dependências:

```text
GV5.App ───────────────→ GV5.Modules.*
GV5.Modules.* ─────────→ GV5.Application ─→ GV5.Core
GV5.Application ───────→ contratos de engine e dados
GV5.Characters ────────→ GV5.Core + GV5.Geometry + GV5.Assets
GV5.Scene ─────────────→ GV5.Characters + GV5.Assets + GV5.Geometry
GV5.Rendering ─────────→ GV5.Scene + GV5.Assets + SkiaSharp
GV5.Media ─────────────→ contratos de GV5.Application + backend isolado
GV5.Timeline ──────────→ GV5.Scene / GV5.Core
GV5.Data ──────────────→ contratos de GV5.Application / GV5.Assets
GV5.Jobs ──────────────→ contratos de GV5.Application
```

Módulos de produto não importam implementações internas uns dos outros. Fabricador e Customizador usam o mesmo modelo e os mesmos serviços públicos do domínio. Integrações passam por contratos em Application ou Core. `GV5.DesignSystem` e módulos de interface podem depender de Avalonia; Core, Geometry, Assets, Characters, Scene, Rendering, Data, Jobs e Diagnostics permanecem independentes da UI quando suas responsabilidades não exigirem apresentação. Referências proibidas devem ser verificadas no build ou em uma verificação de arquitetura; uma orientação escrita sozinha não impede dependências acidentais.

`GV5.Core`, `GV5.Geometry`, `GV5.Assets`, `GV5.Characters`, `GV5.Scene`, `GV5.Rendering`, `GV5.Media` e `GV5.Timeline` não dependem de Avalonia. `GV5.Core` também não conhece SQLite, sistema de arquivos ou APIs de backend de mídia. `GV5.Application` expressa operações como comandos e casos de uso. `GV5.Data` implementa persistência. `GV5.Rendering` compõe a cena com SkiaSharp. `GV5.Media` implementa contratos de mídia por adaptadores substituíveis. `GV5.Jobs` coordena trabalho demorado. `GV5.App` monta serviços, abre janelas e hospeda Views, ViewModels e controles que fazem a ponte entre input Avalonia e as engines.

Usar MVVM com Views e ViewModels pequenos por fluxo. A View encaminha intenção; o ViewModel coordena estado da tela e solicita casos de uso; o domínio mantém invariantes. Evitar code-behind com regras e um ViewModel global com acesso a todas as áreas. Cada módulo fornece registro estático de rotas, serviços, comandos, queries e migrations por contratos; o shell compõe a lista habilitada por feature flags. Não criar um sistema de plugins dinâmico no início.

XAML descreve composição e layout, por exemplo uma janela com `AssetBrowser` ao lado de `CharacterCanvas`. C# implementa o controle especializado, comportamento e ViewModel. `TimelineControl`, `PropertyInspector`, `ColorPicker`, `PoseGrid`, `WardrobeEditor` e `FaceEditor` podem ter APIs e estilos próprios, sem incorporar persistência ou domínio. Esses controles Avalonia são desenhados pela plataforma do Avalonia para aparência consistente; serviços de sistema, como diálogo de arquivo e clipboard, usam a integração da plataforma.

### Contratos entre interface e regras

- ViewModels expõem estado observável e comandos assíncronos para a View.
- Casos de uso retornam resultados explícitos, inclusive erros esperados, progresso e cancelamento quando aplicável.
- Serviços são registrados no ponto de composição do app; telas não constroem repositórios nem abrem bancos.
- Trabalho que atualiza UI volta pelo Dispatcher do Avalonia; workers não acessam controles.
- `Task`, `CancellationToken` e `IProgress<T>` são usados para chamadas pontuais. `Channel<T>` fica para filas duráveis ou produtor/consumidor com contrapressão real, não como padrão para qualquer evento.
- Processos auxiliares só serão adotados quando isolamento, falha independente ou medições justificarem; não distribuir o app em microserviços.

Fixar versões do SDK e dos pacotes compatíveis na criação da solução. Atualizações de dependências serão mudanças deliberadas, acompanhadas de compilação e verificações.

## 4. Fabricador

O Fabricador usa controles próprios de edição gráfica, mas os controles não são a engine. Um `FabricatorCanvas` pode desenhar peças, joints, pivôs, seleção, limites de transformação e grid. `ModelPartVisual`, `JointVisual`, `SelectionOverlay`, `TransformHandles` e `GridOverlay` são conceitos de apresentação; a geometria e as regras continuam em Core/Rendering.

Operações de usuário entram como comandos pequenos: `MovePartCommand`, `RotatePartCommand`, `ResizePartCommand`, `AttachJointCommand` e `PublishPoseCommand`. Um gesto contínuo de drag deve consolidar uma mudança em um único passo de undo/redo. Publicar não altera a revisão que consumidores já usam: cria uma revisão imutável e identificável por ID/hash. O histórico armazena deltas reversíveis quando forem suficientes; snapshots limitados podem ser usados quando o estado relacionado não puder ser representado com segurança por um delta. Não impor delta a todo custo.

Cada asset editável tem rascunho e pode ter revisões publicadas. Personagens e cenas salvam a revisão publicada que usaram. Ao publicar uma revisão nova, o app consulta o grafo de dependências reverso e mostra personagens/cenas afetados; o usuário escolhe manter a revisão anterior, atualizar referências de forma controlada ou comparar diferenças antes da atualização.

O canvas recebe identificadores e uma cena pronta para apresentação, e emite intenções com coordenadas normalizadas. O módulo converte a intenção em comandos de domínio. A tela não altera arrays de peças compartilhados diretamente, nem salva cada evento de mouse como se fosse uma ação independente.

## 5. Customizador e motor de personagem compartilhado

Fluxo conceitual:

```text
Character + Model + WardrobeOverrides + Pose/Expression
                         ↓
              CharacterResolver
                         ↓
                 CharacterScene
                         ↓
                 SkiaRenderer
                         ↓
           prévia Avalonia / exportação
```

Trocar uma roupa altera uma seleção ou `CharacterWardrobeOverride`; o resolver recompõe a cena usando o modelo, encaixes e regras atuais. A mesma composição atende Customizador e Studio. O Video Studio consome estados de personagem em instantes de timeline. Isso evita que cada tela crie sua própria interpretação de camadas, articulações e aparência.

`CharacterResolver` não desenha. Ele recebe Character, Model, Pose, Wardrobe, Hair, Face, Expression e Overrides e produz `ResolvedCharacter`. Essa resolução inclui as camadas e transformações necessárias para construir uma descrição de cena reutilizável pelo Fabricador, Customizador, Studio e Video Studio.

O personagem referencia `ModelId`, `PoseId`, `WardrobeId`, `HairId`, `FaceId` e `ExpressionId` com revisões publicadas explícitas. Ajustes do Customizador são modificadores não destrutivos, ordenados e removíveis (por exemplo, escala da cabeça, roupa selecionada ou expressão); não sobrescrevem a definição global publicada. O resolver aplica base + modificadores em ordem documentada.

## 6. Geometria independente da interface

`GV5.Geometry` contém as regras matemáticas em C# puro, sem Avalonia ou SkiaSharp:

- Matrix, Transform2D, bounds, pivô e crop.
- Joints, bones e transformações locais/ancestrais.
- Hit testing, seleção, snap e validação geométrica.
- Um padrão canônico de unidade, origem, eixo X/Y, sentido de rotação, ordem de transformações e conversão entre modelo/cena/canvas/tela; zoom e pan de visualização nunca alteram transformações salvas.
- Convenção canônica para cores (espaço de cor, canal alpha e conversões na entrada/render/export), para que Fabricador, Customizador, Studio e export interpretem o mesmo valor da mesma forma.

Fabricador, Studio e Video Studio podem consultar a mesma geometria, por exemplo para descobrir qual peça está sob o cursor. O input do mouse vem da UI; a resposta espacial é calculada pela biblioteca de geometria.

## 7. Scene Engine e Rendering Engine

`GV5.Scene` descreve o que deve aparecer. `CharacterRenderSceneBuilder` converte um personagem resolvido em `RenderScene`, uma lista ordenada de layers. Cada layer contém `AssetId`, Transform, Opacity, Crop, Flip, ZIndex e BlendMode. Scene também representa Background, Character, Image, Text, SpeechBubble e Effect com IDs, visibilidade, seleção e transformações próprias.

`GV5.Rendering` começa com `SkiaRenderer`, implementado em C#/.NET sobre SkiaSharp. Ele recebe uma cena pronta e desenha a composição. Regras de personagem, hit testing, timeline e persistência não entram no renderer. FabricatorCanvas pode pedir `engine.GetScene(...)`, receber uma cena imutável e solicitar nova apresentação quando seus dados mudarem.

A composição e a invalidação são incrementais. A engine acompanha dependências entre dados e resultados derivados; uma alteração de boca invalida os nós faciais e composições dependentes, sem decodificar ou resolver novamente roupa, cabelo e corpo que não mudaram. Cache de render usa revisão/hash dos inputs e parâmetros de saída; dependências inválidas propagam invalidação apenas aos consumidores afetados. O primeiro objetivo de performance é correctness-equivalent incremental output: o resultado final deve coincidir com uma renderização completa.

No app interativo, um controle Avalonia usa a integração de desenho customizado: `DrawingContext` para desenho comum ou `ICustomDrawOperation` com a lease de Skia que Avalonia fornece, quando o canvas complexo precisar de `SKCanvas`. Isso deixa Avalonia como cliente e superfície de apresentação; o contrato de `RenderScene` e o código do SkiaRenderer pertencem à engine. O desenho customizado deve permanecer rápido, reutilizar recursos e não decodificar mídia nem resolver roupas dentro do callback. A documentação informa que `Control.Render()` roda na UI thread e recomenda mantê-lo leve; o caminho de Skia e os callbacks de composição têm contratos próprios de thread e recurso, que devem ser respeitados. Referência: [custom rendering no Avalonia](https://docs.avaloniaui.net/docs/graphics-animation/custom-rendering).

Avalonia usa Skia para desenhar a própria UI no Windows, mas isso é independente do G5 possuir `SkiaRenderer`. A engine usa a API SkiaSharp e uma cena explícita; o adaptador Avalonia apresenta o resultado. Rasterização em background e superfícies GPU são caminhos diferentes: superfície GPU precisa de contexto e propriedade de thread corretos. Não presumir que criar um `GRContext` à parte compartilha a GPU de Avalonia automaticamente. Primeiro implementar o renderer e medir; depois escolher a estratégia de superfície e interop adequada. SkiaSharp documenta canvases para superfícies raster e GPU: [SKCanvas](https://learn.microsoft.com/en-us/dotnet/api/skiasharp.skcanvas?view=skiasharp-3.119), [SKSurface](https://learn.microsoft.com/en-us/dotnet/api/skiasharp.sksurface?view=skiasharp).

O contrato de cena não deve expor tipos Avalonia ou SkiaSharp. Isso preserva regras e módulos caso um backend gráfico seja necessário no futuro. SkiaSharp é a implementação inicial escolhida, não uma promessa de construir Skia, Direct2D, Direct3D e Vulkan desde já. Avalonia 12 removeu seu backend Direct2D; a opção considerada no futuro teria de ser uma implementação do G5 com custo e justificativa demonstrados, e não uma configuração hipotética do Avalonia.

## 8. Recursos, imagens e miniaturas

Nenhuma área ou documento mantém strings Base64 como identidade de mídia. Todos usam `AssetId` — uma representação textual como `asset://<id>` é uma URI conceitual, não caminho físico nem conteúdo embutido. `GV5.Assets` oferece `AssetStore.Open(assetId)` para bytes/streams e `DecodedImageCache.Get(assetId)` para imagem decodificada.

```text
AssetId
  ↓
AssetStore ── original, thumbnail, metadata, hash
  ↓
stream → ImageDecoder → DecodedImageCache → SkiaRenderer
```

O armazenamento mantém o original, thumbnails derivados, metadados, hash de conteúdo e cache local. Vários personagens referenciam o mesmo `AssetId`; a mesma imagem decodificada pode ser compartilhada, evitando decodificar um PNG de 4 MB vinte vezes. Cache de bitmaps tem LRU, orçamento de memória, invalidação por hash/versão do decoder e leases/referências de uso para não liberar um recurso ainda em desenho. **512 MB é um teto inicial para benchmark, não configuração garantida**; o limite final será medido no hardware e poderá ser configurável. Objetos GPU possuem regras de descarte específicas e não vivem para sempre só porque há referências no documento.

Um grafo de dependências registra relações entre revisão de asset, personagens, cenas e resultados derivados. Ele permite responder “quem usa esta revisão?”, prevenir mudanças invisíveis e calcular invalidação incremental. O DataPlatform mantém a fonte persistente do grafo; a engine pode manter índices/cache em memória regeneráveis.

Catálogos não abrem imagens originais para desenhar cartões. `ThumbnailService` gera miniaturas, por exemplo 256×256, em background, mantém cache em disco por hash do original e versão das transformações, e entrega o thumbnail para a UI. Gerar thumbnail novamente só quando não existe ou quando original/transformação mudou.

A composição usada pela prévia e pelo export compartilha `RenderScene` e regras visuais, embora possa usar superfícies distintas. A implementação raster CPU em SkiaSharp pode ser usada em trabalhos isolados e testáveis. GPU offscreen fica para depois de confirmar como contexts e superfícies serão geridos; nunca criar/destruir recursos GPU por item ou dentro de cada frame.

## 9. Jobs, filas e cancelamento

`GV5.Jobs` é o ponto coordenado para trabalho que não deve bloquear interação:

- RenderCharacter e GeneratePosePreview.
- CreateThumbnail e ProcessChroma.
- ImportModel e ImportVideo.
- ExportVideo, Backup e Migration.

Cada job tem ID, prioridade, progresso, `CancellationToken`, status e erro/result. Limitar concorrência e aplicar contrapressão; thumbnail em segundo plano não deve impedir uma prévia interativa. Decodificação, análise de assets, cálculo de geometria derivada e preparação de cenas ocorrem em workers apropriados. Resultados retornam como dados imutáveis; só a UI atualiza ViewModels e controles pelo Dispatcher.

O scheduler funciona também como coordenador de recursos: reserva CPU/memória para trabalho ativo, prioriza interação e render visível, limita tarefas simultâneas e posterga/cancela thumbnail, importação ou análise de baixa prioridade quando competirem com a ação atual. Limites começam simples e são ajustados por medições, não por um sistema distribuído de recursos prematuro.

Renderizações são identificadas pela versão/assinatura da entrada. Quando o usuário escolhe Pose 1, 2, 3, 4 e rapidamente chega à Pose 5, jobs ainda não iniciados ou canceláveis das quatro poses anteriores são cancelados; somente o resultado ainda atual pode substituir a prévia. Cancelamento em trabalho já iniciado é cooperativo nos pontos seguros. A UI ignora resultados atrasados mesmo quando uma biblioteca não pode interromper a operação imediatamente.

## 10. Mídia, timeline e Video Studio

O controle premium `MediaPlayerControl` do Avalonia é um componente pronto de interface e playback, disponível no Avalonia Pro ou superior. Ele não é requisito para o G5 tocar vídeo. A interface de player — Play, Pause, seek bar, volume e preview canvas — será nossa, ligada a contratos em `GV5.Media`. O Video Studio não dependerá de `Avalonia.Controls.MediaPlayer` nem de licença Pro para funcionar. O framework Avalonia continua MIT; ferramentas e componentes comerciais têm licenças próprias. Como licenciamento e preços podem mudar, consultar as páginas oficiais antes de fixar versões ou custos no orçamento. Referências: [MediaPlayerControl](https://docs.avaloniaui.net/controls/media/mediaplayer), [FAQ de licença](https://docs.avaloniaui.net/tools/faq), [planos Avalonia](https://avaloniaui.net/pricing).

Playback de usuário, decodificação precisa para edição e export são trabalhos diferentes. Separar serviços, mesmo que uma implementação futura compartilhe bibliotecas nativas:

- `PlaybackEngine`: reprodução fluida, relógio, sincronização de áudio e vídeo, volume e seek interativo.
- `FrameDecoder`: seek por frame, frame anterior/próximo, scrubbing, thumbnails e extração de waveform.
- `ExportEngine`: render determinístico da timeline, áudio e mux final, com opções de formato/qualidade.

`GV5.Timeline` resolve tracks, clips, frames, keyframes, áudio e estados de personagens. Para um instante solicitado, produz uma cena temporal; `GV5.Scene` e `GV5.Rendering` compõem vídeo, personagens, balões, texto e overlays. A avaliação temporal deve ser compartilhada entre preview e export para evitar interpretações divergentes, mas o playback pode usar decodificação em tempo real e cache adequados à fluidez, enquanto o export prioriza resultado determinístico.

```text
Avalonia UI própria
  ├── controles de transporte e preview canvas
  └── GV5.Media contracts
        ├── PlaybackEngine
        ├── FrameDecoder
        ├── AudioEngine / clock
        └── ExportEngine ── FFmpeg para encode/mux quando adequado

Timeline → cena do instante → vídeo + camadas do G5 → preview/export
```

### Backend de mídia: decisão adiada e testável

Definir interfaces independentes de fornecedor, por exemplo `IMediaPlayback`, `IFrameDecoder` e `IAudioClock`. O Video Studio chama esses contratos, nunca LibVLC, Media Foundation, mpv ou FFmpeg diretamente. Começar com um backend por vez; não construir uma matriz de backends antes de haver medições e requisitos concretos.

Candidatos para uma prova de conceito no Windows:

- **Media Foundation (`IMFMediaEngine` ou APIs adequadas):** backend nativo do Windows para playback. É uma opção promissora para o foco Windows, mas exige interop e validação do fluxo de frames para a composição do G5.
- **LibVLCSharp:** projeto mantido pela VideoLAN, com pacote de integração Avalonia e suporte listado a Windows/macOS/Linux. O `VideoView` Avalonia documenta limitações de airspace: overlays e controles sobre uma superfície nativa exigem tratamento específico. Isso é um risco para seleção, guias, personagens e texto por cima do vídeo. Verificar também os termos LGPL da distribuição escolhida. Referências: [LibVLCSharp.Avalonia](https://github.com/videolan/libvlcsharp/tree/3.x/src/LibVLCSharp.Avalonia), [repositório e licença](https://github.com/videolan/libvlcsharp).
- **libmpv:** candidato alternativo se a integração entregar frames/texture que possam ser compostos no canvas. Qualquer implementação Avalonia de terceiros precisa de avaliação de manutenção, licença, compatibilidade de versão e estabilidade; não assumir zero-copy nem integração GPU pelo material promocional.

A escolha não será feita pela facilidade de mostrar um MP4 isolado. Fazer uma comparação com o mesmo vídeo e cenário do G5: precisão e latência de seek, frame stepping, sincronização de áudio, CPU/GPU/RAM, codecs necessários, hardware decode, cancelamento, estabilidade ao abrir/fechar projetos e custo de distribuir dependências. O critério decisivo de integração é compor vídeo e camadas G5 na mesma superfície, sem depender de uma janela nativa que impeça overlays livres. O teste pode concluir por backend diferente para playback e frame decode.

FFmpeg permanece candidato para probing, processamento, encode e mux, encapsulado por `ExportEngine`/serviços. Não assumir que playback, edição e export devem usar a mesma biblioteca. A decisão entre bindings .NET e processo FFmpeg controlado também fica para a prova de conceito e análise de distribuição/licença.

Referências técnicas: [MediaPlayerControl e backend Media Foundation no Windows](https://docs.avaloniaui.net/controls/media/mediaplayer/media-playback), [Microsoft: Media Foundation em vez de DirectShow quando possível](https://learn.microsoft.com/en-us/windows/win32/directshow/processing-data-in-a-dmo), [IMFMediaEngine](https://learn.microsoft.com/en-us/windows/win32/api/mfmediaengine/).

## 11. Modelo de personagem único

Definir uma representação canônica que sirva às ferramentas de criação e de personalização:

- Modelo corporal com peças, hierarquia, articulações e pontos de encaixe.
- Pose com transformações locais relativas à hierarquia.
- Aparência com cabelo, rosto, roupas, acessórios e cores.
- Ordem de camadas explícita, com critérios determinísticos para empates.
- Referências de recursos por identificador estável.
- Unidades, origem, eixos, pivôs e regras de espelhamento documentados.
- Separação entre definição do modelo, personagem salvo e estado temporário da prévia.

O tronco e as articulações reais orientam as transformações conectadas. As roupas são recursos associados ao corpo e não se tornam peças corporais por conveniência da interface. Alterar o zoom da prévia não modifica as dimensões salvas do personagem.

Antes de implementar todos os ajustes, estabelecer exemplos de referência com resultados visuais conhecidos: pose neutra, rotação de braço, espelhamento, roupa vinculada e personagem com proporções alteradas.

## 12. Dados e arquivos do usuário

Usar SQLite para metadados estruturados e relacionamentos. Guardar imagens e outros arquivos grandes no armazenamento de recursos, referenciados pelo banco. Não persistir imagens repetidas como base64 em cada registro de personagem ou pose.

`GV5.Data` é o DataPlatform central. Os módulos não abrem conexões SQLite nem constroem seus próprios repositórios de arquivo; enviam comandos e queries pelas interfaces de Application, enquanto Data implementa armazenamento e coordena migrations registradas pelos módulos.

Estrutura conceitual da pasta de dados:

```text
%LOCALAPPDATA%/Gacha Nymi/G-V5/
  database/gv5.sqlite3
  assets/<hash-do-conteudo>.<extensao>
  thumbnails/
  projects/
  backups/
  cache/
  logs/
  temp/
```

`IAppDataPaths` é o contrato único dos caminhos. `GV5.Data` fornece o resolvedor padrão sob o perfil local do usuário; testes podem injetar uma raiz temporária. Resolver caminhos não cria pastas. `EnsureDirectoriesExist` é explícito e cria somente as pastas controladas pelo G-V5. Não depender da pasta atual do terminal, do executável ou do repositório, nem reutilizar a pasta de dados do Electron.

O ownership relacional inicial, as convenções de IDs/revisões/JSON e as relações entre módulos estão especificados em `docs/data/SCHEMA_DESIGN.md`. Esse desenho antecede o DDL e as migrations, que serão implementados nas tarefas F02.03–F02.04.

Depois do primeiro fluxo vertical persistente, definir o formato portátil `.gv5project`: manifesto com versão, objetos/revisões usados, dependências e hashes; assets podem ser incluídos para arquivamento/transferência e verificados na importação. O pacote deve abrir sem depender de caminhos locais da máquina de origem. Não implementar o contêiner completo antes de validar os modelos de dados e dependências.

Entidades iniciais previstas: modelos, peças, articulações, poses, personagens, roupas, conjuntos de rosto, recursos e referências entre eles. Cada domínio deve detalhar seu esquema antes de implementar suas gravações. Evitar tanto uma tabela gigante de JSON quanto fragmentar cada pequeno valor em tabelas desnecessárias. JSON versionado pode servir para configurações flexíveis que não precisem de consultas relacionais.

Regras essenciais:

- IDs estáveis independentes do nome exibido e da posição em listas.
- Chaves estrangeiras, índices, unicidade e restrições de valores quando aplicáveis.
- Datas com convenção única, versão do produto SemVer e revisão para detectar gravações desatualizadas.
- Versão de schema/migration independente da versão do produto. Cada release registra compatibilidade e caminho de atualização; updater pode ser implementado depois.
- Migrações numeradas e backup consistente antes de atualizações de esquema.
- Backups versionados com manifesto de formato, versão do produto e schema, inventário de conteúdo e hashes; criação consistente para SQLite, sem copiar apenas o arquivo principal durante gravações/WAL ativos.
- Restore de backup verificado em ambiente isolado antes de considerar a operação concluída; relatório de itens restaurados e incompatíveis.
- Quando o formato portátil `.gv5project` entrar após o primeiro fluxo vertical, ele terá manifesto versionado e verificação de integridade.
- Nenhuma exclusão de arquivo compartilhado enquanto houver referências válidas.

Banco e arquivos não participam da mesma transação automaticamente. A importação deve preparar o recurso em área temporária, validar, publicar o arquivo e confirmar suas referências no banco, com recuperação de operações interrompidas. A limpeza de recursos órfãos será uma operação explícita e recuperável.

Antes de abrir/exportar projeto, uma verificação de integridade pode apontar assets ausentes, referências quebradas, revisões incompatíveis, arquivos corrompidos e migrações pendentes. Reparos são propostas revisáveis; nunca modificar ou descartar arquivos automaticamente quando houver risco de perda.

## 13. Edição, desfazer e salvamento

Representar ações importantes por comandos reversíveis: mover peça, alterar pivô, aplicar pose, trocar roupa, duplicar personagem e excluir item. O histórico é por workspace e pode agrupar operações entre painéis do mesmo documento. Uma interação contínua de arrastar gera uma única entrada, não centenas. Deltas são preferidos quando completos e seguros; checkpoints/snapshots têm limites explícitos de tamanho e retenção.

O estado de edição deve distinguir alterações temporárias e dados confirmados: `Saved`, `Dirty`, `Saving` e `Error`. Autosave grava somente entidades alteradas, com debounce e revisão para impedir sobrescritas. Usar journal/checkpoints recuperáveis; após encerramento inesperado, validar a última operação e oferecer recuperação sem substituir silenciosamente a versão confirmada. Ao fechar normalmente, aguardar gravações pendentes ou permitir uma decisão informada do usuário.

Agrupar mudanças rápidas e gravar apenas os registros necessários, dentro de transações. Usar uma política de escrita coordenada para evitar duas telas sobrescrevendo a mesma revisão. Não guardar um histórico ilimitado de imagens para implementar desfazer.

Manter também um registro compacto e recuperável de operações significativas (comando, alvo, revisão, horário, resultado e correlation ID). Agrupar gestos/transações e evitar gravar cada evento de mouse; esse registro ajuda a explicar falhas e restaurar um estado confirmado sem substituir o histórico de undo/redo da sessão.

Exclusões comuns podem ir para uma lixeira com restauração. Exclusão permanente é uma ação separada. Recursos necessários a uma sessão ou exportação em andamento não podem ser removidos silenciosamente.

## 14. Interface e novas áreas

Usar MVVM com ViewModels pequenos por tela ou painel e bindings compilados onde forem adequados. A composição da aplicação registra os serviços e as áreas disponíveis. Evitar um ViewModel global que conheça todos os detalhes do produto.

Cada nova área declara rota, título, permissões de edição quando necessárias, ViewModel e casos de uso. A navegação precisa liberar inscrições de eventos, cancelar tarefas e descartar recursos ao encerrar a sessão.

Layouts básicos podem começar fixos e responsivos. Depois dos primeiros fluxos, oferecer workspaces por área com painéis redimensionáveis, abas reorganizáveis, layouts nomeados/restauráveis, atalhos configuráveis e suporte a múltiplos monitores. Persistir preferências de layout separadas dos documentos e permitir redefinição segura.

Criar desde cedo um conjunto consistente de cores, espaçamentos, tipografia, botões, formulários, estados de carregamento e mensagens de erro. Suportar escala de tela, atalhos com contexto, foco de teclado e textos acessíveis. `GV5.DesignSystem` será a fonte única de tokens e controles visuais compartilhados.

Serviços de sistema entram por contratos na fronteira do app — `IFilePicker`, `IClipboard`, `INotificationService` e `IHardwareInfo` — com adaptadores Avalonia/Windows na composição. Módulos não chamam APIs do Windows diretamente.

Ordem oficial das áreas reconstruídas: Fabricador → Customizador → Studio → Base de Vídeos → Roteiros → Video Studio. Poses, Rosto, Roupas, Cabelos, Faces, Expressões e Animações começam como fluxos/seções do Fabricador conforme o modelo de domínio amadurecer; não criar páginas fictícias para antecipar o produto.

Quando forem implementadas, as áreas adicionais seguem estes limites:

- **Studio:** uma cena contém entidades com IDs e transformações próprias: fundo, personagem, imagem, objeto, fala, pensamento e texto. Consumirá personagens por contratos de Core/Characters/Rendering e não poderá importar classes de View, controle ou ViewModel do Fabricador ou Customizador. Alterar `Transform.X`/`Transform.Y` atualiza o item e sua visualização, preservando o restante da cena. Transformações e overrides pertencem à cena/personagem local e não modificam a revisão publicada de origem.
- **Base de Vídeos:** biblioteca própria com `VideoAsset` (ID estável, arquivo original/AssetId, hash, duração, resolução, FPS, codecs, data de criação, categorias/tags, thumbnail e estado de proxy), além de `VideoLibraryService`, `VideoMetadataService` e `ThumbnailService`. Metadados e arquivos são geridos pela plataforma de dados/assets; não pertencem ao módulo Roteiros.
- **Roteiros:** entidades próprias como `Roteiro`, Sections, TikToks, Dialogues, Reactions, CharacterReferences e VideoReferences. Referenciar vídeos da biblioteca por `VideoId`, sem copiar nem persistir a biblioteca dentro do roteiro. Persistir alterações por entidade/ID/revisão (por exemplo `RoteiroId`, `SectionId`, `BlockId`, `Revision`), agrupando mudanças rápidas e gravando apenas o que mudou.
- **Video Studio:** última grande área da reconstrução. `TimelineControl` apresenta faixas de vídeo, áudio, texto, personagem, keyframes e playhead. Edição de timeline vive em regras testáveis; playback, frame decode e exportação usam serviços/jobs separados da View. FFmpeg pode ser encapsulado para processamento de vídeo.
- **Opções e navegação:** preferências da interface não são gravadas junto de dados de personagem. Janelas e diálogos pertencem ao shell e aos serviços de interação com o sistema.

## 15. Prévia, jobs e desempenho

- Uma superfície de composição de personagem, em vez de reconstruir a tela inteira para cada ajuste.
- Atualização limitada às peças e propriedades alteradas.
- Carregamento assíncrono de recursos, com primeiro resultado útil aparecendo cedo.
- Fila limitada de geração de miniaturas, priorizando os itens visíveis.
- Cache por conteúdo e parâmetros de renderização, com limite de bytes e descarte de recursos nativos.
- Cancelamento e número de geração para impedir uma prévia antiga de substituir uma edição mais recente.
- Listas com virtualização quando a quantidade de itens justificar.
- Transformações rápidas durante o arraste; tarefas caras agrupadas ao confirmar a edição quando isso preservar o resultado esperado.
- Nenhuma gravação, decodificação ou processamento demorado executado diretamente no thread da interface.

`GV5.Jobs` fornece filas com concorrência limitada, `CancellationToken`, estado de progresso e resultados explícitos. Usar `async/await` para aguardar I/O e tarefas de worker para trabalho de CPU; não criar uma thread ou processo por item. As operações que podem ser interrompidas devem verificar cancelamento em limites seguros. FFmpeg pode continuar como processo externo para probing, encode e mux de vídeo, encapsulado por serviços que reportam saída, erro, cancelamento e recuperação. A UI só exibe o progresso e envia comandos de iniciar/cancelar.

Um cache compartilhado mantém orçamento total de memória em bytes, LRU, leases e métricas de hit/miss/eviction. Ele inclui imagens decodificadas, thumbnails e personagens/cenas resolvidos; entradas descartáveis podem ser regeneradas e nunca definem a fonte de verdade.

Usar `SkiaRenderer` como engine de desenho do G5 desde o primeiro fluxo de personagem. Avalonia apresenta o resultado e desenha a interface; `DrawingContext` atende elementos simples da UI, e a ponte de desenho customizado apresenta a saída do renderer no canvas. Manter raster CPU como primeiro caminho funcional, medir e só então decidir a estratégia GPU. GPU e C# não garantem fluidez se a interface continuar fazendo trabalho desnecessário.

Registrar abertura fria e quente, tempo até a primeira prévia, latência de arraste, tempo de salvamento, memória e recursos retidos depois de fechar um projeto. Definir metas com um primeiro cenário medido no computador de uso, em vez de prometer números sem evidência.

## 16. Falhas, logs e suporte

Erros esperados devem ter resultado tipado: arquivo ausente, formato inválido, conflito de revisão, acesso negado e falta de espaço. Exibir uma mensagem útil com a ação que falhou e a possibilidade de tentar novamente quando aplicável.

Logs locais devem incluir operação, duração, módulo e identificador de correlação, com rotação e limite de tamanho. Métricas internas registram tempos de abertura, renderização, queries, jobs, memória e erros. Não registrar imagens, textos privados, segredos ou caminhos pessoais completos por padrão. Um relatório de diagnóstico exportável deve permitir revisão antes de compartilhar.

Falhas inesperadas precisam preservar o último estado confirmado e informar quando uma operação ficou incompleta. Não usar um capturador global de exceções para fingir que uma operação foi concluída. Em falhas repetidas na abertura, oferecer modo seguro: iniciar shell mínimo, suspender autoabertura do último projeto, ignorar caches regeneráveis e desabilitar áreas opcionais para permitir diagnóstico e recuperação. Um inspetor de projeto avançado e reparações assistidas entram após os primeiros fluxos completos; validações básicas de integridade são obrigatórias desde as primeiras importações.

Ferramentas internas podem expor banco, assets, cache, jobs, revisões, memória e eventos em um painel oculto, desativado por padrão e habilitado explicitamente em desenvolvimento. O painel observa e exporta diagnósticos; não altera diretamente dados de produção.

## 17. Verificações que acompanham a arquitetura

- Regras geométricas: articulações, pivôs, espelhamento, encaixe de roupas e ordem de camadas.
- Persistência: criar, editar, fechar, reabrir, migrar e recuperar uma gravação interrompida.
- Contratos: comandos e arquivos exportados continuam compatíveis.
- Comparação visual com referências aprovadas para o motor de personagem.
- Testes de fidelidade visual com imagens douradas de fixtures canônicas; diferenças de pixels usam tolerâncias explícitas e justificadas, além de diagnósticos de geometria/transparência.
- Contrato de compatibilidade Fabricador → Customizador → Studio → persistência: publicar modelo/pose/roupa/expressão, criar personagem com as revisões, carregar e editar no Studio, fechar/reabrir e comparar o resultado visual.
- Regressão de revisão: publicar alteração nova no Fabricador e verificar que personagens/cenas existentes mantêm a revisão fixada até uma atualização controlada.
- Interface: fluxos essenciais, atalhos, desfazer e fechar com mudanças pendentes.
- Desempenho: o mesmo cenário antes e depois da mudança, com quantidades de peças e personagens documentadas.
- Arquitetura: dependências entre projetos respeitam os limites definidos.
- Fixtures canônicas: modelo simples e complexo, roupa, face, cabelo, pose e transformações extremas.
- Testes de arquitetura: `Core` não referencia Avalonia; Studio não importa Views/controles do Fabricador ou Customizador; módulos acessam dados apenas via contratos; dependências proibidas falham no CI.
- Restauração de backup: validar manifesto e hashes, restaurar em área temporária e abrir o resultado antes de reportar sucesso.
- Benchmarks repetíveis: 100 personagens, 1000 poses, 5000 assets, imagens grandes e cache cheio, registrando baseline e ambiente.

Compilar não comprova correção visual. Uma verificação automática também não substitui executar o aplicativo no Windows e manipular um personagem real. Novos testes devem proteger regras e riscos concretos, sem apenas repetir a implementação.

## 18. Importação do legado e independência

O legado será fonte de referência e importação, nunca biblioteca obrigatória do novo aplicativo. Criar `tools/GV5.Legacy.Electron`, uma ferramenta de importação versionada que entende os formatos antigos e conversa com o novo armazenamento por formatos/contratos de intercâmbio. O executável principal não referencia nem distribui esse projeto; ele pode ser removido quando a migração terminar.

Não escrever no banco ou nos arquivos originais do Electron. Conservar IDs de origem em um mapeamento de importação para evitar duplicar itens na repetição do processo. Validar transparência, dimensões, vínculos, camadas e poses, além da contagem de arquivos.

Antes de excluir o legado, provar que uma cópia contendo somente `master avalonia` compila e executa, que os recursos necessários foram importados, que backups e restauração funcionam e que os fluxos usados foram aceitos. A exclusão futura do legado será uma ação explícita do usuário.

## 19. Primeiras entregas, na ordem

1. **Contratos mínimos da plataforma:** shell, IDs/revisões e dados versionados, padrão de coordenadas/cores, DataPlatform inicial, limites entre módulos, Geometry/Assets e o primeiro pipeline `RenderScene`/SkiaRenderer. Criar fixtures visuais mínimas e verificações de arquitetura desde já. Critério: app compila, persiste o primeiro objeto e renderiza um asset sem dependência do legado. Não antecipar painel de diagnóstico completo, updater, sistema sofisticado de plugins ou layouts avançados.
2. **Fabricador:** modelos, parts/layers, joints/pivôs/transformações, poses, roupas, cabelo, face/expressões, animações, importação/chroma, undo/redo e publicação de assets imutáveis. Priorizar grafo de dependências/reverse lookup e renderização incremental. Critério: criar/editar/publicar/reabrir preservando geometria, transparência, vínculos e aparência; nova revisão não altera consumidores existentes silenciosamente.
3. **Customizador:** consumir por IDs e revisões estáveis (`ModelId`, `PoseId`, `WardrobeId`, `HairId`, `FaceId`, `ExpressionId`), montar `Character` por `CharacterResolver` e salvar modificadores próprios sem alterar assets globais. Priorizar atualização seletiva do render e testar que mudanças localizadas recalculam apenas dependências afetadas. Critério: Fabricador e Customizador renderizam o mesmo conteúdo de forma consistente.
4. **Studio:** reutilizar `CharacterResolver` e `RenderingEngine`; adicionar Scene Engine e entidades de fundo, personagem, imagem, objeto, texto, fala e pensamento. Critério: montar uma cena com personagens salvos, reabrir e obter o mesmo resultado visual; confirmar por teste de arquitetura que Studio não referencia nenhum assembly/classe de UI do Fabricador ou Customizador. Este é o primeiro grande marco de validação da plataforma compartilhada.
5. **Base de Vídeos:** implementar biblioteca e serviços de metadados/miniaturas, categorias/tags, IDs, arquivos originais e integridade. Critério: importar, catalogar, reabrir, localizar e remover referências sem misturar a biblioteca com roteiros.
6. **Roteiros:** construir seções/blocos e referências a personagens e `VideoId`; salvar incrementalmente por entidade/revisão. Critério: editar texto e vínculos sem regravar a biblioteca nem o roteiro inteiro por tecla; fechar/reabrir preserva a estrutura.
7. **Video Studio, por último:** iniciar timeline, playback/frame decoder, áudio, keyframes, transições e export somente após as etapas anteriores estarem persistentes e utilizáveis. Escolher backends com a prova de conceito da seção de mídia.

Após o gate Fabricador → Customizador → Studio, evoluir o empacotamento `.gv5project`, inspetor/reparo avançado, workspaces personalizados e laboratório interno completo. Jobs, autosave, cache, backups e diagnósticos básicos crescem junto com a primeira operação real que precisar deles; as versões avançadas seguem as prioridades acima.

### Gate obrigatório antes do Video Studio

Nenhum código específico de edição/playback/export do Video Studio será desenvolvido antes de Fabricador → Customizador → Studio completar um fluxo vertical persistente. Contratos gerais e decisões de arquitetura podem ser documentados antes; o gate bloqueia implementar o módulo de vídeo antecipadamente.

```text
Fabricador: criar/publicar modelo, pose e roupa
        ↓
Customizador: criar personagem, aplicar modelo/pose/roupa e ajustes
        ↓ salvar e fechar o aplicativo
Reabrir: os dados permanecem íntegros
        ↓
Studio: carregar o mesmo personagem com aparência correta
```

Esse fluxo deve ser demonstrado com assets reais e dados persistidos antes de avançar para Base de Vídeos e Roteiros. Para cada fase, exigir critérios de saída documentados: funcionalidade, persistência, comparação visual e recuperação de erros aplicáveis. Não avançar apenas porque a tela está desenhada.

## 20. Ideias adicionais para evoluir sem perder controle

- Recuperar rascunhos após encerramento inesperado.
- Prévia de importação antes de confirmar alterações na biblioteca.
- Mostrar quais personagens utilizam uma roupa, pose ou recurso antes de excluir.
- Presets de interface e atalhos configuráveis, separados dos dados de personagens.
- Comparação visual antes/depois de um ajuste.
- Exportação de pacote de personagem com todos os recursos necessários.
- Ferramenta local para verificar integridade e relatar recursos ausentes.
- Histórico de revisões do personagem com retenção limitada e restauração.
- Recursos experimentais liberados por opção, com formato de dados protegido por versão.
- Modo de diagnóstico que mede desempenho por operação, ativado explicitamente.

## 21. O que não construir antecipadamente

Evitar microserviços, servidor obrigatório, sistema de plugins de terceiros, barramento global de eventos para qualquer alteração e dezenas de camadas genéricas. Começar com módulos claros dentro de uma solução e expandir a estrutura quando houver uma necessidade demonstrada.

Antes do código inicial, confirmar as decisões de versão do .NET/Avalonia, localização dos dados, convenção geométrica, representação de personagem e primeiro modelo de referência. As decisões técnicas devem ficar documentadas perto do código e ser revisáveis.
