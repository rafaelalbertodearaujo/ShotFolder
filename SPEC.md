# ShotFolder — SPEC

## Contexto

Hoje, para o Claude Code ler uma foto do celular, ela passa pelo WhatsApp ou Drive. O ShotFolder é um app Android (Samsung) com câmera própria e "Compartilhar" que manda a foto direto para uma pasta escolhida no PC (Windows 11), onde um programa em segundo plano grava a foto só em pastas de uma lista permitida. Também é projeto de aprendizado e portfólio de segurança.

Decisões já tomadas com o Rafael: PC em **Node + TypeScript**; ao chegar, **notificação do Windows** (sem copiar caminho, sem legenda); **um aparelho só** (o desenho permite outro depois); **repositório público no GitHub desde o início**.

---

## 1. App x site (PWA): recomendação

| Critério | App Expo (nativo) | Site/PWA servido pelo PC |
|---|---|---|
| Câmera própria | Sim (`expo-camera`) | Sim (`getUserMedia`), mais limitada |
| "Compartilhar" da galeria | Sim (share intent) | Sim, via Web Share Target (só Chrome Android, PWA instalada) |
| Chave do aparelho | **Hardware (Keystore/StrongBox), não exportável** | WebCrypto em software (IndexedDB) |
| Fila em segundo plano | Razoável (tarefa de fundo + envio ao abrir) | Fraca (Background Sync instável) |
| HTTPS | Não exige (rede já cifrada pelo Tailscale) | Obrigatório, com certificado confiável |
| Se o PC estiver desligado | App abre e enfileira | PWA depende do cache do service worker |
| Curva para você | Maior (build Android, um pouco de Kotlin) | Menor (é HTML/JS) |
| Portfólio de segurança | Forte | Médio |

**Recomendo o app.** O PWA faria uns 80% do trabalho, mas perde justamente no que é prioridade: chave guardada em hardware e fila confiável. A curva extra é controlada porque o Expo é React (JS/TS) e o único Kotlin é um módulo pequeno de ~80 linhas.

## 2. Stack

