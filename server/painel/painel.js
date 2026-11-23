// Painel do ShotFolder. JavaScript puro, sem bibliotecas.
// Regra de segurança: dados que vêm do servidor entram na página só por textContent
// (nunca innerHTML), para um nome de arquivo ou de aparelho não virar código.

"use strict";

let csrf = "";
let abaAtual = "fotos";
let assinaturaFotos = "";

// ---------- utilitários ----------

function el(tag, props = {}, ...filhos) {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (k === "class") e.className = v;
    else if (k === "text") e.textContent = v;
    else if (k.startsWith("on")) e.addEventListener(k.slice(2), v);
    else e.setAttribute(k, v);
  }
  for (const f of filhos) if (f) e.append(f);
  return e;
}

function aviso(texto, erro = false) {
  const a = document.getElementById("aviso");
  a.textContent = texto;
  a.className = erro ? "aviso erro" : "aviso";
  a.hidden = false;
  clearTimeout(aviso.t);
  aviso.t = setTimeout(() => (a.hidden = true), 3500);
}

const MENSAGENS = {
  sem_sessao: "Sessão expirada. Rode shotfolder painel de novo.",
  nao_encontrada: "Essa foto não está mais disponível.",
  arquivo_sumiu: "O arquivo não está mais na pasta (foi movido ou apagado).",
  pasta_fora_da_lista: "A pasta dessa foto saiu da lista do ShotFolder.",
  pasta_indisponivel: "A pasta dessa foto está indisponível.",
  lixeira_falhou: "O Windows não conseguiu mandar para a Lixeira.",
  forbidden: "Ação bloqueada por segurança. Recarregue a página.",
};

async function api(caminho, opcoes = {}) {
  const r = await fetch(`/painel/api/${caminho}`, {
    ...opcoes,
    headers: opcoes.method === "POST" ? { "x-sf-csrf": csrf } : {},
    credentials: "same-origin",
  });
  let corpo = {};
  try {
    corpo = await r.json();
  } catch {
    // sem corpo
  }
  if (!r.ok) throw new Error(MENSAGENS[corpo.error] ?? `Erro ${r.status}`);
  return corpo;
}

function kb(n) {
  if (n == null) return "";
  return n > 1024 * 1024 ? `${(n / 1024 / 1024).toFixed(1)} MB` : `${Math.round(n / 1024)} KB`;
}

function quando(iso) {
  const d = new Date(iso);
  const seg = Math.round((Date.now() - d.getTime()) / 1000);
  if (seg < 60) return "agora";
  if (seg < 3600) return `há ${Math.round(seg / 60)} min`;
  if (seg < 86400) return `há ${Math.round(seg / 3600)} h`;
  return d.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" }) + " " + d.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
}

const dataHora = (iso) => new Date(iso).toLocaleString("pt-BR");

// ---------- estado do servidor ----------

async function carregarEstado() {
  const box = document.getElementById("estado");
  const texto = document.getElementById("estado-texto");
  try {
    const s = await api("status");
    if (s.modo === "tailscale") {
      box.className = "estado ok";
      texto.textContent = `Recebendo pelo Tailscale (${s.host}:${s.port}) · ${s.aparelhosAtivos} aparelho(s) · ${s.pastas} pasta(s)`;
    } else {
      box.className = "estado teste";
      texto.textContent = `Modo de teste (${s.host}:${s.port}): o celular só chega pelo cabo USB`;
    }
    box.title = `Ligado desde ${dataHora(s.startedAt)} · vigia ${s.vigia ? "ativo" : "desligado"} · ${s.iniciaComWindows ? "inicia com o Windows" : "não inicia com o Windows"}`;
  } catch (e) {
    box.className = "estado erro";
    texto.textContent = e.message;
  }
}

// ---------- fotos ----------

let fotosCache = [];

async function carregarFotos() {
  const { fotos } = await api("fotos");
  fotosCache = fotos;
  const sel = document.getElementById("filtro-pasta");
  const atual = sel.value;
  const pastas = new Map(fotos.map((f) => [f.folderId, f.folderName ?? `${f.folderId} (fora da lista)`]));
  if (sel.options.length - 1 !== pastas.size) {
    sel.replaceChildren(el("option", { value: "", text: "Todas" }));
    for (const [id, nome] of pastas) sel.append(el("option", { value: id, text: nome }));
    sel.value = atual;
  }
  desenharFotos();
}

