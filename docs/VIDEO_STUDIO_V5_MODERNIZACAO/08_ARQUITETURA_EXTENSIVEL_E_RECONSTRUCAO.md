# ARQUITETURA EVOLUTIVA — Reestruturação do Video Studio, extensão e reconstrução controlada
Atualização: 2026-10-19 · **autorização de reconstrução condicionada a equivalência funcional e migração segura**.

## Contexto da autorização do produto
O responsável pelo G-V5 **autoriza o Codex a reestruturar profundamente ou reconstruir o Video Studio atual**, se isso resultar em uma engine mais simples, modular, veloz, confiável e extensível. A autorização é para alterar código arquitetural e substituir implementações, **NÃO** para excluir projetos, bancos de dados, mídias, arquivos pessoais, bibliotecas do Fabricador, Customizador ou históricos. **Nenhuma limpeza destrutiva irreversível** de dados ou refatoração sem regressão/backup.

A abordagem default deve ser **strangler architecture**: construir engine vNext paralela, integrar por adaptadores/feature flags, migrar uma função por vez, comprovar paridade e só então retirar código velho. Um big-bang rewrite é aceitável **apenas se** a análise de custo demonstrar vantagem clara, fixtures e backups preservarem compatibilidade, e o app continuar inicializando ao longo dos commits.

## 1. Objetivos arquiteturais

1. Adicionar futuramente novos objetos, efeitos, animações, trilhas, tipos de mídia, renderers e codecs sem editar componentes gigantes ou acoplar lógica ao JSX.
2. Manter a mesma semântica do projeto para preview/print/export e as variantes de export.
3. Permitir experimentos com PixiJS, MLT, FFmpeg, GES/libopenshot, WebCodecs sem reescrever o domínio de personagens.
4. Não instalar bibliotecas pesadas sem ROI, licenças e integração Windows verificadas.
5. Operar com 1 ou mais workers, cache com quota, cancelamento, recuperação de falha e fallback de hardware.
6. Preservar desempenho do editor quando se adicionam dezenas de novos tracks e milhares de keys.

## 2. Árvore modular proposta (adaptar aos padrões reais do repo)

```text
src/
  shared/videoStudio/
    contracts/        # schema, validação, IDs, migrations, timing, versionamento
    scene/            # RenderIR, compiler, evaluator, semantics, event index
    animation/        # pose, expression, transitions, blink, mouth, future motion
    layers/           # Background, Sprite, Text, Video, Effect, future kinds
    text/             # glyphs, line breaks, ellipses, tails, fonts/geometry
    media/            # media PTS mapping, trims, audio plan, transforms
    renderVariants/   # animated/static-characters, future profiles
    cache/            # hash/version/invalidation policy (no IO here)
  renderer/features/videoStudio/
    shell/            # shell, commands and panels; React only UI
    timeline/         # virtualized tracks, snapping, selection, transport
    preview/          # presentation adapter, rulers, HUD
    inspector/        # form components, presets, character edit
    adapters/         # bridges to Customizer/Fabricator and old Studio
    renderers/        # Canvas, Chromium DOM, Pixi proof-of-concept
  electron/videoStudio/
    api/              # IPC typed + sender validation
    jobs/             # state machine, journal, resume, cancel
    media/            # FFprobe, decode, proxy, audio, CAS resolver
    render/           # offscreen capture protocol and buffer ownership
    encode/           # FFmpeg profiles, HW capability probe
    scheduler/        # single worker and N chunk orchestration
    library/          # export and user projects, safe publish
    metrics/          # benchmark/tracing, no private payload
tests/videoStudio/
    fixtures/         # synthetic only
    unit/
    integration/
    visual/
    windows/
```

Não é necessário deslocar todos os arquivos literalmente. **Objetivo são fronteiras estáveis e testáveis**, não estética da árvore. O schema autoral `StudioDocument` pode seguir em `src/shared/studio.ts` com reexports controlados. Evitar migração global de imports só por renomear diretórios.

## 3. Portas de extensão tipadas (sem executar plugins arbitrários)

```ts
interface SceneElementPlugin<TDocument = unknown, TState = unknown> {
  kind: string; schemaVersion: number;
  validate(input: unknown): TDocument;
  compile(document: TDocument, ctx: CompileContext): TState;
  evaluate(state: TState, frame: number, ctx: EvaluationContext): RenderLayer[];
  collectDependencies(state: TState): AssetDependency[];
  getBounds(state: TState, frame: number): PixelRect;
  cacheKey(state: TState, engineVersion: string): string;
  renderCapabilities: { cpu: boolean; gpu: boolean; deterministic: boolean };
}
interface RendererBackend {
  readonly id: string; prepare(snapshot: CompiledScene): Promise<void>;
  renderFrame(frame: CompiledFrame, signal: AbortSignal): Promise<FrameLease>;
  dispose(): Promise<void>;
}
interface MediaBackend {
  probe(media: MediaSource): Promise<MediaInfo>;
  seekToTimestamp(source: MediaSource, time: RationalTime, signal: AbortSignal): Promise<DecodedFrame>;
}
```

**Exemplos ilustrativos**, não bibliotecas já implementadas. Não permitir execução remota de plugins não confiáveis. Primeira versão: registro **interno e estático**, construído no bundle, permitindo adicionar classes nativas ou TS avaliadas em tests/CI. Para user plugins no futuro, projetar sandbox e permissões separadamente.

