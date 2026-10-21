# ADR-0007 — Slots do Animador e vínculo opcional de personagem

Data: 2026-10-21. Estado: ACEITA.

## Contexto

O Animador legado organiza até 12 animações em slots estáveis por modelo e grava miniaturas. Também guarda `characterId` opcional. A nova animação é um documento editável pinado a uma publicação imutável do modelo, com frames de transforms e rig. A arquitetura nova ainda não oferece um repositório de personagens persistidos que o Fabricador possa consultar.

## Decisões

1. Os 12 slots pertencem ao `ModelId`, não a uma revisão do modelo. Cada slot aponta para um `AnimationId`; a animação continua pinada à publicação exata que a originou. Mover uma animação entre slots ou substituir uma associação não muda seu ID nem apaga o rascunho anterior. A associação pode ser liberada sem excluir a animação.
2. A migration 17 preenche os slots antigos por modelo em ordem determinística, até o limite de 12. Rascunhos excedentes permanecem intactos na biblioteca como rascunhos sem slot, para não descartar dados.
3. Miniaturas são renderizações derivadas do primeiro frame usando a publicação exata do modelo. São criadas ao abrir o slot ou após salvar, mantidas somente em memória num cache de até 12 bitmaps e invalidadas quando a revisão da animação muda. Não entram no documento da animação nem na persistência SQLite.
4. `characterId` não integra `AnimationDraft`. No legado, essa identidade restaura o personagem selecionado no editor e fornece contexto para a prévia e para gerar variações corporais. Isso não define identidade ou dependência dos frames. Persistir uma referência agora criaria um vínculo sem resolver personagem que o Fabricador não consegue validar.
5. Quando o Customizador oferecer uma fonte persistente de personagens, a prévia e os geradores poderão receber um contexto opcional tipado por `CharacterId` via serviço de aplicação/resolver. O contexto não altera a identidade dos slots nem o vínculo da animação com o modelo; qualquer transformação incorporada durante uma geração fica capturada nos frames.

## Consequências

- O Fabricador mantém sua fronteira independente do Customizador e não serializa IDs órfãos.
- A tela oferece os 12 slots e mantém rascunhos excedentes acessíveis na biblioteca.
- A restauração do personagem escolhido no Animador continua pendente para a integração vertical com personagens; não é declarada como paridade funcional concluída nesta tarefa.
- Testes validam slots por modelo, preservação dos IDs, dados antigos, limite da grade e thumbnail após salvar. O cache tem limite explícito no código; o vínculo de personagem será reavaliado quando existir o serviço persistente do Customizador.
