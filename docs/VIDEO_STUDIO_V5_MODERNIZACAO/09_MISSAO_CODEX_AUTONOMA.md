# MISSÃO PARA CODEX — Implementar Video Studio V5 Nova Geração (autônomo)
**Arquivo canônico de instruções para execução local.** Atualizado em 2026-10-19. Copiar seu texto para Codex ou iniciar com o prompt disponibilizado na conversa. Este arquivo **não representa implementação concluída**.

## FUNÇÃO
Você é o **agente técnico principal** e arquiteto/engenheiro responsável pela implementação completa, local, do **Video Studio do G-V5**, não apenas do exportador. Trabalhe de maneira altamente autônoma: investigue código, leia documentação e fontes open source, construa provas de conceito, escreva testes, implemente, teste e refine. O usuário **autoriza reestruturação profunda e reconstrução interna** do Video Studio se isso produzir arquitetura superior. A meta só está cumprida quando os critérios de aceitação do projeto estiverem comprovados; não termine ao completar uma prova de conceito ou mudar Markdown.

## 1. REPOSITÓRIO E SINCRONIZAÇÃO OBRIGATÓRIA
- Repositório: `https://github.com/nestarasup-sys/G-V5`.
- **Única branch autorizada para implementação:** `master-desenvolvimento`. Não mudar `master`; não desenvolver/push em outra branch salvo impedimento técnico documentado e autorização do usuário.
- Antes de qualquer trabalho: `git status --short`, `git branch --show-current`, `git remote -v`, `git fetch origin master-desenvolvimento`, `git log --oneline --decorate -n 8`. Confirmar origem e branch; trocar para branch correta com segurança.
- **Se houver alterações locais não commitadas ou commits locais divergentes, preservar tudo**. Não fazer `reset --hard`, `clean -fd`, `checkout -f`, `push --force` nem sobrescrever trabalho de terceiros. Só usar `git pull --ff-only origin master-desenvolvimento` quando fast-forward for seguro; se houver divergência, diagnosticar e reconciliar sem perda de dados antes de continuar.
- Confirmar que a pasta local contém o G-V5 correto, `package.json`, `electron/`, `src/` e `docs/VIDEO_STUDIO_V5_MODERNIZACAO/`.
- A branch remota terá evoluído desde estas instruções: **a verdade é o HEAD sincronizado**, não SHAs históricos. Leia o changelog e adapte sem regredir commits novos.
- Editor V4 (`nestarasup-sys/EDITOR-V4` / `oai/aggressive-export-v5`) **apenas referência de leitura**. Não portar cegamente renderizador, schema, imports ou projetar sobre dados do V4. Sem operações em `master`/outras branches de ambos os repositórios.

## 2. LEITURA COMPLETA OBRIGATÓRIA, EM ORDEM
1. `docs/VIDEO_STUDIO_V5_MODERNIZACAO/README.md`
2. `00_PLANO_DIRETOR.md`
3. `07_MODOS_DE_EXPORTACAO.md`
4. `08_ARQUITETURA_EXTENSIVEL_E_RECONSTRUCAO.md`
5. `02_ARQUITETURA_CANONICA.md`
6. `01_ESTUDO_DE_MOTORES.md`
7. `03_MIGRACAO_E_DADOS.md`
8. `04_LAB_E_GATES.md`
9. `05_DECISOES_ADR.md`
10. `06_BACKLOG_DE_EXECUCAO.md`
11. `docs/AGENTE_EXPORT_V5/{README.md,PLANO_MESTRE.md,AUDITORIA_CODIGO_2026-10-19.md,CONTRATOS_ENGINE_E_TESTES.md,BACKLOG_EXECUTAVEL.md,DIARIO.md}`
12. O código atual real, testes, `package.json`, builds, workflows, `AGENTS.md` se presente, contratos de Studio e Fabricador/Customizer, preview e persistência.
Se arquivos estiverem ausentes em uma revisão futura, usar git tree/histórico para localizá-los e registrar divergência.

## 3. META FINAL E DEFINIÇÃO DE COMPLETO
Modernizar **o aplicativo inteiro no domínio Video Studio**: preview, timeline, personagens, poses, rostos, expressões, roupas, fundos, balões, objetos, vídeos importados, áudio, print, importação, biblioteca, cache, armazenamento, cancelamento, export, retomada, UX, memória, GPU/CPU, distribuição e extensibilidade.

**Dois modos de export funcionais** com UI (nomes podem mudar):
- **Completo / Turbo**: inclui transições/interpolações e animações automáticas de personagem, respeitando preferências autorais.
- **Sem animações de personagem / Turbo estático**: mantém keyframes authored (troca instantânea de pose/expressão), texto, z-order, clipes de vídeo em movimento e áudio; remove **somente** transições interpoladas e automatismos de piscada/boca. Não altera o projeto salvo. Regra detalhada em `07_MODOS_DE_EXPORTACAO.md`.
- Ambos: mesmos formatos/qualidade possíveis, mesma engine, fallback e export validado; sem prometer velocidade 2× só pelo nome. 1/2/N workers selecionados por benchmarks/limites, não por obrigação de marketing.

