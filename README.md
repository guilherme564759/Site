# Sistema RSO com Login Discord

## Login Manager padrão
Usuário: Administrador
Senha: admin123

## Variáveis obrigatórias no Railway
DISCORD_CLIENT_ID=seu_client_id
DISCORD_CLIENT_SECRET=seu_client_secret
DISCORD_CALLBACK_URL=https://SEU-LINK.up.railway.app/auth/discord/callback
DISCORD_BOT_TOKEN=token_do_bot
DISCORD_GUILD_ID=id_do_servidor
SESSION_SECRET=qualquer_texto_grande
MANAGER_PASSWORD=senha_do_admin

## Discord Developer Portal
Em OAuth2 > Redirects, adicione exatamente:
https://SEU-LINK.up.railway.app/auth/discord/callback

## Bot no servidor
O bot precisa estar no servidor para sincronizar os membros.
No painel Manager, entre em:
Manager > Discord/Usuários > Sincronizar Discord

## Recursos
- Login do policial via Discord
- Puxa nome, ID e avatar do Discord
- Sincroniza membros do servidor
- No RSO, digita parte do nome e seleciona o membro
- Participantes veem os RSOs em que participaram
- Manager filtra por unidade, status e policial
- Controle de horas por participante
