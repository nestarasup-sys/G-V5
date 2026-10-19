# Segurança, logging, desempenho e operação

**Status:** desenho de qualidade proposto para R-06, R-18 e R-20–R-24/R-28. Nada aqui implica auditoria de segurança completa ou benchmarks executados. Fontes de implementação: `electron/main.ts`, `electron/preload.ts`, `src/renderer/index.html`, `src/renderer/src/ui/styles.css`, `src/renderer/src/features/options/OptionsPage.tsx`, `electron/videoLibrary.ts`.

## 1. Segurança: modelo de ameaças e checklist verificável

**Fronteiras de confiança:** renderer (incluindo dados importados) → preload tipado → IPC com identidade de janela/senderFrame → serviço de domínio → DataRoot e disco. Arquivos de imagem/vídeo e projetos importados são **entrada não confiável**, mesmo quando escolhidos pelo usuário. Worker e protocolos customizados também processam dados não confiáveis.

**Positivo observado:** `contextIsolation:true`, `nodeIntegration:false`, `sandbox:true`, validação de origem em `assertTrustedSender`, UUID nos protocolos e filtros de tipo/tamanho em alguns importadores. **Gaps a validar:** não há CSP explícita em `index.html`; política explícita de navegação e popups não foi localizada na criação da janela; permissões de sessão não são configuradas no caminho inspecionado; extensão não equivale a magic bytes; caminhos confiados a wrappers precisam de checagem de symlink; base64 gigante pressiona main/renderer. Esses são riscos de design, **não provas de exploração**.

