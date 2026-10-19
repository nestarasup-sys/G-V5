# Estrutura escalável dos dados do GACHA V5

## Estado desta entrega

A fundação de catálogo SQLite, armazenamento endereçado por conteúdo e miniaturas continua ativa. Esta implementação acrescenta armazenamento de arquivos por domínio, migração guiada, backups locais verificáveis e restauração transacional. A migração **não inicia automaticamente**: o usuário a inicia em Opções > Dados e armazenamento. Os arquivos legados são mantidos até a aplicação concluir um carregamento saudável depois da migração; então apenas os arquivos identificados pelo manifesto e cobertos pelo snapshot de migração são removidos. Não foi executada uma migração contra os dados reais do usuário nesta rodada.

O catálogo está na versão de esquema 2. Migração interrompida mantém registro de estado e pode ser retomada. A opção pausar termina o domínio corrente e interrompe entre domínios. O reinício final confirma o novo layout e verifica novamente origem, snapshot e destino antes da limpeza prevista.

## Layout alvo

```text
app-data/
├── user-data/                     # perfil Electron/Chromium e preferências
├── database/
│   ├── catalog.sqlite             # metadados e índices; modo WAL
│   ├── migrations/                # versão e estado das migrações
│   └── journal/                   # recibos locais de operações/migrações
├── libraries/                     # índice lógico de conteúdo publicado
├── characters/                    # destino futuro para escolhas/deltas
├── projects/                      # destino futuro para referências/snapshots
├── media/
│   ├── objects/sha256/ab/<hash>    # binários imutáveis compartilháveis
│   ├── thumbnails/                 # PNGs derivados e recriáveis
│   └── imports-staging/            # staging de importações canceláveis
├── cache/                          # dados inteiramente regeneráveis
├── temp/                           # arquivos temporários enquanto operações rodam
├── logs/                           # logs locais sem conteúdo de personagens
├── crash-dumps/
├── backups/                        # snapshots verificáveis e rollback
└── manifests/                      # inventário, proveniência e hashes
```

O layout existente dentro de `user-data` permanece ativo durante a transição. Não se deve mover o diretório Electron `user-data` nem reescrever suas bibliotecas como parte da inicialização do novo catálogo.

## Contratos

- O SQLite cataloga domínios, entidades, metadados, relações e arquivos. FTS5 indexa nome, tipo e metadados para busca; os binários ficam fora do banco.
- IDs de entidade são independentes de nomes e hashes. O SHA-256 identifica o conteúdo de um arquivo; entidades distintas podem referenciar o mesmo objeto sem se tornarem a mesma entidade.
- Cada domínio registra `domain_id`, versão do schema e manifesto. Categorias novas são declaradas no registro, sem alterar o schema físico para cada tipo novo.
- `DataPlatform` é o ponto único para inicializar catálogo, registrar domínio/asset/relação, paginar/buscar e obter resumo. `ContentAddressedStore` publica objetos em `media/objects/sha256`, gera miniaturas e avalia recompressão PNG lossless.
- `DomainFileSystem` preserva as operações de arquivo usadas pelos módulos existentes e as direciona para o catálogo/armazenamento por conteúdo após o domínio ser ativado. Domínios ainda não migrados continuam usando os caminhos legados.
- Fabricador, Customizador, Studio e Video Studio passam a usar essa camada em seus fluxos de persistência conectados. O IPC existente permanece compatível; a camada resolve caminhos virtuais para leitura e streaming.
- PNGs enviados permanecem byte a byte intactos. Miniaturas são derivações recriáveis. O relatório de recompressão lossless compara pixels decodificados e bytes, mas não troca o original.

## Segurança e recuperação