**PC (`server/`)**
- Node LTS (no PC hoje: 22.14, que funciona; atualizar para 24 LTS quando der) + TypeScript 5. Mesma linguagem do app, e o código do protocolo é compartilhado.
- Fastify 5: valida o formato das requisições, limita o tamanho do corpo e tem `inject()` para testes sem rede.
- `node:crypto` para verificar assinatura ECDSA P-256 (sem biblioteca de cripto extra).
- Estado em `%LOCALAPPDATA%\ShotFolder\` (`config.json`, `devices.json`, `uploads-vistos.json`, `audit.jsonl`), com permissão NTFS só para o seu usuário.
- Segundo plano (**decisão revista em 23/11/2026**, a pedido do Rafael: ligar/desligar pelo Gerenciador de Tarefas): **atalho "ShotFolder" na pasta Inicializar do usuário**, que roda `conhost.exe --headless node cli.js daemon` (sem janela). Aparece em Gerenciador de Tarefas → Aplicativos de inicialização com Habilitar/Desabilitar; roda na sessão do usuário (a notificação funciona) e sem administrador. O `daemon` é um vigia que reinicia o servidor se ele cair (5 s, 10 s, 30 s, depois 60 s — cobre o Tailscale subindo depois do boot). Descartados: Serviço do Windows (sessão 0: sem notificação, grava como outro usuário) e Agendador de Tarefas (não aparece em Aplicativos de inicialização).
- Notificação: `node-notifier` (usa SnoreToast) — a conferir se segue mantido; plano B: PowerShell chamando a API de toast.
- Administração por CLI: `shotfolder pair | folders add/list/remove | devices list/revoke | log`. A CLI fala com o servidor num endereço local `127.0.0.1` usando um token aleatório gravado num arquivo que só o seu usuário lê (impede que um site no navegador mande comandos para o localhost).
- Testes: Vitest.

**Celular (`app/`)**
- Expo (SDK atual, a conferir) + TypeScript + Expo Router, em **development build** (o Expo Go não roda módulos nativos nem o share intent).
- `expo-camera` (câmera), `expo-image-manipulator` (converte para JPEG, reduz para ~2048 px e **remove EXIF/GPS** ao reencodar), `expo-sqlite` + `expo-file-system` (fila), `@react-native-community/netinfo` + `expo-background-task` (reenvio), `expo-share-intent` (comunidade, compatibilidade com o SDK a conferir), `expo-crypto` (SHA-256, UUID).
- Chave: no MVP, chave em software guardada no `expo-secure-store` e assinatura com `@noble/curves`; logo depois troca por **módulo Expo próprio em Kotlin** (`app/modules/keystore`) com chave no Android Keystore. Tudo atrás de uma interface `Signer`, então a troca não mexe no resto.
- Build: recomendo `npx expo run:android` local (Android Studio + JDK 17, ~10 GB) porque o módulo Kotlin exige muitas recompilações; EAS Build na nuvem fica como alternativa para gerar o APK final.

**Regra de dependências do app:** rodar `npx expo install <pacote>` sempre de dentro de `app/` (rodado de outra pasta, o pacote vai parar no `package.json` da raiz e some do app).

**Compartilhado (`packages/protocol/`)**: string canônica de assinatura, nomes de cabeçalho, limites, tipos e vetores de teste usados pelos dois lados.

**Por que JPEG:** o Claude Code lê JPEG/PNG/WEBP, mas não HEIC. O app converte tudo para JPEG (com opção "original" quando precisar de resolução total). Limite de tamanho de imagem do Claude: a conferir.

## 3. Rede: crítica ao "LAN em casa + Tailscale fora"

Com o Tailscale ligado no celular, em casa o tráfego **já vai direto pela rede local**, cifrado pelo WireGuard (o protocolo de VPN do Tailscale), sem passar pela nuvem; só a coordenação de chaves usa o servidor deles. Por isso recomendo:

- O servidor escuta **só no IP do Tailscale do PC (100.x)**, nunca na interface da rede local. Quem está no seu Wi‑Fi (visita, TV, câmera IP) nem enxerga a porta.
- Um endereço só, em casa e fora. Menos código e menos superfície de ataque.
- Modo LAN sem Tailscale fica como etapa opcional, e só se houver problema real (aí com TLS e certificado fixado no pareamento).
- **Nuvem: não há motivo forte.** A fila do celular cobre o PC desligado.

## 4. Modelo de ameaças

**O que proteger (em ordem):** (1) integridade do disco do PC (gravar arquivo onde não deve pode virar execução de código); (2) sigilo das fotos (prints de tela podem ter dado sensível); (3) a chave do aparelho; (4) disponibilidade (disco cheio); (5) o contexto do Claude Code (texto escondido numa imagem pode tentar dar instruções ao Claude).

| # | Quem ataca | Como | Defesa |
|---|---|---|---|
| A1 | Qualquer um na internet | Varre portas | Nada exposto: sem redirecionamento no roteador, servidor só no IP do Tailscale, **Tailscale Funnel desligado** |
| A2 | Alguém no seu Wi‑Fi | Acessa a porta pela rede local | Não escuta na LAN; regra do Firewall do Windows só para o IP Tailscale do celular |
| A3 | Outro aparelho do tailnet comprometido | Chama a API | ACL do Tailscale (só o celular chega na porta) + assinatura do aparelho |
| A4 | Invasão da conta Tailscale | Adiciona aparelho próprio ao tailnet | Conta (Google/GitHub) com **passkey/2FA**; mesmo dentro, sem chave pareada não envia |
| A5 | Ladrão com o celular bloqueado | Tenta usar o app | Chave com `setUnlockedDeviceRequired` (só funciona com o aparelho desbloqueado); revogar no PC + remover o nó no Tailscale + Encontre Meu Dispositivo |
| A6 | Pessoa com o celular desbloqueado | Envia lixo | Só para pastas da lista, nome e extensão definidos pelo PC, cotas; **não consegue mudar a lista** (só o PC administra); app apaga a cópia local após o envio |
| A7 | App malicioso no celular | Usa a chave / compartilha arquivo malicioso | Keystore isola a chave por app; compartilhamento exige confirmação na tela; PC valida tudo |
| A8 | Quem fotografa o QR de pareamento | Pareia antes de você | QR vale 2 min e uma vez só, só funciona dentro do tailnet, e você confirma um código de 6 dígitos igual no PC e no celular |
| A9 | Rede hostil fora de casa | Escuta ou repete a requisição | WireGuard cifra; assinatura com horário (±5 min) e `uploadId` único (repetição vira "já recebido", sem gravar de novo) |
| A10 | Arquivo malicioso | Caminho com `..\`, nome reservado (`CON`), fluxo alternativo NTFS (`foto.jpg:x`), junção/atalho, arquivo gigante, extensão falsa, falha em decodificador de imagem do Windows | Celular **nunca manda caminho nem nome**: manda `folderId`; o PC monta o nome (`2026-11-23_153012_a1b2.jpg`), confere o tipo pelos bytes iniciais, limite de 25 MB durante o recebimento, grava em pasta temporária e só move depois de validar, sem sobrescrever, recusa pasta que seja junção/link; reencode no PC (opcional) |
| A11 | Encher o disco | Muitos envios | Limite por minuto, cota diária e espaço livre mínimo |
| A12 | Injeção de instruções no Claude | Imagem com texto do tipo "ignore as instruções…" (ex.: print recebido no WhatsApp) | Risco baixo (só você envia), mas fica documentado: foto é dado, não instrução |
| A13 | Malware ou pessoa no seu PC desbloqueado | Mexe na config | **Fora do escopo** (já controla o PC). Mitigação leve: arquivos de estado com permissão só sua |
| A14 | Celular com root ou SO comprometido | Usa a chave | Fora do escopo; a StrongBox impede extrair a chave, mas não impede usá-la |
| A15 | Pacote npm comprometido | Código malicioso no build | Poucas dependências, lockfile, versões fixas, `npm audit`, Dependabot |

### Crítica das camadas que você pensou

- **Tailscale, lista de pastas, path traversal, limites, logs, revogação:** mantidos; reforcei com "o celular nunca manda caminho nem nome".
- **Chave no Keystore + cada envio assinado:** mantido. Uso **duas regras**: a chave de envio funciona sem digital (senão a fila não envia sozinha), mas só com o aparelho desbloqueado.
- **TOTP (Google Authenticator): aqui ajuda pouco.** As ações de admin acontecem no PC, e quem já está no seu PC lê o segredo TOTP do disco ou edita a config direto. Pior: o autenticador fica no mesmo celular que você perderia, então **exigir TOTP para revogar travaria você justo quando mais precisa.** Regra: ação que *reduz* acesso (revogar) é fácil; ação que *aumenta* acesso (parear, adicionar pasta) exige presença física no PC.
- **TOTP e phishing:** o código pode ser repassado em tempo real para um site falso (não é ligado ao endereço do site) e o segredo fica guardado no servidor. Aqui nem há página de login para imitar, então o risco de phishing já é baixo.
- **Passkeys/digital são melhores em dois pontos:** (1) na conta do Tailscale (Google/GitHub), onde o phishing é real — é aí que passkey faz diferença; (2) se um dia houver admin pelo celular, uma chave do Keystore que exige digital é, na prática, uma passkey sem domínio: resiste a phishing e fica presa ao aparelho. Passkey "de verdade" (WebAuthn) exigiria domínio e HTTPS — exagero aqui.
- TOTP fica como etapa **opcional de aprendizado**, com esses limites escritos no README.

## 5. Arquitetura

```
Celular (app Expo)                                PC (Node, tarefa ao logon)
câmera / Compartilhar                             escuta só em 100.x:47800 (Tailscale)
  → JPEG ≤2048px, sem EXIF                          1. confere cabeçalhos + assinatura (antes de ler o corpo)
  → fila SQLite (arquivo privado do app)            2. confere horário, uploadId, limites, folderId
  → assina cabeçalhos (Keystore, ECDSA P-256)  ──►  3. recebe em temp/, calcula SHA-256, confere bytes iniciais
  → POST /v1/upload via Tailscale (WireGuard)       4. move para a pasta da lista com nome gerado
  ← 200 / "já recebido" → apaga cópia local         5. audit.jsonl + notificação do Windows
                                                  CLI admin ↔ 127.0.0.1:47801 (token local)
