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

Avalonia é a camada da interface. Ela não será o lugar das regras de personagem, do esquema do banco, da codificação de vídeo ou de tarefas pesadas. XAML descreve a estrutura visual; C# liga eventos de interface a ViewModels e casos de uso. Controles especializados, como canvas e timeline, podem tratar input e desenho, mas chamam contratos do módulo e não implementam as regras de domínio.

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
    GV5.Rendering/              # composição, geometria, cache e miniaturas
    GV5.Data/                   # SQLite, AssetStore, migrations, backups
    GV5.Jobs/                   # filas, workers, cancelamento e progresso
    GV5.Modules.Fabricador/     # telas e fluxos próprios do Fabricador
    GV5.Modules.Customizador/   # telas e fluxos próprios do Customizador
    GV5.Modules.Studio/         # criado quando seus contratos forem definidos
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

Essa lista é um mapa de responsabilidades, não uma ordem para criar projetos vazios. Começar com Core, Application, Rendering, Data, Jobs, App e os módulos Fabricador/Customizador. Os demais módulos entram quando começarem a ser implementados. `GV5.SharedUi` só recebe controles ou estilos com uso realmente compartilhado; não vira uma pasta para regras de negócio.

Direção das dependências:

```text
GV5.App ───────────────→ GV5.Modules.*
GV5.Modules.* ─────────→ GV5.Application ─→ GV5.Core
GV5.Application ───────→ contratos de Rendering, Data e Jobs
GV5.Rendering ─────────→ GV5.Core
GV5.Data ──────────────→ GV5.Application / GV5.Core
GV5.Jobs ──────────────→ contratos de GV5.Application
```

Módulos de produto não importam implementações internas uns dos outros. Fabricador e Customizador usam o mesmo modelo e os mesmos serviços públicos do domínio. Integrações passam por contratos em Application ou Core. Referências proibidas devem ser verificadas no build ou em uma verificação de arquitetura; uma orientação escrita sozinha não impede dependências acidentais.

`GV5.Core` não depende de Avalonia, SQLite, sistema de arquivos ou FFmpeg. `GV5.Application` expressa operações como comandos e casos de uso. `GV5.Data` implementa persistência e arquivos. `GV5.Rendering` produz a composição visual a partir de dados do domínio. `GV5.Jobs` coordena trabalho demorado. `GV5.App` monta serviços, abre janelas e hospeda Views/ViewModels.

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
                ICharacterRenderer
                         ↓
           prévia Avalonia / exportação
