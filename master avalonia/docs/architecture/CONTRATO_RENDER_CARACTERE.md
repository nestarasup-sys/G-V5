# Contrato do render unificado de personagem

F09.12 reúne os builders por domínio num único `RenderScene`, mantendo as fontes de dados e os editores independentes. Não há um segundo renderer: a cena resultante continua sendo consumida pelo `SkiaRenderer` e pode usar o mesmo cache/AssetStore.

## Entrada e validação

- O chamador envia corpo em ordem já resolvida, mapa de `ModelPartId` para índice de camada, hairstyle draft, catálogo/assembly facial, placements de roupa resolvidos e crops obtidos de metadados verificados do AssetStore.
- Uma referência tipada do modelo esperado deve corresponder exatamente à revisão do cabelo e da face. O `WardrobePoseResolver` continua sendo responsável por comprovar modelo/pose/roupa antes de gerar placements. O builder verifica novamente índices de osso e crops por meio de `WardrobeRenderSceneBuilder`.
- Face assemblies precisam corresponder ao ID e à revisão exatos do catálogo. Cabelo invisível não é emitido; as partes visíveis exigem crops positivos verificados. IDs de camada de cabelo são determinísticos por `HairId + HairPartId`.

## Ordem de composição

O builder aplica bandas back-to-front, com z-order denso e determinístico:

1. Back hair e ponytail, atrás do corpo.
2. Body e roupas ligadas ao índice ósseo, intercaladas pelo wardrobe builder.
3. Rear hair / cabelo posterior.
4. Componentes faciais ativos do assembly, na ordem de z-order facial.
5. Front hair e ahoge.
6. Óculos e head accessories autorizados acima do cabelo.

Não usa a ordem da enumeração para decidir o resultado de roupa; as fases, o índice do osso e a sequência do componente vêm dos placements resolvidos. Só óculos/head accessories podem ocupar a fase acima do cabelo.

## Evidência e limites

- `CharacterRenderSceneBuilderTests` verifica a sequência completa de IDs de assets, IDs estáveis do hair builder, exclusão de camadas ocultas, rejeição de crops ausentes e modelo facial/cabelo incompatível.
- `character-composite.golden.png` é uma fixture sintética CPU 96×48 e compara a cena inteira pixel a pixel. Ela valida regressões no compositor, não é uma captura ou golden do Electron.
- Composição de efeitos faciais por rasterizer, UI do Fabricador, integração do Customizador e validação Windows/GPU/visualmente comparativa permanecem fora deste marco.
