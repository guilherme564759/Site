# Sistema RSO - Polícia Militar

Sistema completo de RSO com:

- Site inicial com botão `[+ Iniciar RSO]`
- Formulário de relatório operacional
- Backend Node.js + Express
- Banco SQLite
- Painel Manager
- Visualização completa do relatório antes de aprovar
- Aprovação/recusa
- Permissão para criar outros usuários manager
- Pronto para GitHub e Render

## Login padrão do Manager

Usuário:

```txt
Administrador
```

Senha:

```txt
admin123
```

Você pode alterar a senha no Render criando a variável:

```txt
MANAGER_PASSWORD=sua_senha
```

## Como rodar no PC

```bash
npm install
npm start
```

Depois abra:

```txt
http://localhost:3000
```

## Como subir no Render

1. Crie um repositório no GitHub
2. Envie todos os arquivos deste projeto
3. Entre no Render
4. New Web Service
5. Conecte o repositório
6. Configure:

Build Command:

```bash
npm install
```

Start Command:

```bash
npm start
```

7. Clique em Deploy

## Aviso

No plano grátis do Render, o site pode dormir depois de um tempo parado.
Quando abrir novamente, pode demorar alguns segundos para carregar.
