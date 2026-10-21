# ADR-0004: fidelidade visual do Gacha 5 em Avalonia

- **Estado:** ACEITA por instrução explícita do usuário; capturas e implementação ainda pendentes.
- **Data:** 2026-10-21
- **Contexto:** requisito transversal adicional à reconstrução G-V5 Avalonia; não altera as tarefas F00–F17 nem seus gates/ordem.
- **Referência:** somente o Gacha 5 Electron deste repositório. Editor V4 é projeto diferente e está excluído.

## Contexto

O usuário construiu e ajustou a aparência, organização e experiência de cada área do Gacha 5. Essa identidade visual deve ser reconhecível no novo aplicativo. A reconstrução não é um redesign nem conversão de runtime: Electron/React continuam fora da arquitetura nova; a UI será construída com Avalonia e os limites definidos em `PLANO_DO_NOVO_APP.md`.

Inventários funcionais anteriores declaram expressamente que não comprovam paridade visual. A leitura estática inicial de 2026-10-21 confirmou estrutura/estilos em `src/renderer/src/ui/App.tsx`, `TopBar.tsx`, `styles.css` e páginas por feature, mas não produziu captura do Electron nem comparação Avalonia. O estado correto, portanto, é requisito aceito com evidência visual ainda pendente.

## Decisão

1. Preservar cor, tipografia, geometria, ordem, hierarquia, barras, painéis, estados, diálogos, menus, fluxos e comportamento visual observável do original.
2. Recriar com controles/estilos/templates/bindings Avalonia, MVVM e controles especializados quando necessário; não copiar DOM, CSS ou runtime antigo.
3. Permitir modernização invisível de performance, virtualização, acessibilidade, DPI e atualização incremental desde que não altere o resultado observável.
4. Não introduzir animações, rearranjos responsivos, simplificações, estilos padrão genéricos ou outras mudanças visíveis sem autorização explícita.
5. Classificar evidência separadamente como código estático, captura real Electron e implementação comparada em Avalonia. Não afirmar paridade sem capturas equivalentes e revisão de divergências.
6. Documentar contrato, inventário, tokens, matriz de paridade, recursos Avalonia e critérios por módulo em `docs/ui-fidelity/`.
7. Manter os 247 IDs e a sequência existente. O aceite visual aplicável passa a ser critério dos gates/módulos existentes, não uma nova contagem de progresso.

## Riscos e mitigação

- **Risco:** CSS declara valores mas runtime usa layout/estado diferente. **Mitigação:** registrar literais como evidência estática apenas; capturar a UI original para aceite.
- **Risco:** screenshots em DPI ou dados diferentes geram falsa divergência/paridade. **Mitigação:** fixtures controladas e mesma resolução, escala e estado.
- **Risco:** controles padrão de Avalonia descaracterizam a página. **Mitigação:** Design System e templates próprios baseados em tokens/refs reais.
- **Risco:** fidelidade exigir comportamento nativo indisponível em headless. **Mitigação:** separar teste headless e validação Windows local, sem declarar o primeiro como substituto.

## Impacto e evidência

- Atualizados `AGENTS.md`, `PLANO_DO_NOVO_APP.md`, `PLANO_MESTRE_EXECUCAO_CODEX.md` e os documentos em `docs/ui-fidelity/`.
- Progresso segue F03.09 validada; F03.10 é a próxima tarefa. Nenhuma tarefa foi marcada como concluída por esta decisão.
- Verificação documental: referências de arquivos e inventários estáticos conferidos; `git diff --check` passou. Não se executou app Electron/Avalonia nem se aprovou visualmente qualquer tela nesta mudança.
- Commit inicial dos artefatos: `d96395d`.
