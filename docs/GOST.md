# Private Cloud Proxy

GOST **3.3.3** fornece proxy HTTP sobre TLS e CONNECT. Autenticação HTTP Basic é obrigatória e viaja dentro de TLS. O serviço escuta em **8443**, permite destinos nas portas 80/443 e limita conexões a 32 no total e 16 por IP. Timeout de conexão: 5 s; resposta HTTP: 10 s; túnel ocioso: 60 s. Logs ficam no journal, no nível error; não habilite debug/trace em produção.

`scripts/policy.py` implementa a extensão HTTP de resolução do GOST. A resposta contém somente IPs numéricos públicos validados; respostas mistas, privadas, multicast, reservadas e formatos IPv6 de transição são rejeitados. O GOST conecta ao IP devolvido, sem resolver novamente o hostname. Falha da extensão bloqueia a resolução. Ela escuta exclusivamente em loopback e não registra consultas. Isso depende de manter a configuração gerada sem outros resolvers, hosts ou chains. Não exponha a extensão na rede.

## Testes locais

Use um binário GOST 3.3.3 verificado e execute:

```sh
GOST_BIN=/caminho/gost python3 -m unittest discover -s tests -v
GOST_BIN=/caminho/gost python3 tests/check_chromium.py
```

A suíte real gera uma CA temporária e testa TLS cliente→proxy e destino HTTPS, CONNECT, autenticação, rejeição de certificado não confiável, concorrência, timeout de túnel e destinos/portas bloqueados. O teste positivo permite um destino loopback exclusivamente em sua configuração de laboratório; a configuração protegida é testada separadamente e o rejeita. Rebinding é simulado nos testes unitários com respostas DNS alternadas e mistas; não foi executado contra um servidor DNS adversarial externo. Os testes não demonstram produção.

O teste opcional de Chromium requer Linux, Chromium, NSS certutil e Playwright no caminho registrado no script. Ele adiciona uma CA de teste ao NSS do usuário e a remove no finally; não execute simultaneamente com outros testes que alterem esse banco. Nenhuma validação TLS é desativada. PowerShell/Windows ainda requer teste no computador cliente.

## Windows

```powershell
./Open-ProxyBrowser.ps1 -ProxyHost proxy.seudominio.com -Port 8443
```

O script localiza Chrome/Chromium e usa perfil separado. O navegador solicita usuário e senha; não coloque credenciais na URL ou no script. O certificado público precisa ser válido para o domínio. Falhas aparecem no navegador. O teste Linux usou autenticação via automação Playwright; o diálogo manual de autenticação no Windows não foi testado.

## Implantação em VM Ubuntu nova

**Nenhum serviço foi hospedado.** Cloud-init e firewall ainda não foram executados em uma VM real com systemd. O ambiente de teste não tem privilégios para validar o firewall do kernel. Não use o ativador em infraestrutura existente: ele cria regras dedicadas e persiste as regras atuais.

1. Confirme a elegibilidade e disponibilidade de uma VM gratuita no provedor. A Oracle foi retirada da estratégia por indisponibilidade de cadastro. Consulte deploy/HOSTING.md para as alternativas; não crie recursos pagos sem autorização. Configure a VM e suas regras somente em recursos novos autorizados. É preciso uma conta autorizada; nenhuma está conectada a este ambiente.
2. Cole `deploy/cloud-init.yaml` no campo de dados de inicialização da VM Ubuntu. Esse arquivo inclui os scripts completos, instala dependências e GOST com SHA-256 fixo para amd64/arm64, mas não habilita o proxy. Regere-o com `python3 deploy/render_cloud_init.py` após mudanças.
3. Aponte um domínio público para a VM. Permita TCP 80 para ACME HTTP-01 e TCP 8443 apenas para o IPv4 público do cliente nas regras de rede do provedor. Não habilite IPv6 para o serviço; o ativador bloqueia a entrada IPv6 em 8443.
4. Por um mecanismo autorizado de execução de comandos no painel do provedor, execute como root `/bin/sh /opt/private-cloud-proxy/deploy/activate.sh DOMINIO EMAIL IP_CLIENTE/32`. Isso requer um canal administrativo web já configurado na VM; cloud-init não concede acesso a uma conta externa. Alternativamente, inclua a chamada em user-data antes de criar a VM, após preencher domínio/email/CIDR; não inclua segredos. Não é necessário SSH no computador cliente.
5. A senha é gerada na VM e guardada em `/etc/private-cloud-proxy/settings.json` (root, 0600). Consulte-a somente pelo canal administrativo autorizado; não a publique em logs. A configuração do GOST fica legível apenas a root e ao grupo dedicado proxy. O ativador não sobrescreve configuração existente.
6. Verifique `cloud-init status --long`, `systemctl status private-cloud-proxy private-cloud-policy`, e `journalctl -u private-cloud-proxy -u private-cloud-policy`. Teste o endpoint com TLS confiável, autenticação e navegação antes de considerá-lo disponível.

A ativação falha sem certificado/chave válidos e remove READY/para o serviço se um comando falhar. Certbot obtém o certificado público e a renovação usa o hook `deploy/renew.sh`; mantenha TCP 80 disponível para HTTP-01 e verifique o timer de renovação. O serviço recupera falhas via systemd. Firewall restringe entrada por IP; o resolver valida os destinos após DNS. Não há regra de saída independente no kernel: a proteção depende do GOST e da extensão.

## Pesquisa e limites

Fontes oficiais consultadas:

- https://gost.run/en/tutorials/protocols/http/
- https://gost.run/en/concepts/bypass/
- https://github.com/go-gost/gost/releases/tag/v3.3.3
- https://github.com/go-gost/x/tree/v0.28.1 (configuração TLS, resolver HTTP, conexão ao IP e limitadores)
- https://chromium.googlesource.com/chromium/src/+/main/net/docs/proxy.md
- https://docs.oracle.com/en-us/iaas/Content/FreeTier/freetier_topic-Always_Free_Resources.htm

Uma VM com socket TCP persistente é compatível com CONNECT; plataformas apenas de funções HTTP não são equivalentes. Disponibilidade, elegibilidade, tráfego e armazenamento gratuitos devem ser conferidos na conta/região antes de provisionar. Não há garantia de custo zero sem essa conferência. Google Cloud e Workers não foram validados como alternativas de implantação desta configuração.

## Atualizar e desinstalar

Atualizações exigem trocar versão e checksums fixos, verificar a nova versão e reexecutar os testes antes de substituir o binário. Para desinstalar, pare/desabilite os dois serviços, remova seus units e os arquivos em `/opt/private-cloud-proxy` e `/etc/private-cloud-proxy`, remova o hook de renovação e as regras dedicadas PRIVATE_PROXY_IN/8443, e salve o firewall. Não apague certificados, usuário ou regras compartilhados por outros serviços. Exclua a VM e seus volumes pelo provedor somente quando autorizado.

## Hospedagem sem Oracle

Veja [deploy/HOSTING.md](../deploy/HOSTING.md) para a comparação atual. A infraestrutura preparada está em [deploy/digitalocean](../deploy/digitalocean/README.md), sem criação de recursos e bloqueada por padrão para custos. Arquivos Oracle foram preservados somente como histórico; não são dependências do proxy.
