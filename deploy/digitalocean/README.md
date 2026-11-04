# DigitalOcean — preparado, sem implantação autorizada

**Este caminho é pago, a partir de US$ 4/mês mais extras. Não houve autorização de custo e nenhum recurso foi criado.** Confira [a comparação](../HOSTING.md) antes de escolher.

## O que está automatizado

Terraform cria somente uma VM Ubuntu nova e um firewall novo, sem alterar recursos existentes. Reutiliza o cloud-init do projeto. Um timer verifica o IPv4 público pelo metadata oficial da **própria VM** e aguarda o domínio resolver somente para esse IP. Depois chama o ativador existente uma única vez: Certbot, senha aleatória, configuração GOST, ACL, systemd e verificação TLS. O metadata é consultado pelo processo administrativo root; não fica acessível a clientes do proxy.

Não há senha/token no user-data. Antes da ativação não existe listener de proxy. Se DNS estiver incorreto, o timer aguarda; se uma ativação falhar, a marca `ACTIVATION_ATTEMPTED` impede reexecução cega. Diagnostique pelo console web antes de tentar novamente; não remova a marca sem investigar os arquivos parciais.

## Pré-requisitos ainda ausentes

1. Autorização explícita para o custo real (base, impostos e eventual excesso de tráfego). O default `allow_paid_deployment=false` bloqueia a criação.
2. Conta DigitalOcean autorizada com API token de escopo adequado, injetado como `DIGITALOCEAN_TOKEN` por configuração segura, nunca em chat, tfvars ou Git. O ambiente atual não tem essa identidade/binding. Não criamos conta nem habilitamos billing.
3. Domínio/subdomínio sob seu controle, email ACME e IPv4 público atual do cliente. Não compramos domínio. Mudanças de IP exigem atualizar tanto o firewall cloud quanto a chain `PRIVATE_PROXY_IN` por administração autenticada; TLS/senha continuam sendo a identidade principal.

## Quando os pré-requisitos estiverem satisfeitos

Na raiz do projeto, use a CLI Terraform oficial e o ambiente autenticado:

```sh
python3 deploy/digitalocean/preflight.py --region nyc3
terraform -chdir=deploy/digitalocean init -lockfile=readonly
terraform -chdir=deploy/digitalocean validate
```

O preflight faz somente GET e recusa substituições de size/preço. Ele não garante capacidade no instante de criar, nem autoriza cobrança. Não foi executado contra uma conta real porque falta token.

Copie `terraform.tfvars.example` para `terraform.tfvars` e preencha domínio/email/IP. Somente após autorização de custos, defina `allow_paid_deployment=true` e revise um `terraform plan`. Não aplique um plano que substitua/altere infraestrutura existente ou contenha recursos diferentes da VM/firewall novos descritos. Não há GitHub Action automática que possa gerar custos inadvertidamente.

O operador autorizado pode então executar `terraform apply`. Esse comando **cria recursos pagos** e não foi executado nesta sessão. Use o IPv4 de saída do Terraform para criar o registro DNS A. Remova AAAA conflitante; o timer aguarda DNS antes de solicitar o certificado. O domínio não é gerenciado pelo Terraform, para preservar zonas existentes e permitir qualquer provedor de DNS.

O console web da DigitalOcean evita instalar SSH no Windows; ele usa o agente SSH na VM. O firewall restringe 22 ao IP do cliente: caso o console use outra origem, não abra 22 globalmente; use a Recovery Console ou adicione somente uma origem administrativa verificada. Leia a documentação oficial. Nunca envie a senha gerada pela VM a logs públicos.

## Diagnóstico e aceitação

No canal administrativo autorizado da VM:

```sh
cloud-init status --long
systemctl status private-cloud-activate.timer private-cloud-activate.service
journalctl -u private-cloud-activate.service
systemctl status private-cloud-proxy private-cloud-policy
journalctl -u private-cloud-proxy -u private-cloud-policy
```

A senha está no arquivo root-only `/etc/private-cloud-proxy/settings.json`. Verifique DNS/certificado, firewall real, timer de renovação, recuperação após reboot, HTTP/HTTPS autenticados, destinos e portas proibidos, concorrência, timeout e IP de saída. Nada disso foi testado remotamente. O handshake local do ativador não substitui essa aceitação.

Windows após validação remota:

```powershell
.\Open-ProxyBrowser.ps1 -ProxyHost proxy.seudominio.com -Port 8443
```

## Verificações que podem rodar sem conta

```sh
terraform -chdir=deploy/digitalocean validate
terraform -chdir=deploy/digitalocean test
GOST_BIN=/workspace/.tools/private-cloud-proxy/gost python3 -m unittest discover -s tests -v
GOST_BIN=/workspace/.tools/private-cloud-proxy/gost python3 tests/check_chromium.py
```

Os testes Terraform usam provider **mock**, sem chamadas à nuvem e sem custos. Eles verificam bloqueio de criação sem autorização, user-data/recursos preparados e recusa de CIDR aberto. Os testes Python novos simulam preço/estoque e DNS. A suíte GOST existente e o Chromium executam integração local real; não provam operação nesta VM.

Para encerrar cobrança, destruir a VM é diferente de desligar. Não execute `terraform destroy` sem autorização e sem revisar que apenas os recursos próprios serão removidos. Não crie snapshots/backups pagos ou IP reservado. O domínio e o estado Terraform exigem tratamento separado.
