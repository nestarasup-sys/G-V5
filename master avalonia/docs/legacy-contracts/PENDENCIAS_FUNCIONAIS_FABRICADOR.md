# Pendências funcionais do Fabricador — cobertura do legado Gacha 5

**Data da revisão:** 2026-10-21.  
**Fonte:** comparação estática do Gacha 5 Electron com matriz/inventário do Avalonia; a ausência foi registrada nos documentos de auditoria do próprio projeto. Nenhuma captura, build ou teste Windows novo foi executado nesta revisão.  
**Motivo:** após ADR-0006, pequenas diferenças visuais são aceitáveis; **controles e ferramentas reais AUSENTES não são diferenças estéticas** e continuam obrigações de implementação antes do aceite G2/Fabricador completo.

## Lacunas explicitamente observadas

| Recurso do Electron | Situação documentada no Avalonia até F06 | Fase de implementação sugerida | Critério funcional de encerramento |
| --- | --- | --- | --- |
| Dez slots de modelos, selecionar/limpar/excluir | Layout aproximado existe, mas os 10 slots com navegação/exclusão não | F09.15/G2, após dependências F07/F08 | Criar/selecionar/substituir/remover por slot, persistir e reabrir, respeitando proteção de referências |
| Abas Peças, Camadas e Juntas | Painel de camadas existe; abas dedicadas ainda ausentes | Peças/Juntas: F07.02–F07.04; revisão do conjunto: F09.15/G2 | Abas acessíveis, seleção preservada, cada controle executa ação correspondente |
| Miniaturas de peças | Listagem de layers existe, miniaturas ainda ausentes | F09.15/G2 | Gerar/carregar sob cache limitado, atualizar ao alterar assets, não bloquear UI |
| Quadrícula do canvas | Prévia clara e seleção presentes; grid ausente no estado atual | F07.04 ou F09.15/G2 | Exibir/ocultar, escala e pan corretos, não alterar render/export base |
| Controles de tolerância de chroma | ChromaCropProcessor existe, controles no editor não | F09.15/G2 | Ajustar tolerância e prévia, confirmar/cancelar, não destruir fonte |
| Misturador/edição de pixels | Ferramenta do legado mapeada; sem UI/serviço correspondente validado | F09.15/G2 | Ferramenta funcional com undo/redo, assets sem perda e round-trip |
| Edição de pivôs/âncoras e estado fixed | Motor geométrico existe; ferramentas de UI específicas não validadas | F07.02–F07.04 | Criar/editar/excluir juntas; arrastar pivôs; fixar/soltar sem snap; salvar/reabrir |
| Dividir/mesclar peças e restaurar fonte | Legado possui; não há prova completa de controles Avalonia | F09.15/G2 | Ações reversíveis, assets/crop preservados, reabertura |
| Reordenação por arrasto na lista | Alteração por botões existe, drag de linhas ausente | F09.15/G2 | Drag de camada atualiza ordem e undo sem mudar joints |
| Heurística de conexões automáticas | Legacy rig.ts auditado F07.01; integração UI nativa ainda não | F07.02–F07.04 / fechamento G2 | Sugestões sem ciclos/pais duplicados, usuário pode corrigir manualmente |

## Regras de condução

- Não antecipar Video Studio nem deslocar funções do Fabricador para áreas alheias.
- F07 deve prosseguir porque o gate **técnico limitado a Modelos F06** tem evidências suficientes. As lacunas são rastreadas e deverão ser implementadas no Fabricador antes do **G2 funcional completo**, especialmente F09.15.
- Se alguma lacuna for comprovada já implementada, adicionar teste e referência ao arquivo e marcar apenas essa linha como concluída; evitar trabalho duplicado.
- A lista não é exaustiva: F09.15 deve revisar todas as funcionalidades de Fabricador comparando com FABRICADOR_INVENTARIO.md e MATRIZ_PARIDADE.md. Não basta preservar aparência geral.
- Gravar falhas funcionais de verdade como pendentes até teste positivo/negativo e persistência; nenhuma captura "bonita" substitui recurso ausente.
- Ajustes de espaçamento, posição ou cores secundárias são refináveis posteriormente e não devem bloquear programação do rig, poses e animações.

## Estado atual

**0 lacunas deste inventário estão declaradas resolvidas por esta auditoria.** A F07.02 está EM_EXECUCAO: RigJointGraph/ModelRigEditor e testes escritos; um teste Headless falhou no CI 39646435562 por asserção incorreta, corrigida em 32beda0. A integração com View/ViewModel, persistência de juntas e testes de reopen ainda não foi concluída. A fase F07 só encerra quando seu gate técnico passar.
