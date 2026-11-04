# Oracle: preparação do deploy, sem recursos criados

Verificação documental em 4 de novembro de 2026. Conta, região, domínio, IPv4 e capacidade física ainda não foram confirmados pelo proprietário. Nenhuma consulta autenticada à Oracle foi possível; nenhum custo ou disponibilidade real de conta foi confirmado.

## Provedor e configuração proposta

Prioridade: Oracle Always Free, na **home region da conta**. Candidata: VM.Standard.A1.Flex, Ubuntu ARM64 elegível, 1 OCPU, 2 GB de RAM, boot volume de 50 GB, sem volumes extras, backups automáticos, load balancer ou NAT Gateway. O instalador existente contém o SHA-256 ARM64 da release oficial GOST 3.3.3. E2.1.Micro com Ubuntu amd64 é alternativa se constar como elegível e houver capacidade gratuita disponível; não troque por outra shape automaticamente.

A página oficial consultada informa atualmente 1.500 OCPU-h e 9.000 GB-h/mês para A1 (equivalentes a 2 OCPUs/12 GB nas contas Always Free), até duas E2.1.Micro, 200 GB compartilhados de volumes e 10 TB/mês de saída compartilhada. E2 tem até 50 Mbps de banda de internet. Esses limites são compartilhados com outros recursos da conta e não constituem reserva para este projeto. Verifique os valores exibidos pela sua conta antes de criar recursos. Não use limites antigos publicados por terceiros. A própria página contém diferenças entre o tamanho mínimo e padrão de boot; propomos 50 GB e exigimos a confirmação de elegibilidade no Console.

Não há garantia de disponibilidade: a Oracle documenta erros de falta de capacidade e pode recuperar instâncias gratuitas ociosas. Não gere tráfego artificial para evitar isso. Não faça upgrade de conta nem ative recurso pago para obter capacidade.

Uma VM fornece sockets TCP persistentes e pode executar CONNECT e GOST sem adaptação. A configuração existente usa domínio público e certificado ACME válido; o domínio pode ter custo próprio. O certificado não elimina a necessidade de DNS sob controle do proprietário.

Google Cloud: a documentação lista e2-micro em três regiões dos EUA, 30 GB de disco padrão e 1 GB/mês de saída gratuita de Compute; não é uma alternativa automaticamente sem custo para um proxy público, e IP externo/faturamento precisam ser analisados separadamente. Workers: a API TCP é de saída; conexões TCP de entrada gerais continuam descritas como futuras. Não hospeda este binário GOST nem substitui uma VM para esta implementação.

## Autenticação oficial sem compartilhar credenciais

O caminho mais simples é **Oracle Console → Cloud Shell**, autenticado pelo próprio proprietário no site oficial. A CLI usa o contexto da sessão: não envie senha, chave ou token ao agente, ao repositório ou ao chat. O ambiente deste projeto não tem conector OCI, identidade de nuvem ou configuração OCI. Instalar a CLI não conecta uma conta.

A CLI oficial 3.96.0 foi instalada neste ambiente em `/workspace/.tools/oci-cli/bin/oci`, e o esquema de `compute instance launch` foi verificado localmente. Fora de Cloud Shell, `oci session authenticate` é o fluxo oficial com navegador. **`--no-browser` não resolve uma conta desconectada:** a Oracle exige autenticação prévia por chave API ou token de sessão. Não exporte arquivos de sessão para o chat. Não inicie login em nome de outra pessoa.

Se quiser que o agente execute o deploy diretamente, será necessário um canal autorizado de identidade/execução OCI neste ambiente; ele não está disponível hoje. O pacote pode ser executado pelo proprietário na Cloud Shell sem fornecer credenciais ao agente.

## Menor sequência manual

