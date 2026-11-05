# Diagnóstico do cliente Windows

Use o ZIP de [downloads/windows](../downloads/windows/README.md), extraia todos os arquivos numa pasta gravável e execute `Start-Private-Proxy.cmd`. Não execute dentro da visualização do ZIP. O pacote inclui `node_modules/ws`, `node_modules/ipaddr.js` e `bridge/bootstrap.mjs`; não copie somente o arquivo CMD ou a pasta bridge.

O erro `ERR_MODULE_NOT_FOUND: Cannot find package 'ws'` significa que a pasta executada não contém essa dependência. Não é uma rejeição do segredo pela Render: a importação falhou antes de iniciar o cliente. Ao usar um clone completo do GitHub, o launcher atualizado instala os pacotes ausentes com o npm do Node portátil, usando `npm ci --omit=dev --ignore-scripts --no-audit --no-fund`. O lockfile fixa versões e integridade. A instalação não exige administrador e mantém as configurações de rede existentes. Se os pacotes já estiverem presentes nas versões previstas, esse passo não acessa a rede.

Falhas depois de carregar os módulos mostram um código específico, sem imprimir valores externos de erro, o segredo ou conteúdo do arquivo de consumo:

| Código | Significado / ação |
|---|---|
| `DEPENDENCIES_UNAVAILABLE` | A instalação não terminou ou a pasta está incompleta. Use o ZIP completo atualizado em uma pasta gravável. Preserve o erro do npm com cuidado para não divulgar credenciais de sua rede. |
| `SECRET_INVALID` | Entrada tem menos de 32 caracteres. Copie o valor completo de `TUNNEL_TOKEN` em Render → serviço → Environment. Não envie o valor ao chat. Esse controle não autentica no servidor; um segredo incorreto com tamanho suficiente só será recusado ao abrir o túnel. |
| `USAGE_INVALID` | O arquivo `%LOCALAPPDATA%\PrivateCloudProxy\bridge-usage.json` não pôde ser lido ou validado. Preserve-o; não apague nem zere o consumo para contornar a cota. Informe o código antes de alterar o arquivo. |
| `LOCAL_PORT_BUSY` | Outro processo ocupa `127.0.0.1:17831`. Feche a janela anterior do cliente e tente novamente. Não finalize processos desconhecidos. |
| `LOCAL_LISTEN_FAILED` | O sistema não permitiu abrir a porta local. Informe o código, sem desabilitar proteções do Windows. |
| `CLIENT_LOCK_UNAVAILABLE` | Pode haver outro cliente ativo ou arquivo de controle inacessível. Feche o cliente anterior. Não apague o lock de um processo que ainda esteja ativo. |
| `INTERACTIVE_REQUIRED` | Execute o arquivo CMD em terminal interativo para fornecer o segredo com entrada oculta. |
| `BROWSER_NOT_FOUND` / `BROWSER_LAUNCH_FAILED` | Chrome/Chromium não foi encontrado nos locais usuais ou não abriu. |
| `DATA_DIRECTORY_UNAVAILABLE` | A pasta de dados do usuário está inacessível. |
| `ENDPOINT_INVALID` | A configuração precisa de URL `wss://HOST/tunnel`, sem credenciais na URL. |

Os testes de inicialização reproduzem segredo incompleto, ledger inválido, porta ocupada e falta de terminal interativo em subprocessos reais. O teste do bootstrap instala os pacotes reais do cache npm, com acesso externo desativado, comprova que scripts de ciclo de instalação não são executados e verifica que um pacote pronto não reinstala dependências. O ZIP extraído também passa pelo bootstrap e importa o cliente fora do repositório. Esses testes rodam em Linux; não substituem a execução nativa do CMD, PowerShell e navegador no Windows.