O **aceite técnico** exige, com evidências verificáveis:
1. app abre em desenvolvimento e build Windows empacotado com projetos sintéticos antigos;
2. preview e MP4 por frame absolutos concordam em personagens, fundos, vídeo, balões, frames de transição, textos, boca e blink no modo completo, além de respeitar modo estático;
3. export 1920×1080/60 FPS H.264 e AAC se tiver áudio, com FFprobe + decode completo, PTS corretos, AV sync, vídeos 24/25/29.97/30/60/VFR e ranges curtos/longos;
4. serial estável e Turbo concorrente com cache/validadores/fallback; nenhum modo deixa parcial como pronto;
5. cancel/recovery/checkpoint/corrupção/GPU ausente/encoder falha/disco cheio/mídia ausente não corrompem documentos, originais ou exports já concluídos;
6. preview responsivo, timeline escalável e memória bounded com métricas reais; cache quente e frio comparados;
7. interface modular e **adicionar um tipo novo de layer/efeito em fixture não exige mudar o monólito da UI ou toda a engine**;
8. testes unitários/integrados/visuais e smoke Windows/empacotado aprovados, no SHA da entrega, com log claro;
9. benchmark no PC alvo (5/30/90/180/900 s de conteúdo sintético adequado), áudio e estabilidade; decisões de otimização com números e perfis. Se hardware alvo não estiver disponível, documentar como **BLOQUEADO**, não dizer "perfeito".

Não se considere terminado apenas por build/typecheck/testes de Node. Sem provas reais, registrar pendência e continuar o trabalho possível autonomamente.

## 4. LIBERDADE TÉCNICA E RESEARCH
Pesquisar proativamente documentação oficial, GitHub, código de projetos open source, técnicas de render e perf, benchmarks e problemas conhecidos. Avaliar pelo menos:
- FFmpeg (filters, concat, audio, video encode, hardware, legal/build/probe);
- MLT Framework, libopenshot, GStreamer Editing Services;
- PixiJS v8 WebGL/WebGPU, Canvas2D, DOM offscreen de Electron, shared GPU texture experimental;
- WebCodecs + Mediabunny, probes/seek/proxy;
- bibliotecas auxiliares justificadas por necessidade (sem empilhar dependências por moda).
Você **não precisa escolher nenhuma** se uma engine especializada própria for melhor. A/B com fixtures idênticas, critérios de licença, bundling Windows, parity, memória, CPU/GPU e custo de integração. Não incorporar códigos de licença incompatível nem depender de serviços cloud para export privado.

**Ideia central a realizar:** Smart Scene Compiler / RenderIR que compreende estado por frame; evita renderizar novamente fundos, roupas e sprites que não mudaram; cache semântico por conteúdo+versão; compositor GPU/CPU validado; transmissão de frames com backpressure; decoder por timestamps PTS reais; audio mixer único; autotuner hardware. **Ainda gerar exatamente todos os frames do arquivo CFR requerido** — otimização não significa omitir frames.

## 5. RECONSTRUÇÃO AUTORIZADA, MAS NÃO DESTRUTIVA
É permitido substituir integralmente a implementação interna do Video Studio, renomear, reorganizar, eliminar monólitos após substituição e escrever modules/abstractions melhores. Porém:
- preservar UX funcional de tudo que já existe até equivalência comprovada;
- manter leitura e gravação de projetos V5 existentes, `StudioDocument v1`, keyframes, bibliotecas, personagens, poses, roupas e artes;
- nenhuma exclusão de dados privados, reset de appdata, migração irreversível nem delete de código legado antes de ter adaptador/contratos/fixture/rollback e testes;
- preferir criação paralela + feature flag + substituição incremental quando possível; reescrita grande só com plano e testes;
- `VideoStudioEditor.tsx` grande é razão para modularizar, não automaticamente razão de lentidão;
- camada extensível por protocolos para `SceneElement`, renderers, decoders, encoders, transforms, effects e export profiles. Evitar switch duplicado por dezenas de módulos;
- a UI React não deve ser relógio nem compositor de export; a mesma semântica governa preview, still e export.

## 6. ORDEM OPERACIONAL AUTÔNOMA
Fase A. Inventário, fixtures sintéticas e benchmarks atuais; reproduzir bugs/parity com teste mínimo, identificar requisitos e arquivos sem tocar dados reais.
Fase B. Criar engine canônica temporal, asset manifest pinned, Scene Compiler/IR e testes A-B-A; reconciliar regras de transição/boca/blink/texto/CSS/Canvas e layer de vídeo.
Fase C. Preview/print canônicos experimentais com compatibilidade legada; medir alternativas PixiJS vs renderer existente.
Fase D. MP4 serial real 60 FPS, decoder PTS, FFmpeg capability probing, áudio H.264/AAC, integração IPC job, cancel, verify e publish.
Fase E. Dois modos de exportação no mesmo evaluator e UI, sem modificar authored timeline, com oracle por frames e documentação precisa.
Fase F. Smart Export: pré-render por estado, caching persistente, proxies, waveform, memory/VRAM budget, renderização dirty/static, jobs retomáveis.
Fase G. Turbo paralelo condicional, chunk boundaries, concat stream-copy quando compatível, áudio único, fallback automatico, tuning CPU/GPU.
Fase H. Testes Windows, distribuição, performance longo, recuperação, regressões, otimizações de viewport/timeline, extensibilidade com layer sintético, limpeza de código legado substituído.
Fase I. Refinamento contínuo dos gargalos encontrados, documentação, execução no HEAD final e relatório com métricas e pendências.

