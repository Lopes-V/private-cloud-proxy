# Private Cloud Proxy — modo gratuito WSS

`Chromium → HTTP/CONNECT em 127.0.0.1 → WSS autenticado → Render Free → site público`.

HTTPS do site permanece cifrado entre navegador e destino. O Render termina apenas o TLS externo do WSS. O projeto GOST anterior e seus 24 testes Python foram preservados; não são necessários para executar este novo modo.

## Implantar sem domínio pago

1. No Render, vincule o GitHub e crie um **Blueprint** do repositório `Lopes-V/proxy`, branch `main`, usando `render.yaml`. Há somente um Web Service **Free**, sem banco, disco ou add-on pago.
2. Confirme **US$ 0**, sem meio de pagamento para cobrança automática. Se o painel exigir cartão ou plano pago, pare. Não use este procedimento para alterar serviços existentes.
3. Após o deploy, copie a URL `https://NOME.onrender.com` e consulte `TUNNEL_TOKEN` no painel **Environment**. Nunca envie esse segredo ao chat nem ao GitHub.

[Iniciar Blueprint no Render](https://render.com/deploy?repo=https://github.com/Lopes-V/proxy)

## Windows x64: abrir um arquivo

Extraia o pacote Windows em uma pasta gravável e abra **`Start-Private-Proxy.cmd`**. Na primeira execução ele baixa Node portátil oficial e verifica o SHA-256 fixo. Informe a URL Render e o segredo com entrada oculta; o segredo não é salvo e será pedido novamente a cada execução. Chrome/Chromium abre em perfil separado. Mantenha a janela do cliente aberta.

Não exige administrador, SSH, VPN, Node instalado ou domínio próprio. Nenhuma política de execução ou validação TLS é desativada. O launcher Windows foi preparado, mas precisa de execução real no Windows; os testes de navegador foram realizados no Linux.

## Limites e custo

- Render Free: suspensão após 15 min sem tráfego, 750 horas de instância/mês compartilhadas; Hobby inclui **5 GB/mês** de banda compartilhada. Sem pagamento cadastrado, excesso resulta em suspensão; com pagamento pode haver cobrança. Não prometemos R$ 0 numa conta com faturamento automático ou outros recursos pagos.
- Render pode suspender serviços Free com saída incomum, mesmo abaixo da franquia. Não há garantia de operação contínua. Não há pings artificiais nem contorno de cotas.
- Cliente: limite persistente **128 MiB por mês UTC**, com reserva de 8 KiB por tentativa e margem por bloco. Servidor: 8 sessões simultâneas, 8 MiB/sessão, 64 MiB/processo, 2.000 sessões/dia, 45 s ocioso, 5 min por sessão. Estado do servidor reinicia no redeploy; ele não mede a fatura global do Render.
- Reconexão de abertura ocorre somente durante pedido ativo, por até 90 s. Túneis interrompidos são fechados, sem repetir dados nem usar acesso direto. Após suspensão, pode ser necessário recarregar a página.

## Testes

```sh
npm ci --ignore-scripts
npm test
npm run test:browser
GOST_BIN=/workspace/.tools/private-cloud-proxy/gost python3 -m unittest discover -s tests -v
```

O teste Chromium requer as ferramentas Linux descritas em [bridge/README.md](bridge/README.md). Usa CA temporária confiada explicitamente, removida ao terminar; não ignora erros TLS.

Veja [arquitetura, segurança, fontes e aceitação remota](bridge/README.md). O modo GOST anterior está documentado em [docs/GOST.md](docs/GOST.md). Não houve implantação remota nem confirmação de fatura nesta entrega; só um endpoint real pode comprovar saída da nuvem e cold start do Render.
