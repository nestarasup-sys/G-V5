# Novo Gacha Nymi — C# + Avalonia

Status: proposta de arquitetura, antes da implementação.

## Ambiente de desenvolvimento sem Visual Studio

A escolha é C# + Avalonia + SDK .NET portátil, com scripts `.bat`. O Visual Studio não será requisito. O SDK fica em `.tools/dotnet`, o perfil da CLI e os templates em `.tools/cli-home`, e o cache de pacotes em `.packages`, todos dentro desta pasta e ignorados pelo Git.

Versões iniciais fixadas: .NET SDK **10.0.402** (linha .NET 10 LTS) e templates Avalonia **12.1.4**. O `global.json` exige o SDK escolhido. O SDK inclui runtime, compilador e ferramentas de compilação; não é preciso instalar um runtime separado para desenvolver.

- `Preparar.bat`: baixa o SDK do servidor oficial, verifica SHA-512 e instala os templates Avalonia no perfil local.
- `Desenvolver.bat`: usa o SDK local e inicia `dotnet watch` quando o projeto Desktop existir. Antes disso, informa que a criação do app ainda está pendente.
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

O novo G5 é uma reconstrução de produto, não uma conversão mecânica de telas. Fabricador, Customizador, Studio, Video Studio, Roteiros, Base de Vídeos e Opções poderão ser reconstruídos nessa stack, cada um após seus modelos, fluxos e formatos de dados terem sido definidos.

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
    GV5.Data/                   # SQLite, implementação de arquivos e migrations
    GV5.Jobs/                   # filas, workers, cancelamento e progresso
    GV5.Modules.Fabricador/     # telas e fluxos próprios do Fabricador
    GV5.Modules.Customizador/   # telas e fluxos próprios do Customizador
    GV5.Modules.Studio/         # criado quando seus contratos forem definidos
    GV5.Timeline/               # modelo e avaliação temporal, sem UI/FFmpeg
    GV5.Modules.VideoStudio/    # edição; reprodução e exportação em serviços
    GV5.Modules.Roteiros/
    GV5.Modules.BaseDeVideos/
    GV5.SharedUi/               # estilos e controles visuais realmente comuns
  tests/
    GV5.Core.Tests/
    GV5.Integration.Tests/
    GV5.Desktop.Tests/
  docs/
    decisions/                 # decisões curtas: motivo, alternativas e limite
    data/                      # esquema, migrações e recuperação
  tools/                       # ferramentas reproduzíveis de desenvolvimento