function desenharFotos(forcar = false) {
  const pasta = document.getElementById("filtro-pasta").value;
  const excluidas = document.getElementById("filtro-excluidas").checked;
  const lista = fotosCache.filter((f) => (!pasta || f.folderId === pasta) && (excluidas || !f.excluida));
  // Só redesenha se algo mudou (evita recarregar as miniaturas a cada 5 s).
  const assinatura = JSON.stringify(lista.map((f) => [f.uploadId, f.excluida, f.existe])) + pasta + excluidas;
  if (!forcar && assinatura === assinaturaFotos) return;
  assinaturaFotos = assinatura;

  const grade = document.getElementById("fotos");
  grade.replaceChildren(...lista.map(cartaoFoto));
  document.getElementById("fotos-vazio").hidden = lista.length > 0;
  document.getElementById("contagem").textContent = lista.length ? `${lista.length} foto(s)` : "";
}

function cartaoFoto(f) {
  const url = `/painel/api/fotos/${encodeURIComponent(f.uploadId)}/arquivo`;
  const disponivel = f.existe && !f.excluida;
  const miniatura = disponivel
    ? el("a", { class: "miniatura", href: url, target: "_blank", rel: "noopener", title: "Abrir em tamanho real" },
        el("img", { src: url, alt: f.file, loading: "lazy" }))
    : el("div", { class: "miniatura" },
        el("div", { class: "sem-imagem", text: f.excluida ? "Na Lixeira" : "O arquivo não está mais na pasta" }));

  const acoes = el("div", { class: "acoes" });
  if (disponivel) {
    acoes.append(
      el("a", { class: "botao", href: url, target: "_blank", rel: "noopener", text: "Abrir" }),
      el("button", { class: "botao", type: "button", text: "Mostrar na pasta", onclick: () => mostrar(f) }),
      el("button", { class: "botao perigo", type: "button", text: "Excluir", onclick: (ev) => excluir(f, ev.currentTarget) }),
    );
  }

  return el("article", { class: f.excluida ? "foto excluida" : "foto" },
    miniatura,
    el("div", { class: "info" },
      el("div", { class: "nome", text: f.file }),
      el("div", {},
        el("span", { class: f.folderName ? "etiqueta" : "etiqueta cinza", text: f.folderName ?? `${f.folderId} (fora da lista)` })),
      el("div", { class: "meta", text: `${quando(f.at)} · ${kb(f.bytes)} · ${f.aparelho}`, title: dataHora(f.at) }),
    ),
    acoes,
  );
}

async function mostrar(f) {
  try {
    await api(`fotos/${encodeURIComponent(f.uploadId)}/mostrar`, { method: "POST" });
  } catch (e) {
    aviso(e.message, true);
  }
}

async function excluir(f, botao) {
  if (!confirm(`Mandar "${f.file}" para a Lixeira do Windows?\n\nDá para restaurar pela Lixeira.`)) return;
  botao.disabled = true;
  try {
    await api(`fotos/${encodeURIComponent(f.uploadId)}/excluir`, { method: "POST" });
    aviso("Foto enviada para a Lixeira.");
    await carregarFotos();
  } catch (e) {
    botao.disabled = false;
    aviso(e.message, true);
  }
}

// ---------- aparelhos ----------

async function carregarAparelhos() {
  const { aparelhos } = await api("aparelhos");
  const corpo = document.getElementById("aparelhos");
  if (aparelhos.length === 0) {
    corpo.replaceChildren(el("tr", {}, el("td", { colspan: "5", class: "suave", text: "Nenhum aparelho pareado." })));
    return;
  }
  corpo.replaceChildren(
    ...aparelhos.map((a) =>
      el("tr", {},
        el("td", { text: a.name }),
        el("td", { class: "mono", text: a.id }),
        el("td", { text: dataHora(a.createdAt) }),
        el("td", {}, a.revokedAt
          ? el("span", { class: "erro-texto", text: `Revogado em ${dataHora(a.revokedAt)}` })
          : el("span", { class: "ok-texto", text: "Ativo" })),
        el("td", {}, a.revokedAt ? null
          : el("button", { class: "botao perigo", type: "button", text: "Revogar", onclick: () => revogar(a) })),
      ),
    ),
  );
}

