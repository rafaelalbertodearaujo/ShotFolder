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

## Etapa 10 — Teste do "perdi o celular"

Siga `docs/perdi-o-celular.md` só com o passo 1 (revogar), sem apagar nada do celular:
- [ ] Depois de revogar, o app mostra "O PC não reconhece este celular" ao atualizar as pastas, e uma foto enviada fica como "falhou"
- [ ] O Registro do painel mostra "Aparelho revogado" e depois "Envio recusado"
- Para voltar a usar: no app, "Esquecer pareamento" e parear de novo

## Etapa 8 — Compartilhar da Galeria

1. Na Galeria, abra uma foto → Compartilhar → **ShotFolder**.
   - [ ] O ShotFolder abre na tela "1 foto para o PC", com a miniatura
   - [ ] Escolha a pasta e toque em Enviar → "1 enviada(s) para o PC"
   - [ ] No PC a foto chega como `.jpg`, sem GPS (Propriedades → Detalhes)
   - [ ] A foto original continua na Galeria, igual
2. Várias de uma vez: selecione 3 fotos na Galeria → Compartilhar → ShotFolder → [ ] chegam as 3
3. HEIC: se a câmera do Samsung estiver salvando em HEIF (Câmera → Configurações → Formatos → "Fotos de alta eficiência"), compartilhe uma → [ ] chega como `.jpg`
4. Cancelar: compartilhe e toque em "Cancelar" → [ ] nada vai para o PC
5. Algo que não é foto (um PDF): [ ] o ShotFolder nem aparece na lista do Compartilhar (ou mostra "só recebe fotos")
6. Se der erro ao abrir a foto compartilhada, me avise: bloqueei a permissão de ler o armazenamento, que só faria diferença em Android 12 ou mais antigo.

## Etapa 7 — Fila offline

1. Bateria: Configurações → Aplicativos → ShotFolder → Bateria → **Sem restrições**. Sem isso, a Samsung "adormece" o app e a fila só anda com ele aberto.
2. PC desligado ou servidor parado (`npm run cli -w @shotfolder/server -- stop`):
   - [ ] Tire 3 fotos e envie: aparece "Foto na fila"; a tela inicial mostra "Fila de envio (3)"
   - [ ] A escolha de pasta funciona mesmo sem o PC (aviso "usando a lista de pastas de …")
3. Ligue o servidor de novo:
   - [ ] Com o app aberto, as 3 chegam sozinhas em até ~20 s (ou toque em "Enviar todas agora")
   - [ ] No PC, cada foto aparece **uma vez só**; a fila do celular esvazia
4. Fundo (opcional, demora): fila com fotos, app fechado, servidor ligado → [ ] em até ~15–30 min as fotos chegam sem abrir o app (o Android decide a hora)
5. Falha definitiva: no PC, `folders remove` da pasta escolhida e envie uma foto → [ ] ela fica como "falhou" com o motivo; "Descartar" apaga

## Etapa 6 — Chave no Keystore (junto com o primeiro build do app)

O módulo Kotlin só compila no primeiro build (`npx expo run:android` ou EAS). **Se o build falhar, me mande a mensagem de erro**: é a parte que não consegui compilar daqui.

- [ ] O build termina sem erro de Kotlin
- [ ] Depois de parear, a tela inicial mostra "Chave guardada no chip de segurança separado (StrongBox)" ou "área segura do processador (TEE)"
- [ ] Enviar uma foto funciona
- [ ] Teste do bloqueio: com o app aberto, toque em "Atualizar pastas" e bloqueie a tela logo em seguida; ao desbloquear, se o pedido saiu depois do bloqueio, aparece "O celular precisa estar desbloqueado…" (pode ser difícil de pegar no tempo; não é obrigatório)
- [ ] No PC, `devices list` mostra o celular; se você tinha pareado antes com a versão antiga, revogue o aparelho antigo

## Etapa 5 — Tirar foto e enviar (precisa de você)

Depois da etapa 4 funcionando (app instalado e pareado). Se já instalou antes, rode `npx expo run:android` de novo na pasta `app` (entraram módulos nativos novos: manipulação de imagem e arquivos).

1. Servidor rodando (`start:local` + `adb reverse tcp:47800 tcp:47800`, ou `start` com Tailscale).
2. No app: **Tirar foto** → disparar → prévia.
   - [ ] A prévia está **em pé/deitada do jeito certo** (não girada)
   - [ ] Aparece o tamanho (lado maior 2048) e "sem localização"
   - [ ] A pasta sugerida é a padrão (na primeira vez) e dá para trocar tocando em outra
3. **Enviar**.
   - [ ] "Foto enviada" com o nome do arquivo e a pasta
   - [ ] Notificação "Foto recebida" no PC
   - [ ] O arquivo está na pasta certa e abre normal no Windows
   - [ ] Botão direito no arquivo → Propriedades → Detalhes: **sem GPS, sem modelo do celular**
   - [ ] O Claude Code lê a foto pelo caminho (o "Pronto quando" da etapa)
4. Tirar outra foto: [ ] a pasta sugerida agora é a última usada
5. Erros:
   - [ ] Servidor parado → mensagem de erro e botão "Tentar enviar de novo"; religar o servidor e tentar → chega **uma vez só**
   - [ ] `folders remove` da pasta escolhida no PC e enviar → "Essa pasta não está mais na lista do PC"