```

Essa lista é um mapa de responsabilidades, não uma ordem para criar projetos vazios. A engine é esse conjunto de bibliotecas C#/.NET, sem um monólito obrigatório chamado Engine. Começar com Core, Application, Geometry, Assets, Characters, Rendering, Data, Jobs, App e os módulos Fabricador/Customizador. Scene e Timeline entram ao iniciar esses domínios; os demais módulos entram quando começarem a ser implementados. `GV5.SharedUi` só recebe controles ou estilos com uso realmente compartilhado; não vira uma pasta para regras de negócio.

Direção das dependências:

```text
GV5.App ───────────────→ GV5.Modules.*
GV5.Modules.* ─────────→ GV5.Application ─→ GV5.Core
GV5.Application ───────→ contratos de engine e dados
GV5.Characters ────────→ GV5.Core + GV5.Geometry + GV5.Assets
GV5.Scene ─────────────→ GV5.Characters + GV5.Assets + GV5.Geometry
GV5.Rendering ─────────→ GV5.Scene + GV5.Assets + SkiaSharp
GV5.Timeline ──────────→ GV5.Scene / GV5.Core
GV5.Data ──────────────→ contratos de GV5.Application / GV5.Assets
GV5.Jobs ──────────────→ contratos de GV5.Application
```

Módulos de produto não importam implementações internas uns dos outros. Fabricador e Customizador usam o mesmo modelo e os mesmos serviços públicos do domínio. Integrações passam por contratos em Application ou Core. Referências proibidas devem ser verificadas no build ou em uma verificação de arquitetura; uma orientação escrita sozinha não impede dependências acidentais.

`GV5.Core`, `GV5.Geometry`, `GV5.Assets`, `GV5.Characters`, `GV5.Scene`, `GV5.Rendering` e `GV5.Timeline` não dependem de Avalonia. `GV5.Core` também não conhece SQLite, sistema de arquivos ou FFmpeg. `GV5.Application` expressa operações como comandos e casos de uso. `GV5.Data` implementa persistência. `GV5.Rendering` compõe a cena com SkiaSharp. `GV5.Jobs` coordena trabalho demorado. `GV5.App` monta serviços, abre janelas e hospeda Views, ViewModels e controles que fazem a ponte entre input Avalonia e a engine.

Usar MVVM com Views e ViewModels pequenos por fluxo. A View encaminha intenção; o ViewModel coordena estado da tela e solicita casos de uso; o domínio mantém invariantes. Evitar code-behind com regras e um ViewModel global com acesso a todas as áreas. Cada módulo publica uma entrada pequena de navegação e seus serviços; não criar um sistema de plugins dinâmico no início.

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

Operações de usuário entram como comandos pequenos: `MovePartCommand`, `RotatePartCommand`, `ResizePartCommand`, `AttachJointCommand` e `PublishPoseCommand`. Um gesto contínuo de drag deve consolidar uma mudança em um único passo de undo/redo. O histórico armazena deltas reversíveis quando forem suficientes; snapshots limitados podem ser usados quando o estado relacionado não puder ser representado com segurança por um delta. Não impor delta a todo custo.

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

## 6. Geometria independente da interface

`GV5.Geometry` contém as regras matemáticas em C# puro, sem Avalonia ou SkiaSharp:

- Matrix, Transform2D, bounds, pivô e crop.
- Joints, bones e transformações locais/ancestrais.
- Hit testing, seleção, snap e validação geométrica.
- Conversões entre coordenadas do modelo, da cena, do canvas e da tela ficam em adaptadores explícitos; zoom e pan de visualização não alteram transformações salvas.

Fabricador, Studio e Video Studio podem consultar a mesma geometria, por exemplo para descobrir qual peça está sob o cursor. O input do mouse vem da UI; a resposta espacial é calculada pela biblioteca de geometria.

## 7. Scene Engine e Rendering Engine

`GV5.Scene` descreve o que deve aparecer. `CharacterRenderSceneBuilder` converte um personagem resolvido em `RenderScene`, uma lista ordenada de layers. Cada layer contém `AssetId`, Transform, Opacity, Crop, Flip, ZIndex e BlendMode. Scene também representa Background, Character, Image, Text, SpeechBubble e Effect com IDs, visibilidade, seleção e transformações próprias.

`GV5.Rendering` começa com `SkiaRenderer`, implementado em C#/.NET sobre SkiaSharp. Ele recebe uma cena pronta e desenha a composição. Regras de personagem, hit testing, timeline e persistência não entram no renderer. FabricatorCanvas pode pedir `engine.GetScene(...)`, receber uma cena imutável e solicitar nova apresentação quando seus dados mudarem.

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

Catálogos não abrem imagens originais para desenhar cartões. `ThumbnailService` gera miniaturas, por exemplo 256×256, em background, mantém cache em disco por hash do original e versão das transformações, e entrega o thumbnail para a UI. Gerar thumbnail novamente só quando não existe ou quando original/transformação mudou.

A composição usada pela prévia e pelo export compartilha `RenderScene` e regras visuais, embora possa usar superfícies distintas. A implementação raster CPU em SkiaSharp pode ser usada em trabalhos isolados e testáveis. GPU offscreen fica para depois de confirmar como contexts e superfícies serão geridos; nunca criar/destruir recursos GPU por item ou dentro de cada frame.

## 9. Jobs, filas e cancelamento

`GV5.Jobs` é o ponto coordenado para trabalho que não deve bloquear interação:

- RenderCharacter e GeneratePosePreview.
- CreateThumbnail e ProcessChroma.
- ImportModel e ImportVideo.
- ExportVideo, Backup e Migration.

Cada job tem ID, prioridade, progresso, `CancellationToken`, status e erro/result. Limitar concorrência e aplicar contrapressão; thumbnail em segundo plano não deve impedir uma prévia interativa. Decodificação, análise de assets, cálculo de geometria derivada e preparação de cenas ocorrem em workers apropriados. Resultados retornam como dados imutáveis; só a UI atualiza ViewModels e controles pelo Dispatcher.

Renderizações são identificadas pela versão/assinatura da entrada. Quando o usuário escolhe Pose 1, 2, 3, 4 e rapidamente chega à Pose 5, jobs ainda não iniciados ou canceláveis das quatro poses anteriores são cancelados; somente o resultado ainda atual pode substituir a prévia. Cancelamento em trabalho já iniciado é cooperativo nos pontos seguros. A UI ignora resultados atrasados mesmo quando uma biblioteca não pode interromper a operação imediatamente.

## 10. Timeline Engine e mídia

Quando o Video Studio começar, `GV5.Timeline` será outro consumidor da Scene Engine. Ele resolve tracks, clips, frames, keyframes, transitions, áudio e estados de personagens. Para um frame pedido, produz uma `Scene` daquele instante; Scene Engine resolve entidades e `GV5.Rendering` desenha o frame. Preview e export usam a mesma avaliação temporal, evitando duas interpretações da timeline.

```text
Timeline
  ↓ evaluate frame 1230
