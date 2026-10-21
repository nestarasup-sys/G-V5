# Contrato legado de roupas — F08.01

Data da inspeção: 2026-10-21. Escopo: contratos, transformações, compatibilidade e persistência encontrados no código-fonte Electron. Esta auditoria é estática; não confirma comportamento em execução nem captura visual.

## Categorias e finalidade

O Fabricador V1 reconhece quinze categorias: `camisa`, `jaqueta`, `manga-superior`, `manga-inferior`, `luvas`, `capa`, `cinto`, `oculos`, `acessorio-cabeca`, `saia`, `calca-coxa`, `calca-canela`, `shorts`, `meia` e `sapato`. A interface exibe nomes localizados e permite reclassificar cada recorte. A separação automática é apenas uma sugestão inicial por posição relativa do recorte na folha; não é regra de domínio confiável. Associações automáticas a osso usam categoria/localização e podem falhar; o fluxo mostra erro e exige associação explícita antes de salvar peças sem vínculo.

Camisas, jaquetas, capas, cintos, óculos, acessórios, saias, shorts, meias e sapatos recebem nomes de componente próprios; mangas, luvas e partes de calça podem ser identificadas por lado. `calca-coxa` e `calca-canela` são componentes separados. Ao renderizar uma roupa completa na pose, o legado acrescenta sobreposição no encontro de coxa/canela quando ambas estão presentes e pequena margem nas mangas para cobrir costuras.

## WardrobeSet, componente e persistência

`WardrobeSet` usa `schemaVersion: 1`, ID string, slot/nome de modelo, nome do conjunto, dimensões da folha, lista de componentes e `updatedAt`. `edition` pode faltar em dados antigos; ausência equivale à edição 1. Os valores aceitos são 1 e 2. Cada componente possui ID, nome, categoria, `attachedPartId`, posição, largura, altura, rotação, origem opcional, `binding` opcional e `renderAboveHair` opcional. Os bytes PNG ficam em `wardrobe/model-{slot}/set-{id}/parts/{componentId}.png`, e não no manifesto persistente; `dataUrl` é reconstituído ao carregar.

O salvamento valida modelo, edição, IDs, categorias, associação a parte, unicidade e limite de 100 componentes; exige os PNGs antes de publicar o manifesto. Escritas são serializadas, usam manifesto temporário e backup recuperável e removem PNGs sem referência depois da publicação. Óculos e acessórios de cabeça podem definir `renderAboveHair`; para outras categorias esse estado é normalizado como falso. Isso é uma opção explícita para esses itens, não uma regra de ordem global de todas as roupas.

## Binding e transferência para poses

`WardrobeBinding` versão 1 registra `boneId`, dimensão e rotação do osso na folha de origem, centro local normalizado (`localCenterX/Y`), proporções (`widthRatio`, `heightRatio`) e rotação relativa (`relativeRotation`). O centro do recorte é transformado para o referencial local do osso; largura/altura são razões pela dimensão de referência. O referencial prioriza `sourceTransform`, com geometria atual como fallback e dimensões mínimas de 1.

Na pose, um binding válido para o mesmo osso transporta centro, dimensão e ângulo relativo para o osso posado. Se não houver binding compatível, o legado mantém um caminho de compatibilidade que deriva a transformação a partir do transform original do osso e do posicionamento atual do componente, incluindo escalas não uniformes. Arrastos na pose são convertidos de volta aos eixos da folha original. Refixar a roupa recalcula o binding a partir da colocação atual. Alterações de categoria, associação ou transform mantêm o binding atualizado quando há osso de referência.

## Edição 1 e edição 2

Edição 1 corresponde à folha original do modelo e pode ser editada/salva. Edição 2 representa o fluxo antigo de folha separada. Ela é somente leitura na interface atual: o salvamento fica desabilitado e a edição 2 não participa do rebinding normal. Ao abrir uma edição 2 com folha de referência disponível, o sistema tenta rebaseá-la para a folha original e passa a edição 1.

