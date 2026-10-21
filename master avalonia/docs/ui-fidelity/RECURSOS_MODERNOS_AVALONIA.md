# Uso moderno de Avalonia preservando o visual do Gacha 5

**Base:** Avalonia e dependências fixadas pela solução (consulte `global.json` e `Directory.Packages.props`). Estratégias abaixo são propostas arquiteturais; antes de implementar, confirmar API e comportamento na versão instalada e validar no alvo Windows. Não são alegações de que todos os recursos já estão configurados.

| Recurso | Benefício esperado | Módulos candidatos | Estratégia proposta | Dependências/riscos | Validação e preservação visual |
|---|---|---|---|---|---|
| Styles, ControlThemes, templates e resources | Visual consistente com componentes nativos e uma fonte de tokens | Todas as áreas | Criar o Design System a partir dos tokens reais; templates customizados onde o tema padrão divergir | Evitar sobrescrever diferenças intencionais ou depender de API incompatível | Capturas/goldens de cada controle e estados contra Electron |
| MVVM e comandos tipados | Separar apresentação, fluxo e domínio | Todas | View + ViewModel específico; casos de uso/serviços tipados; código-behind limitado a input/controle especializado | Bindings e conversões podem gerar erros silenciosos | Validar bindings no build, comandos e estado; comparar layout antes/depois |
| Binding compilado quando suportado/configurado | Detecção antecipada de nomes/tipos e menos reflexão | Shell e listas de dados | Ativar por projeto/visão quando a versão e o compilador instalados oferecerem suporte | Migração gradual pode expor erros de DataContext | Build com validação e teste de estado/seleção preservada |
| Virtualização | Limitar controles criados ao viewport | Catálogos, bibliotecas, listas e coleções grandes | Usar controles/painéis virtualizados; evitar wrappers que materializem toda a coleção | Templates pesados e containers aninhados podem anular virtualização; scroll/seleção podem saltar | Fixture grande, contagem de containers/memória/scroll e comparação de cards |
| Layout incremental e coleções observáveis | Preservar foco/scroll e atualizar apenas itens alterados | Fabricador, Base de Vídeos, Roteiros, Studio | Atualizar item por ID e manter seleção; não reconstruir árvore inteira por digitação | Estado de item pode ficar obsoleto se IDs/chaves forem instáveis | Testes de interação repetida, foco, scroll, seleção e captura de estados |
| Composição/renderização Avalonia | Desenhar UI própria e aproveitar compositor da plataforma | Canvas, preview e painéis | UI apresenta output de GV5.Rendering; controles customizados tratam somente input/apresentação | Aceleração real depende do backend/hardware; não prometer GPU ou FPS | Medir backend, tempo e captura em Windows; mesma geometria de referência |
| Skia em GV5.Rendering | Renderer independente da View para personagens/cenas | Fabricador, Customizador, Studio; Video Studio por último | Cena tipada em GV5.Scene/Geometry, render determinístico, preview entregue como recurso de imagem com cache | Custo/cópia de pixels e descarte; evitar render na UI thread | Fixtures sintéticas e golden PNG; comparer com Electron em condições iguais |
| Transições/animations | Reproduzir feedback/transições que já existem | Navegação, dialogs, hover | Replicar somente animação confirmada no legado; não adicionar decoração | Movimento aumenta latência percebida e altera personalidade | Medir duração real no Electron e comparar movimento/estado final |
| DPI/layout e resize | Manter controles usáveis em escalas Windows | Shell e todas as páginas | Definir janela/resolução/DPI de referência; preservar hierarquia e breakpoints apenas quando legado confirmar | DPI awareness, rounding, snapping e layouts fixos podem divergir | Capturas em 100/125/150% e tamanhos-alvo; logar divergência por controle |
| Foco, teclado e acessibilidade | Tornar interação acessível sem alterar visual | Formulários, menus, listas e dialogs | Ordem de tab, comandos e nomes acessíveis com estados corretos | Semântica incorreta e foco visual extra podem mudar aparência | Testar navegação de teclado e registrar estado/foco com screenshots |
| Popups/dialogs Avalonia + serviços de sistema | Manter dialogs de produto consistentes e integrar seletor de arquivos nativo | Todas; import/export | Dialogs de produto customizados; seleção de arquivo por serviço `IFilePicker` | Janela nativa tem aparência do Windows e ciclo de vida próprio | Classificar dialog como produto/sistema e comparar somente escopo equivalente |
| Diagnóstico e inspeção visual | Encontrar bindings, layout e re-renderizações custosas | Desenvolvimento/testes | Habilitar ferramentas permitidas em Debug/testes; manter desativadas no produto quando intrusivas | Ferramentas/licenças opcionais não podem virar dependência do app | Comprovar ausência de dependência paga/runtime; registrar métricas e capturas |
| Avalonia Headless | Testar bindings, composição e fluxos UI sem manipular desktop | Todas | Usar para testes determinísticos que o backend suporta | Não prova janela nativa, GPU, DPI real ou file dialogs Windows | Rotular como teste headless; completar aceite Windows quando aplicável |

