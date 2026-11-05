# Private Cloud Proxy — modo gratuito WSS

`Chromium → HTTP/CONNECT em 127.0.0.1 → WSS autenticado → Render Free → site público`.

HTTPS do site permanece cifrado entre navegador e destino. O Render termina apenas o TLS externo do WSS. O projeto GOST anterior e seus testes Python foram preservados; não são necessários para executar este novo modo.

> **Aviso educacional e de responsabilidade:** este é um projeto educacional, destinado a estudo de redes, proxies, WebSocket, HTTPS e implantação em nuvem. Use-o somente em redes, contas, dispositivos e destinos para os quais você tenha autorização expressa. Não o use para burlar políticas de rede, controles de acesso, termos de serviços, monitoramento, limites de provedores ou a lei. Você é integralmente responsável pelo seu uso e pelas consequências dele; o autor e os colaboradores não se responsabilizam por danos, perdas, bloqueios de conta, cobrança de terceiros ou uso indevido. Este aviso não substitui leis aplicáveis nem os termos do GitHub, Render e dos sites acessados.

## Passo a passo: Render, instalação e primeiro uso no Windows

### 1. Criar o serviço gratuito no Render

1. Entre em [render.com](https://render.com/) e conecte sua conta GitHub.
2. Abra este repositório no GitHub e confirme que a branch usada é `main`.
3. No Render, escolha criar um **Blueprint** a partir do repositório `Lopes-V/proxy_fake`; alternativamente, use o botão abaixo.
4. Revise a configuração importada de `render.yaml`: ela cria apenas um **Web Service** Node no plano **Free**, sem banco de dados, disco persistente ou add-on pago.
5. Antes de confirmar, verifique que o plano mostra **Free** e custo **US$ 0**. Se o painel pedir cartão, plano pago ou criação de recurso adicional, cancele e revise a conta — este guia não orienta contratação ou mudança de plano.
6. Aguarde o build e o deploy terminarem com sucesso. Em seguida, copie a URL do serviço no formato `https://NOME.onrender.com`.
7. No serviço criado, abra **Environment**, localize `TUNNEL_TOKEN` (gerado pelo Blueprint) e copie-o para uso local. Trate-o como senha: não o publique, não o envie em chat e não o grave no repositório.

[Criar Blueprint no Render](https://render.com/deploy?repo=https://github.com/Lopes-V/proxy_fake)

Se você já tiver criado o serviço e precisar conferir os comandos de build e auto-deploy, siga [o guia de configurações da Render](docs/RENDER-SETTINGS.md). Não gere outro token sem necessidade: os clientes em execução precisarão do novo valor.

### 2. Baixar e preparar o cliente Windows x64

1. No GitHub, abra **Code → Download ZIP** para baixar o código deste repositório, ou baixe o artefato Windows mais recente em uma execução bem-sucedida do [GitHub Actions](https://github.com/Lopes-V/proxy_fake/actions/workflows/ci.yml).
2. Extraia **todo** o conteúdo para uma pasta gravável do seu usuário, por exemplo `Documentos\PrivateCloudProxy`. Não execute o arquivo ainda dentro da visualização do ZIP.
3. Confirme que a pasta extraída contém `Start-Private-Proxy.cmd`, `package-lock.json` e a pasta `bridge`.
4. Instale Google Chrome ou Chromium normalmente, caso ainda não exista no computador. Não é necessário instalar Node.js, configurar VPN, abrir SSH nem executar como administrador.

Na primeira abertura, o launcher baixa o Node portátil oficial, valida seu SHA-256 e, se o pacote não trouxer dependências, instala somente as dependências de produção previstas no `package-lock.json`. Ele não desativa TLS, políticas de execução ou proteções do Windows.

### 3. Iniciar e conectar

1. Feche qualquer janela anterior iniciada por este projeto.
2. Dê duplo clique em **`Start-Private-Proxy.cmd`**.
3. Quando o programa pedir a URL, cole somente a URL HTTPS copiada do Render, por exemplo `https://NOME.onrender.com`. O cliente converte internamente para o endpoint seguro `wss://NOME.onrender.com/tunnel` e salva apenas essa URL localmente.
4. Quando pedir o segredo, cole o valor de `TUNNEL_TOKEN`. A entrada fica oculta e o token não é salvo; ele será pedido de novo na próxima abertura.
5. Aguarde a validação de disponibilidade, certificado, autenticação e cota. Se tudo estiver correto, o Chrome/Chromium abrirá em um perfil separado já configurado para o proxy local.
6. Navegue apenas para destinos públicos e autorizados. Mantenha a janela do terminal aberta enquanto usar o navegador; fechá-la encerra o cliente e a navegação do perfil deve falhar, sem acesso direto alternativo.

### 4. Conferir e encerrar com segurança

1. Abra uma página HTTP e uma página HTTPS autorizadas no navegador iniciado pelo launcher. Em um primeiro acesso após inatividade, o Render Free pode demorar para reativar.
2. Se quiser confirmar a saída, consulte um serviço de verificação de IP de sua confiança e compare o resultado com o esperado para o serviço; isso não prova acesso permitido a nenhum site específico.
3. Ao terminar, feche o navegador e a janela do launcher. Não apague `bridge-usage.json` em `%LOCALAPPDATA%\PrivateCloudProxy`: ele guarda a cota mensal local.
4. Se ocorrer uma falha, compartilhe apenas o código entre colchetes, como `RELAY_AUTH_FAILED` ou `LOCAL_PORT_BUSY`; nunca compartilhe `TUNNEL_TOKEN`, cookies, URLs privadas ou credenciais.

Consulte [o diagnóstico de inicialização](docs/WINDOWS-STARTUP.md) para a explicação de cada código de falha.

### Pacote Windows atualizado
O cliente distribuído no ZIP antigo em `downloads/windows` pode estar defasado. O workflow de CI agora gera e testa automaticamente `PrivateCloudProxy-Windows.zip` para cada alteração e publica o arquivo na seção **Artifacts** do [GitHub Actions](https://github.com/Lopes-V/proxy_fake/actions/workflows/ci.yml). Escolha a execução `main` concluída com sucesso, baixe o artefato `PrivateCloudProxy-Windows`, extraia o ZIP externo e depois o `PrivateCloudProxy-Windows.zip` interno. Feche o cliente antigo antes de iniciar `Start-Private-Proxy.cmd`.

### Diagnóstico do limite local no Windows
Se `Start-Private-Proxy.cmd` mostrar `CLIENT_TRAFFIC_LIMIT`, o arquivo em `%LOCALAPPDATA%\\PrivateCloudProxy\\bridge-usage.json` atingiu o orçamento **local**. O launcher agora exibe o consumo e verifica a cota **antes** de pedir `TUNNEL_TOKEN`. O limite passou de 128 MiB para 512 MiB, preservando o valor acumulado no arquivo, inclusive reservas antecipadas do ledger. Esse teto é local e **não** altera os 128 MiB por processo na Render, nem controla o faturamento da conta ou de outros serviços.

Não exclua nem edite `bridge-usage.json` para reiniciar a cota. Ela é mensal e troca de mês ao reiniciar o cliente em um novo mês UTC. Uma tentativa com segredo de menos de 32 caracteres produz `SECRET_INVALID`; um segredo com comprimento válido só será de fato validado ao consultar a Render.

### Conexões persistentes
A janela de ociosidade do relay passou a dois minutos, e a duração máxima de uma sessão passou a 30 minutos para reduzir interrupções em sites interativos, como mensageiros. As quotas de tráfego e sessões permanecem inalteradas. Esta é uma correção da infraestrutura, não uma validação de login ou disponibilidade do WhatsApp Web. O proxy HTTP/CONNECT transporta TCP; chamadas com requisitos de UDP/WebRTC não estão cobertas.

## Limites e custo

- Render Free: suspensão após 15 min sem tráfego, 750 horas de instância/mês compartilhadas; Hobby inclui **5 GB/mês** de banda compartilhada. Sem pagamento cadastrado, excesso resulta em suspensão; com pagamento pode haver cobrança. Não prometemos R$ 0 numa conta com faturamento automático ou outros recursos pagos.
- Render pode suspender serviços Free com saída incomum, mesmo abaixo da franquia. Não há garantia de operação contínua. Não há pings artificiais nem contorno de cotas.
- Cliente: limite persistente **512 MiB por mês UTC**, com reserva de 8 KiB por tentativa e margem por bloco. Cliente admite até 24 túneis e 32 pedidos em fila por até 20 s; o relay mantém 32 vagas para absorver sessões em encerramento. Servidor: 32 sessões simultâneas, 16 MiB/sessão, 128 MiB/processo, 2.000 sessões/dia, 120 s ocioso, 30 min por sessão. Estado do servidor reinicia no redeploy; ele não mede a fatura global do Render.
- Reconexão de abertura ocorre somente durante pedido ativo, por até 90 s. Túneis interrompidos são fechados, sem repetir dados nem usar acesso direto. Após suspensão, pode ser necessário recarregar a página.

## Liberação de túneis ociosos sob saturação

O cliente mantém conexões HTTPS/WebSocket sem encerrar por inatividade quando há vagas. **Somente quando todas as 24 vagas locais estão ocupadas e chega uma nova conexão**, ele pode fechar **um** túnel que não trafegou nenhum byte nos últimos **90 segundos** (priorizando o mais antigo). Isso evita manter vagas presas por HTTP/2 keep-alives ociosos, sem adicionar pings artificiais nem mexer nas cotas. Atividade de tráfego em qualquer direção adia a elegibilidade à liberação.

**Limite importante:** o proxy não consegue diferenciar um WebSocket de aplicativo ocioso de uma conexão HTTP/2 sem tráfego porque ambos estão dentro do TLS do destino. Logo, sob saturação, um WebSocket legítimo (como uma sessão de mensageria) que permaneça mais de 90 s sem bytes **também pode ser encerrado** e precisar reconectar. Não há encerramento antecipado quando o cliente não está saturado.

O diagnóstico registra somente `IDLE_EVICTED`, um identificador aleatório e duração da ociosidade, nunca host, URL ou credenciais. A configuração `idleEvictMs: 0` desativa essa política no uso programático.

## Abertura rápida de túneis para uso pessoal
O relay agora anuncia `fastOpen: true` na consulta autenticada `/usage`. Depois dessa verificação de prontidão, o cliente inclui o destino criptografado com **AES-256-GCM** no cabeçalho da negociação WSS; assim, o servidor pode iniciar política, DNS e conexão TCP **sem aguardar a primeira mensagem após o WebSocket abrir**, eliminando uma ida e volta de rede na abertura de cada túnel. Um nonce aleatório diferente é usado em cada tentativa, com chave derivada do token via HKDF. O domínio de destino **não aparece em texto claro** no cabeçalho de upgrade.

O servidor preserva a negociação antiga (a primeira mensagem JSON) para clientes desatualizados. Clientes que se conectam a um servidor antigo não recebem o indicador `fastOpen` e usam automaticamente o caminho antigo. Essa melhora **não multiplexa** conexões: cada CONNECT ainda usa seu próprio WebSocket, e o cold start da Render permanece.

O modo de abertura rápida é ativado depois do teste de prontidão existente no `Start-Private-Proxy.cmd`. Alterar o token invalida a criptografia e mantém falha de autenticação. **Não** foram alteradas cotas, origem permitida, validação de TLS ou bloqueios SSRF.

## Latência de conexões
O cliente reutiliza sockets HTTPS de controle, libera a vaga local quando o WebSocket fecha e usa retry curto com jitter somente para `SESSION_LIMIT`. O relay aplica `TCP_NODELAY` e cache DNS público validado de 20 s/128 hosts; o timer de ociosidade não é recriado a cada chunk. A arquitetura continua **um WSS por conexão TCP**, portanto não elimina o RTT Brasil–Oregon nem garante que o WhatsApp, Steam ou qualquer outro destino responda sem restrições.

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
