# AGENTS.md — G-V5 Avalonia (instruções permanentes para Codex)

> **Escopo:** este arquivo rege **somente** a nova aplicação em `master avalonia/`.
> A raiz do repositório e os diretórios externos a esta pasta são **legado Electron/React, somente leitura**.

## Missão e fontes de verdade

Reconstruir o G-V5/Gacha Nymi como uma aplicação desktop **C# + .NET 10 + Avalonia**, sem Chromium, mantendo fidelidade funcional ao legado quando especificada e criando uma arquitetura modular sustentável. **Não é uma conversão linha a linha** das telas React.

Leia, nesta ordem, **no início de cada sessão**:

1. `PLANO_DO_NOVO_APP.md` — requisitos, visão de produto, arquitetura e decisões.
2. `PLANO_MESTRE_EXECUCAO_CODEX.md` — ordem exata de fases e tarefas, gates e evidências.
3. `EXECUTION_STATUS.md` — última tarefa validada, bloqueios e próxima tarefa. **Se ausente, criá-lo na tarefa F00.05, conforme o Plano Mestre**, não simular progresso.
4. `README.md`, `global.json`, `GV5.sln` e projetos afetados — estado verdadeiro do código.

Em caso de divergência, não decidir silenciosamente: preservar os requisitos do plano-fonte, investigar o código real e registrar uma decisão em `docs/decisions/ADR-*.md`. Ajustes no Plano Mestre exigem justificativa e commit próprios.

## Limites absolutos de trabalho

- Trabalhar **somente na branch `Master-AValonia`**, **somente em `master avalonia/`**. Confirmar `git branch --show-current` e `git status --short` antes de editar.
- Não modificar, excluir, mover, formatar, executar migração destrutiva nem commitar mudanças nos arquivos **fora desta pasta**. Consultar o legado exclusivamente para leitura, contratos e comparação.
- **Exceção de infraestrutura:** somente `.github/workflows/native-avalonia.yml` pode ser ajustado fora da pasta nova quando necessário para o CI do G-V5; isso não autoriza alterar qualquer outro arquivo legado/raiz.
- Nunca abrir em modo escrita os dados do Electron ou dados pessoais do usuário. Testes devem usar **fixtures sintéticas** e pastas temporárias.
- Nenhuma dependência de build/runtime de caminhos, arquivos ou scripts externos a `master avalonia/`. O novo app deve compilar isoladamente.
- Não usar Electron, React, Node.js, Chromium, WebView, componentes Avalonia Pro obrigatórios, nem servidor remoto obrigatório.
- Respeitar o SDK portátil, `global.json`, `Preparar.bat`, `Desenvolver.bat` e os caches locais. **Visual Studio não é requisito.**
- Não alterar versões de .NET, Avalonia, NuGets ou backend gráfico sem necessidade comprovada, testes e ADR.
- Proibido force push ou sobrescrever alterações de outra sessão/agente. Consultar HEAD remoto; reconciliar divergências de forma não destrutiva.
- Não executar operações destrutivas no Git, limpar dados ou excluir o legado sem autorização explícita do usuário.

## Execução contínua, mas estritamente sequencial

1. Identificar a **primeira tarefa PENDENTE** do Plano Mestre, considerando `EXECUTION_STATUS.md` e evidências reais.
2. Trabalhar em **uma tarefa por vez**. Não implementar tarefas futuras antecipadamente; pode dividir a tarefa atual em subpassos registrados.
3. Quando a tarefa passar em todos os seus testes/validações, atualizar status e criar commit coeso.
4. **Continuar automaticamente com as próximas tarefas na mesma sessão** enquanto houver condições; não parar depois de cada checkbox. Preferir ciclos flexíveis de aproximadamente **3–8 tarefas relacionadas**, sem quota artificial.
5. Na conclusão de uma fase, **executar e comprovar seu GATE** antes de iniciar a seguinte. Um build verde não substitui teste de persistência, fidelidade visual ou uso real.
6. Se houver falha, corrigir antes de avançar. Se o bloqueio depender de Windows/GPU/assets locais indisponíveis, registrar `BLOQUEADA — VALIDAÇÃO LOCAL`, procedimento reprodutível e não inventar aceite.
7. Ao retomar, verificar o código e o HEAD novamente: uma tarefa marcada VALIDADA sem prova deve ser corrigida no status, não simplesmente ignorada.

**Ordem imutável das áreas:** plataforma/engines → **Fabricador** → **Customizador** → **Studio** → **Base de Vídeos** → **Roteiros** → **Video Studio por último**. Não antecipar implementação de timeline, playback ou export do Video Studio; Base de Vídeos pode usar probing/miniaturas conforme seu próprio escopo.

## Arquitetura inegociável

