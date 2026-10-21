# AGENTS.md — G-V5 Avalonia (instruções permanentes para Codex)

> **Escopo:** este arquivo rege **somente** a nova aplicação em `master avalonia/`.
> A raiz do repositório e os diretórios externos a esta pasta são **legado Electron/React, somente leitura**.

## Missão e fontes de verdade

Reconstruir o G-V5/Gacha Nymi como uma aplicação desktop **C# + .NET 10 + Avalonia**, sem Chromium, mantendo fidelidade funcional e **visual** ao Gacha 5 original em Electron, com arquitetura modular sustentável. **Não é uma conversão linha a linha** das telas React: reproduzir a experiência visual em controles Avalonia nativos, sem transportar o runtime antigo.

### Identidade visual obrigatória

- A identidade visual reconhecível do Gacha 5 é obrigatória, mas **não exige igualdade pixel a pixel**. ADR-0006 permite pequenos ajustes de posição, dimensões e estilo; a prioridade é preservar e melhorar **todos os botões e funcionalidades reais**, sem controle decorativo.
- Consultar `docs/ui-fidelity/CONTRATO_VISUAL_GACHA5.md` e o inventário `docs/legacy-contracts/PENDENCIAS_FUNCIONAIS_FABRICADOR.md`. Registrar separadamente **função ausente** (obrigação técnica) e **detalhe estético diferente** (refinamento opcional) antes de marcar área concluída.
- Usar somente o Gacha 5 original deste repositório como referência. **Editor V4 é outro projeto e não é referência visual**.
- Distinguir evidência de código, captura Electron real e validação visual no Avalonia. Não afirmar paridade por semelhança de nomes, build verde ou screenshot fictícia.
- Modernizar com Avalonia, virtualização, acessibilidade e melhor performance. Pequenas diferenças visuais são aceitas e revisáveis; apenas redesign radical, perda de função ou descaracterização exigem aprovação.

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
- Proibido force push ou sobrescrever alterações de outra sessão/agente. **Não consultar nem sincronizar GitHub até autorização explícita do usuário**; até lá usar só Git e testes locais.
- Não executar operações destrutivas no Git, limpar dados ou excluir o legado sem autorização explícita do usuário.

## Meta operacional curta vigente — 2026-10-21

**Construir o G-V5 Avalonia com todos os botões, fluxos e funcionalidades do Gacha 5, mas UI apenas parecida e reconhecível, não pixel-perfect.** Melhorar a experiência com recursos nativos. Avançar continuamente desde **F07.02** com implementação real, testes, persistência e reabertura; registrar evidências e commits locais. Não bloquear por capturas estéticas pendentes, não marcar pronto sem prova funcional. Resolver as lacunas listadas em `docs/legacy-contracts/PENDENCIAS_FUNCIONAIS_FABRICADOR.md` antes de G2. Proteger legado Electron e dados pessoais. Respeitar a ordem de módulos e deixar Video Studio por último. **Não usar GitHub, fetch, pull nem push sem nova autorização do usuário.**

## Execução contínua, mas estritamente sequencial

1. Identificar a **primeira tarefa PENDENTE** do Plano Mestre, considerando `EXECUTION_STATUS.md` e evidências reais.
2. Trabalhar em **uma tarefa por vez**. Não implementar tarefas futuras antecipadamente; pode dividir a tarefa atual em subpassos registrados.
3. Quando a tarefa passar em todos os seus testes/validações, atualizar status e criar commit coeso.
4. **Continuar automaticamente com as próximas tarefas na mesma sessão** enquanto houver condições; não parar depois de cada checkbox. Preferir ciclos flexíveis de aproximadamente **3–8 tarefas relacionadas**, sem quota artificial.
5. Na conclusão de uma fase, comprovar o **gate técnico** antes de avançar: ações reais, testes, dados e arquitetura. Ausência de screenshot Electron/Avalonia ou teste manual com asset pessoal deixa revisão de produto pendente, **não bloqueia automaticamente a próxima fase** quando a engenharia está demonstrada (ADR-0006).
6. Se houver falha funcional crítica, corrigir antes de avançar. Falta de captura ou validação de aparência em Windows/GPU/assets privados deve ser registrada como revisão pendente, sem inventar aceite nem impedir tarefas tecnicamente independentes. Se a própria funcionalidade não puder ser comprovada sem isso, manter bloqueio técnico justificado.
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
