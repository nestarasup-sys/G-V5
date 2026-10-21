# ADR-0001: coordenadas, transforms, recorte, zoom e cor

- **Estado:** ACEITA como contrato para a engine nova; ainda não implementada nem validada por golden.
- **Data:** 2026-10-20
- **Contexto:** F00.11 do Plano Mestre.
- **Escopo:** GV5.Geometry, GV5.Scene, GV5.Rendering e adaptadores de canvas. Não altera o formato Electron.

## Contexto e evidência

O plano do G-V5 exige uma convenção única para modelo, cena, canvas e tela; zoom/pan de visualização não podem alterar valores persistidos. `docs/legacy-contracts/FABRICADOR_INVENTARIO.md` e `FORMATOS_E_IDS_ELECTRON.md` mostram que o legado armazena dimensões e coordenadas de imagem em números, ângulos em graus, pivôs/âncoras opcionais e transformações em mais de um formato. O legado ainda não oferece um contrato matemático uniforme: por exemplo, `ModelPart` usa retângulo `x/y/width/height`, `jointAnchor` e `rotation`, enquanto o rig deriva pivôs ausentes do centro e a UI aplica rotação à imagem. Por isso a importação do legado precisa ser específica por tipo e coberta por fixtures; não se pode interpretar todo `x/y` como o mesmo tipo de ponto.

Referências consultadas somente para leitura: `PLANO_DO_NOVO_APP.md` §§5, 7 e 13; `src/shared/fabricator.ts` (`ModelPart`, `JointLink`, `FaceTransform`); `src/renderer/src/features/fabricator/models/rig.ts` (`center`, `partJointAnchor`, `sourcePointFromCanvas`); `FabricatorPage.tsx` (transform de peças e canvas); `src/shared/studio.ts` (`StudioElement`, transforms); `studioCharacterGeometry.ts`.

## Decisões

### 1. Espaço de coordenadas

- Uma unidade persistida é um **GV5 logical pixel**: unidade de projeto independente do monitor e de seu DPI. Em assets raster, a conversão inicial é 1 unidade por pixel-fonte, salvo se um módulo definir dimensões de cena próprias (por exemplo, canvas 1920×1080).
- Origem `(0,0)` fica no canto superior esquerdo; `+X` aponta à direita e `+Y` para baixo. Retângulos usam valores finitos; largura/altura não negativas; escalas físicas ficam separadas dos bounds originais.
- Input do canvas, tamanho do controle, DIP da UI e pixels físicos da tela são espaços diferentes. A View converte o input para coordenadas de cena por uma transformação inversa. Não persistir conversões de monitor.

### 2. Pivot, ângulo e matriz

- Transformações são 2D afins em matriz homogênea 3×3, vetores-coluna; a composição é aplicada da direita para a esquerda. Para uma hierarquia: `World(node) = World(parent) × Local(node)`.
- Cada nó possui `pivotLocal` explícito e sua posição correspondente `pivotParent`. O transform local é `T(pivotParent) × R(clockwiseDegrees) × S(positiveScaleX, positiveScaleY) × F(flipX, flipY) × T(-pivotLocal)`.
- Ângulo é armazenado em graus e positivo **horário** na tela (eixo Y para baixo). Conversão para trigonometria ocorre na fronteira matemática; normalizar para uma faixa canônica apenas para exibição, sem perder a rotação visual equivalente.
- Escala numérica é positiva. Espelhamento usa flags independentes X/Y e é aplicado em torno do pivô. Não codificar flip como escala negativa persistida.
- Um asset solto usa o centro geométrico como pivô padrão. Peças do rig usam âncora/junta explícita; fallback ao centro só pode acontecer quando o formato de origem documentar ou comprovar essa regra. Componentes/roupas mantêm pivot de origem ou declaram seu próprio.
- Bounds e hit testing transformam os quatro cantos e usam a inversa da matriz para testes locais. Z-order é independente da hierarquia de juntas.

### 3. Crop e pixels

