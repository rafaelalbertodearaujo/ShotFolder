import { describe, expect, it } from "vitest";
import {
  buildFoldersCanonical,
  buildUploadCanonical,
  HEADERS,
  isTimestampFresh,
  LIMITS,
  parseFoldersHeaders,
  parseUploadHeaders,
  uploadHeaders,
  type HeaderBag,
  type UploadFields,
} from "../src/index.js";
import vetores from "./vetores.json" with { type: "json" };

const base: UploadFields = {
  deviceId: "dev_TESTE_0001",
  uploadId: "3f2b8c1e-9a4d-4e6f-8b7a-1c2d3e4f5a6b",
  timestamp: "1795000000000",
  folderId: "shotfolder-docs",
  contentType: "image/jpeg",
  contentLength: "1024",
  sha256: "a".repeat(64),
};
const headersOf = (f: UploadFields = base): HeaderBag => uploadHeaders(f, "MEUCIQDassinaturafalsa==");

describe("string canônica", () => {
  it("tem o formato exato do SPEC", () => {
    expect(buildUploadCanonical(base)).toBe(
      [
        "SHOTFOLDER-V1",
        "POST",
        "/v1/upload",
        "dev_TESTE_0001",
        "3f2b8c1e-9a4d-4e6f-8b7a-1c2d3e4f5a6b",
        "1795000000000",
        "shotfolder-docs",
        "image/jpeg",
        "1024",
        "a".repeat(64),
      ].join("\n"),
    );
  });

  it("bate com os vetores montados à mão", () => {
    expect(buildUploadCanonical(vetores.upload.fields as UploadFields)).toBe(vetores.upload.canonical);
    expect(buildFoldersCanonical(vetores.folders.fields)).toBe(vetores.folders.canonical);
  });

  it("recusa campo com quebra de linha (não deixa um campo empurrar o outro)", () => {
    expect(() => buildUploadCanonical({ ...base, folderId: "docs\nimage/png" })).toThrow();
    expect(() => buildUploadCanonical({ ...base, deviceId: "dev_TESTE_0001\n" })).toThrow();
  });
});

describe("leitura dos cabeçalhos", () => {
  it("aceita cabeçalhos válidos", () => {
    const r = parseUploadHeaders(headersOf());
    expect(r.ok).toBe(true);
  });

  it.each([
    ["caminho no lugar da pasta", { folderId: "..\\Windows" }],
    ["barra na pasta", { folderId: "docs/../x" }],
    ["pasta com maiúscula", { folderId: "Docs" }],
    ["pasta vazia", { folderId: "" }],
    ["uuid inválido", { uploadId: "nao-e-uuid" }],
    ["uuid com maiúsculas", { uploadId: base.uploadId.toUpperCase() }],
    ["horário com letras", { timestamp: "17950000000xx" }],
    ["sha256 curto", { sha256: "abc" }],
    ["tamanho zero", { contentLength: "0" }],
    ["tamanho com zero à esquerda", { contentLength: "0100" }],
    ["tamanho acima do limite", { contentLength: String(LIMITS.maxUploadBytes + 1) }],
  ] as const)("recusa %s", (_nome, troca) => {
    const r = parseUploadHeaders(headersOf({ ...base, ...troca } as UploadFields));
    expect(r).toMatchObject({ ok: false, error: "invalid_field" });
  });

  it("aceita exatamente o limite de tamanho", () => {
    const r = parseUploadHeaders(headersOf({ ...base, contentLength: String(LIMITS.maxUploadBytes) }));
    expect(r.ok).toBe(true);
  });

  it.each(["image/heic", "image/svg+xml", "text/html", "image/jpeg; charset=utf-8", "IMAGE/JPEG"])(
    "recusa o tipo %s",
    (tipo) => {
      const h = { ...headersOf(), [HEADERS.contentType]: tipo };
      expect(parseUploadHeaders(h)).toMatchObject({ ok: false, error: "invalid_field", field: "content-type" });
    },
  );

  it("recusa cabeçalho faltando", () => {
    const h = { ...headersOf() };
    delete h[HEADERS.signature];
    expect(parseUploadHeaders(h)).toMatchObject({ ok: false, error: "missing_header", field: HEADERS.signature });
  });

  it("recusa cabeçalho repetido em vez de escolher um", () => {
    const h = { ...headersOf(), [HEADERS.folder]: ["shotfolder-docs", "outra"] };
    expect(parseUploadHeaders(h)).toMatchObject({ ok: false, error: "duplicate_header", field: HEADERS.folder });
  });

  it("lê os cabeçalhos da listagem de pastas", () => {
    const r = parseFoldersHeaders({
      [HEADERS.device]: "dev_TESTE_0001",
      [HEADERS.request]: "0a1b2c3d-4e5f-4a7b-9c8d-7e6f5a4b3c2d",
      [HEADERS.time]: "1795000000000",
      [HEADERS.signature]: "MEUCIQDassinaturafalsa==",
    });
    expect(r.ok).toBe(true);
  });
});

describe("janela de horário", () => {
  const agora = 1_795_000_000_000;
  it("aceita dentro da janela e na borda", () => {
    expect(isTimestampFresh(String(agora), agora)).toBe(true);
    expect(isTimestampFresh(String(agora - LIMITS.clockSkewMs), agora)).toBe(true);
    expect(isTimestampFresh(String(agora + LIMITS.clockSkewMs), agora)).toBe(true);
  });
  it("recusa fora da janela, para trás e para frente", () => {
    expect(isTimestampFresh(String(agora - LIMITS.clockSkewMs - 1), agora)).toBe(false);
    expect(isTimestampFresh(String(agora + LIMITS.clockSkewMs + 1), agora)).toBe(false);
  });
  it("recusa formato inválido", () => {
    expect(isTimestampFresh("abc", agora)).toBe(false);
  });
});