## Fronteiras

Avalonia permanece na camada `GV5.App` e nos módulos de UI. `GV5.Core`, `GV5.Geometry`, `GV5.Characters`, `GV5.Scene`, `GV5.Rendering`, `GV5.Data` e `GV5.Jobs` não recebem dependência de Avalonia. Video Studio continua a última grande área conforme o Plano Mestre.

## Adoção comprovada até F05.06 — 2026-10-21

- `GV5.Rendering` entrega um `RenderedFrame` independente da UI. `GV5.App.Presentation.AvaloniaRenderedFrameAdapter` copia os pixels existentes para `WriteableBitmap` na thread de UI; não resolve personagens, não consulta `IAssetStore` e não decodifica assets.
- O adaptador respeita `Bgra8888/Premul` ou `Rgba8888/Premul`, pois o formato retornado deve ser lido do bitmap real. O renderer CPU observado neste ambiente produziu `Bgra8888/Premul`; o teste Headless confirma que os canais aparecem corretamente numa `Image` Avalonia.
- `Avalonia.Headless` renderizou uma janela em memória e a captura confirmou pixels de quatro cores. A contagem de aquisições do provider ficou igual antes/depois do desenho da `Image`; chamada do adaptador fora do UI dispatcher é rejeitada.
- Essa validação comprova o caminho técnico de apresentação em Headless. Não comprova aparência final de módulo, DPI de Windows, janela nativa, GPU nem paridade visual com uma captura do Electron; esses aceites continuam pendentes na matriz visual.

## Adoção comprovada até F05.07 — 2026-10-21

- `GV5.App.Presentation.EditorOverlayState` é um snapshot imutável e transitório de grade, bounds de seleção e pivôs em coordenadas de pixels da prévia. Ele não pertence a `RenderScene`, às entidades do domínio, nem a contratos de persistência.
- `RenderedFrameOverlayControl` apresenta os adorners por cima da imagem, aplica ajuste uniforme e recorte da área da prévia, e não intercepta input do canvas. As cores e medidas vêm de `EditorOverlayStyle` fornecido pelo consumidor, pois as referências completas de seleção/pivôs ainda não foram capturadas; nenhum estilo final de produto é declarado.
- Headless capturou a imagem do renderer com cada tipo de overlay ativado separadamente, verificou diferenças visíveis nos pixels, e confirmou que o hash PNG do `RenderedFrame` original não mudou. O teste também verificou coleção de pivôs copiada, grade inválida rejeitada, nenhuma aquisição/decode extra de asset e liberação da lease.
- Essa validação prova composição transitória em Avalonia Headless; não prova interação de edição, apresentação Windows/GPU/DPI, estilo final do Fabricador ou paridade visual com Electron. Essas validações continuam pendentes na matriz visual.

## Adoção comprovada até F05.08 — 2026-10-21

- `GV5.Rendering.IRenderSceneRenderer` define a entrada de render de uma `RenderScene` imutável; `SkiaRenderer` implementa o contrato. `GV5.App.Presentation.LatestPreviewRenderer` atribui versões monotônicas e cancela a solicitação anterior.
- Antes de publicar, o coordenador volta ao UI dispatcher e confere, de forma atômica com o callback, que o pedido ainda é atual e não foi cancelado. Frames obsoletos e frames consumidos pelo callback são descartados; o callback deve copiar os pixels para a apresentação durante sua execução.
- Teste Headless usa um renderer controlado que deliberadamente ignora o cancelamento e termina depois de uma nova solicitação. A versão antiga não é publicada e seu `RenderedFrame` está descartado; a nova versão é publicada. Há também teste de cancelamento explícito. Isso cobre ordenação e ownership, não latência ou GPU.

## Adoção comprovada até F05.09 — 2026-10-21

- `GV5.Rendering.IncrementalSkiaRenderer` usa uma assinatura por raster isolado composta por dimensões do frame, `AssetId` estável, crop, posição, escala, rotação, pivô, flips e alpha. O AssetStore mantém IDs/referências separados do caminho físico e conteúdo importado; o renderer não persiste a cache. Blend mode e z-order são aplicados durante a composição final, portanto mudanças nesses valores não exigem novo raster isolado.
- `RenderedLayerCache` mantém frames isolados sob LRU com teto de bytes configurável (inicialmente 128 MiB), leases para evitar eviction enquanto um layer está em uso e descarte explícito. Oversized ou entrada que não cabe são usadas transitoriamente sem aumentar a memória residente.
- Testes comparam todos os pixels do renderer incremental com o `SkiaRenderer` completo, incluindo layers Normal/Multiply/Screen/Add, alpha, crop, transformações, rotação e flips. Uma repetição comprova hits; modificar só uma layer comprova que apenas sua assinatura foi rasterizada novamente. Um orçamento reduzido prova eviction e limite de bytes.
- F05.09 prova equivalência nas fixtures e contabilidade da cache, não desempenho superior. F05.10 vai medir primeiro render, repetição quente, edição de layer e RAM retida para decidir se o teto e a estratégia compensam seu custo de composição.
