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
4. Em outra janela, parear o cliente de teste: veja a Etapa 3 (o antigo `registrar` foi trocado por `parear`).
5. Ver as pastas: `npm run enviar-teste -w @shotfolder/server -- pastas`
   - [ ] Responde `200` com códigos e nomes, sem caminhos
6. Enviar uma foto .jpg sua: `npm run enviar-teste -w @shotfolder/server -- enviar C:\caminho\foto.jpg --repetir`
   - [ ] `envio: 201` e `repetição: 200 duplicate`
   - [ ] A foto aparece **uma vez** na pasta padrão, com nome tipo `2026-11-23_153012_a1b2.jpg`
   - [ ] **Apareceu a notificação do Windows "Foto recebida"** (único item que não consegui conferir daqui)
   - [ ] O Claude Code consegue ler a foto pelo caminho
7. Parar o servidor: Ctrl+C na primeira janela.


## Etapa 3 — Pareamento e comandos de administração

Atalho usado abaixo: `npm run cli -w @shotfolder/server --` equivale ao comando `shotfolder`.

1. `npm run build` e, numa janela, `npm run start:local -w @shotfolder/server` (deixe aberta).
2. Pastas pela CLI (em vez de editar o JSON):
   - `npm run cli -w @shotfolder/server -- folders add prints "Prints" C:\caminho\da\pasta --padrao`
   - `npm run cli -w @shotfolder/server -- folders list` → [ ] pastas aparecem como `[ok]`
   - [ ] `folders add teste "Teste" C:\Windows` é **recusado**
3. Pareamento, em outra janela: `npm run cli -w @shotfolder/server -- pair`
   - [ ] O QR aparece legível (no Windows Terminal; se sair com caracteres estranhos, me avise)
   - Copie o "Texto do QR" e, numa terceira janela: `npm run enviar-teste -w @shotfolder/server -- parear "<texto do QR>"`
   - [ ] O código mostrado no cliente é **igual** ao da janela do `pair`; responda `s`
   - [ ] Rodar o mesmo `parear` de novo com o mesmo texto falha (QR de uso único)
4. Envio: `npm run enviar-teste -w @shotfolder/server -- enviar C:\caminho\foto.jpg` → [ ] `201` e notificação
5. Revogar: `npm run cli -w @shotfolder/server -- devices list`, depois `devices revoke <deviceId>`
   - [ ] `enviar-teste -- pastas` passa a responder `401`
   - [ ] Revogar também funciona com o servidor **parado**
6. `npm run cli -w @shotfolder/server -- log` → [ ] mostra pareamento, envio e revogação

O celular de verdade entra na etapa 4 (o QR será lido pela câmera).

## Etapa 4 — App no celular (precisa de você)

O código já está pronto e testado no PC. Falta instalar no Samsung.

**Preparar o PC (uma vez):**
1. Instalar o Android Studio (vem com o JDK certo). Na primeira abertura, deixar ele baixar o Android SDK.
2. Criar a variável de ambiente `ANDROID_HOME` apontando para `%LOCALAPPDATA%\Android\Sdk` e pôr `%LOCALAPPDATA%\Android\Sdk\platform-tools` no `Path`. Fechar e abrir o terminal.
3. No Samsung: Configurações → Sobre o telefone → Informações do software → tocar 7 vezes em "Número de compilação"; depois Opções do desenvolvedor → Depuração USB.
4. Ligar o cabo USB e aceitar a pergunta no celular. `adb devices` deve listar o aparelho.

**Instalar o app (development build):** na pasta `app`:

```powershell
npx expo run:android
```

A primeira compilação demora (vários minutos). O app abre sozinho no celular.

**Testar o pareamento — opção A, sem Tailscale (pelo cabo USB):**
1. `adb reverse tcp:47800 tcp:47800` (o celular passa a enxergar a porta 47800 do PC pelo cabo).
2. Servidor: `npm run start:local -w @shotfolder/server` (escuta em 127.0.0.1:47800).
3. `npm run cli -w @shotfolder/server -- pair` e ler o QR com o app.
   - [ ] O app mostra o código de 6 dígitos **igual** ao do PC; responder `s`
   - [ ] O app volta para o início e mostra as pastas da lista (nomes, sem caminhos)
   - [ ] `npm run cli -w @shotfolder/server -- devices list` mostra o celular

**Opção B, com Tailscale (o uso real):** Tailscale ligado no PC e no celular, `npm run start -w @shotfolder/server` (sem `--local`), `pair` e ler o QR.
   - [ ] Mesmo resultado da opção A, sem cabo

**Erros que valem testar:**
   - [ ] QR antigo (depois de 2 min) → mensagem "O QR expirou"
   - [ ] Responder `n` no PC → "Pareamento recusado no PC"
   - [ ] `devices revoke` no PC e puxar a lista para atualizar → "O PC não reconhece este celular"
   - [ ] Servidor parado → "Não consegui falar com o PC…"

Me mande print ou o texto de qualquer erro.

## Próximas etapas

(preenchido conforme as etapas forem implementadas)