```

**Protocolo v1** (em `packages/protocol`):
- `POST /v1/upload`, corpo = bytes da imagem (sem multipart, menos superfície de ataque). Cabeçalhos `X-SF-Device`, `X-SF-Upload` (UUID), `X-SF-Time`, `X-SF-Folder`, `X-SF-Sha256`, `X-SF-Signature`.
- String assinada: `SHOTFOLDER-V1\nPOST\n/v1/upload\n<device>\n<upload>\n<time>\n<folder>\n<content-type>\n<tamanho>\n<sha256>`.
- `GET /v1/folders` (assinado) devolve `[{id, nome}]` e a pasta padrão. O celular nunca vê caminhos do PC. Cabeçalhos `X-SF-Device`, `X-SF-Request` (UUID), `X-SF-Time`, `X-SF-Signature`; string assinada: `SHOTFOLDER-V1\nGET\n/v1/folders\n<device>\n<request>\n<time>`.
- Regras de formato (em `packages/protocol/src/index.ts`): cabeçalho repetido é recusado; `Content-Type` tem de ser exatamente `image/jpeg`, `image/png` ou `image/webp`; `folderId` só minúsculas, dígitos e hífen (até 32); assinatura ECDSA P-256 em DER/base64; chave pública SPKI/DER em base64. O pacote tem duas entradas: `@shotfolder/protocol` (sem Node, serve ao app) e `@shotfolder/protocol/node` (verificação com `node:crypto`, só no PC).
- `POST /v1/pair {token, publicKey, deviceName}` só aceito com pareamento pendente; o token é comparado em tempo constante.
- QR: `shotfolder://pair?v=1&host=<ip-tailscale>&port=47800&t=<token>`; código de confirmação = 6 dígitos de SHA-256(token + chave pública).