async function revogar(a) {
  if (!confirm(`Revogar "${a.name}"?\n\nEle deixa de conseguir enviar na hora. Para voltar, será preciso parear de novo.`)) return;
  try {
    await api(`aparelhos/${encodeURIComponent(a.id)}/revogar`, { method: "POST" });
    aviso("Aparelho revogado.");
    await Promise.all([carregarAparelhos(), carregarEstado()]);
  } catch (e) {
    aviso(e.message, true);
  }
}

// ---------- pastas ----------

async function carregarPastas() {
  const { pastas } = await api("pastas");
  const corpo = document.getElementById("pastas");
  if (pastas.length === 0) {
    corpo.replaceChildren(el("tr", {}, el("td", { colspan: "4", class: "suave", text: "Nenhuma pasta na lista." })));
    return;
  }
  corpo.replaceChildren(
    ...pastas.map((p) =>
      el("tr", {},
        el("td", { text: p.padrao ? `${p.name} (padrão)` : p.name }),
        el("td", { class: "mono", text: p.id }),
        el("td", { class: "mono", text: p.path }),
        el("td", {}, p.problema
          ? el("span", { class: "erro-texto", text: `Recusada: ${p.problema}` })
          : el("span", { class: "ok-texto", text: "OK" })),
      ),
    ),
  );
}

// ---------- registro ----------

const EVENTOS = {
  upload_saved: "Foto recebida",
  upload_duplicate: "Reenvio (já recebida)",
  upload_rejected: "Envio recusado",
  upload_error: "Erro no envio",
  folders_rejected: "Listagem recusada",
  pair_started: "Pareamento iniciado",
  pair_submitted: "Celular pediu pareamento",
  pair_accepted: "Aparelho pareado",
  pair_failed: "Pareamento falhou",
  pair_rejected_by_user: "Pareamento recusado",
  device_revoked: "Aparelho revogado",
  folder_added: "Pasta adicionada",
  folder_removed: "Pasta removida",
  photo_recycled: "Foto para a Lixeira",
  panel_login: "Painel aberto",
  panel_rejected: "Ação do painel bloqueada",
  admin_rejected: "Acesso admin bloqueado",
  server_stop_requested: "Servidor parado",
  startup_installed: "Instalado na inicialização",
  startup_removed: "Removido da inicialização",
};

async function carregarRegistro() {
  const { log } = await api("log");
  document.getElementById("registro").replaceChildren(
    ...log.map((l) => {
      const { at, event, ...resto } = l;
      const detalhes = Object.entries(resto).map(([k, v]) => `${k}=${v}`).join("  ");
      return el("tr", {},
        el("td", { text: at ? dataHora(at) : "" }),
        el("td", { text: EVENTOS[event] ?? event }),
        el("td", { text: detalhes }));
    }),
  );
}

// ---------- abas e atualização ----------

const CARREGAR = {
  fotos: carregarFotos,
  aparelhos: carregarAparelhos,
  pastas: carregarPastas,
  registro: carregarRegistro,
};

function trocarAba(nome) {
  abaAtual = nome;
  for (const b of document.querySelectorAll(".aba")) b.classList.toggle("ativa", b.dataset.aba === nome);
  for (const s of document.querySelectorAll(".secao")) s.hidden = s.id !== `sec-${nome}`;
  atualizar();
}

async function atualizar() {
  try {
    await Promise.all([carregarEstado(), CARREGAR[abaAtual]()]);
  } catch (e) {
    aviso(e.message, true);
  }
}

async function iniciar() {
  try {
    ({ csrf } = await api("sessao"));
  } catch (e) {
    document.getElementById("estado-texto").textContent = e.message;
    return;
  }
  for (const b of document.querySelectorAll(".aba")) b.addEventListener("click", () => trocarAba(b.dataset.aba));
  document.getElementById("filtro-pasta").addEventListener("change", () => desenharFotos(true));
  document.getElementById("filtro-excluidas").addEventListener("change", () => desenharFotos(true));
  await atualizar();
  // Atualiza a cada 5 s, só com a aba do navegador visível.
  setInterval(() => {
    if (document.visibilityState === "visible") atualizar();
  }, 5000);
}

document.addEventListener("DOMContentLoaded", iniciar);