```

Trocar uma roupa altera uma seleção ou `CharacterWardrobeOverride`; o resolver recompõe a cena usando o modelo, encaixes e regras atuais. A mesma composição atende Customizador e Studio. O Video Studio consome estados de personagem em instantes de timeline. Isso evita que cada tela crie sua própria interpretação de camadas, articulações e aparência.

`CharacterResolver` resolve dados; `CharacterRenderer` desenha. A prévia pode reter recursos de desenho, enquanto o documento persistido contém identificadores, transformações e overrides. Um contrato de renderer deve existir para separar consumidor e implementação, sem prometer ou construir um segundo backend antes que haja caso real. No Avalonia 12, Skia é o backend recomendado e o Direct2D antigo foi removido; qualquer renderer alternativo futuro exigirá avaliação de compatibilidade.

## 6. Rendering, recursos e imagens

Referenciar mídia por `AssetId` e resolver o conteúdo através do `AssetStore`. Acesso a bytes usa streams ou buffers adequados ao trabalho; não serializar PNG em strings Base64 para transportar imagens entre camadas. A prévia pode manter `Bitmap` e cache de GPU limitados à sessão, mas esses objetos não são entidades do domínio nem persistência.

```text
AssetId → AssetStore → stream/arquivo → decoder → bitmap ou desenho em Skia
```

O caminho exato de decode/render será medido e seguirá as APIs do Avalonia/Skia da versão selecionada. A composição usada pela prévia e pelo export precisa compartilhar regras visuais, ainda que use alvos de renderização distintos. Thumbnails são derivados regeneráveis e podem ter tamanho menor que os originais.

## 7. Modelo de personagem único

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

## 8. Dados e arquivos do usuário

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

## 9. Edição, desfazer e salvamento

Representar ações importantes por comandos: mover peça, alterar pivô, aplicar pose, trocar roupa, duplicar personagem e excluir item. Uma interação contínua de arrastar gera uma única entrada no histórico, não centenas.

O estado de edição deve distinguir alterações temporárias e dados confirmados. Definir estados visíveis como: salvo, alterações pendentes, salvando e falha ao salvar. Ao fechar, aguardar gravações pendentes ou permitir uma decisão informada do usuário.

Agrupar mudanças rápidas e gravar apenas os registros necessários, dentro de transações. Usar uma política de escrita coordenada para evitar duas telas sobrescrevendo a mesma revisão. Não guardar um histórico ilimitado de imagens para implementar desfazer.

Exclusões comuns podem ir para uma lixeira com restauração. Exclusão permanente é uma ação separada. Recursos necessários a uma sessão ou exportação em andamento não podem ser removidos silenciosamente.

## 10. Interface e novas áreas

Usar MVVM com ViewModels pequenos por tela ou painel e bindings compilados onde forem adequados. A composição da aplicação registra os serviços e as áreas disponíveis. Evitar um ViewModel global que conheça todos os detalhes do produto.

Cada nova área declara rota, título, permissões de edição quando necessárias, ViewModel e casos de uso. A navegação precisa liberar inscrições de eventos, cancelar tarefas e descartar recursos ao encerrar a sessão.

Criar desde cedo um conjunto consistente de cores, espaçamentos, tipografia, botões, formulários, estados de carregamento e mensagens de erro. Suportar escala de tela, atalhos com contexto, foco de teclado e textos acessíveis.

Primeiras áreas: Fabricador e Customizador. Poses, Rosto e Roupas podem começar como seções do Fabricador. Studio, Roteiros e Base de Vídeos só entram quando seus contratos estiverem definidos; não criar páginas fictícias para antecipar todo o produto.

Quando forem implementadas, as áreas adicionais seguem estes limites:

- **Studio:** uma cena contém entidades com IDs e transformações próprias: fundo, personagem, imagem, balão e texto. Alterar `Transform.X`/`Transform.Y` atualiza o item e sua visualização, preservando o restante da cena.
- **Video Studio:** `TimelineControl` apresenta faixas de vídeo, áudio, texto, personagem, keyframes e playhead. Edição de timeline vive em regras testáveis; reprodução e exportação usam serviços/jobs separados da View. FFmpeg continua apto a ser encapsulado para processamento de vídeo.
- **Roteiros e Base de Vídeos:** ViewModels e casos de uso próprios, com entidades, vínculos e operações explícitas. Recursos grandes são referências ao AssetStore. Nenhuma dessas áreas depende dos controles internos do Studio ou do Video Studio.
- **Opções e navegação:** preferências da interface não são gravadas junto de dados de personagem. Janelas e diálogos pertencem ao shell e aos serviços de interação com o sistema.

## 11. Prévia, jobs e desempenho

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

Escolher primeiro os recursos de desenho do próprio Avalonia e medir. Uma integração direta adicional com Skia ou outra biblioteca só deve entrar por necessidade demonstrada. GPU e C# não garantem fluidez se a interface continuar fazendo trabalho desnecessário.

Registrar abertura fria e quente, tempo até a primeira prévia, latência de arraste, tempo de salvamento, memória e recursos retidos depois de fechar um projeto. Definir metas com um primeiro cenário medido no computador de uso, em vez de prometer números sem evidência.

## 12. Falhas, logs e suporte

Erros esperados devem ter resultado tipado: arquivo ausente, formato inválido, conflito de revisão, acesso negado e falta de espaço. Exibir uma mensagem útil com a ação que falhou e a possibilidade de tentar novamente quando aplicável.

Logs locais devem incluir operação, duração, módulo e identificador de correlação, com rotação e limite de tamanho. Não registrar imagens, textos privados, segredos ou caminhos pessoais completos por padrão. Um relatório de diagnóstico exportável deve permitir revisão antes de compartilhar.

Falhas inesperadas precisam preservar o último estado confirmado e informar quando uma operação ficou incompleta. Não usar um capturador global de exceções para fingir que uma operação foi concluída.

## 13. Verificações que acompanham a arquitetura

- Regras geométricas: articulações, pivôs, espelhamento, encaixe de roupas e ordem de camadas.
- Persistência: criar, editar, fechar, reabrir, migrar e recuperar uma gravação interrompida.
- Contratos: comandos e arquivos exportados continuam compatíveis.
- Comparação visual com referências aprovadas para o motor de personagem.
- Interface: fluxos essenciais, atalhos, desfazer e fechar com mudanças pendentes.
- Desempenho: o mesmo cenário antes e depois da mudança, com quantidades de peças e personagens documentadas.
- Arquitetura: dependências entre projetos respeitam os limites definidos.

Compilar não comprova correção visual. Uma verificação automática também não substitui executar o aplicativo no Windows e manipular um personagem real. Novos testes devem proteger regras e riscos concretos, sem apenas repetir a implementação.

## 14. Importação do legado e independência

O legado será fonte de referência e importação, nunca biblioteca obrigatória do novo aplicativo. Criar importadores versionados em C# que copiem os dados selecionados e gerem um relatório de itens importados, ignorados e incompatíveis.

Não escrever no banco ou nos arquivos originais do Electron. Conservar IDs de origem em um mapeamento de importação para evitar duplicar itens na repetição do processo. Validar transparência, dimensões, vínculos, camadas e poses, além da contagem de arquivos.

Antes de excluir o legado, provar que uma cópia contendo somente `master avalonia` compila e executa, que os recursos necessários foram importados, que backups e restauração funcionam e que os fluxos usados foram aceitos. A exclusão futura do legado será uma ação explícita do usuário.

## 15. Primeiras entregas, na ordem

1. **Fundação executável:** solução C#, janela Avalonia, navegação entre Fabricador e Customizador, tema e diretório de dados próprios. Critério: abrir e fechar no Windows com logs e configuração persistente.
2. **Personagem mínimo real:** importar um modelo de referência com peças, desenhar camadas, selecionar e transformar uma peça. Critério: geometria e transparência corretas em zoom e espelhamento.
3. **Edição confiável:** articulações, comando de edição, desfazer/refazer e SQLite. Critério: salvar, fechar e reabrir preserva o resultado, inclusive após falha simulada de gravação.
4. **Primeiro Customizador:** criar personagem a partir do modelo, aplicar uma roupa e uma aparência facial usando o mesmo motor. Critério: Fabricador e Customizador concordam sobre encaixe e proporções.
5. **Bibliotecas úteis:** miniaturas leves, busca, filtros, duplicação, lixeira e importação com progresso e cancelamento.
6. **Expansão controlada:** completar poses, rosto, cabelo, roupas e proporções, uma seção validada por vez.

## 16. Ideias adicionais para evoluir sem perder controle

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

## 17. O que não construir antecipadamente

Evitar microserviços, servidor obrigatório, sistema de plugins de terceiros, barramento global de eventos para qualquer alteração e dezenas de camadas genéricas. Começar com módulos claros dentro de uma solução e expandir a estrutura quando houver uma necessidade demonstrada.

Antes do código inicial, confirmar as decisões de versão do .NET/Avalonia, localização dos dados, convenção geométrica, representação de personagem e primeiro modelo de referência. As decisões técnicas devem ficar documentadas perto do código e ser revisáveis.
