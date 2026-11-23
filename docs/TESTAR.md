# O que testar à mão

Checklist do que depende do celular, do Windows ou de painéis externos. Marque `[x]` e anote o resultado. Cada etapa do `SPEC.md` acrescenta itens aqui.

## Etapa 0 — Preparação

- [ ] `node -v` mostra a versão LTS (24.x, a conferir)
- [ ] `git -v` responde
- [ ] Conta do Tailscale protegida com passkey ou 2FA
- [ ] Tailscale instalado e conectado no PC e no Samsung
- [ ] Tailscale Funnel desligado no PC (`tailscale funnel status` sem nada ativo)
- [ ] No PC, `tailscale ping <nome-do-celular>` responde
- [ ] Opções do desenvolvedor e depuração USB ligadas no Samsung
- [ ] Android Studio instalado (SDK + JDK 17) e `adb devices` lista o Samsung
- [ ] Lista de pastas que podem receber fotos e qual é a padrão (mandar para o Claude; não vai para o repositório)

## Etapa 1 — Protocolo

Nada a testar à mão: é só código com testes automáticos. Se quiser conferir, na pasta do projeto:

```powershell
npm test
```

Deve terminar com `45 passed`.

## Etapa 2 — Servidor (teste no próprio PC, sem Tailscale)

Rode no PowerShell, na pasta do projeto, um comando por vez:

1. Compilar: `npm run build`
2. Criar a configuração: copie `server\config.exemplo.json` para `%LOCALAPPDATA%\ShotFolder\config.json` e troque os caminhos por pastas suas que já existam (fora de `AppData`).
3. Subir o servidor (deixe esta janela aberta): `npm run start:local -w @shotfolder/server`
   - [ ] Cada pasta aparece como `[ok]`
4. Em outra janela, cadastrar o cliente de teste: `npm run enviar-teste -w @shotfolder/server -- registrar`
5. Ver as pastas: `npm run enviar-teste -w @shotfolder/server -- pastas`
   - [ ] Responde `200` com códigos e nomes, sem caminhos
6. Enviar uma foto .jpg sua: `npm run enviar-teste -w @shotfolder/server -- enviar C:\caminhooto.jpg --repetir`
   - [ ] `envio: 201` e `repetição: 200 duplicate`
   - [ ] A foto aparece **uma vez** na pasta padrão, com nome tipo `2026-11-23_153012_a1b2.jpg`
   - [ ] **Apareceu a notificação do Windows "Foto recebida"** (único item que não consegui conferir daqui)
   - [ ] O Claude Code consegue ler a foto pelo caminho
7. Parar o servidor: Ctrl+C na primeira janela.

Observação: o cliente de teste fica cadastrado em `devices.json`. Ele será revogado na etapa 3 com `shotfolder devices revoke`.

## Próximas etapas

(preenchido conforme as etapas forem implementadas)