- Todos os caminhos gerados são confinados à raiz local e recusam raiz/diretórios finais simbólicos ou não canônicos.
- Publicação de binários usa staging em `app-data/temp`, hash e rename atômico. Objetos já existentes são revalidados antes de reutilização.
- O catálogo usa `foreign_keys=ON`, `journal_mode=WAL` e `synchronous=FULL`. WAL e banco são tratados como um conjunto vivo; snapshots são criados pela API de backup do SQLite, verificados por `integrity_check` e publicados por rename.
- Nenhum coletor de lixo de objetos ou retenção automática de backups está habilitado nesta etapa. Antes de qualquer coleta futura, ela deverá validar referências, hashes, backup e restauração.
- `app-data` está dentro da pasta do projeto. Isso melhora portabilidade entre pastas, mas cópias no mesmo disco não protegem contra falha física do disco.

## Dependências e operação

- `better-sqlite3` é compilado para a versão de Electron instalada pelo script de pós-instalação usando `@electron/rebuild`.
- `sharp` usa binários/libvips distribuídos pelo pacote oficial npm para processamento de imagens. Deve permanecer fora do bundle JavaScript e fora de ASAR na configuração de distribuição, quando ASAR for adotado.
- A tela Opções > Dados e armazenamento mostra inventário por domínio, progresso da migração, pausa segura e reinício após a conclusão. A limpeza legada só ocorre após carregamento saudável e verificação de hashes.
- Backups manuais incluem catálogo, bibliotecas, personagens, projetos e mídia durável, com manifesto de hashes e teste de integridade SQLite. Cache, logs, temporários e a própria pasta de backups são excluídos. Restaurar cria primeiro um backup de segurança, prepara os dados em staging e só troca as raízes no reinício; a troca é confirmada após carregamento saudável.
- Backups são locais ao mesmo disco e não protegem contra falha física, perda ou corrupção desse disco. O usuário deve copiar backups importantes para outro dispositivo/local.
- A migração real permanece pendente de execução e validação pelo usuário. Esta entrega não percorre nem modifica o perfil pessoal automaticamente durante testes ou build.
- O pacote oficial SQLite Tools 3.54.1 para Windows x64 foi baixado para `tools-local/sqlite-3.54.1`, ignorado pelo Git, após conferir o SHA3-256 do ZIP (`e171f3993a992edf076746926dd52b5e2ebfabaee38818e74987e1d8112ab987`). Inclui `sqlite3`, `sqlite3_analyzer` e `sqldiff` para diagnóstico local; não é dependência do app nem será incluído no build de usuário.

## Implementação e próximos passos

1. Catálogo, esquema, busca e armazenamento por conteúdo foram exercitados com fixtures sintéticas.
2. O painel local agora prepara inventário de domínios e inicia migração guiada; a validação do inventário pessoal deve ser feita dentro do app, sem enviar relatórios privados.
3. Adaptadores de arquivo por domínio mantêm chamadas legadas e direcionam operações de leitura/escrita para domínios ativados.
4. Migração sintética verifica hashes, espaço, cópia, retomada e limpeza somente após carregamento saudável.
5. Backups manuais e restauração foram exercitados em sandbox sintético, incluindo verificação e troca transacional de raízes.
6. Retenção automática e coleta de objetos continuam desativadas; a implementação não remove backups manuais nem objetos compartilhados automaticamente.

Pendências para a validação no perfil real: executar a migração guiada com o app fechado de outras instâncias, confirmar visualmente Fabricador/Customizador/Studio/Video Studio, testar backup copiado para outro disco e manter o backup de segurança até confirmar todos os dados. A cobertura sintética não substitui essa validação.

## Critérios de escala

Benchmarks devem usar dados sintéticos: 600 personagens, 1.000 assets de cabelo frontal, 1.000 inferiores e milhares de assets gerais. Medir cold start, consulta P95, primeira página de até 100 itens, memória, miniaturas decodificadas, importação, backup e restauração. Metas iniciais: abrir o shell em até 5 s; busca/filtro P95 abaixo de 250 ms; primeira página abaixo de 500 ms após entrar na categoria. Registrar hardware e resultados; não declarar escala comprovada sem captura e relatório reproduzíveis.
