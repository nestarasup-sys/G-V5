# ADR-0006 — Fidelidade visual pragmática e avanço por gates técnicos

Data: 2026-10-21. Estado: ACEITA por nova instrução explícita do usuário.
Substitui os aspectos estritos da ADR-0004 sobre igualdade visual/pixel a pixel e bloqueio automático por captura não disponível.

## Intenção do produto

O novo G-V5 Avalonia deve ter a **cara familiar do Gacha 5 Electron**, mas pequenas diferenças de posição, dimensão, estilo, espaço ou organização local são aceitáveis. O usuário poderá solicitar ajustes posteriores. Prioridade máxima: **todos os botões, ferramentas e funcionalidades reais do Gacha 5 presentes, funcionais e melhorados no Avalonia**. Não remover recursos nem substituir funções por controles decorativos.

Preservar a identidade visual e hierarquia reconhecível; proibir descaracterização ou reorganização radical sem aprovação. Modernizar interfaces com MVVM, templates/estilos Avalonia, virtualização, DPI, performance, foco, acessibilidade e atualizações incrementais. O Editor V4 não é referência.

## Aceites distintos

1. **Gate técnico de fase**: funções reais implementadas, testes positivos/negativos, fluxos de persistência/reopen/undo/erro, fronteiras de arquitetura e evidências do escopo. Deve ser verde para avançar.
2. **Revisão de aparência do produto**: comparar com Electron quando capturas reais estiverem disponíveis. Pequenas divergências são aceitas; fotos e pixel diffs não são obrigatórios para iniciar fase seguinte quando gate técnico passou. Registrar pendências, sem declarar paridade visual final.
3. **Aceite final/vertical**: testar no Windows, usar modelo/folha representativo, verificar ferramentas omitidas, fluxo real e aparência geral antes de declarar entrega final. Falhas funcionais essenciais seguem bloqueantes.

### Decisão específica F06

F06.01–F06.14 constam como concluídas; o último gate local anterior registrou 198 testes verdes de pipeline real SQLite/AssetStore/render com fixture sintética, incluindo importação, edição, undo, gravação, reabertura e publicação imutável. **Isso libera F07 para desenvolvimento de engenharia.** A comparação independente de pixels com worker Electron, a folha real do usuário, os screenshots e os testes Windows/DPI/GPU continuam **NÃO TESTADOS/PENDENTES** para G2/F12/aceite final.

Não renumerar nem validar novas tarefas apenas por esta decisão. A política de Git local-first do Codex permanece; o usuário autoriza o assistente a atuar remotamente nesta revisão, sem autorizar sincronizações remotas automáticas do Codex.
