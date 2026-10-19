# GACHA V5 — instruções de trabalho para agentes

## Primeiro, preserve o que existe
- Inspecione `git status --short --branch`, HEAD, remotos e mudanças não commitadas antes de editar.
- **Não descarte** alterações locais ou remotas. Não execute `reset --hard`, `clean -fd`, `push --force` ou substituição de pastas sem plano de recuperação autorizado.
- **Branch permanente de desenvolvimento: `master-desenvolvimento`.** Reutilize-a para mudanças incrementais. Não crie branches por rotina; justifique qualquer isolamento excepcional. A `master` só recebe integração após autorização explícita.
- **Não altere, force-push ou faça merge na `master` sem autorização explícita**. Entregue via PR com CI e evidências; não delete branches antes da integração confirmada.

## Arquitetura e escopo
- Fontes normativas: `docs/PLANO_ESTRUTURA_PROJETO_E_DADOS.md`, `docs/refactor/ROADMAP_EXECUTAVEL.md`, `docs/refactor/FLUXO_ASSETS_FABRICADOR_CUSTOMIZADOR_STUDIOS.md`, `docs/refactor/ISOLAMENTO_STUDIOS_E_DEV_AI.md` e `docs/refactor/DADOS_E_RECUPERACAO.md`.
- **Fabricador Dev publica** modelos/poses/roupas/cabelos/acessórios e seus bindings/default transforms. **Customizador possui** personagens com deltas individuais. **Studio e Video Studio consomem** a aparência canônica sem modificar personagem ou bibliotecas.
- Transformações devem ser coerentes em folha desmontada → osso → pose → delta do personagem → cena; não adivinhe ossos nem esconda erro de asset.
- Não considere uma fixture sintética ou um save IPC equivalente ao fluxo integral da interface. `AF-01..AF-20` e `ISO-01..ISO-15` somente ficam concluídos com as evidências definidas.

## Dados e qualidade
- Dados pessoais, perfis, bibliotecas privadas, imagens, backups e relatórios reais **não entram em Git, logs remotos ou CI**. Para validação privada, exija cópia isolada, backup/hash conferido e rollback. Nunca teste destrutivamente no perfil original.
- Use fixtures sintéticas nas auditorias remotas. Não afrouxe assertions, tolerâncias ou status para conseguir testes verdes.
- DEV AI e auditorias DEV AI foram desativados a pedido do usuário: não restaurar workflows nem comandos automáticos, não iniciar `audit:all` e não executar o runner. `npm test` cobre somente os testes locais de migração de dados e geometria do personagem.
- Para alterações funcionais, execute os testes locais aplicáveis, typecheck e build. Não rode auditorias completas sem novo pedido explícito do usuário.
- Faça commits pequenos e relatórios objetivos: arquivos, comportamento, comandos, resultado, SHA, riscos, limitações e pendências. Atualize o roadmap sem marcar cobertura parcial como concluída.
