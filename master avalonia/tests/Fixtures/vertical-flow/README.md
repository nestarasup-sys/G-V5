# Fixture sintética do fluxo vertical

`fixture.json` é uma **especificação de dados de teste**, não um schema de persistência do produto nem um documento que o shell atual carrega. As formas geométricas simples são a fonte determinística para gerar pixels de teste quando Geometry/Rendering estiverem disponíveis. Todos os nomes, IDs, cores e geometrias são inventados para este repositório; não dependem de dados pessoais, app-data ou assets do Electron.

## Conteúdo mínimo

- Um modelo de 256×384, seis peças rasterizáveis, cinco juntas e ordem de camadas explícita.
- Duas poses, uma neutra e uma com o braço direito erguido.
- Um set sintético de camiseta preso ao tronco.
- Um personagem com pose e roupa referenciadas, mais uma alteração de cor privada.
- Uma cena 1920×1080 com personagem, fundo sólido e texto.

As chaves de fixture (`fixture-model-001`, etc.) são determinísticas e **não** devem virar IDs globais de produção. Ao materializar os dados para os casos de uso, o fixture builder atribui IDs reais e registra o mapeamento em ambiente temporário.

## Cenário de aceitação Fabricador → Customizador → Studio

1. **Preparar ambiente isolado:** gerar diretório temporário vazio, banco sintético e recursos a partir desta fixture. Falhar se o teste resolver `userData`, `app-data` ou uma origem externa.
2. **Fabricador:** criar modelo/peças/juntas, ordenar camadas, publicar modelo; criar/publicar as duas poses e set da camiseta como revisões imutáveis. Registrar IDs e revisões devolvidos.
3. **Customizador:** criar personagem novo referenciando os IDs publicados; aplicar pose e roupa; editar `shirtColor`/tom de pele como overrides do personagem; confirmar que os hashes/revisões das fontes não mudaram.
4. **Studio:** resolver esse `CharacterId` pela API de aplicação e compor a cena dada. Nenhuma referência a View/ViewModel/controle do Fabricador ou Customizador é permitida.
5. **Persistência:** salvar cada etapa; fechar/descartar o provider; reabrir o banco e AssetStore do diretório temporário; reconstruir renderer e confirmar os mesmos IDs, revisões, relações, transformações e pixels do golden.
6. **Câmera:** alterar zoom/pan e redimensionar viewport; os campos persistidos do personagem e cena devem permanecer byte a byte estáveis.

## Casos negativos obrigatórios quando o fluxo for implementado

- Recusar publicação se um joint referencia uma peça inexistente, se dimensões/transform são não finitas ou se a referência de roupa aponta para outro modelo.
- Recusar personagem com `ModelId`, `PoseId` ou `WardrobeId` ausente/incompatível, mantendo salvos e imutáveis os ativos publicados.
- Recusar cena que referencia personagem inexistente e mostrar erro tipado, sem criar elemento substituto silencioso.
- Simular falha durante escrita e confirmar que o último checkpoint consistente reabre e não retorna estado `Saved` antes do commit confirmado.

## Estado da evidência

Esta tarefa define a fixture e o procedimento; não há ainda builder, projeto de testes Avalonia, fixture raster PNG ou golden produzido, porque Geometry/Rendering e os repositórios reais ainda não existem. Os passos acima passam a ser executáveis quando as tarefas do F01–F05 entregarem as APIs necessárias. Não marcar o fluxo vertical como validado antes de executar a sequência em um processo reiniciado e comparar um golden.