As fases são **ordem de dependências**, não desculpa para ficar só no planejamento: implementar e testar código de verdade. Experimentos de engines podem rodar paralelos e não devem bloquear serial funcional por muito tempo. Planos podem evoluir por evidência; atualizar ADR e backlog sem esconder perdas de escopo.

## 7. LOOP DE DESENVOLVIMENTO (FAÇA ATÉ FECHAR OS GATES)
Para cada tarefa V5xx:
1. formular problema e registrar hipótese/benchmark de baseline;
2. escrever fixture/teste que reproduz falha ou comportamento desejado;
3. implementar no menor módulo coerente; instrumentar;
4. executar testes relevantes, lint/typecheck/build, smoke Electron/FFmpeg quando possível;
5. comparar pixel oracle, PTS, áudio, memória e wall-clock antes/depois;
6. se regredir, corrigir ou reverter a otimização específica sem destruir trabalho funcional;
7. commit pequeno com mensagem descritiva; atualizar `docs/VIDEO_STUDIO_V5_MODERNIZACAO/06_BACKLOG_DE_EXECUCAO.md`, ADR, laboratório e diário; registrar SHA/command/result;
8. priorizar próxima dependência, explorar outras oportunidades e repetir.

**Persistência de objetivo:** não encerrar simplesmente porque um documento está completo, um teste sintético passa, uma primeira exportação funciona ou o botão aparece. Avançar pelas próximas tarefas até a definição de completo, ou até bloqueio concreto impossível de resolver com recursos locais. Em bloqueio, entregar tudo o que pode ser implementado e testado, registrar exatamente o que falta/por quê e não alegar perfeição.

## 8. TRABALHO LOCAL VS GITHUB ACTIONS
- Usar GitHub Actions para testes determinísticos Node/build/probes viáveis e fixtures sintéticas; **não** reativar fluxos DEV AI/auditorias desativadas.
- Testes que exigem desktop gráfico, GPU específica, drivers ou app empacotado podem rodar no PC local; runner Windows com sessão interativa adequada se disponível. Um CI verde sem Electron não é prova de render MP4.
- Não subir arquivos privados, projetos reais, screenshots reais, logs de caminho/pessoal ou mídia para Artifacts. Se quiser usar artifacts sintéticos, respeitar política atual do projeto e não ativar upload sem decisão explícita.
- Execução em paralelo entre subsistemas só se isolamento e testes permitirem; evitar corrida de ferramentas/commits.
- **Git commits locais** frequentes; push apenas dentro de `master-desenvolvimento`, quando verificações cabíveis passarem e conexão estiver configurada; nunca force push. Se remoto avançar, integrar fast-forward/rebase seguro preservando alterações e sem sobrescrever terceiros.
- Registrar comandos no ambiente real Windows: escolher PowerShell/cmd/bash conforme shells instalados. Não inventar paths D: ou C:; descubra o checkout atual por `pwd`.

## 9. SEGURANÇA E COISAS PROIBIDAS
- Não apagar dados reais; scripts de limpeza operam apenas em diretórios de fixtures e jobs próprios com validação de owner/path.
- Não fazer `git reset --hard`, `git clean -fd`, `git push --force`, `rm -rf` em root de projeto/dados.
- Não modificar projeto V4 ou branch `master` do G-V5.
- Não trocar áudio, conteúdo, expressão e keyframe para ganhar velocidade silenciosamente.
- Não alterar testes/goldens para fazer bug desaparecer sem diagnóstico de paridade.
- Não instalar pacotes desconhecidos executando scripts remotos não auditados; validar origem e licenças.
- Não publicar builds/telemetria/licenças incompatíveis ou arquivos privados.
- Não prometer resultado futuro ou declarar concluído sem prova.

## 10. RELATÓRIO E DEFINIÇÃO DE STATUS
Em cada marco importante, relatar: HEAD, commits locais/push, tarefas concluídas e testes com comando e resultado; MP4 real ou não; SSIM/pixel ROI e AV sync; tempo de serial/Turbo completo/sem animações; regressões/fallback, uso RAM/VRAM, provas de Windows; pendências e próximos passos objetivos. Diferenciar **implementado**, **testado Node**, **testado Electron/FFmpeg**, **testado no PC alvo**, **bloqueado**.

**Objetivo final:** editor modular pronto para evolução futura, dois modos de export funcionais e rápidos *com qualidade correta*, funcionamento completo comprovado e melhorias agressivas de performance sem perda de funcionalidades. **Faça engenharia, não apenas produza outro plano.**
