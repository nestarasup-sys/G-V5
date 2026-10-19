# ADR-0001 — Runtime, arquitetura de processos e estratégia de testes

**Data:** 2026-10-18  
**Status:** proposta para validação, **não aprovada para substituir Electron**  
**Base de evidência:** `5b8483454757f4cc9606c626471aabbeccf35daa`  
**Impacto:** distribuição desktop, performance, mídia, filesystem, segurança e DEV AI  
**Decisões relacionadas:** [qualidade e operação](../QUALIDADE_E_OPERACAO.md), [runner e isolamento](../ISOLAMENTO_STUDIOS_E_DEV_AI.md), [dados e recuperação](../DADOS_E_RECUPERACAO.md).

## Contexto e problema

O G-V5 usa Electron + electron-vite + React/TypeScript com APIs expostas pelo preload. Os Studios usam renderização web, timeline, vídeos e imagens; o Fabricador já utiliza Web Workers, `OffscreenCanvas` e `createImageBitmap`. O main administra IPC, disco, catálogos e protocolos internos. É preciso avaliar mudanças de runtime por custo mensurável do produto — não por preferência estética, popularidade ou tamanho do executável isoladamente.

**Objetivo obrigatório de produto:** aplicativo offline-first, workspaces portáteis, segurança por fronteiras, codecs e preview utilizáveis, edição fluida, alto volume de mídia, isolamento de áreas e runner DEV AI com suites **sem janela visível e sem interação manual**. A suíte de teste deve ser capaz de usar armazenamento sintético sem ler pastas reais do proprietário.

## Alternativas tecnológicas e trade-offs

| Opção | Ganhos plausíveis | Custos / riscos | Headless e offscreen | Veredito atual |
| --- | --- | --- | --- | --- |
| **A. Electron + React/TS, modularização incremental** | Aproveita UI, workers, IPC e auditorias; retém comportamento conhecido, Chromium previsível; menor risco de retrabalho de UI/timeline | Chromium embarcado usa RAM e disco; main concentrado requer extração; shell e renderer exigem hardening | `BrowserWindow({show:false})` existe no teste atual; pintar via offscreen é capacidade distinta; suportar Electron/Chromium por adapter e testar GPU/codec | **Linha base recomendada**, não certificação de performance |
| **B. Electron + processo auxiliar Rust/Node/FFmpeg restrito** | Permite decodificação/transcodificação e trabalho CPU/IO isolados, cancelamento, quota por processo; evolução por contrato | Mais binários, pipeline de empacotamento, IPC e versionamento; risco de cópias de buffer/latência/supply chain | Testar helper sem UI + screenshot pelo Chromium/Electron; fixtures sintéticas; protocolos IPC fechados | **PoC prioritária apenas após profiler** localizar gargalo de mídia ou imagem |
| **C. Tauri v2 + React + Rust** | Backend nativo com comandos/capabilities, shell geralmente menor, menor duplicação de runtime em plataforma compatível | Variabilidade WebView2/WebKitGTK/WKWebView, codecs/compositor, compatibilidade de canvas/trabalhos de imagem, portabilidade/release e migração da ponte; teste headless Windows/Linux/macOS não uniforme | WebDriver é dependente de plataforma/driver; offscreen não é garantido; a suíte deve provar screenshot e IPC reais sem abrir janela | **Investigar em spike isolado**, sem reescrever app agora |
| **D. App web/PWA local-first** | Distribuição simples, desenvolvimento de UI e DOM testáveis em Chromium headless; pouca dependência de app nativo | Filesystem limitado/permissões, integração e portabilidade de diretórios grandes, codecs, armazenamento local e backups do usuário, experiência de arquivos | Playwright headless para UI; APIs de arquivo diferem de desktop; não prova requisitos nativos | **Não substituir** sem atender filesystem/backup/arquivos enormes |
| **E. UI nativa completa (Qt/Flutter/etc.)** | Potencial controle de GPU/render e recursos específicos de desktop | Reimplementação muito ampla do editor/canvas/timeline, custo alto, regressão de UX e portabilidade de assets | Framework próprio para screenshot/teste; maior custo de suporte | **Não recomendada agora**, reconsiderar só com limitação fundamental provada |
| **F. WASM/C++/Rust apenas em kernels puros** | Operações de imagem/sinais CPU-bound podem ganhar eficiência em dados grandes; reutilização de kernel entre worker e backend | Marshalling JS↔WASM, memória duplicada, toolchain, SIMD/GPU e diferenças entre plataformas | Benchmarks sintéticos sem janela para kernel; screenshot do host ainda necessário | **PoC condicionada a gargalo medido** |

