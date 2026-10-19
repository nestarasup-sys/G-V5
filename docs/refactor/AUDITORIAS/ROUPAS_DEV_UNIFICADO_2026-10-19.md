# Roupas Dev unificado

Escopo autorizado pelo usuário: uma única área Roupas Dev, com layout do 2.0
e importação de todas as categorias. A decisão final é usar **somente a folha
original do modelo**, com pé/sapato integrado à canela e mão/luva ao antebraço.
A correção anterior de cobertura de juntas
continua específica para joelhos e para a regra de mangas já existente; não é
um preenchimento automático de pele em todas as peças corporais.

## Implementação

- Uma entrada Roupas Dev na navegação do Fabricador.
- Biblioteca reúne conjuntos antigos de ambas as áreas, mantendo IDs e arquivos.
- Layout com conjuntos, catálogo, prévia e controles de ajuste para todos.
- Prévia, novas importações e publicações usam apenas a folha original. A escolha
  de referência separada e a checagem bloqueante de dez recortes foram retiradas
  do fluxo da biblioteca.
- O campo antigo `edition: 2` é aceito para leitura. Ao abrir, o rascunho é
  reprojetado na folha original usando os bindings congelados por ID do osso.
  Centros e dimensões normalizados e rotação relativa permanecem equivalentes
  no render posado. A posição de restaurar origem também é reprojetada.
- Essa conversão ocorre somente no rascunho e é publicada ao clicar em salvar.
  Sem vínculo válido ou sem osso correspondente, a peça é mantida para revisão
  manual; não se inventa um encaixe nem se remove a peça.
- Sapatos são sugeridos para canelas e luvas para antebraços. A troca para essas
  categorias procura o osso apropriado; sem correspondência pede seleção manual.
- Todas as categorias continuam disponíveis na importação e no seletor da peça.
- Abrir a biblioteca recupera origens do histórico em memória, sem publicar
  automaticamente alterações no modelo corporal.
- Importações/publicações aguardam a referência correspondente. Requisições
  antigas não substituem o modelo/conjunto selecionado mais recentemente.

Não houve migração em lote, movimentação ou exclusão de dados por esta alteração.
Customizador e Studios continuam referenciando os mesmos conjuntos/componentes.

## Validação

- `npm run typecheck`: passou.
- `npm run build`: passou.
- `node scripts/audit-wardrobe-flow.mjs`: passou, incluindo equivalência de
  vínculos ao converter conjuntos, restauração de origem, imutabilidade,
  canela/sapato e antebraço/luva mesmo quando há mãos ou pés separados próximos.
- `npm test`: 26 aprovados e 2 pulados por restrições locais de symlink.
- `git diff --check`: passou.
- Conferência visual e de salvamento na interface: pendente, pelo usuário.

Conferência sugerida: abrir a área; verificar conjuntos antigos das duas
áreas na folha original; conferir o corpo de encaixe e a conversão; importar uma
folha nova; revisar categoria/osso; salvar e reabrir o conjunto. Depois conferir
um personagem que já utilizava esse conjunto no Customizador e nos Studios.