Scene at frame 1230
  ↓
Scene Engine → Rendering Engine → frame
```

FFmpeg continua responsável pelo trabalho especializado de mídia. `VideoEngine` encapsula decoder/probing e `ExportEngine` reúne frames e áudio para produzir o arquivo final. A decisão entre bindings como FFmpeg.AutoGen e processo FFmpeg controlado fica adiada; os módulos dependem de contratos de serviço, não da escolha de binding/processo.

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

Estrutura conceitual da pasta de dados:

```text
GachaNymiAvalonia/
  database/app.db
  assets/<hash-do-conteudo>.<extensao>
  thumbnails/
  backups/
  logs/
  temp/
```

A localização real será resolvida por um serviço de armazenamento. Não depender da pasta atual do terminal ou do repositório. Um modo portátil poderá ser criado depois, com seleção explícita de diretório.

Entidades iniciais previstas: modelos, peças, articulações, poses, personagens, roupas, conjuntos de rosto, recursos e referências entre eles. Cada domínio deve detalhar seu esquema antes de implementar suas gravações. Evitar tanto uma tabela gigante de JSON quanto fragmentar cada pequeno valor em tabelas desnecessárias. JSON versionado pode servir para configurações flexíveis que não precisem de consultas relacionais.

Regras essenciais:

- IDs estáveis independentes do nome exibido e da posição em listas.
- Chaves estrangeiras, índices, unicidade e restrições de valores quando aplicáveis.
- Datas com convenção única e revisão para detectar gravações desatualizadas.
- Migrações numeradas e backup consistente antes de atualizações de esquema.
- Backup feito com mecanismo consistente para SQLite; não copiar apenas o arquivo principal enquanto há gravações ou arquivos WAL ativos.
- Exportação e importação de projeto com manifesto versionado e verificação de integridade.
- Nenhuma exclusão de arquivo compartilhado enquanto houver referências válidas.

Banco e arquivos não participam da mesma transação automaticamente. A importação deve preparar o recurso em área temporária, validar, publicar o arquivo e confirmar suas referências no banco, com recuperação de operações interrompidas. A limpeza de recursos órfãos será uma operação explícita e recuperável.

## 13. Edição, desfazer e salvamento

Representar ações importantes por comandos: mover peça, alterar pivô, aplicar pose, trocar roupa, duplicar personagem e excluir item. Uma interação contínua de arrastar gera uma única entrada no histórico, não centenas.

O estado de edição deve distinguir alterações temporárias e dados confirmados. Definir estados visíveis como: salvo, alterações pendentes, salvando e falha ao salvar. Ao fechar, aguardar gravações pendentes ou permitir uma decisão informada do usuário.

Agrupar mudanças rápidas e gravar apenas os registros necessários, dentro de transações. Usar uma política de escrita coordenada para evitar duas telas sobrescrevendo a mesma revisão. Não guardar um histórico ilimitado de imagens para implementar desfazer.

Exclusões comuns podem ir para uma lixeira com restauração. Exclusão permanente é uma ação separada. Recursos necessários a uma sessão ou exportação em andamento não podem ser removidos silenciosamente.

## 14. Interface e novas áreas

Usar MVVM com ViewModels pequenos por tela ou painel e bindings compilados onde forem adequados. A composição da aplicação registra os serviços e as áreas disponíveis. Evitar um ViewModel global que conheça todos os detalhes do produto.

Cada nova área declara rota, título, permissões de edição quando necessárias, ViewModel e casos de uso. A navegação precisa liberar inscrições de eventos, cancelar tarefas e descartar recursos ao encerrar a sessão.

Criar desde cedo um conjunto consistente de cores, espaçamentos, tipografia, botões, formulários, estados de carregamento e mensagens de erro. Suportar escala de tela, atalhos com contexto, foco de teclado e textos acessíveis.

Primeiras áreas: Fabricador e Customizador. Poses, Rosto e Roupas podem começar como seções do Fabricador. Studio, Roteiros e Base de Vídeos só entram quando seus contratos estiverem definidos; não criar páginas fictícias para antecipar todo o produto.

Quando forem implementadas, as áreas adicionais seguem estes limites:

- **Studio:** uma cena contém entidades com IDs e transformações próprias: fundo, personagem, imagem, balão e texto. Alterar `Transform.X`/`Transform.Y` atualiza o item e sua visualização, preservando o restante da cena.
- **Video Studio:** `TimelineControl` apresenta faixas de vídeo, áudio, texto, personagem, keyframes e playhead. Edição de timeline vive em regras testáveis; reprodução e exportação usam serviços/jobs separados da View. FFmpeg continua apto a ser encapsulado para processamento de vídeo.
- **Roteiros e Base de Vídeos:** ViewModels e casos de uso próprios, com entidades, vínculos e operações explícitas. Recursos grandes são referências ao AssetStore. Nenhuma dessas áreas depende dos controles internos do Studio ou do Video Studio.
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

Usar `SkiaRenderer` como engine de desenho do G5 desde o primeiro fluxo de personagem. Avalonia apresenta o resultado e desenha a interface; `DrawingContext` atende elementos simples da UI, e a ponte de desenho customizado apresenta a saída do renderer no canvas. Manter raster CPU como primeiro caminho funcional, medir e só então decidir a estratégia GPU. GPU e C# não garantem fluidez se a interface continuar fazendo trabalho desnecessário.

Registrar abertura fria e quente, tempo até a primeira prévia, latência de arraste, tempo de salvamento, memória e recursos retidos depois de fechar um projeto. Definir metas com um primeiro cenário medido no computador de uso, em vez de prometer números sem evidência.

## 16. Falhas, logs e suporte

Erros esperados devem ter resultado tipado: arquivo ausente, formato inválido, conflito de revisão, acesso negado e falta de espaço. Exibir uma mensagem útil com a ação que falhou e a possibilidade de tentar novamente quando aplicável.

Logs locais devem incluir operação, duração, módulo e identificador de correlação, com rotação e limite de tamanho. Não registrar imagens, textos privados, segredos ou caminhos pessoais completos por padrão. Um relatório de diagnóstico exportável deve permitir revisão antes de compartilhar.

Falhas inesperadas precisam preservar o último estado confirmado e informar quando uma operação ficou incompleta. Não usar um capturador global de exceções para fingir que uma operação foi concluída.

## 17. Verificações que acompanham a arquitetura

- Regras geométricas: articulações, pivôs, espelhamento, encaixe de roupas e ordem de camadas.
- Persistência: criar, editar, fechar, reabrir, migrar e recuperar uma gravação interrompida.
- Contratos: comandos e arquivos exportados continuam compatíveis.
- Comparação visual com referências aprovadas para o motor de personagem.
- Interface: fluxos essenciais, atalhos, desfazer e fechar com mudanças pendentes.
- Desempenho: o mesmo cenário antes e depois da mudança, com quantidades de peças e personagens documentadas.
- Arquitetura: dependências entre projetos respeitam os limites definidos.

Compilar não comprova correção visual. Uma verificação automática também não substitui executar o aplicativo no Windows e manipular um personagem real. Novos testes devem proteger regras e riscos concretos, sem apenas repetir a implementação.

## 18. Importação do legado e independência

O legado será fonte de referência e importação, nunca biblioteca obrigatória do novo aplicativo. Criar importadores versionados em C# que copiem os dados selecionados e gerem um relatório de itens importados, ignorados e incompatíveis.

Não escrever no banco ou nos arquivos originais do Electron. Conservar IDs de origem em um mapeamento de importação para evitar duplicar itens na repetição do processo. Validar transparência, dimensões, vínculos, camadas e poses, além da contagem de arquivos.

Antes de excluir o legado, provar que uma cópia contendo somente `master avalonia` compila e executa, que os recursos necessários foram importados, que backups e restauração funcionam e que os fluxos usados foram aceitos. A exclusão futura do legado será uma ação explícita do usuário.

## 19. Primeiras entregas, na ordem

1. **Fundação executável:** solução C#, janela Avalonia, navegação entre Fabricador e Customizador, tema e diretório de dados próprios. Critério: abrir e fechar no Windows com logs e configuração persistente.
2. **Pipeline gráfico mínimo:** `ModelPart`, Transform, Pivot, Joint e ordem de camadas; `AssetStore`, decoder e cache compartilhado; `RenderScene` e `SkiaRenderer`; `CharacterResolver` fornecendo a cena. Critério: abrir um modelo real, renderizar, selecionar, mover, girar, salvar, fechar e reabrir com o mesmo resultado.
3. **Edição confiável:** articulações, comandos, desfazer/refazer e SQLite integrados ao pipeline gráfico. Critério: salvar, fechar e reabrir preserva o resultado, inclusive após falha simulada de gravação.
4. **Primeiro Customizador:** criar personagem a partir do modelo, aplicar roupa e aparência facial usando o mesmo resolver e renderer do Fabricador. Critério: ambas as áreas concordam sobre encaixe, camadas e proporções.
5. **Bibliotecas úteis:** miniaturas leves, busca, filtros, duplicação, lixeira e importação com progresso e cancelamento.
6. **Expansão controlada:** completar poses, rosto, cabelo, roupas e proporções, uma seção validada por vez.

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