## Rodar em segundo plano (parte da etapa 9, adiantada)

Na pasta do projeto, depois de `npm run build`:

1. Instalar. Enquanto não tiver Tailscale, com `--local` (depois de instalar o Tailscale, rode de novo sem o `--local`):
   ```powershell
   npm run cli -w @shotfolder/server -- install --local
   ```
   - [ ] Nenhuma janela fica aberta
   - [ ] `npm run cli -w @shotfolder/server -- status` diz "Rodando" e "Vigia ativo"
2. Gerenciador de Tarefas (Ctrl+Shift+Esc) → **Aplicativos de inicialização**:
   - [ ] Aparece **ShotFolder** (anote o nome e o "Editor" que aparecem; o editor pode sair como Microsoft, porque quem abre é o conhost do Windows)
   - [ ] Desabilitar → reiniciar o PC → `status` diz "parado"; Habilitar → reiniciar → volta sozinho
3. Parar agora sem desinstalar: `npm run cli -w @shotfolder/server -- stop`
4. Tirar de vez: `npm run cli -w @shotfolder/server -- uninstall`
5. Se algo der errado, o log fica em `%LOCALAPPDATA%\ShotFolder\server.log` (ou `shotfolder status` mostra o caminho).

Sem Tailscale e sem `--local`, o vigia fica tentando a cada 60 s e escrevendo "Tailscale não encontrado" no log — é o esperado.

## Etapa 9 — Cercas de rede (depois do Tailscale instalado nos dois)

1. Verificação geral, a qualquer momento:
   ```powershell
   npm run cli -w @shotfolder/server -- check
   ```
   Hoje ela já aponta: Tailscale ausente e regras antigas "Node.js JavaScript Runtime" liberando o Node em qualquer porta no perfil Público.
2. Firewall: pegue o IP Tailscale do celular (app do Tailscale no celular, ou https://login.tailscale.com/admin/machines) e rode:
   ```powershell
   npm run cli -w @shotfolder/server -- firewall --celular 100.x.y.z
   ```
   Ele mostra um comando `powershell -ExecutionPolicy Bypass -File "...firewall-shotfolder.ps1"`. Rode-o num **PowerShell aberto como administrador**.
   - [ ] `check` passa a dizer "Firewall: só o celular entra na porta do ShotFolder"
3. ACL do Tailscale: siga `docs/tailscale-acl.md` (copie a política atual antes de trocar).
   - [ ] O painel salvou sem erro nos `tests`
4. Teste de fogo:
   - [ ] Depois de reiniciar o PC, uma foto do celular chega sem você abrir nada
   - [ ] De outro aparelho (outro PC no Wi-Fi ou no tailnet), `http://<IP do PC>:47800/v1/folders` **não abre**
   - [ ] `check` termina com "0 problema(s)"

## Painel web

1. Com o ShotFolder rodando, abra o painel com o comando abaixo ou pelo Menu Iniciar → **ShotFolder Painel** (o atalho aparece depois de rodar `install` de novo):
   ```powershell
   npm run cli -w @shotfolder/server -- painel
   ```
   - [ ] O navegador abre o painel sozinho
   - [ ] Aba Fotos: as fotos recebidas aparecem com miniatura
   - [ ] "Mostrar na pasta" abre o Explorer com a foto selecionada
   - [ ] "Excluir" pede confirmação e a foto aparece na Lixeira do Windows
2. Segurança:
   - [ ] Copiar o link da barra de endereço e abrir em outra janela anônima → pede para rodar `shotfolder painel` (o link é de uso único)

## Notificação clicável

Mandei uma notificação de teste ("Teste do ShotFolder") apontando para a pasta `test-output` do projeto. Se ela ainda estiver na Central de Notificações (Win+N):
- [ ] Clicar no corpo da notificação abre a pasta no Explorer
- [ ] O botão **Ver foto** abre a foto no visualizador de imagens
- [ ] O botão **Abrir pasta** abre a pasta

Numa foto de verdade (do celular ou do `enviar-teste`), o mesmo vale para a pasta onde ela caiu.

## Regras antigas do Node no firewall (você roda, como administrador)

O PC tem duas regras "Node.js JavaScript Runtime" que liberam o Node em qualquer porta na rede Pública. Você não usa o Node para mais nada, então pode desativar. Desativar não apaga: dá para religar depois. Num **PowerShell aberto como administrador**:

```powershell
Get-NetFirewallRule -DisplayName 'Node.js JavaScript Runtime' | Disable-NetFirewallRule
```

Para desfazer: o mesmo comando trocando `Disable-NetFirewallRule` por `Enable-NetFirewallRule`.

- [ ] `npm run cli -w @shotfolder/server -- check` deixa de mostrar o problema das regras antigas
- Se o Windows perguntar se deve "permitir o Node.js" na rede, clique em **Cancelar**. Depois do Tailscale, a porta do ShotFolder é liberada pela regra própria dele (`shotfolder firewall`), só para o seu celular.

## Próximas etapas

(preenchido conforme as etapas forem implementadas)
