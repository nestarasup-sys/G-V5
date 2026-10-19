# Dados locais portáteis do GACHA V5

## Raiz

Todo dado persistente do aplicativo deve ficar sob `app-data/`, dentro do checkout original. A pasta é ignorada pelo Git e não deve ser incluída em commits, releases ou CI.

```text
app-data/
  database/catalog.sqlite   # metadados e arquivos lógicos por domínio
  media/objects/sha256/      # arquivos binários deduplicados por conteúdo
  media/thumbnails/          # miniaturas derivadas
  user-data/                 # perfil interno Electron e estado web
  logs/                      # logs locais
  crash-dumps/               # relatórios locais de falha
  temp/                      # temporários do processo do app
  backups/                   # backups manuais e recuperação local
  manifests/                 # recibos e proveniência local
```

## Evolução escalável do layout

A estrutura expandida está detalhada em [APP_DATA_ESCALAVEL.md](./APP_DATA_ESCALAVEL.md). O app cria `database/catalog.sqlite` e oferece migração guiada por domínio em Opções > Dados e armazenamento. A migração não começa no boot: o usuário confere o inventário e inicia a operação. Domínios ativados usam o catálogo e objetos endereçados por conteúdo através de um adaptador de filesystem, preservando os contratos de persistência das áreas. Os demais continuam usando os caminhos legados até serem migrados.

Antes de uma migração, crie um backup manual em Opções. A migração verifica origem e destino por hash e só remove os arquivos antigos após o primeiro carregamento saudável. Backups manuais permanecem até o usuário excluí-los. Não execute várias instâncias do app durante a migração.

Depois da migração, `user-data` permanece como perfil interno do Electron. Personagens, bibliotecas e projetos são lidos e gravados pelo catálogo e pelo armazenamento de objetos; as antigas pastas de domínio deixam de ser a fonte ativa. O perfil mantém `Local Storage` e preferências do renderer.

As áreas continuam com ownership separado: Fabricador publica bibliotecas e vínculos; Customizador guarda personagens e overrides; Studio normal e Video Studio salvam seus próprios projetos. O catálogo mantém esses domínios isolados e deduplica binários pelo hash do conteúdo.

## Migração do perfil Electron legado

`npm run dev` e `npm run preview` executam `scripts/prepare-app-data.cjs` antes de abrir o Electron. O Electron de desenvolvimento aponta `userData` e `sessionData` para `app-data/user-data`; a versão empacotada usa `app-data` ao lado do executável. Logs, crash dumps, temporários do processo e o caminho `appData` também são direcionados para a raiz local. Se o perfil `%APPDATA%/gacha-nymi-work-app` existir e `app-data/user-data` ainda não existir, o migrador:

1. Confirma que não há processo principal do GACHA V5 aberto.
2. Inventaria arquivos e diretórios, rejeitando links simbólicos e tipos especiais.
3. Copia o perfil inteiro para um staging dentro de `app-data` e compara SHA-256, tamanhos e estrutura.
4. Copia para `app-data/user-data` e compara novamente a publicação por hash.
5. Faz uma cópia de verificação do perfil legado, move o original para `app-data/backups/roaming-profile-<data>` e valida o arquivo movido antes de remover o staging.
6. Grava um manifesto local com inventário, hashes, resumo e local do backup.

Se o destino já existe sem manifesto ou as cópias divergem, o processo para sem mesclar nem sobrescrever dados. Um staging de falha é mantido para inspeção. Se uma origem Roaming reaparecer após a primeira abertura, o próximo início exige que o app esteja fechado, restaura apenas arquivos ausentes nas pastas de domínio (sem sobrescrever conflitos), arquiva e verifica a origem completa. O perfil Chromium legado é preservado no backup; não mesclamos arquivos de banco do Chromium individualmente.

O Electron aponta `userData` e `sessionData` para `app-data/user-data`; logs, crash dumps e temporários ficam em pastas próprias dentro de `app-data`. O perfil Chromium permanece em `user-data` para preservar `localStorage` e preferências.

## Testes e limites

Os testes de armazenamento, migração, limpeza e restauração usam diretórios sintéticos temporários. Nenhum teste automatizado migra o perfil real. O snapshot transitório de migração é removido depois da validação saudável; backups manuais persistem até exclusão explícita. A aplicação pode manter caches temporários no perfil Electron, todos dentro da raiz local.

O manifesto contém nomes relativos e hashes dos arquivos migrados; não é versionado. Os testes não afirmam que um backup local protege contra falha ou perda do mesmo disco; mantenha cópia em outra unidade para proteção física.
