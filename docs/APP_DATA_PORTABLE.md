# Dados locais portáteis do GACHA V5

## Raiz

Todo dado persistente do aplicativo deve ficar sob `app-data/`, dentro do checkout original. A pasta é ignorada pelo Git e não deve ser incluída em commits, releases ou CI.

```text
app-data/
  user-data/                 # raiz Electron; armazenamento organizado por domínio
    customizer/              # personagens e personalizações individuais
    fabricator/              # modelos, poses, roupas, rosto, cabelo e acessórios
    studios/                 # Studio normal e Video Studio
    video-studios/           # compatibilidade de dados legados até sua migração validada
    Local Storage/           # preferências e rascunhos do renderer
    Cache/                   # cache Chromium local
  logs/                      # logs locais
  crash-dumps/               # relatórios locais de falha
  temp/                      # temporários do processo do app
  backups/                   # origem legada arquivada e cópias verificáveis
  migration-manifest.json    # inventário/hash da migração local
```

## Evolução escalável do layout

A estrutura expandida, o catálogo SQLite, os objetos por conteúdo, as miniaturas, a retenção e a migração gradual estão especificados em [APP_DATA_ESCALAVEL.md](./APP_DATA_ESCALAVEL.md). O app agora cria `database/catalog.sqlite` e diretórios vazios de destino no próximo boot. **Isso não importa, move nem reescreve os dados atuais em `user-data`**; a organização vigente permanece a fonte canônica até migrações por domínio serem validadas e reversíveis.

As áreas continuam com ownership separado: Fabricador publica bibliotecas e vínculos; Customizador guarda personagens e overrides; Studio normal e Video Studio salvam seus próprios projetos. A troca da raiz não altera os caminhos relativos nem os contratos entre essas áreas.

## Migração do perfil Electron legado

`npm run dev` e `npm run preview` executam `scripts/prepare-app-data.cjs` antes de abrir o Electron. O Electron de desenvolvimento aponta `userData` e `sessionData` para `app-data/user-data`; a versão empacotada usa `app-data` ao lado do executável. Logs, crash dumps, temporários do processo e o caminho `appData` também são direcionados para a raiz local. Se o perfil `%APPDATA%/gacha-nymi-work-app` existir e `app-data/user-data` ainda não existir, o migrador:

1. Confirma que não há processo principal do GACHA V5 aberto.
2. Inventaria arquivos e diretórios, rejeitando links simbólicos e tipos especiais.
3. Copia o perfil inteiro para um staging dentro de `app-data` e compara SHA-256, tamanhos e estrutura.
4. Copia para `app-data/user-data` e compara novamente a publicação por hash.
5. Faz uma cópia de verificação do perfil legado, move o original para `app-data/backups/roaming-profile-<data>` e valida o arquivo movido antes de remover o staging.
6. Grava um manifesto local com inventário, hashes, resumo e local do backup.

Se o destino já existe sem manifesto ou as cópias divergem, o processo para sem mesclar nem sobrescrever dados. Um staging de falha é mantido para inspeção. Se uma origem Roaming reaparecer após a primeira abertura, o próximo início exige que o app esteja fechado, restaura apenas arquivos ausentes nas pastas de domínio (sem sobrescrever conflitos), arquiva e verifica a origem completa. O perfil Chromium legado é preservado no backup; não mesclamos arquivos de banco do Chromium individualmente.

O Electron aponta `userData` e `sessionData` para `app-data/user-data`; logs, crash dumps e temporários do processo ficam em pastas próprias dentro de `app-data`. O diretório `user-data` contém subpastas das áreas do app e o perfil Chromium necessário para preservar `localStorage`.

## Testes e limites

Os testes de migração usam apenas fixtures sintéticas sob `out/dev-ai`. A migração do perfil real é uma ação local, executada por `npm run dev`/`npm run preview` depois que o aplicativo estiver fechado. A cópia antiga arquivada permanece em `app-data/backups` como rollback. A aplicação pode manter alguns caches temporários no próprio perfil Electron; os arquivos de cache também ficam dentro da raiz local.

O manifesto contém nomes relativos e hashes dos arquivos migrados; não é versionado. Os testes não afirmam que um backup local protege contra falha ou perda do mesmo disco.
