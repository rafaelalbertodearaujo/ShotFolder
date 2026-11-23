# Perdi o celular (ou foi roubado)

São três cortes independentes. Faça os três, nesta ordem. O primeiro já basta para o ShotFolder recusar o aparelho; os outros fecham as portas de fora.

## 1. Revogar no ShotFolder (1 minuto, no PC)

Funciona até com o servidor parado. Vale na hora.

```powershell
npm run cli -w @shotfolder/server -- devices list
```
```powershell
npm run cli -w @shotfolder/server -- devices revoke <deviceId do celular perdido>
```

Ou pelo painel: `npm run cli -w @shotfolder/server -- painel` → aba **Aparelhos** → **Revogar**.

A partir daí, qualquer envio daquele celular recebe "não autorizado", mesmo que alguém consiga desbloquear o aparelho.

## 2. Remover o celular do Tailscale

1. Abra https://login.tailscale.com/admin/machines
2. No celular perdido: menu **…** → **Remove**.

Assim, ele nem chega na rede do PC.

## 3. Localizar, bloquear ou apagar o celular

- Samsung: https://smartthingsfind.samsung.com
- Google: https://www.google.com/android/find

Se não for recuperar o aparelho, use **Apagar dados**.

## Depois

- Confira o que aconteceu: `npm run cli -w @shotfolder/server -- log 50` (ou a aba **Registro** do painel). Envios recusados aparecem como "Envio recusado".
- Celular novo: instale o app e pareie de novo (`shotfolder pair`).

## Por que isso é suficiente

- A chave do ShotFolder fica no chip de segurança do celular e **não pode ser copiada**. Revogada no PC, ela não vale mais nada.
- Com o celular bloqueado, a chave nem assina (etapa 6). Quem pegar o aparelho travado não consegue enviar.
- Você não precisa do celular perdido para revogar: não há código de autenticador no caminho.
