# Sistema RSO corrigido para Render

## Login padrão
Usuário: `Administrador`
Senha: `admin123`

## Render
Build Command:
```bash
npm install
```

Start Command:
```bash
npm start
```

## Correção feita
O sistema agora cria automaticamente a pasta `data` antes de abrir o banco SQLite, corrigindo o erro:

`SQLITE_CANTOPEN: unable to open database file`

Também usa `0.0.0.0` no `app.listen`, melhor para hospedagem.