**Pastas do repositório**
```
ShotFolder/
  SPEC.md  README.md  .gitignore  package.json (npm workspaces)
  packages/protocol/   string canônica, constantes, tipos, testes
  server/              src/ (app, state, files, notify, net, main; depois pair, admin, cli), test/
  app/                 Expo SDK 58: src/app/ (telas), src/lib/ (crypto, api, storage), test/; depois app/modules/keystore/ (Kotlin)
  server/src/tools/    enviar-teste.ts (cliente de teste que faz o papel do celular)
  server/config.exemplo.json  modelo do config.json (o real fica em %LOCALAPPDATA%\ShotFolder)
  scripts/             firewall.ps1 (etapa 9)
  docs/TESTAR.md       checklist do que o Rafael testa à mão
```

## 6. Etapas (essencial → opcional)

**Essenciais — MVP = etapas 0 a 5**

0. **Preparação (você, à mão).** Pronto quando: `node -v` e `git -v` respondem; Tailscale nos dois aparelhos e `tailscale ping <celular>` funciona no PC; depuração USB ligada e `adb devices` lista o Samsung.
1. ✅ **Repo + protocolo** (concluída: 45 testes passando; vetores fixos em `packages/protocol/test/vetores.json`, gerados por `gerar-vetores.mjs`). Workspaces, `packages/protocol` com string canônica e verificação. Pronto quando: `npm test` passa com vetores de teste (assinatura válida, campo alterado, horário fora da janela).
2. ✅ **Servidor recebe foto assinada** (concluída: 42 testes do servidor + teste ponta a ponta no PC com `--local`). Fastify no IP do Tailscale, `/v1/upload`, `/v1/folders`, lista de pastas, nomes gerados, temp→mover, limites, `uploadId` persistido, `audit.jsonl`, notificação; `scripts/enviar-teste.ts` assina com chave em software cadastrada à mão. Pronto quando: o script manda uma foto e ela aparece na pasta com notificação; testes automáticos recusam traversal, tipo falso, arquivo grande demais, assinatura errada, repetição e `folderId` desconhecido.
   - Como ficou: estado em `%LOCALAPPDATA%\ShotFolder` (ou `SHOTFOLDER_HOME`); `config.json`, `devices.json` e `uploads-vistos.json` são relidos a cada requisição (revogar vale na hora). Sem Tailscale o servidor se recusa a subir, salvo com `--local` (só `127.0.0.1`); IP fora de 100.64.0.0/10 é recusado.
   - Gravação: recebe em `tmp\` e **copia** com `COPYFILE_EXCL` (falha se o nome existir, nunca sobrescreve; a cópia herda as permissões da pasta de destino). Mover/hard link manteria as permissões da pasta de estado.
   - Pasta da lista é recusada se for raiz de disco, caminho de rede, pasta do sistema (`Windows`, `Program Files`, `ProgramData`, `AppData`, inclusive Inicializar), a própria pasta de estado, ou se ela ou um nível acima for link/junção. Checado na partida e antes de cada gravação.
   - Falha de autenticação responde só `401 unauthorized`; o motivo (`bad_signature`, `unknown_device`, `clock_skew`) vai só para o `audit.jsonl`.
   - Limites padrão: 30 envios/min, 2 GB/dia, 5 GB livres. Contagem por minuto e por dia fica na memória (zera ao reiniciar) — aceitável para um aparelho só.
   - Notificação via PowerShell do Windows (sem `node-notifier`: uma dependência a menos).
3. ✅ **Pareamento + CLI admin** (concluída: 60 testes do servidor + teste ponta a ponta com a CLI real). Admin em 127.0.0.1 com token local; `shotfolder pair` mostra QR no terminal e pede o código; `folders add/list`, `devices list/revoke`. Pronto quando: o script de teste pareia lendo o texto do QR; QR expirado ou reutilizado é recusado; aparelho revogado recebe 401.
   - Como ficou: CLI única `shotfolder` (`server/src/cli.ts`): `serve [--local]`, `pair`, `folders list|add|remove|default`, `devices list|revoke`, `log [n]`. Só `pair` precisa do servidor rodando; pastas e aparelhos são editados direto nos arquivos, então **revogar funciona com o servidor parado**.
   - Fluxo: `pair` pede um token (32 bytes, 2 min, uso único) à API admin e mostra o QR (`uqr`, sem dependências). O celular faz `POST /v1/pair {token, publicKey, deviceName}`, que **fica esperando** (até 90 s) a decisão no PC. O PC mostra nome e código; você responde s/n. O token queima no primeiro uso, mesmo que você recuse. QR novo invalida o anterior.
   - Código de confirmação: 6 dígitos de SHA-256(`SHOTFOLDER-PAIR-V1\n<token>\n<chave SPKI base64>`) — funções `pairCodeInput`/`pairCodeFromSha256Hex` no protocolo, para o app calcular com expo-crypto.
   - API admin em `127.0.0.1:<adminPort>` (padrão: porta + 1): exige `Authorization: Bearer <admin.token>` (arquivo novo a cada partida, apagado ao parar), `Host` exato e **nenhum** cabeçalho `Origin` (bloqueia sites no navegador e DNS rebinding). Hoje só expõe o pareamento.
   - JSON com campo a mais é recusado (o Fastify por padrão só descartaria).
   - `folders add` recusa pastas do sistema, junções etc. (mesma regra do servidor) e uma alteração inválida da config não é gravada.
4. 🟡 **App mínimo no celular** (código pronto e testado no PC; **falta rodar no Samsung**). Development build no Samsung, ler QR, parear (chave em software), listar pastas. Pronto quando: o celular aparece em `devices list` e mostra as pastas da lista.
   - Feito: projeto Expo SDK 58 (React Native 0.88) em `app/`, no mesmo workspace; telas `src/app/index.tsx` (pareado? lista as pastas) e `src/app/parear.tsx` (leitor de QR com `expo-camera`, código de 6 dígitos, campo para colar o texto do QR); chave P-256 em software com `@noble/curves` (`src/lib/crypto.ts`, interface `Signer`), guardada no `expo-secure-store` (`src/lib/storage.ts`); cliente HTTP em `src/lib/api.ts` com mensagens de erro em português.
   - Verificado sem o celular: 12 testes (assinatura do app confere no verificador do PC, código de pareamento igual ao do PC, e pareamento + listagem de pastas contra o servidor real por HTTP); `expo export --platform android` gera o pacote Hermes sem erro; `expo-doctor` 20/20.
   - Decisões: `usesCleartextTraffic: true` (o tráfego é HTTP, mas já vai cifrado dentro do Tailscale; o IP do PC só é conhecido no QR, então não dá para liberar por domínio); esquema de link do app é `shotfolder-app://`, **diferente** do `shotfolder://` do QR, e a tela de pareamento ignora parâmetros de link — um link malicioso não consegue parear o celular com o PC de outra pessoa; `allowBackup: false` e microfone bloqueado; regex do nome do aparelho sem `\p{L}` para rodar igual no Hermes.
   - Pendências conhecidas: React 19.3.1 único no monorepo (o Expo pede 19.3.0; diferença de patch, checagem excluída em `app/package.json`); `npm audit` aponta 3 alertas moderados em `minimatch` dentro das ferramentas de build do Expo (não vão para o celular; corrigir exigiria rebaixar o Expo).
