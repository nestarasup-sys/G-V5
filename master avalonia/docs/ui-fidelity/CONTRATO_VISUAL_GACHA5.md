# Contrato visual do Gacha 5 — Avalonia

**Estado:** requisito permanente; critérios ainda não validados em uma tela reconstruída.  
**Referência autorizada:** Gacha 5 Electron neste repositório.  
**Referência excluída:** Editor V4, que pertence a outro projeto.

## Princípio

**Mesma aparência. Tecnologia nova. Implementação melhor.** A identidade visual criada pelo usuário no Gacha 5 original é um requisito do produto. A reconstrução deve ser imediatamente familiar e preservar aparência, organização e experiência observável. Isto não autoriza copiar a implementação Electron/React: a nova UI deve usar Avalonia, AXAML/XAML, estilos, templates, bindings e controles apropriados à versão fixada.

## O que preservar

- Paleta, fundos, painéis, textos, gradientes, opacidades, bordas, raios, sombras, separadores, imagens, ícones e indicadores.
- Tipografia, tamanhos, pesos, alinhamento, alturas de linha e espaçamentos identificados na referência real.
- Geometria e hierarquia: ordem, posição, proporções, barras, painéis laterais, listas, cards, campos, previews, canvas, timeline e rolagem.
- Estados normal, hover, foco, selecionado, desabilitado, vazio, preenchido, expandido, recolhido, erro, confirmação e progresso.
- Fluxos visuais e comportamentos observáveis: navegação, menus, diálogos, pop-ups, tooltips, atalhos e drag-and-drop quando existirem.
- Variações intencionais entre páginas. Compartilhar um controle ou token não deve apagar diferenças do legado.

## Modernização permitida

Virtualização, carregamento incremental, atualizações menores, processamento fora da thread de UI, cancelamento, foco consistente, suporte a DPI, acessibilidade por teclado e diagnóstico podem modernizar a implementação sem mudar o resultado visual. Animações novas, reorganização responsiva, mudança de texto ou simplificação de controles que alterem a experiência exigem autorização explícita. Quando o legado já tiver uma transição, reproduzir sua duração/comportamento após medição; não adicionar movimento decorativo.

## Evidência e estados

Cada item da matriz visual deve distinguir:

1. **Código legado inspecionado:** estrutura/estilo encontrado nos arquivos; não prova resultado visual em execução.
2. **Referência Electron capturada:** screenshot real do Gacha 5, com resolução, DPI, estado e fixture registrados; não criar captura fictícia.
3. **Avalonia comparado:** captura real da implementação nas mesmas condições, acompanhada por comparação visual/golden e inspeção de divergências.

Build, teste headless, nomes de controles e screenshot ilustrativa não equivalem a paridade. Se faltarem capturas ou estados, registrar `REFERENCIA_PENDENTE` ou `VALIDACAO_VISUAL_PENDENTE`; não declarar `VALIDADO`. Headless pode provar layout/render em casos suportados, mas não substitui validação Windows quando o comportamento depender de janela, DPI, GPU, diálogo do sistema ou input real.

## Resolução e mudanças

Definir uma resolução, escala DPI e tamanho de janela de referência por módulo antes do aceite. Em outros tamanhos, preservar a hierarquia e o comportamento equivalente encontrado no Electron; falta de espaço não autoriza mover painéis ou trocar barras sem referência ou aprovação. Registrar qualquer exceção como divergência, com evidência e autorização do usuário.

## Critérios para aprovar uma tela

- Página, subpágina e estado comparados contra referência real do Electron.
- Ordem, geometria, textos, ícones, tipografia, cores, bordas, margens, espaçamentos e rolagem conferidos.
- Estados interativos relevantes capturados e comparados, não somente o estado vazio.
- Nenhuma mudança visual intencional sem aprovação; diferenças acidentais têm causa resolvida ou ficam `DIVERGENTE`.
- Implementação Avalonia continua respeitando MVVM, fronteiras de módulo, performance e persistência do plano.
- Evidência, versão/commit, ambiente, resolução/DPI e limitações anotados em `MATRIZ_PARIDADE_VISUAL.md` e no gate da fase.

## Escopo

Este contrato complementa `PLANO_DO_NOVO_APP.md` e as tarefas F00–F17. Não altera nem renumera suas 247 tarefas ou a ordem das áreas. Os gates funcionais existentes também exigem o aceite visual aplicável antes de declarar um módulo completo.
