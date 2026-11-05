# Private Cloud Proxy — modo gratuito WSS

`Chromium → HTTP/CONNECT em 127.0.0.1 → WSS autenticado → Render Free → site público`.

HTTPS do site permanece cifrado entre navegador e destino. O Render termina apenas o TLS externo do WSS. O projeto GOST anterior e seus testes Python foram preservados; não são necessários para executar este novo modo.

## Implantar sem domínio pago

1. No Render, vincule o GitHub e crie um **Blueprint** do repositório `Lopes-V/proxy`, branch `main`, usando `render.yaml`. Há somente um Web Service **Free**, sem banco, disco ou add-on pago.
2. Confirme **US$ 0**, sem meio de pagamento para cobrança automática. Se o painel exigir cartão ou plano pago, pare. Não use este procedimento para alterar serviços existentes.
3. Após o deploy, copie a URL `https://NOME.onrender.com` e consulte `TUNNEL_TOKEN` no painel **Environment**. Nunca envie esse segredo ao chat nem ao GitHub.

Para o serviço já existente, siga [o guia das opções Build Command e Auto-Deploy](docs/RENDER-SETTINGS.md).

[Iniciar Blueprint no Render](https://render.com/deploy?repo=https://github.com/Lopes-V/proxy)

## Windows x64: abrir um arquivo

Feche janelas antigas do perfil do proxy, extraia o pacote Windows atualizado em uma pasta gravável e abra **`Start-Private-Proxy.cmd`**. Na primeira execução ele baixa Node portátil oficial e verifica o SHA-256 fixo. Se a pasta vier de um clone do GitHub e estiver sem dependências, o launcher instala somente os pacotes de produção pelo `package-lock.json`, sem scripts de instalação. O ZIP pronto já inclui esses pacotes. Informe a URL Render e o segredo com entrada oculta; o segredo não é salvo e será pedido novamente a cada execução. Chrome/Chromium abre em perfil separado. Mantenha a janela do cliente aberta.

Não exige administrador, SSH, VPN, Node instalado ou domínio próprio. Nenhuma política de execução ou validação TLS é desativada. O launcher Windows foi preparado, mas precisa de execução real no Windows; os testes de navegador foram realizados no Linux.

### Pacote Windows atualizado
O cliente distribuído no ZIP antigo em `downloads/windows` pode estar defasado. O workflow de CI agora gera e testa automaticamente `PrivateCloudProxy-Windows.zip` para cada alteração e publica o arquivo na seção **Artifacts** do [GitHub Actions](https://github.com/Lopes-V/proxy/actions/workflows/ci.yml). Escolha a execução `main` concluída com sucesso, baixe o artefato `PrivateCloudProxy-Windows`, extraia o ZIP externo e depois o `PrivateCloudProxy-Windows.zip` interno. Feche o cliente antigo antes de iniciar `Start-Private-Proxy.cmd`.

### Conexões persistentes
A janela de ociosidade do relay passou a dois minutos, e a duração máxima de uma sessão passou a 30 minutos para reduzir interrupções em sites interativos, como mensageiros. As quotas de tráfego e sessões permanecem inalteradas. Esta é uma correção da infraestrutura, não uma validação de login ou disponibilidade do WhatsApp Web. O proxy HTTP/CONNECT transporta TCP; chamadas com requisitos de UDP/WebRTC não estão cobertas.

## Limites e custo

- Render Free: suspensão após 15 min sem tráfego, 750 horas de instância/mês compartilhadas; Hobby inclui **5 GB/mês** de banda compartilhada. Sem pagamento cadastrado, excesso resulta em suspensão; com pagamento pode haver cobrança. Não prometemos R$ 0 numa conta com faturamento automático ou outros recursos pagos.
- Render pode suspender serviços Free com saída incomum, mesmo abaixo da franquia. Não há garantia de operação contínua. Não há pings artificiais nem contorno de cotas.
- Cliente: limite persistente **128 MiB por mês UTC**, com reserva de 8 KiB por tentativa e margem por bloco. Cliente admite até 16 túneis e 32 pedidos em fila por até 60 s. Servidor: 16 sessões simultâneas, 16 MiB/sessão, 128 MiB/processo, 2.000 sessões/dia, 120 s ocioso, 30 min por sessão. Estado do servidor reinicia no redeploy; ele não mede a fatura global do Render.
- Reconexão de abertura ocorre somente durante pedido ativo, por até 90 s. Túneis interrompidos são fechados, sem repetir dados nem usar acesso direto. Após suspensão, pode ser necessário recarregar a página.

## Testes

```sh
npm ci --ignore-scripts
npm test
npm run test:browser
npm run test:browser:resources
GOST_BIN=/workspace/.tools/private-cloud-proxy/gost python3 -m unittest discover -s tests -v
```

O teste Chromium requer as ferramentas Linux descritas em [bridge/README.md](bridge/README.md). Usa CA temporária confiada explicitamente, removida ao terminar; não ignora erros TLS.

A revisão atual da fila, das faixas IANA e do CI está em [auditoria com evidências Steam](docs/STEAM-AUDIT.md).

Veja [arquitetura, segurança, fontes e aceitação remota](bridge/README.md). O modo GOST anterior está documentado em [docs/GOST.md](docs/GOST.md). Endpoint informado: https://private-cloud-proxy-free.onrender.com. O túnel autenticado passou em HTTP, HTTPS/CONNECT e Chromium real no Linux, com saída observada 74.220.48.29, bloqueios de destinos e falha sem acesso direto. O proprietário confirmou Free sem método de pagamento; a retomada após 17 minutos sem tráfego passou em aproximadamente 12,7 s, com reinício do processo observado. Veja [resultado remoto](docs/REMOTE-VALIDATION.md).

Se aparecer `ERR_MODULE_NOT_FOUND` para `ws`, atualize o projeto/ZIP: o launcher atual prepara as dependências antes de carregar o cliente. Falhas posteriores mostram um código entre colchetes; consulte [o diagnóstico de inicialização](docs/WINDOWS-STARTUP.md).

A inicialização verifica disponibilidade, TLS, autenticação e cota na Render antes de abrir o navegador. Sessões canceladas são liberadas por HTTPS autenticado, sem aguardar o timeout WSS. Veja [diagnóstico de desempenho e limites](docs/PERFORMANCE.md).