5. 🟡 **Câmera e envio** (código pronto e testado no PC; **falta rodar no Samsung**). Tirar foto → escolher pasta (ou padrão) → confirmar → JPEG sem EXIF → enviar. Pronto quando: a foto do celular cai na pasta certa do PC e o Claude Code a lê pelo caminho.
   - Feito: tela `src/app/foto.tsx` (câmera → prévia → pastas como botões, sugerindo a última usada, depois a padrão → Enviar; em erro, "Tentar de novo" reusa o mesmo `uploadId`, então não duplica no PC). Sem parâmetros de rota: link externo não consegue escolher arquivo para enviar.
   - `src/lib/photo.ts`: `ImageManipulator.manipulate(uri, { maxWidth: 2048, maxHeight: 2048 })` (reduz já na decodificação), JPEG 85%, apaga a foto original na hora. `src/lib/jpeg.ts`: remove APP1 (EXIF/XMP), APP13 (IPTC) e comentários sem decodificar a imagem — o reencode provavelmente já tira, mas isso não está documentado, então o app garante.
   - `uploadPhoto` em `src/lib/api.ts`: corpo `Uint8Array` (o `expo/fetch` do Android monta o corpo com tamanho fixo no OkHttp, então vai `Content-Length`, que a assinatura exige), limite de 25 MB checado antes de sair do celular, mensagens de erro em português.
   - Verificado sem o celular: 21 testes do app (envio contra o servidor real chega byte a byte e sem "GPS"; reenvio com mesmo id = "já recebido"; não-JPEG recusado), remoção de EXIF testada também num JPEG real com GPS gerado pelo Pillow (continua abrindo, EXIF e comentário vazios), pacote Android Hermes gerado, `expo-doctor` 20/20.
   - A conferir no aparelho: orientação da foto (a câmera já gira os pixels; sem EXIF não há rotação "de mentira") e o `Content-Length` real no envio.
