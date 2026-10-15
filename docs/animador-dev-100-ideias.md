# Animador Dev: 100 ideias de evolução

O Animador Dev é experimental e usa o rig salvo no Fabricador. Esta lista separa o que já está nesta versão das ideias possíveis para evoluções. As 13 animações demonstrativas implementadas são **Andar, Cruzar os braços, Sentar e cruzar os braços, Correr, Acenar, Bater palmas, Comemorar, Apontar, Pular, Chutar, Espreguiçar, Dançar e Agachar**. A lista abaixo é planejamento; ela não afirma que todos os itens já existem.

## 1. Player e navegação

1. Atalhos de teclado para play, pausa, início e avanço de quadro.
2. Reprodução quadro a quadro com teclas anterior e próximo.
3. Campo de tempo atual em segundos, além do controle deslizante.
4. Alternância entre loop, uma vez e pingue-pongue.
5. Marcadores visuais de início, contato, passagem e fim do movimento.
6. Repetição de um intervalo marcado pelo usuário.
7. Velocidade em passos comuns, como 0,25×, 0,5×, 1× e 2×.
8. Botão para voltar a intensidade e velocidade padrão.
9. Opção para reproduzir continuamente a animação selecionada ao trocar de modelo.
10. Comparação lado a lado da pose inicial e do quadro atual.

## 2. Rig e juntas

11. Diagnóstico visual da árvore completa de juntas.
12. Realce da peça e do ramo afetado ao selecionar uma junta.
13. Mostrar pivô, âncoras dos dois lados e distância entre elas.
14. Alertar sobre peças desconectadas do tronco.
15. Alertar sobre ciclos, múltiplos pais e filhos duplicados.
16. Permitir associar manualmente uma peça ao papel coxa, canela, braço ou antebraço.
17. Guardar associações de papel por projeto, sem depender apenas do nome.
18. Mostrar profundidade e caminho do tronco até cada peça.
19. Comparar o resultado do Animador com a rotação do editor Poses.
20. Incluir um botão para recalcular o mapeamento usando as juntas existentes.

## 3. Movimento das articulações

21. Definir limites angulares seguros por junta.
22. Ajustar limites e ângulo neutro sem deformar o projeto salvo.
23. Usar curvas de entrada e saída configuráveis por movimento.
24. Permitir interpolação linear, suave e cúbica entre quadros-chave.
25. Separar movimento local da junta e deslocamento global do personagem.
26. Preservar o comprimento aparente dos membros durante o movimento.
27. Adicionar compensação de tronco para movimentos de braço e perna.
28. Adicionar inclinação e balanço da cabeça com intensidade configurável.
29. Manter os pés no chão durante apoio e contato.
30. Evitar cruzamento indesejado de pernas e braços com limites ou avisos.

## 4. Animações e variações

31. Criar variações de velocidade para caminhada e corrida.
32. Criar caminhada lenta, normal e apressada.
33. Criar aceno com mão esquerda e mão direita.
34. Criar cruzamento de braços mais alto, baixo ou relaxado.
35. Criar sentar em cadeira e sentar no chão como movimentos distintos.
36. Criar levantar da cadeira como sequência reversível de sentar.
37. Criar apontar para esquerda, direita, cima e frente.
38. Criar reações curtas, como surpresa, comemoração e desapontamento.
39. Criar transições de entrada e saída para todas as poses mantidas.
40. Permitir que uma animação combine camadas de corpo, braços e cabeça.

## 5. Edição de movimento

41. Adicionar linha do tempo por junta.
42. Inserir, mover, duplicar e apagar quadros-chave.
43. Copiar e colar quadros entre juntas.
44. Duplicar um movimento e ajustar a cópia sem alterar o original.
45. Espelhar um movimento entre os lados esquerdo e direito.
46. Inverter a ordem temporal do movimento.
47. Ajustar a duração sem alterar a amplitude das poses.
48. Mostrar a curva de ângulo de cada junta ao longo do tempo.
49. Desfazer e refazer alterações na linha do tempo.
50. Salvar movimentos personalizados em uma biblioteca separada.

