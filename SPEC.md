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
- Segundo plano: **Agendador de Tarefas, "ao fazer logon", no seu usuário, sem janela, reiniciar se falhar.** Por quê não um Serviço do Windows: serviço roda na sessão 0, não consegue mostrar notificação e grava arquivos como outro usuário. Como você só usa com o PC ligado e logado, a tarefa agendada é mais simples e roda sem privilégio de administrador.
- Notificação: `node-notifier` (usa SnoreToast) — a conferir se segue mantido; plano B: PowerShell chamando a API de toast.
- Administração por CLI: `shotfolder pair | folders add/list/remove | devices list/revoke | log`. A CLI fala com o servidor num endereço local `127.0.0.1` usando um token aleatório gravado num arquivo que só o seu usuário lê (impede que um site no navegador mande comandos para o localhost).
- Testes: Vitest.

**Celular (`app/`)**
- Expo (SDK atual, a conferir) + TypeScript + Expo Router, em **development build** (o Expo Go não roda módulos nativos nem o share intent).
- `expo-camera` (câmera), `expo-image-manipulator` (converte para JPEG, reduz para ~2048 px e **remove EXIF/GPS** ao reencodar), `expo-sqlite` + `expo-file-system` (fila), `@react-native-community/netinfo` + `expo-background-task` (reenvio), `expo-share-intent` (comunidade, compatibilidade com o SDK a conferir), `expo-crypto` (SHA-256, UUID).
- Chave: no MVP, chave em software guardada no `expo-secure-store` e assinatura com `@noble/curves`; logo depois troca por **módulo Expo próprio em Kotlin** (`app/modules/keystore`) com chave no Android Keystore. Tudo atrás de uma interface `Signer`, então a troca não mexe no resto.
- Build: recomendo `npx expo run:android` local (Android Studio + JDK 17, ~10 GB) porque o módulo Kotlin exige muitas recompilações; EAS Build na nuvem fica como alternativa para gerar o APK final.

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
  server/              src/ (http, upload, pair, admin, store, notify, cli), test/
  app/                 Expo; app/modules/keystore/ (Kotlin)
  scripts/             enviar-teste.ts, instalar-tarefa.ps1, firewall.ps1
  docs/TESTAR.md       checklist do que o Rafael testa à mão
```

## 6. Etapas (essencial → opcional)

**Essenciais — MVP = etapas 0 a 5**

0. **Preparação (você, à mão).** Pronto quando: `node -v` e `git -v` respondem; Tailscale nos dois aparelhos e `tailscale ping <celular>` funciona no PC; depuração USB ligada e `adb devices` lista o Samsung.
1. ✅ **Repo + protocolo** (concluída: 45 testes passando; vetores fixos em `packages/protocol/test/vetores.json`, gerados por `gerar-vetores.mjs`). Workspaces, `packages/protocol` com string canônica e verificação. Pronto quando: `npm test` passa com vetores de teste (assinatura válida, campo alterado, horário fora da janela).
2. **Servidor recebe foto assinada.** Fastify no IP do Tailscale, `/v1/upload`, `/v1/folders`, lista de pastas, nomes gerados, temp→mover, limites, `uploadId` persistido, `audit.jsonl`, notificação; `scripts/enviar-teste.ts` assina com chave em software cadastrada à mão. Pronto quando: o script manda uma foto e ela aparece na pasta com notificação; testes automáticos recusam traversal, tipo falso, arquivo grande demais, assinatura errada, repetição e `folderId` desconhecido.
3. **Pareamento + CLI admin.** Admin em 127.0.0.1 com token local; `shotfolder pair` mostra QR no terminal e pede o código; `folders add/list`, `devices list/revoke`. Pronto quando: o script de teste pareia lendo o texto do QR; QR expirado ou reutilizado é recusado; aparelho revogado recebe 401.
4. **App mínimo no celular.** Development build no Samsung, ler QR, parear (chave em software), listar pastas. Pronto quando: o celular aparece em `devices list` e mostra as pastas da lista.
5. **Câmera e envio.** Tirar foto → escolher pasta (ou padrão) → confirmar → JPEG sem EXIF → enviar. Pronto quando: a foto do celular cai na pasta certa do PC e o Claude Code a lê pelo caminho.
6. **Chave no Keystore.** Módulo Kotlin: gerar par P-256 não exportável (StrongBox se houver, `setUnlockedDeviceRequired`), exportar a chave pública, assinar; re-parear. Pronto quando: envio funciona com a chave nova; a chave antiga foi revogada; com o celular bloqueado a assinatura falha.
7. **Fila offline.** SQLite + cópia privada; envia ao abrir o app, quando a rede volta e por tarefa de fundo; repetição com espera crescente; "já recebido" conta como sucesso. Pronto quando: com o Tailscale desligado tiro 3 fotos, religo e as 3 chegam uma vez só.
8. **Compartilhar da galeria.** Share intent → tela de confirmação com pasta → fila. Pronto quando: uma foto da Galeria e uma HEIC chegam como JPEG na pasta escolhida.
9. **Segundo plano no Windows + cercas de rede.** `instalar-tarefa.ps1` (ao logon, sem janela, reinicia), regra de firewall, ACL no Tailscale (eu entrego o texto, você cola no painel), espera o Tailscale subir após o boot. Pronto quando: após reiniciar o PC, a foto chega sem abrir nada; outra máquina do tailnet e da LAN não conecta na porta.
10. **Revogação e "perdi o celular".** Procedimento em `docs/` (revogar no PC → remover no Tailscale → Encontre Meu Dispositivo), `shotfolder log`. Pronto quando: você executa o roteiro num teste e o celular é recusado.

**Opcionais (aprendizado e portfólio)**

11. Log de auditoria encadeado por hash (cada linha guarda o hash da anterior; adulteração aparece). Pronto quando: `shotfolder log verify` detecta uma linha editada.
12. Reencode no PC (sharp, em processo separado) como segunda barreira contra arquivo malicioso. Pronto quando: um arquivo poliglota de teste sai limpo.
13. Fator extra para admin: TOTP como exercício (só para parear/adicionar pasta, nunca para revogar, com códigos de recuperação e anti-repetição) e/ou admin pelo celular com chave Keystore que exige digital. Pronto quando: os testes de ambos passam e o README explica os limites.
14. Atestação de chave Android (o PC confirma que a chave está em hardware). Pronto quando: pareamento registra "StrongBox/TEE verificado".
15. Modo LAN sem Tailscale com TLS fixado no pareamento (só se o Tailscale atrapalhar).
16. Ícone na bandeja com status, último envio e "parear".
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
