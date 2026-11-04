# Firewall

O ativador cria PRIVATE_PROXY_IN para TCP 8443, aceita somente o CIDR IPv4 informado e bloqueia os demais clientes. IPv6 de entrada em 8443 é bloqueado. As regras são persistidas por netfilter-persistent. Aplicar somente em VM nova dedicada; nunca executar novamente ou sobre infraestrutura existente sem revisar as regras. A proteção de saída é feita pelo resolver validado do GOST, não por regras de saída no kernel. O firewall real ainda requer validação na VM.