**Extensibilidade por capacidades e versão:** novos kinds precisam declarar fallback de renderer, cache invalidation, serialização/deserialização, time semantics, rendering sem animações, segurança e coverage de testes. Não fazer `switch` espalhado em React, render/export, store e IPC.

## 4. Padrão de pipeline futuro

```text
User changes → Command bus → Undo/Redo → Immutable authored document
                                   └─▶ SceneCompiler → CompiledScene
                                                       │
                            ┌──────────────────────────┼────────────────────────────┐
                            ▼                          ▼                            ▼
                      PreviewAdapter              StillAdapter               ExportScheduler
                       UI 30/60 FPS               print at N               serial/parallel N
                            │                          │                            │
                   RendererBackend              RendererBackend            RendererBackend
                            └──────────────────────────┼────────────────────────────┘
                                                       ▼
                                     Media/Audio/Encode + verified MP4
```

Editor UI, domínio de frames e codificação não dependem reciprocamente. Uma capacidade ausente é detectada antes de começar o render, não depois de exportar 14 minutos.

## 5. Migração e proteção do usuário

- Começar por inventário de componentes do editor, comandos, persistência, formatos e testes; listar o **catálogo de recursos atuais** antes de retirar implementações.
- Manter a leitura/gravação de projetos v1 e cópias de vídeos existentes; um projeto salvo no editor antigo continua abrindo, tendo timeline, rosto e fala com o mesmo resultado.
- Fazer migrações idempotentes/versionadas com backup, roundtrip e dry-run sintético.
- Manter testes golden de dados antigos gerados (não privados), import/duplicate/save/reopen/delete, modelos, poses, recortes, assets e URLs.
- Não apagar `VideoStudioEditor.tsx` ou arquivos antigos até o sucessor passar nos gates de equivalência e a inicialização Windows empacotada.
- Evitar manipulação automática de arquivos privados locais; testar em profile temporário e synthetic app-data.
- Uma nova estrutura deve preservar hooks/autosave/undo/redo e acessibilidade em torno da engine nova.

## 6. Critérios de escolha reescrita vs extração gradual

Reescrever componente/subsistema quando **todos** são verdade:
1. Ele é barreira real à modularidade/performance/correção demonstrada por testes/profiling ou análise de dependências.
2. Existe especificação do comportamento, fixtures/contratos atuais e caminho de migração.
3. Há como inverter o switch sem tocar dados user-facing.
4. O novo subsistema tem fewer coupling points, limites de memória/cancel claros e adequação a novas extensões.
5. O prazo/custo/riscos são inferiores à manutenção do legado ou a correção isolada seria quebradiça.

Se faltar condição, começar extraindo domínio e adaptadores do componente existente. **Não confundir arquivo grande com prova de lentidão**. O tamanho atual de `VideoStudioEditor.tsx` é um sinal de acoplamento, não benchmark.

## 7. Fases de substituição

| Etapa | Ação | Gate |
| --- | --- | --- |
| R0 | catálogo de recursos atual + fixtures + baseline | testes observam comportamento legado |
| R1 | contratos, indexes, RenderIR e RenderVariants atrás de adapter | identical state by frame |
| R2 | renderizador compartilhado screenshot/print/export | visual parity + text/font |
| R3 | MP4 serial + áudio, API IPC e cancel | Windows ffprobe/decode |
| R4 | timeline/preview/inspector extraídos para componentes | undo/redo/autosave e perf |
| R5 | engine Smart Export/cache/proxies | cold/warm + memory + parity |
| R6 | concorrência e dois modos (animated/static) | boundaries/PTS/audio + retry |
| R7 | remover código morto/rotas duplicadas com tests/migration | todos os gates regressivos |
| R8 | documentação de extensões e exemplo de novo layer | adiciona um tipo novo sem grande refactor |

## 8. Critério de arquitetura futuramente extensível (aceite)
Como teste, implementar em fixture um **novo elemento sintético** (ex. retângulo com fade controlado por 3 keyframes) usando registro de layer, evaluator, preview, print, export e serialização. A adição deve tocar módulos de registro/implementação/testes, **sem editar um monólito JSX, FFmpeg command builder, todos os backends ou formatos legados**. Testar renderização no modo Sem animações sob política explícita de nova feature.

## 9. O que é livre para o agente decidir
- Divisão exata de pastas e código.
- Bibliotecas open source/algoritmos depois de pesquisa e verificação de licença.
- Reestruturar internamente UI, timeline, render, media, export e cache.
- Criar fixtures, benchmarks e documentação de arquitetura, testar alternativas e abandonar hipóteses.
- Número de workers e opções de codificação automáticas.
- Otimizações próprias superiores ao V4.

## 10. Limites de autonomia

Sem solicitação adicional, **não**: apagar dados/projetos/caches pessoais; forçar migração destrutiva; modificar `master`, branch do V4 ou outros repositórios; publicar release; ativar telemetria de conteúdo; subir mídia privada para CI; incorporar código de licença incompatível; desabilitar recursos para simular ganho; apagar testes que falham para ganhar "verde". Mudanças de arquitetura não autorizam perda de dados.

**Documentos relacionados:** [00_PLANO_DIRETOR.md](./00_PLANO_DIRETOR.md), [07_MODOS_DE_EXPORTACAO.md](./07_MODOS_DE_EXPORTACAO.md), [06_BACKLOG_DE_EXECUCAO.md](./06_BACKLOG_DE_EXECUCAO.md), [04_LAB_E_GATES.md](./04_LAB_E_GATES.md), [03_MIGRACAO_E_DADOS.md](./03_MIGRACAO_E_DADOS.md).
