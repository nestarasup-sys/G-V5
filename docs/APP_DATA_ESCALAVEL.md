# Estrutura escalável dos dados do GACHA V5

## Estado desta entrega

Esta etapa introduz a fundação do catálogo e do armazenamento endereçado por conteúdo. Ela **não migra nem indexa automaticamente** os arquivos existentes em `app-data/user-data`; os formatos atuais continuam como fonte canônica até cada domínio ganhar um adaptador e uma migração validada. O banco inicial é aditivo e pode ser removido somente antes de receber dados reais do catálogo.

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
- `Asset Catalog/Resolver` futuro deverá mediar Fabricador, Customizador, Studio e Video Studio por IPC tipado; nenhum renderer deverá construir caminho de mídia diretamente.
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
- O app cria a estrutura vazia e `database/catalog.sqlite` no próximo boot. A inicialização não percorre, copia ou altera arquivos já existentes.
- A tela Opções > Dados e armazenamento mede grupos por tamanho/quantidade sem exibir caminhos ou nomes de arquivos. É somente leitura; não limpa nem migra.
- O pacote oficial SQLite Tools 3.54.1 para Windows x64 foi baixado para `tools-local/sqlite-3.54.1`, ignorado pelo Git, após conferir o SHA3-256 do ZIP (`e171f3993a992edf076746926dd52b5e2ebfabaee38818e74987e1d8112ab987`). Inclui `sqlite3`, `sqlite3_analyzer` e `sqldiff` para diagnóstico local; não é dependência do app nem será incluído no build de usuário.

## Caminho de evolução

1. Provar as dependências, esquema, busca, deduplicação binária, miniaturas, snapshot e restauração com fixtures sintéticas.
2. Medir o inventário real localmente, sem publicar caminhos privados, e escolher um domínio piloto.
3. Adicionar adaptador de leitura/escrita por domínio mantendo compatibilidade com JSON e caminhos antigos.
4. Migrar uma cópia isolada do domínio, comparar IDs, vínculos, tamanhos e hashes, validar as telas consumidoras e provar rollback.
5. Só então migrar novos domínios e considerar remover cópias antigas que comprovadamente não sejam usadas.
6. Adicionar painel local de armazenamento, retenção e limpeza apenas após haver inventário confiável e testes de recuperação.

## Critérios de escala

Benchmarks devem usar dados sintéticos: 600 personagens, 1.000 assets de cabelo frontal, 1.000 inferiores e milhares de assets gerais. Medir cold start, consulta P95, primeira página de até 100 itens, memória, miniaturas decodificadas, importação, backup e restauração. Metas iniciais: abrir o shell em até 5 s; busca/filtro P95 abaixo de 250 ms; primeira página abaixo de 500 ms após entrar na categoria. Registrar hardware e resultados; não declarar escala comprovada sem captura e relatório reproduzíveis.