6. 🟡 **Chave no Keystore** (código pronto; **o Kotlin ainda não foi compilado** — não há Android SDK no PC; compila no primeiro build). Módulo Kotlin: gerar par P-256 não exportável (StrongBox se houver, `setUnlockedDeviceRequired`), exportar a chave pública, assinar; re-parear. Pronto quando: envio funciona com a chave nova; a chave antiga foi revogada; com o celular bloqueado a assinatura falha.
   - Feito: módulo local `app/modules/shotfolder-keystore/` (montado a partir do `expo-module-template` 58; o `create-expo-module` travou num prompt interativo), detectado pelo autolinking do Expo. Kotlin: `generateKey` (tenta StrongBox, cai para TEE), `sign` (`SHA256withECDSA`, DER; com tela bloqueada lança `ERR_KEY_LOCKED`), `getPublicKey` (SPKI), `getSecurityLevel`, `hasKey`, `deleteKey`.
   - App: `src/lib/keystore-signer.ts` (`KeystoreSigner`, módulo injetado), `storage.ts` guarda só o apelido da chave (`shotfolder.session.v2`); pareamento do MVP (chave em software) é apagado e pede novo pareamento; chave que sumiu do Keystore (dados apagados) também; re-parear apaga a chave antiga do aparelho. A tela inicial mostra onde a chave mora (StrongBox/TEE). Assinatura recusada vira erro `key_locked` ("desbloqueie o celular").
   - Verificado sem o celular: 26 testes do app (com um Keystore falso que imita o Kotlin: pareia, lista e envia contra o servidor real; bloqueado = nada chega no PC; chave antiga revogada é recusada), pacote Android Hermes, `expo-doctor` 20/20. Não verificado: compilação do Kotlin, StrongBox real do Samsung, recusa real com tela bloqueada.
7. 🟡 **Fila offline** (código pronto e testado no PC; **falta rodar no Samsung**). SQLite + cópia privada; envia ao abrir o app, quando a rede volta e por tarefa de fundo; repetição com espera crescente; "já recebido" conta como sucesso. Pronto quando: com o Tailscale desligado tiro 3 fotos, religo e as 3 chegam uma vez só.
   - Mudança: em vez de SQLite, um `index.json` + as fotos em `Paths.document/fila/` (`src/lib/queue-storage.ts`). São poucos itens, e assim fica uma dependência nativa a menos. O índice é gravado num temporário e trocado, então nunca fica pela metade.
   - Lógica pura em `src/lib/queue.ts` (`UploadQueue`). **Toda foto passa pela fila**, inclusive quando a rede está boa: grava, tenta na hora e apaga do celular quando o PC confirma. O `uploadId` é fixo por foto. Espera entre tentativas: 30 s, 1, 2, 5, 15, 30 min e depois 1 h.
   - Erros definitivos (pasta saiu da lista, aparelho revogado, arquivo recusado) marcam a foto como "falhou" com o motivo; a tela inicial oferece "Tentar agora" e "Descartar". Erros que valem para tudo (rede, celular bloqueado, revogado, disco cheio no PC, limite de envio) param a rodada.
   - Gatilhos (`queue-context.tsx`, `queue-runtime.ts`): ao enviar, ao abrir ou voltar ao app, quando a rede volta, a cada 20 s com o app aberto, e uma tarefa do Android (`expo-background-task`, no mínimo a cada 15 min, quando o sistema deixar). Só um envio por vez.
   - Sem conexão, a escolha de pasta usa a última lista recebida do PC (`use-folders.ts`, guardada no SecureStore).
   - Verificado sem o celular: 9 testes da fila contra o servidor real (PC desligado → 3 fotos esperam → PC volta → chegam 3, uma vez só; resposta perdida vira "já recebido"; espera respeitada; pasta removida → falha e reenvio em outra pasta; revogado para tudo; chamadas simultâneas não duplicam; fila sobrevive a reabrir o app). Total do app: 35 testes, pacote Android Hermes e `expo-doctor` 20/20.
