# Critérios de aceite visual e técnico por módulo

Este documento complementa os gates funcionais (ADR-0006). Priorizar funções reais e aparência familiar do Gacha 5, sem exigência pixel a pixel. Pequenas divergências são aceitáveis e refináveis depois; capturas pendentes não barram automaticamente fase técnica verde.

## Dois níveis de aceite

1. **Durante cada fase:** controles e funcionalidades completos, testes reais positivos/negativos, persistência, erros, arquitetura; verificar identidade visual geral por código ou headless.
2. **Revisão posterior:** quando disponível, comparar capturas Electron/Avalonia, conferir cores, grupos de botões e posições aproximadas, sem exigir pixels iguais.
3. **Aceite final:** testar no Windows com dados representativos, conferir funções omitidas e aparência familiar; nenhuma evidência não executada pode ser considerada aprovada.
4. **Mudança visível:** pequenas diferenças são permitidas; perda de ferramenta, navegação radical ou descaracterização exigem correção/autorização.

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

- Diferença estética discreta: aceitável agora, ajustável posteriormente por preferência do usuário.
- Limite comprovado da plataforma: documentar impacto e alternativa Avalonia que preserve o resultado; não aprovar mudança de experiência automaticamente.
- Windows/GPU/diálogo real: manter `VALIDACAO_VISUAL_PENDENTE` até executar no alvo; headless não substitui, mas a pendência visual não barra tarefa técnica independente.
- Pequena divergência visual intencional: permitida pela ADR-0006; registrar se relevante. Mudança radical de identidade/navegação ou remoção de funções exige autorização do usuário.
- Estado/viewport não capturado: manter pendente, não generalizar aceite de outra tela.
