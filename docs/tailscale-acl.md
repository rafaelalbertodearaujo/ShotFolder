# Regra de acesso (ACL) no Tailscale

Por padrão, todo aparelho do seu tailnet (a sua rede Tailscale) alcança todos os outros, em qualquer porta. A ACL abaixo deixa o celular chegar **só** na porta do ShotFolder no PC. Se um dia outro aparelho seu for comprometido, ele não chega no ShotFolder. E se o celular for roubado, ele não chega em mais nada do PC.

É a camada A3 do modelo de ameaças. O ShotFolder já exige a assinatura do aparelho; a ACL é uma barreira a mais, antes disso.

## Onde colar

1. Abra https://login.tailscale.com/admin/acls (Access controls → editor de arquivo).
2. **Antes de mudar, copie o conteúdo atual para um arquivo.** Assim dá para voltar atrás.
3. Troque `100.x.y.z` pelo IP do PC e `100.a.b.c` pelo do celular. Os dois aparecem em https://login.tailscale.com/admin/machines.
4. Salve. O painel roda os `tests` e recusa salvar se algum falhar.

```jsonc
{
  "hosts": {
    "pc-shotfolder": "100.x.y.z",
    "celular":       "100.a.b.c"
  },

  "acls": [
    // O celular só alcança a porta do ShotFolder no PC.
    { "action": "accept", "src": ["celular"], "dst": ["pc-shotfolder:47800"] }

    // Se você usa o Tailscale para outras coisas (área de trabalho remota, outro PC...),
    // adicione aqui as regras delas. Esta política substitui o "tudo liberado" padrão.
  ],

  "tests": [
    {
      "src": "celular",
      "accept": ["pc-shotfolder:47800"],
      "deny":   ["pc-shotfolder:47801", "pc-shotfolder:3389", "pc-shotfolder:445", "pc-shotfolder:22"]
    }
  ]
}
```

## Conferir no painel (a conferir no seu primeiro uso)

- O formato acima (`hosts`, `acls`, `tests`) é o clássico do Tailscale. O painel também aceita o formato mais novo, `grants`. Se ele sugerir converter, pode aceitar: o efeito é o mesmo.
- Se o editor reclamar de `"src": "celular"` em `tests`, troque pelo IP do celular entre aspas.

## Outras proteções da conta Tailscale

- [ ] Login da conta (Google/GitHub/Microsoft) protegido com **passkey** ou 2FA. É ali que o phishing faz diferença.
- [ ] Funnel e Serve desligados no PC. Confira com `shotfolder check`.
- [ ] Em Machines, só aparelhos seus. Celular perdido: remova o nó lá, **além** de rodar `shotfolder devices revoke`.