8. 🟡 **Compartilhar da galeria** (código pronto e testado no PC; **falta rodar no Samsung**). Share intent → tela de confirmação com pasta → fila. Pronto quando: uma foto da Galeria e uma HEIC chegam como JPEG na pasta escolhida.
   - Feito: `expo-share-intent` 9 (compatível com o SDK 58), configurado **só para imagens** (`image/*`, uma ou várias) e sem iOS. `_layout.tsx` usa o `ShareIntentProvider` por fora de tudo e abre `/compartilhar` quando chega algo. A tela mostra as miniaturas, a escolha de pasta e **só envia depois que você toca em "Enviar"**. Cada foto vira JPEG ≤2048 px sem EXIF (o HEIC é convertido) e vai para a fila. O original da Galeria nunca é tocado (`preparePhoto(uri, false)`).
   - Regras em `src/lib/share.ts`: aceita JPEG, PNG, WEBP, HEIC e HEIF; ignora o resto; no máximo 10 por vez.
   - Links (`src/app/+native-intent.tsx`): só `/`, `/foto` e `/compartilhar` são destinos válidos. Os parâmetros de link são descartados, então um link externo não escolhe arquivo, pasta nem PC.
   - Permissões do Android, conferidas gerando o projeto nativo (`expo prebuild`): ficam só **câmera, internet e vibração**. Microfone, leitura e gravação de armazenamento e "sobrepor outros apps" foram bloqueados (`blockedPermissions`). O backup está desligado e o HTTP liberado só porque roda dentro do Tailscale.
   - Verificado sem o celular: 45 testes do app (inclui filtro de tipos, limite de 10 e links maliciosos), pacote Android Hermes, `expo-doctor` 20/20, manifesto gerado com os filtros `SEND` e `SEND_MULTIPLE` para `image/*`. Não verificado: abrir pelo Compartilhar da Galeria de verdade e a conversão de HEIC no aparelho.
9. 🟡 **Segundo plano no Windows + cercas de rede** (código pronto; **falta aplicar e testar com o Tailscale instalado**). Segundo plano, regra de firewall, ACL no Tailscale (eu entrego o texto, você cola no painel), espera o Tailscale subir após o boot. Pronto quando: após reiniciar o PC, a foto chega sem abrir nada; outra máquina do tailnet e da LAN não conecta na porta.
   - Feito: `shotfolder install [--local]` cria o atalho e já inicia; `uninstall` para e remove; `status` mostra servidor, vigia, se inicia com o Windows e onde está o log (`%LOCALAPPDATA%\ShotFolder\server.log`, gira em 5 MB); `stop` desliga agora (via API admin `POST /admin/shutdown`). Uma cópia só (arquivo `daemon.pid`; porta em uso = sai com código 3 e o vigia não insiste).
   - Verificado de verdade (com uma pasta Inicializar de teste): processos sem janela, servidor derrubado à força voltou sozinho em 5 s, `install` repetido não duplica, `uninstall` não deixa processo nem atalho.
   - Firewall: `shotfolder firewall --celular <IP> [--pc <IP>]` gera `%LOCALAPPDATA%\ShotFolder\firewall-shotfolder.ps1` (o Rafael roda como administrador). Duas regras na porta 47800: **permitir** só do IP Tailscale do celular, só para o IP Tailscale do PC, só o `node.exe`; **bloquear** todo o resto. Bloqueio vence permissão no Firewall do Windows, o que importa porque o PC já tem regras antigas "Node.js JavaScript Runtime" (perfil Público) liberando o `node.exe` em qualquer porta — achadas em 23/11/2026. O IPv6 não entra porque o servidor só escuta IPv4.
   - ACL do Tailscale: modelo em `docs/tailscale-acl.md` (celular → só `pc:47800`, com `tests` que o painel confere ao salvar).
   - `shotfolder check`: verificação só de leitura — Tailscale conectado, Funnel/Serve desligados, servidor só no IP do Tailscale, vigia, inicialização, regras de firewall (e as antigas do `node.exe`), pastas válidas, quantos aparelhos ativos.
   - Verificado: 74 testes do servidor; `check` e `firewall` rodados de verdade; o script gerado passa no analisador do PowerShell. **Não verificado:** aplicar o script (exige administrador e o IP real do celular) e a ACL (exige a conta Tailscale).
   - Observação: se a pasta do projeto mudar de lugar, rode `shotfolder install` de novo (o atalho aponta para o caminho atual).
10. **Revogação e "perdi o celular".** Procedimento em `docs/` (revogar no PC → remover no Tailscale → Encontre Meu Dispositivo), `shotfolder log`. Pronto quando: você executa o roteiro num teste e o celular é recusado.

**Opcionais (aprendizado e portfólio)**