## 6. Prévia visual

51. Mostrar silhuetas anteriores e posteriores como rastro de movimento.
52. Exibir os pontos de contato dos pés e das mãos.
53. Mostrar grade, eixos e linha do chão opcionais.
54. Ajustar enquadramento, zoom e centralização sem mudar o modelo.
55. Alternar transparência da imagem e contraste do fundo.
56. Pausar automaticamente quando a aba perde foco.
57. Permitir arrastar a câmera sem selecionar peças.
58. Mostrar o nome da peça sob o cursor e sua rotação atual.
59. Oferecer captura PNG do quadro atual.
60. Mostrar duas animações simultâneas em velocidades sincronizadas.

## 7. Roupa, cabelo e camadas

61. Incluir roupas vinculadas ao rig apenas na prévia experimental.
62. Usar cópia isolada dos assets para impedir gravação acidental nos catálogos.
63. Mostrar a camada visual final de cada peça durante a animação.
64. Detectar roupa sem peça corporal vinculada.
65. Mostrar quando uma roupa acompanha o ramo, mas não a rotação local esperada.
66. Permitir compensação de encaixe por junta durante a prévia.
67. Preservar posições de cabelo frontal e traseiro em todos os quadros.
68. Comparar o contorno da roupa com a pele visível no contato.
69. Criar um relatório de peças ocultas por ordem de camada.
70. Manter qualquer teste de roupa temporário e fora da pose salva.

## 8. Diagnóstico e desenvolvimento

71. Manter uma ferramenta de auditoria do rig que leia o projeto sem gravá-lo.
72. Mostrar ID estável, nome, papel detectado, pai e filhos de cada peça.
73. Calcular distância entre âncora de peça, âncora da junta e pivô legado.
74. Verificar se o ramo rotacionado preserva o ponto de conexão.
75. Verificar se uma rotação da coxa movimenta a canela e mantém seu joelho conectado.
76. Verificar se a rotação da canela não altera a coxa.
77. Reproduzir movimentos com dados fictícios e modelos pequenos de referência.
78. Registrar avisos de configuração no painel sem interromper a prévia.
79. Exibir o motivo quando uma animação não pode mover um segmento.
80. Comparar automaticamente o antes e depois de uma mudança no algoritmo.

## 9. Armazenamento e interoperabilidade

81. Versionar o formato das animações e migrar dados antigos ao abrir.
82. Salvar rascunho automaticamente em armazenamento separado.
83. Exportar a animação como spritesheet com tamanho configurável.
84. Exportar sequência PNG com nomes ordenados por quadro.
85. Exportar GIF ou WebM com transparência quando suportado.
86. Importar e exportar movimentos em JSON documentado.
87. Guardar metadados de duração, loop e taxa de quadros junto do movimento.
88. Não gravar alterações em modelos durante reprodução ou exportação.
89. Avisar se o projeto foi alterado desde que a animação foi criada.
90. Permitir apagar um rascunho com recuperação temporária.

## 10. Uso e desempenho

91. Mostrar estados claros para modelo sem rig, rig incompleto e erro de imagem.
92. Navegar pelo catálogo por categoria e busca.
93. Marcar animações favoritas e usadas recentemente.
94. Ajustar automaticamente a prévia a telas menores sem esconder o player.
95. Respeitar redução de movimento do sistema na interface.
96. Oferecer controles acessíveis por teclado e foco visível.
97. Evitar recalcular o projeto em quadros que não mudaram.
98. Pausar e liberar observadores e quadros ao sair da área.
99. Medir atraso de renderização e indicar quando a prévia cai abaixo da taxa desejada.
100. Separar catálogo, rig, player, biblioteca e exportação em módulos pequenos e versionados.

## Ferramenta interna incluída nesta entrega

O script `scripts/audit-animator-rig.mjs` lista a hierarquia do Modelo 01, associa as peças repetidas pela profundidade e calcula a diferença entre a âncora usada pelo rig e o pivô médio antigo. É somente leitura e aceita um caminho alternativo para auditar outros projetos.
