# Aceitação remota — Render

Endpoint informado pelo proprietário: https://private-cloud-proxy-free.onrender.com

Verificações executadas em 4/11/2026, com validação TLS habilitada e rota de rede autorizada:

| Verificação real | Resultado |
|---|---|
| HTTPS com verificação de certificado/hostname | Passou |
| GET /health | 200, corpo `ok` |
| GET /usage sem credencial | 401 |
| Upgrade WSS /tunnel sem autenticação | 401 |
| Upgrade WSS /tunnel com credencial aleatória inválida | 401 |

Ainda **não executado** no endpoint: autenticação válida, tráfego HTTP/HTTPS pelo túnel, IP de saída, Chromium remoto, retomada após suspensão, confirmação de cota/fatura Free. Os testes locais anteriores não substituem essas verificações.

O segredo válido não está presente no ambiente. Foi declarado um campo seguro `TUNNEL_TOKEN`, restrito ao hostname deste serviço, e `TUNNEL_URL` com o endereço WSS. O proprietário deve preencher o campo seguro nas configurações do ambiente do Codex, fora do chat. Declarar o campo não fornece seu valor nem confirma aplicação/publicação da configuração.

O pacote Windows pode ser gerado com a URL pública pré-configurada, sem incluir o segredo:

```sh
python3 scripts/package-free.py --endpoint wss://private-cloud-proxy-free.onrender.com/tunnel
```

O usuário abre `Start-Private-Proxy.cmd` e informa somente o segredo com entrada oculta. A URL é pública; a senha não é incluída no ZIP nem armazenada em texto puro.