O rebase só transforma um componente se encontrar o osso associado, binding consistente com esse osso, dimensões positivas e proporções finitas/positivas. Projeta o vínculo congelado para o frame original atual; recupera o frame antigo a partir do binding, sem pressupor retângulos ou ordenação hardcoded; projeta também a origem do componente e cria novo binding. Componentes que não satisfazem as pré-condições permanecem sem alteração durante esse mapeamento. A rotina não deve ser substituída por uma migração baseada em coordenadas fixas.

## Migrações de categorias e compatibilidade

O esquema atual do Fabricador usa `saia` como categoria única, `calca-coxa` e `calca-canela`, e `cinto` como cinto. Leituras históricas ainda reconhecem `saia-superior`, `saia-inferior`, `cinto-saia-1`, `cinto-saia-2` e `calca`. O Customizador tem contrato próprio mais antigo: `saia`, `saia-superior`, `saia-inferior` e `calca`, além das categorias compartilhadas.

Na leitura de personagens, `cinto-saia-1` vira `cinto`; `cinto-saia-2` e `saia` viram `saia-superior`. Quando havia paleta antiga global `wardrobeColors`, ela é removida do nível global e aplicada às entradas sem `colors`. Na leitura do conjunto de roupas, `cinto-saia-1` vira `cinto` e `cinto-saia-2` vira `saia`. As diferenças entre as normalizações de personagem e conjunto são históricas e devem ser preservadas na importação até que dados reais e uma regra de conversão sem perda sejam verificados. Não colapsar silenciosamente `saia-inferior` nem `calca` sem definir equivalência.

## Ajustes privados do Customizador

O personagem armazena grupos que referenciam `modelSlot`, `setId`, categoria e, em formatos novos, `componentId`; inclui offset X/Y, escalas X/Y e rotação. O `componentId` ausente representa posicionamento legado para a categoria inteira. A migração ancora um ajuste antigo no frame de pose atualmente exibido, divide um grupo por componente somente quando todos os componentes têm osso válido, preserva a aparência por compensação do pivô e armazena uma referência de ajuste (`version`, `boneId`, largura, altura e rotação). Se a conversão não puder mapear todos os componentes, conserva o grupo legado em vez de descartar dados.

Offsets e transformações pertencem ao personagem, não à roupa publicada. O transporte de pose conjuga a transformação afim com escala não uniforme e rotação do osso; movimentos do usuário permanecem direcionados na tela. Ajustes podem conter opacidade, exclusão reversível (`hidden`) e cores por componente. Overrides privados não devem mutar o manifesto/asset de origem. A validação dos dados limita grupos, escala positiva e valores finitos.

## Referências verificadas

- `src/shared/fabricator.ts`: contratos `WardrobeCategory`, `WardrobeBinding`, `WardrobeComponent`, `WardrobeSet*`.
- `src/renderer/src/features/fabricator/wardrobe/WardrobeWorkspace.tsx`: categorias, sugestão de classificação/ossos, edição, binding, edição 2 e rebase.
- `src/renderer/src/features/fabricator/wardrobe/poseTransform.ts`: binding, rebase, transferência para pose, cobertura de costuras e drag reverso.
- `src/shared/customizer.ts`: categorias e formato persistido dos ajustes de roupa por personagem.
- `src/shared/wardrobeAdjustment.ts`: transporte de transformações, migração de grupos antigos e comportamento de edição.
- `electron/main.ts`: validação de personagens, normalização de categorias, persistência e IPC de conjuntos de roupas.
- `docs/legacy-contracts/FABRICADOR_INVENTARIO.md`: inventário amplo e organização persistente observada.

## Limites e implicações para F08

Esta tarefa não implementa roupas em Avalonia, não inspeciona manifests pessoais em `app-data`, não mede pixels do Electron e não valida runtime. Os contratos da nova aplicação devem ser tipados e versionados, manter separadas a revisão publicada e os overrides de personagem, e importar categorias antigas por conversores explícitos e testados. A liberação funcional da área requer testes de geometria em poses rotacionadas/extremas, persistência e compatibilidade; este inventário não conta como paridade.
