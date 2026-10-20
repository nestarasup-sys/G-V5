# VIDEO STUDIO V5 — CHECKLIST FINAL DE RELEASE

Atualizado em 2026-10-20. Este arquivo é um **gate**, não uma declaração automática de conclusão.

## Correção e paridade
- [ ] `npm run test:export:synthetic`, `npm run typecheck` e `npm run build` no HEAD exato
- [ ] Electron ExportSurface + MP4 H.264 1920×1080/60 + FFprobe + decode integral
- [ ] fixtures 5 s/30 s e fontes 24/29.97/60/VFR
- [ ] AAC 48 kHz: trim, delay, volume e silêncio fora do clip
- [ ] Preview DOM ↔ Canvas: texto/balões/V546 e personagem authored/transição/blink/mouth/vídeo
- [ ] `animated` e `static-characters` comprovados sem mutar o Studio

## Desempenho
- [ ] benchmark full-engine serial e Turbo 2 workers
- [ ] autotuner calibrado por benchmark; serial permanece fallback
- [ ] cache semântico L1 + L2 persistente cold→warm
- [ ] cache raster de background/layers limitado por bytes
- [ ] proxy de preview + waveform com fallback para original
- [ ] scheduler latest-only de seeks
- [ ] 90 s e 15 min full-engine; RAM bounded
- [ ] composição/readback medidos; sharedTexture somente se readback dominar

## Dados e recuperação
- [ ] mídia/assets de personagem pinados por SHA-256
- [ ] CAS global permanece shadow/non-destructive
- [ ] resume preserva chunks íntegros e refaz somente faltantes/corrompidos
- [ ] manifest corrompido/temps órfãos/final parcial nunca são publicados
- [ ] cancelamento mata subprocessos e é idempotente
- [ ] disk-full/permissão negada falham sem publicar saída parcial

## Windows e distribuição
- [ ] build FFmpeg LGPL pinado por URL+SHA; GPL/nonfree ausentes
- [ ] AAC + encoder H.264 passam encode real
- [ ] pacote inclui `resources/video-tools`
- [ ] executável empacotado resolve `toolSource=packaged`, sem PATH
- [ ] notices + BUILD_INFO + MANIFEST preservados
- [ ] pacote limpo validado em Windows sem FFmpeg externo

## Extensibilidade e experimentos
- [ ] V546: extensão sintética usa o mesmo registry em Preview e Canvas
- [ ] PixiJS WebGL A/B inclui readback; só promover com ganho + paridade
- [ ] Mediabunny/WebCodecs A/B; só promover com ganho + compatibilidade
- [ ] sharedTexture fica fora se profiling não justificar

## Hardware alvo
- [ ] executar `powershell -ExecutionPolicy Bypass -File scripts/video-studio/run-hardware-gate.ps1 -Include15Min`
- [ ] resumir números do relatório sem commitar caminhos privados
- [ ] validar encoder, serial/Turbo, cold/warm, 90 s e 15 min no PC alvo

## Critério de conclusão
A missão termina quando todos os gates aplicáveis têm evidência no HEAD, experimentos rejeitados estão documentados como rejeitados por dados, nenhum MP4 parcial é publicado, o pacote Windows funciona sem ferramentas externas e o gate do hardware alvo foi executado por um agente/processo com acesso ao PC.

## Evidência parcial registrada em 2026-10-20

O oracle sintético Electron DOM ↔ Canvas passou em oito seeks, duas variantes e A-B-A binário. Cobre personagem, texto, vídeo importado, camadas e extensão V546; métricas e hashes constam em `04_LAB_E_GATES.md`. Os checkboxes acima permanecem desmarcados porque exportação MP4 comparada, print, cenários longos, distribuição, hardware e demais requisitos ainda não foram demonstrados.
