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

## Próximas etapas

(preenchido conforme as etapas forem implementadas)
