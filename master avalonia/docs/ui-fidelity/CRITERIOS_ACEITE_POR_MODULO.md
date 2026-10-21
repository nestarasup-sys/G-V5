# Critérios de aceite visual e técnico por módulo

Este documento complementa os gates funcionais existentes. Não altera a contagem de tarefas. Nenhum módulo recebe aceite visual só por abrir, compilar ou ter controles com nomes semelhantes.

## Evidência mínima comum

1. Captura real do Gacha 5 Electron e captura Avalonia com mesmo estado, fixture, conteúdo, resolução, DPI e tamanho de janela.
2. Checklist de geometria/ordem, cor, tipografia, ícones, espaçamento, estados, scroll, foco e diálogos aplicáveis.
3. Comparação documentada (golden/diff ou inspeção lado a lado com exceções identificadas); registrar commit, ambiente, tamanhos, caminho de artefatos e divergências.
4. Testes funcionais/persistência e erro conforme gate existente. Teste Headless, teste Windows e validação manual são evidências distintas.
5. Revisão da matriz visual e aprovação do usuário nos casos em que não há oráculo automatizável ou uma divergência visível deliberada.

## Critérios por módulo

| Módulo | Aceite visual específico | Aceite técnico existente a preservar | Estado atual |
|---|---|---|---|
| Shell/navegação | Top bar, marca, rotas, seleção/hover/foco, espaçamentos e tamanho de janela comparados | Rotas registradas e arquitetura modular; teste headless | PENDENTE |
| Fabricador | Cada workspace: Models, Chroma, rig/layers, histórico, Poses, Animador, Roupas, Face/olhos, Expressões, Animador facial, Cabelos, Extras e Design Dev; estados vazio/ocupado/seleção/diálogo | Gate G2, edição/persistência, undo/redo e renderer | PENDENTE |
| Customizador | Catálogo, editor, subpainéis e previews de corpo/roupa/cabelo/rosto em estados selecionados | Gate G3, CharacterResolver e overrides persistentes | PENDENTE |
| Studio | Biblioteca, canvas, barra/painéis, fundo, objeto/ator selecionado, diálogos e export | Gate G4, scene save/reopen e renderer compartilhado | PENDENTE |
| Base de Vídeos | Principal, rascunhos, cards, preview/player, filtros, categoria/modal, detalhes, tempos e estados de publicação/exclusão | Gate G5, referência estável, persistência e asset íntegro | PENDENTE |
| Roteiros | Biblioteca/editor, abertura/TikToks, elenco, faixa de preview, blocos, campos, picker de vídeo, ocultação e export/log | Gate G5, referências por ID, salvamento/reabertura e exportação | PENDENTE |
| Opções | Tela de dados, migração, backup/restore, progresso, confirmações, erros e estados vazios | Backup íntegro, restore, cópia/migração verificável | PENDENTE |
| Video Studio | Biblioteca, workspace, timeline, preview, faixas/seleção, propriedades, áudio, modais e export; implementação só por último | Gate G6; mídia, timeline, áudio, jobs, cancelamento e export medidos | PENDENTE |

## Regras para diferenças e limitações

- Diferença acidental: corrigir antes de aceitar.
- Limite comprovado da plataforma: documentar impacto e alternativa Avalonia que preserve o resultado; não aprovar mudança de experiência automaticamente.
- Requisito de Windows/GPU/diálogo real: manter `VALIDACAO_VISUAL_PENDENTE` até executar no alvo; headless não substitui.
- Divergência visual intencional: obter aprovação explícita do usuário, registrar o que mudou e manter rastreio da exceção.
- Estado/viewport não capturado: manter pendente, não generalizar aceite de outra tela.