- `GV5.App` hospeda Avalonia, shell, composição, Views e ViewModels. **Avalonia é UI, não a engine.**
- `Core` guarda regras e entidades; `Application` casos de uso; `Geometry` matemática; `Assets` armazenamento e cache; `Characters` resolução; `Scene` descrição; `Rendering` renderizador; `Data` persistência; `Jobs` tarefas pesadas.
- `Core`, `Geometry`, `Assets`, `Characters`, `Scene`, `Rendering`, `Data` e `Jobs` **não dependem de Avalonia/UI**.
- Uma área **nunca importa View, ViewModel ou controle de outra área**. Integrações passam por contratos tipados e IDs estáveis.
- Fabricador publica assets com **revisões imutáveis**. Customizador usa referências e **overrides privados**, sem editar fontes publicadas. Studio consome o mesmo `CharacterResolver` e renderer.
- SQLite para metadados relacionais; assets binários por referência/hash; migrations numeradas, transações, revisão otimista e backups verificáveis. Nenhuma tela executa SQL.
- Sem Base64 persistente como identidade de imagem. Cache limitado em bytes, thumbnails derivadas, recursos nativos descartados e jobs canceláveis.
- Não bloquear thread de UI com decode, render pesado, SQL ou I/O. Trabalho em background retorna resultados versionados; previews atrasadas são ignoradas.
- Undo/redo por comandos e gestos coalescidos; autosave não pode perder revisões nem anunciar sucesso antes da gravação.
- Não construir bibliotecas genéricas vazias, plugins dinâmicos ou múltiplos backends GPU/mídia sem uma necessidade comprovada.

## Ciclo de desenvolvimento local-first (obrigatório)

- **Testes no PC local são o caminho padrão.** Não aguardar GitHub Actions a cada commit/push e não interromper implementação só para ver CI de pequenas tarefas.
- Rodar `TestarLocal.bat rapido` após alterações funcionais/tarefas (build Debug incremental + testes da solution + Avalonia Headless). É permitido usar CPU/RAM do PC; não abrir janelas nem manipular mouse/teclado real.
- Rodar `TestarLocal.bat gate` ao finalizar uma fase, depois de mudanças amplas ou antes de declarar um gate aprovado (restore/build Release + testes + Headless). Corrigir falhas localmente primeiro.
- Para testar **somente UI headless**, `TestarHeadless.bat` continua disponível; para testes específicos durante implementação, pode executar comandos direcionados do .NET conforme a tarefa.
- A meta ativa desta execução restringe todo o trabalho ao ambiente local. **Não executar `git fetch`, `pull`, `push`, comandos `gh`, chamadas GitHub API ou GitHub Actions até o usuário autorizar explicitamente.** A referência local `origin/*` pode estar desatualizada e não deve ser consultada.
- Se um gate exigir validação remota, registrar `VALIDAÇÃO REMOTA ADIADA PELO USUÁRIO`; não inventar aprovação nem deixar a exigência remota bloquear o trabalho local independente. Se a evidência remota for condição essencial do gate, ele permanece sem aprovação final.
- `EXECUTION_STATUS.md` preserva o avanço existente. Este ajuste de infraestrutura não valida, remove nem reordena tarefas F00–F17. Documentação e tarefas prosseguem na ordem original.

## Qualidade, testes e evidências

Para considerar **uma tarefa VALIDADA**, exigir conforme o caso:

- Implementação funcional, **não** placeholder, mock decorativo nem tela apenas visual.
- Testes positivos e negativos; regressões existentes continuam passando.
- Persistência: criar/editar/salvar/**fechar/reabrir** e tratar conflito/falha.
- Geometria/renderização: fixtures, golden PNG/diff e comparação com comportamento do legado.
- Arquitetura: referências entre assemblies dentro das fronteiras.
- Performance: benchmark reproduzível, números reais, ambiente e baseline (nunca prometer velocidade sem medir).
- Windows/GPU/integração: comprovação local quando o gate exigir; CI isolada não substitui essa evidência.
- `dotnet restore`, `dotnet build`, `dotnet test` no SDK local, conforme disponibilidade e comandos reais. **Não dizer que testes passaram se não foram executados.**

Registrar em `EXECUTION_STATUS.md`: ID, estado, commits, testes executados, evidência, bloqueios, último HEAD, próximo ID. Criar `docs/gates/GATE-FXX.md` conforme Plano Mestre.

## Git e autonomia

- Preferir commits pequenos de **entregas reais e testadas**, prefixo `native:`.
- Não fazer commit apenas para aumentar contagem ou marcar tarefas artificialmente.
- Não misturar reformatação/refatoração global com implementação de feature sem justificativa.
- Ações paralelas de leitura/revisão são aceitáveis; **evitar dois agentes editando os mesmos arquivos**. Preservar alterações locais do usuário.
- Quando uma tarefa exigir revisão do Plano Mestre, fazer commit dedicado e registrar ADR/impacto.
- Commits e verificações Git locais continuam obrigatórios. Operações remotas ficam proibidas até solicitação explícita do usuário, mesmo que a branch possua um remote configurado.

## Relatório obrigatório ao encerrar cada sessão

Informar de forma objetiva:

```text
Branch:
HEAD:
Fase atual:
Última tarefa VALIDADA:
Próxima tarefa PENDENTE:
Commits:
Build/testes executados e resultados:
Validação Windows/visual (realizada ou pendente):
Bloqueios e condição de desbloqueio:
```

**Meta principal:** construir um produto realmente utilizável, extensível e seguro; avançar continuamente **sem pular gates, falsificar evidências ou comprometer dados**.