- `CropRect` é definido no espaço de pixels do asset decodificado, com borda esquerda/superior inclusiva e direita/inferior exclusiva. Deve ser finito, não negativo e limitado às dimensões do asset.
- Crop seleciona a região visível, mas mantém o referencial original, o pivot e o binding. Não recentralizar o objeto só porque a caixa de pixels transparentes foi aparada.
- Normalizar orientação da imagem na ingestão antes de construir o asset canônico. Crop, transform local, hierarquia, câmera e viewport são estágios separados e em ordem documentada.

### 4. Zoom, pan e conversão de tela

- A câmera é estado de apresentação, nunca parte do documento persistido: `screen = pan + zoom × scene`; a operação de input usa a inversa correspondente.
- `zoom` precisa ser finito e positivo. Alterar zoom com o ponteiro como âncora preserva o ponto da cena sob esse ponteiro; pan altera apenas a câmera. Clamp/limites de zoom pertencem ao controle, não ao domínio.
- Conversão entre cena e UI é responsabilidade do adaptador de canvas. Nenhuma movimentação, escala ou crop salvo deriva do tamanho da janela, zoom, pan ou DPI atual.

### 5. Espaço de cores e alpha

- Entrada e saída raster padrão usam **sRGB IEC 61966-2-1**, RGBA de 8 bits. Metadados de cor que não indiquem perfil são interpretados como sRGB e o perfil é preservado/normalizado explicitamente na ingestão/exportação.
- A fronteira de asset usa canais não pré-multiplicados (straight alpha). O compositor converte para alpha pré-multiplicado para composição e volta ao formato de saída ao codificar. RGB de pixels totalmente transparentes não influencia a cor visível nem cria halos.
- Blend `source-over` é o modo padrão. Os cálculos de mistura ocorrem em luz linear após decodificar a curva sRGB; exportação volta a sRGB. Outros blend modes devem declarar sua matemática e espaço.
- Cor e alpha não são inferidos de thumbnails, CSS, tema ou framebuffer da UI. A saída de cena é independente do tema Avalonia.

## Compatibilidade e migração do legado

- Modelo/pose: legado usa coordenadas de folha, dimensões raster e graus. Preservar `sourceTransform` e `jointAnchor` como entradas para conversão; para pivô ausente, reproduzir a regra comprovada do formato (no rig atual, `center(part)` é fallback em contextos específicos), não preencher todos os objetos com um único fallback global.
- Studio: converter retângulos/ângulos por tipo e testar as posições originais; o contrato de `StudioElement` não prova a origem exata do pivô em todos os formatos históricos.
- O formato Electron não é sobrescrito nem reserializado pela nova engine. A importação futura deve ser copy-only, manter `legacyId`, registrar a transformação aplicada e deixar a origem intacta.
- O comportamento de valores sem unidade/perfil e documentos antigos sem pivô/crop explícitos é **desconhecido** até análise de um fixture de origem autorizado. Nesses casos, o importador deve preservar o documento de origem e reportar a ambiguidade, em vez de ajustar silenciosamente.

## Consequências

- Fabricador, Customizador, Studio e renderer compartilham matemática única; câmera e tela não contaminam dados persistidos.
- A decisão cria contrato testável, mas não prova compatibilidade visual. Alpha em linear-light pode diferir de resultados antigos; comparação com referência do legado é requisito para escolher conversão/adaptação por importação, sem mudar a regra canônica sem novo ADR.
- Futuras mudanças de unidade, pivô, ordem matricial, semântica de crop ou espaço de cor exigem novo ADR e fixtures golden de geometria, transparência, transforms aninhadas, flip, rotação extrema e zoom/pan.

## Verificação obrigatória antes de marcar geometria/renderização validadas

1. Testes puros de forward/inverse transform, composição pai-filho, rotação horária, flip em torno do pivô e escalas não uniformes.
2. Fixtures sintéticas de bounds/crop incluindo borda, transparência, dimensão 1×1 e região inválida.
3. PNG golden de `source-over`, alpha parcial/zero, perfis sRGB, halo colorido oculto em pixels transparentes, crop com pivot preservado e layers em z-order.
4. Conversão de fixture sintética de formato legado e comparação de pixels/âncoras antes/depois.
5. Registrar tolerância, runtime, versão do renderer e diferença geométrica e de cor. Nenhuma dessas verificações foi executada como parte desta ADR.