1. Entre na conta Oracle, confirme a elegibilidade Always Free e a home region. Abra Cloud Shell. Envie o pacote `private-cloud-proxy-cloudshell.tar.gz` pelos controles de upload da Cloud Shell e extraia-o.
2. Execute `sh deploy/oci-preflight.sh TENANCY_OCID COMPARTMENT_OCID HOME_REGION`. OCIDs não são senhas. A verificação é somente leitura. Confira também uso em **todos** os compartments, saldo gratuito de volumes/CPU/RAM/tráfego, imagem elegível e disponibilidade física. Listar shapes não prova estoque nem gratuidade.
3. Crie apenas uma VCN/sub-rede pública dedicada e uma VM **nova** com os parâmetros acima e o selo/indicação Always Free aplicável. Use `deploy/cloud-init.yaml` em user-data. Não altere VCN, rotas, regras ou VMs existentes. Não adicione serviços pagos. Pare se o Console indicar custo não gratuito ou falta de capacidade.
4. Reserve um subdomínio sob seu controle e aponte o registro A ao IP público da VM. Permita TCP 80 para ACME e 8443 somente para a origem autorizada nas regras de ingresso da rede nova. A instalação inicial não inicia o proxy.
5. Use um canal administrativo oficial já configurado para a VM (por exemplo, Run Command quando o agente, a política e a imagem oferecerem suporte) para executar `sh /opt/private-cloud-proxy/deploy/activate.sh DOMINIO EMAIL IPV4_CLIENTE/32` como root. Se esse canal não estiver disponível, é um pré-requisito real; a Cloud Shell não dá acesso automático ao SO da VM. Não é preciso SSH no computador Windows. Consulte a senha somente pelo canal administrativo autorizado, sem gravá-la em saídas compartilhadas.
6. Faça os testes remotos abaixo antes de considerar o serviço publicado. A ativação, o firewall, systemd e a renovação precisam dessa validação na VM; os testes locais não a substituem.

## Automação oficial de criação da VM

Depois de confirmar gratuidade e criar uma rede nova dedicada, a CLI aceita o comando abaixo. Preencha somente IDs de recursos novos/autorizados. O comando **cria uma VM**; não o execute antes da verificação de quota/custo. Ele é documentação, não foi executado pelo agente.

```sh
oci --region "$REGION" compute instance launch \
  --compartment-id "$COMPARTMENT_OCID" \
  --availability-domain "$AVAILABILITY_DOMAIN" \
  --display-name private-cloud-proxy \
  --shape VM.Standard.A1.Flex \
  --shape-config '{"ocpus":1,"memoryInGBs":2}' \
  --image-id "$UBUNTU_ARM_IMAGE_OCID" \
  --subnet-id "$NEW_DEDICATED_SUBNET_OCID" \
  --assign-public-ip true \
  --boot-volume-size-in-gbs 50 \
  --user-data-file deploy/cloud-init.yaml
```

A elegibilidade da imagem, permissões da conta, rede, agente administrativo e cotas não podem ser inferidas sem acesso. Não automatizamos tentativa de shapes pagas nem mudanças em infraestrutura existente.

## IPv4 variável: autenticação e atualização segura

O IP não é a identidade do usuário. A proteção principal é TLS válido + senha aleatória de 256 bits gerada na VM; a ACL por IP é uma barreira adicional. Quando seu IP mudar, use o canal administrativo autenticado no Console para substituir o `/32` nas regras da rede **dedicada** e na chain `PRIVATE_PROXY_IN` da VM; confirme acesso pelo novo IP e remova o antigo. Isso não exige senha nova do proxy nem IP fixo.

Não abra temporariamente `0.0.0.0/0`, não crie endpoint público de atualização de ACL e não use atualização por URL com token. O ativador atual exige CIDR restrito; não o reexecute para atualizar IP, pois ele recusa sobrescrever a configuração. Uma atualização automática futura deve usar API/IAM com escopo mínimo e somente as regras próprias; não foi implementada nesta entrega. Um DDNS para o computador cliente, sozinho, não atualiza regras IP de firewall.

## Aceitação remota ainda não executada

- TLS público, hostname e cadeia válidos; certificado não confiável deve falhar.
- Sem credenciais/credenciais erradas: rejeição; corretas: HTTP e HTTPS via CONNECT.
- Destinos privados, loopback, IPv6 local, metadados e portas não permitidas: bloqueio.
- Concorrência, limite e timeout; encerramento e recuperação após reinício de serviço/VM.
- Chromium real no Windows e IP público observado igual ao da VM.
- Timer e teste de renovação Certbot, logs sem credenciais e firewall persistente após reboot.
- Medição de uso e confirmação de permanência na franquia gratuita.

## Fontes oficiais

- Oracle Always Free: https://docs.oracle.com/en-us/iaas/Content/FreeTier/freetier_topic-Always_Free_Resources.htm
- Sessões OCI: https://docs.oracle.com/en-us/iaas/Content/API/SDKDocs/clitoken.htm
- CLI authenticate: https://docs.oracle.com/en-us/iaas/tools/oci-cli/latest/oci_cli_docs/cmdref/session/authenticate.html
- Google Free Tier: https://cloud.google.com/free/docs/free-cloud-features
- Workers TCP: https://developers.cloudflare.com/workers/runtime-apis/tcp-sockets/