11. Log de auditoria encadeado por hash (cada linha guarda o hash da anterior; adulteração aparece). Pronto quando: `shotfolder log verify` detecta uma linha editada.
12. Reencode no PC (sharp, em processo separado) como segunda barreira contra arquivo malicioso. Pronto quando: um arquivo poliglota de teste sai limpo.
13. Fator extra para admin: TOTP como exercício (só para parear/adicionar pasta, nunca para revogar, com códigos de recuperação e anti-repetição) e/ou admin pelo celular com chave Keystore que exige digital. Pronto quando: os testes de ambos passam e o README explica os limites.
14. Atestação de chave Android (o PC confirma que a chave está em hardware). Pronto quando: pareamento registra "StrongBox/TEE verificado".
15. Modo LAN sem Tailscale com TLS fixado no pareamento (só se o Tailscale atrapalhar).
16. ✅ **Painel web local** (decidido em 23/11/2026: opção 1, página no navegador, sem ícone na bandeja). `shotfolder painel` ou o atalho "ShotFolder Painel" no Menu Iniciar (criado pelo `install`) abre `http://127.0.0.1:<adminPort>/painel/`. Abas: Fotos (miniatura, pasta, horário, tamanho, aparelho; Abrir, Mostrar na pasta, Excluir → **Lixeira**), Aparelhos (revogar), Pastas (só leitura, com o caminho e se está válida), Registro (últimos 150 eventos).
   - Segurança (`server/src/panel.ts`): entrada por código de uso único (60 s) que só a CLI gera com o token local → cookie `HttpOnly; SameSite=Strict` de 12 h; ações exigem `X-SF-CSRF` + Origin do próprio painel; `Host` exato; CSP sem script inline; a página monta tudo com `textContent`. Excluir só vale para fotos registradas pelo ShotFolder, com nome no padrão gerado, numa pasta da lista, e vai para a Lixeira (`server/src/recycle.ts`).
   - Arquivos da página em `server/painel/` (HTML, CSS e JS puros). O registro de envios (`SeenStore`) agora é um só, compartilhado entre servidor e painel, e guarda o tamanho e se foi para a Lixeira.
   - Verificado: 89 testes do servidor (inclui CSRF ausente, Origin de outro site, `Sec-Fetch-Site: cross-site`, Host falso, código reutilizado, caminho no lugar do id, registro adulterado); no navegador, com 3 fotos reais: lista, miniaturas, excluir (o arquivo saiu da pasta e apareceu na Lixeira do Windows), abas Aparelhos e Registro, console sem erros.
   - Fica para depois, se quiser: parear e editar pastas pelo painel (hoje só pela CLI).
17. Portfólio: README com diagrama, `SECURITY.md` com este modelo de ameaças, script de "ataques" automatizados, revisão de segurança antes de divulgar.

## 7. Riscos

- **Bateria da Samsung** coloca apps para dormir e atrasa a fila: tirar o ShotFolder da otimização de bateria. Mesmo assim, o Android não garante envio imediato com o app fechado; com o app aberto é imediato.
- **Tailscale ocupa a vaga de VPN** do Android (conflita com outra VPN) e, sem internet, novas conexões podem falhar (a conferir); a fila cobre.
- `expo-share-intent` e `node-notifier` são de comunidade: compatibilidade a conferir na etapa.
- **Kotlin/build Android** é a parte mais nova para você; por isso a chave em software vem antes (etapas 4–5) e o Keystore logo depois (etapa 6).
- Repo público: cuidado para nunca commitar `%LOCALAPPDATA%\ShotFolder`, IPs ou nome do tailnet (`.gitignore` + revisão no commit).

## 8. O que você faz à mão

1. Instalar Node LTS e Git; `gh auth login` (para eu criar o repo).
2. Conta Tailscale com passkey/2FA; instalar no PC e no Samsung; Funnel desligado.
3. Android: opções do desenvolvedor → depuração USB; instalar Android Studio (SDK + JDK 17); permitir instalar o APK.
4. Rodar como administrador os comandos de firewall que eu entregar; colar a ACL no painel do Tailscale.
5. Dizer quais pastas entram na lista e qual é a padrão.
6. Seguir o `docs/TESTAR.md` a cada etapa e me dizer o resultado.

## 9. Perguntas em aberto

- Quais pastas entram na lista inicial e qual é a padrão (respondido na etapa 3).
- Limites exatos (25 MB, cota diária, 2048 px) ajustáveis depois de usar.

## Verificação

Cada etapa tem "Pronto quando". Testes automáticos (Vitest) cobrem protocolo e servidor; o que depende do celular fica em `docs/TESTAR.md` para você confirmar. Nada é dado como pronto sem teste, log ou sua confirmação.