## Critérios ponderados da escolha (a ajustar após baseline)

A decisão de runtime deve comparar as mesmas fixtures reais sintéticas, no mesmo hardware/OS, sem misturar pintura offscreen com UI visível. Proposta de pesos iniciais: **correção e preservação de dados 25%**, confiabilidade/segurança 20%, desempenho em uso (latência p95, RSS, CPU, mídia) 20%, testabilidade offscreen/CI 15%, distribuição/atualização/compatibilidade 10%, manutenção e custo de evolução 10%. Registrar custo de suporte de Windows primeiro, e então plataformas oficialmente suportadas; critérios de bloqueio (perda de dados, dependência obrigatória da rede, ausência de teste IPC real em sandbox) não podem ser compensados por pontuação.

PoC mínima para qualquer alternativa: abrir projeto com milhares de elementos, preview 16:9, timeline vídeo/áudio, import/export e save/recovery, alternar Studio normal/Video Studio 100x, captar screenshot determinística sem janela visível, testar preload/IPC-equivalente real contra sandbox e transportar workspace entre diretórios. Usar `p50/p95`, pico RSS/CPU, frames perdidos, bytes copiados/latência, custo de instalação, tempo de build e manutenção de dois releases; anexar flags GPU/codec. Exigir ganho que supere ruído e custo de migração explícito.

## Decisão recomendada na data

**Manter Electron + React/TypeScript por enquanto, com arquitetura de ports/adapters e serviços de domínio que permitam trocar o host no futuro**; separar shell/workspaces, abstrair DataRoot e extração de IPC, estabelecer testes e baseline. Não introduzir Tauri, Rust, WASM nem FFmpeg no produto sem PoC e ADR complementar com resultados.

Adotar primeiro testes de funções puras e armazenamento em processo Node isolado; depois renderer em Chromium/DOM; depois testes Electron real com `BrowserWindow({show:false})` e perfil/raiz exclusivos. Avaliar Electron offscreen paint só depois de capturas do compositor sem janelas; `show:false` e `offscreen:true` são **coisas diferentes**. Playwright Electron é experimental; seu uso precisa de compatibilidade comprovada com a versão de Electron instalada, executável, Linux/Windows e flags de segurança. `axe-core` e linter não substituem teste de foco/Canvas manual ou adapter E2E.

**Regra de isolamento:** módulos puros podem usar TS/Rust/WASM, mas nunca receber caminhos de usuário brutos, acesso irrestrito ao disco ou executar comando externo arbitrário. Helper de mídia só deve ler arquivo explicitamente permitido e produzir output dentro do workspace, com tempo/memória/codec monitorados. Processos auxiliares devem ser encerrados no lifecycle/abort do workspace, sem ficar ativos depois da troca de rota.

## Gatilhos para reabrir a ADR

- Baseline repetível mostra gargalo acima dos limites de aceitabilidade em timeline/preview/importação, sem solução proporcional com Worker/caching/streaming.
- Electron em máquina mínima não atinge SLO de RSS/CPU ou render confiável; uma alternativa demonstra melhoria e conservação de features.
- Requisito de codec/export necessita helper nativo validado e empacotamento reproduzível/offline.
- PoC de Tauri prova suporte de UI, filesystem, codecs e offscreen por sistema operacional com custo de migração sustentável.
- Correção crítica de segurança ou política de distribuição impossibilita manter o host atual.

## Checklist de evidência obrigatória

- [ ] Levantar baseline de Electron com scripts registrados, números p50/p95, RSS e tamanho do instalador, no SO-alvo.
- [ ] Provar suite Electron real e captura `show:false` sem interface visível, separada de offscreen paint.
- [ ] Se justificar helper: benchmark isolado de media/image worker atual versus Rust/FFmpeg/WASM com mesmo fixture.
- [ ] Se justificar Tauri: spike de duas rotas Studios, importação/media playback, IPC nativo e testes offscreen em Windows/Linux.
- [ ] Registrar licenças, binários, suporte/atualização, riscos de CVE e efeito de rede/instalação por alternativa.
- [ ] Somente depois de obter dados, decidir em nova ADR de aprovação/rejeição e marcar esta como superada quando aplicável.

## Referências para avaliação, não evidência de PoC

- [Electron Security](https://www.electronjs.org/docs/latest/tutorial/security/)
- [Electron Offscreen rendering](https://www.electronjs.org/docs/latest/tutorial/offscreen-rendering/)
- [Playwright Electron](https://playwright.dev/docs/api/class-electron)
- [Tauri WebDriver](https://v2.tauri.app/develop/tests/webdriver/)