| Controle | Teste/prova exigida |
| --- | --- |
| CSP por dev/prod, `script-src` estrito | build e Worker continuam; bloqueio de script externo/injection em fixture |
| `will-navigate`, `setWindowOpenHandler`, permissões explicitamente negadas | URL desconhecida, `window.open`, câmera/microfone/notificações indevidas recusados |
| origem/owner de IPC, args validados, `workspaceId` do canal | frame não autorizado, payload inválido, canal cruzado e rate limits rejeitados |
| protocolos `gacha-video`/`gacha-background` | UUID/range inválidos, métodos não previstos, symlink, path fora da pasta, erro em mídia ausente |
| importação | magic bytes, MIME, dimensões, duração, decompress ratio, cópia temporária, cota, tipos inválidos |
| storage | canonicalização Windows, `..\`, UNC, symlink, diretório de instalação, readonly, mtime não confiável |
| cadeia de suprimentos | `npm ci` e lockfile fixos, revisão de licenças/manutenção, SBOM local, revisão de scripts lifecycle, atualização controlada |
| superfície de DEV AI | área de desenvolvimento ausente em release, commands em allowlist, sem network/upload default |

**Ferramentas locais candidatas:** `eslint` + regras arquiteturais, `typescript` já presente, `dependency-cruiser`/Madge para import graphs, `vitest` para lógica pura, `@playwright/test`/Playwright Electron experimental para DOM/IPC, `axe-core` para a11y, `sharp` opcional se medir ganho em pipeline de imagem. Instalar **somente** após verificação de suporte Node/Electron/OS, licença, tamanho, manutenção e PoC; versões exatas + lockfile, sem instalação global. `npm audit` depende de serviço externo: não automatizar envio de metadados sem aprovação; usar SBOM/scan local ou serviço autorizado.

**Fontes oficiais para PoC:** [Electron Security](https://www.electronjs.org/docs/latest/tutorial/security/), [Electron Offscreen](https://www.electronjs.org/docs/latest/tutorial/offscreen-rendering/), [Playwright Electron](https://playwright.dev/docs/api/class-electron), [Tauri WebDriver](https://v2.tauri.app/develop/tests/webdriver/). Documentação consultada na revisão, não homologação local.

## 2. Logging estruturado e diagnóstico

**Serviço novo:** `LoggingService` no main recebe eventos JSONL por fila bounded; preload encaminha eventos allowlisted do renderer e IPC injeta `requestId`. `operationId` atravessa serviço/storage; `runId` marca DEV AI; `entityId` opcional deve ser pseudônimo estável por operação. Uso de `AsyncLocalStorage` no main é candidato a testar, não obrigatório no renderer. UI nunca registra payloads integrais.

Contrato mínimo:
```json
{
  "schemaVersion": 1,
  "timestamp": "2026-10-18T00:00:00.000Z",
  "level": "info",
  "event": "studio.document.save.completed",
  "featureId": "studio",
  "layer": "storage",
  "requestId": "uuid",
  "operationId": "uuid",
  "result": "success",
  "durationMs": 34,
  "details": { "assetCount": 5, "sizeBucket": "1-10MB" }
}
```

**Privacidade por allowlist:** permitidos `event`, `featureId`, `layer`, IDs correlacionáveis, durações arredondadas, contagens, tamanhos por faixa, formato conhecido, código de erro, bucket de operação. Proibidos por default: strings livres de erros/stack, paths absolutos, usernames, nomes de arquivos, roteiro, texto da cena, tokens, data URLs, mídia, payload IPC e query de usuário. Redaction é antes da escrita/export, além de teste com segredos sintéticos. UI Opções→Logs lê índices paginados/limitados, sem `readFile` irrestrito.

**Política inicial sujeita a volume medido:** log operacional 5 arquivos de 10 MiB, retenção 14 dias; atividade 30 dias/50 MiB totais; falhas de logger não bloqueiam autosave, usar ring buffer limitado de até 1 MiB + sinal de degradação. Não apagar a trilha de auditoria de exclusão/backup antes da janela de recuperação definida em produto; documentar escolha real de retenção. Quota é garantida, com truncamento seguro em linha completa e escrita protegida de concorrência. Usar compressão local somente se testes justificarem IO/CPU.

**Acontecimentos auditáveis:** criação, importação, edição confirmada (agregada por comando), duplicação, exportação, backup, exclusão, restore, migração, falha persistente, limpeza de logs. Não registrar por mousemove, frame ou render. Erros têm código estável, mensagem pública localizada, `requestId` e remediação. `TopBar` consome estado real: `pending`, `saved`, `failed`, `unknown` — nunca status 'salvo' prematuro.

**Testes:** simular 100k eventos sintéticos; garantir limites e rotação, arquivo parcialmente truncado recuperável, permissão negada, disco cheio, erro de serializer, logger duplicado e export redigida; simular segredo/path/data URL e exigir 0 ocorrências. Correlacionar um fluxo IPC end-to-end em relatório.

## 3. Desempenho com contrato comparável

| Fluxo | Métricas instrumentadas | Fixture / critério antes-depois |
| --- | --- | --- |
| Cold start | `process-start→first-interactive`, `first-contentful`, load/preload time | N≥20 cold starts em SO/hardware declarados, p50/p95 |
| Troca de workspace | navegação→`workspace-ready`, frames perdidos, dispose time | 100 alternâncias + heap/handles + screenshots |
| Studio estático | drag/input latency p95, render commits, canvas paint | elementos e resolução fixos em projeto sintético |
| Video Studio | seek→preview painted, timeline p95, frames efetivos, áudio sync, decode jobs | 1/30/100 tracks e clip count controlado, vários codecs |
| Asset import | bytes/s, decode, thumbnails, pico RSS e event-loop lag | 1 MB, 50 MB, limite negativo, mídia longa; sem bytes de usuário |
| Save/restore | request→durable commit, write amplification, recovery | assets variados, fsync/test fault injection |
| Uso ocioso | CPU, RSS, workers e recursos após desmontagem | idle 5–15 min no ambiente baseline |

**Gate quantitativo provisório** até baseline: para fluxo não otimizado, regressão de p95 ou pico RSS >10% requer diagnóstico/justificativa e aprovação explícita; resultado funcional/visual não pode degradar. Quando baseline registrar ruído elevado, estabelecer intervalo de confiança e repetir. Para otimização, exigir melhoria >ruído entre séries comparáveis e manter correção pixel/tempo/áudio. Nunca comparar screenshot GPU com software renderer sem fixar ambiente. Aplicar profiling somente ao gargalo medido, ex.: imagens base64 repetidas, render facial, timeline virtualizada, cache de preview e import de mídia; evitar abstrações/caches antes da medição.

**Separação observada:** já existem Web Workers e bibliotecas persistentes por domínio; não reescrever para Rust/WASM sem protótipo medindo custo de serialização, memória, distribuição e correção.

## 4. Estabilidade, qualidade, uso e a11y

- Controles assíncronos exibem carregando/erro/retentar/cancelar e indicam o estado de commit verdadeiro. O Error Boundary deve registrar erro sanitizado, permitir recuperação de documento e isolar falha de feature sem reiniciar app.
- Operações longas aceitam abort quando seguro; saves duráveis permanecem serializados no main mesmo após navegação. A UI evita callbacks após desmontagem, race e stale snapshot.
- Foco e teclado: todo modal trap/restore, label real, `aria-live` para falha/sucesso e dicas de atalho, escape coerente, tab order, zoom 200%, sem dependência exclusiva de drag; interação por teclado em timeline e painéis.
- Contraste e movimento: validar tokens do tema, estado de foco, reduced motion, screen reader e high-DPI; não assumir que `axe` cobre posicionamento/Canvas por si só.
- Recursos: watchers e workers possuem `dispose`; mídia/URL object são liberadas; buffers de thumbnail não ficam duplicados sem quota.
- Diagnóstico de usuário oferece bundle local redigido, sem arquivos de projeto, token ou mídia por default. Logs exportados não são telemetria; **nenhuma transmissão** ocorre sem opt-in explícito.
- CI local/offscreen deverá mostrar `unsupported` quando screenshot/codec/process isolation não suportados; nunca verde silencioso.

## 5. Revisão de release

- [ ] `npm ci` (lockfile íntegro) / TypeScript / build, lint e unit tests.
- [ ] Testes IPC/storage com sandbox real; schema migrations e export/import/restore, paths e malware sintético.
- [ ] Matriz de Studio↔Video incluindo CSS, atalhos, estado, persistência e teardown; smoke áreas não tocadas.
- [ ] Segurança de Electron conforme checklist oficial; políticas de import/protocol; deps/SBOM/licenças/risco de atualização.
- [ ] DOM + a11y + screenshots comparadas e revisadas, relatório com ambiente.
- [ ] Baseline/rebaseline antes/depois em pelo menos duas fixtures de carga; nenhum número inventado.
- [ ] Instalador/versão portátil e mover workspace para outro drive, com backup verificado; sem dados em Git/release.
- [ ] Documentar rollback, compatibilidade de schema, falhas conhecidas, limites GPU/codec, teste manual residual e checklist fechado com SHA/evidência.
