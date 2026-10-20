# VIDEO STUDIO V5 — CHECKLIST FINAL DE RELEASE

Atualizado em 2026-10-20. Este arquivo é um **gate**, não uma declaração automática de conclusão. Estado real vem do HEAD + testes + workflows. Pesquisa/decisões externas consolidadas em [11_PESQUISA_OPEN_SOURCE_E_FECHAMENTO_EXPORTADOR.md](./11_PESQUISA_OPEN_SOURCE_E_FECHAMENTO_EXPORTADOR.md).

## Correção e paridade
- [ ] `npm run test:export:synthetic`, `npm run typecheck` e `npm run build` no HEAD exato
- [ ] Electron ExportSurface + MP4 H.264 1920×1080/60 + FFprobe + decode integral
- [ ] fixtures 5 s/30 s e fontes 24/29.97/60/VFR
- [ ] AAC 48 kHz: trim, delay, volume e silêncio fora do clip
- [ ] Preview DOM ↔ Canvas: texto/balões/V546 e personagem authored/transição/blink/mouth/vídeo
- [ ] A-B-A e A-B-A-C-A reproduzíveis nas variantes `animated` e `static-characters`
- [ ] `animated` e `static-characters` comprovados sem mutar o Studio
- [ ] serial é oracle de correção e fallback do Turbo

## Desempenho
- [ ] benchmark full-engine serial e Turbo 2 workers
- [ ] benchmark `workers × encoder/filter threads` para detectar oversubscription
- [ ] autotuner calibrado por benchmark; serial permanece fallback
- [ ] cache semântico L1 + L2 persistente cold→warm
- [ ] cache raster de background/layers limitado por bytes
- [ ] A/B layer cache ON/OFF com mesma saída
- [ ] proxy de preview + waveform com fallback para original
- [ ] proxy tem quota e estado transacional `pending/ready/failed/stale`
- [ ] scheduler latest-only de seeks
- [ ] 90 s e 15 min full-engine; RAM bounded
- [ ] RAM medida incluindo subprocessos quando tecnicamente possível
- [ ] número de frames/buffers in-flight é limitado
- [ ] pipe/writer stalls são observáveis e não acumulam memória
- [ ] composição/readback medidos; sharedTexture somente se readback dominar

## Dados e recuperação
- [ ] mídia/assets de personagem pinados por SHA-256
- [ ] CAS global permanece shadow/non-destructive
- [ ] resume preserva chunks íntegros e refaz somente faltantes/corrompidos
- [ ] manifest corrompido/temps órfãos/final parcial nunca são publicados
- [ ] crash de surface/worker não corrompe projeto/job
- [ ] crash de FFmpeg não publica parcial
- [ ] kill antes/depois de checkpoint é recuperável
- [ ] falha durante concat/audio/verify/publish é recuperável
- [ ] cancelamento mata subprocessos e é idempotente
- [ ] resume é idempotente
- [ ] disk-full/permissão negada falham sem publicar saída parcial
- [ ] cancel durante Turbo/fallback/concat/verify não deixa orphan subprocess

## Windows e distribuição
- [ ] build FFmpeg LGPL pinado por URL+SHA; GPL/nonfree ausentes
- [ ] AAC + encoder H.264 passam encode real
- [ ] pacote inclui `resources/video-tools`
- [ ] executável empacotado resolve `toolSource=packaged`, sem PATH
- [ ] notices + BUILD_INFO + MANIFEST preservados
- [ ] pacote limpo validado em Windows sem FFmpeg externo
- [ ] export real executado a partir do pacote/portable, não apenas do checkout

## Extensibilidade e experimentos
- [ ] V546: extensão sintética usa o mesmo registry em Preview e Canvas
- [ ] PixiJS WebGL A/B inclui readback; só promover com ganho + paridade
- [ ] Mediabunny/WebCodecs A/B; só promover com ganho + compatibilidade
- [ ] sharedTexture fica fora se profiling não justificar
- [ ] NodeAV/libav* direto não entra antes do release salvo gargalo comprovado
- [ ] MLT/GES/libopenshot permanecem referência/spike salvo vantagem comprovada sobre a engine específica

## Hardware alvo
- [ ] executar `powershell -ExecutionPolicy Bypass -File scripts/video-studio/run-hardware-gate.ps1 -Include15Min`
- [ ] resumir números do relatório sem commitar caminhos privados
- [ ] validar encoder, serial/Turbo, cold/warm, 90 s e 15 min no PC alvo
- [ ] recalibrar workers/threads/autotuner a partir do hardware real

## Critério de conclusão
A missão termina quando todos os gates aplicáveis têm evidência no HEAD, experimentos rejeitados estão documentados como rejeitados por dados, nenhum MP4 parcial é publicado, o pacote Windows funciona sem ferramentas externas e o gate do hardware alvo foi executado por um agente/processo com acesso ao PC.

## Evidência parcial registrada em 2026-10-20

Já existem evidências locais/CI de MP4 real, áudio, Turbo, cache, 90 s e 15 min em revisões anteriores, além do oracle sintético DOM ↔ Canvas. Contudo, houve falha posterior de A-B-A no character/media oracle e o HEAD continua evoluindo. Portanto **nenhum checkbox deve ser inferido apenas de um run histórico**: a rodada final precisa provar o HEAD exato.

## Regra de prioridade

Se houver conflito de agenda entre experimento e fechamento do produto:

```text
determinismo/recovery/package/hardware gate
    vence
Pixi/WebCodecs/sharedTexture/engine experiments
```
