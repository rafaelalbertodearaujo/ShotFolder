import { describe, expect, it } from "vitest";
import { buildPairUri, PAIR_PATTERNS, pairCodeFromSha256Hex, parsePairUri } from "../src/index.js";
import { pairCode } from "../src/node.js";

const token = "A".repeat(20) + "b-_" + "9".repeat(20);

describe("URI do QR", () => {
  it("ida e volta", () => {
    const info = { host: "100.101.102.103", port: 47800, token };
    const uri = buildPairUri(info);
    expect(uri).toBe(`shotfolder://pair?v=1&host=100.101.102.103&port=47800&t=${token}`);
    expect(parsePairUri(uri)).toEqual(info);
  });

  it.each([
    ["outro esquema", `https://pair?v=1&host=100.1.1.1&port=47800&t=${token}`],
    ["versão desconhecida", `shotfolder://pair?v=2&host=100.1.1.1&port=47800&t=${token}`],
    ["host com nome", `shotfolder://pair?v=1&host=evil.com&port=47800&t=${token}`],
    ["octeto acima de 255", `shotfolder://pair?v=1&host=100.1.1.300&port=47800&t=${token}`],
    ["porta baixa", `shotfolder://pair?v=1&host=100.1.1.1&port=80&t=${token}`],
    ["token curto", "shotfolder://pair?v=1&host=100.1.1.1&port=47800&t=abc"],
    ["parâmetro extra", `shotfolder://pair?v=1&host=100.1.1.1&port=47800&t=${token}&x=1`],
  ])("recusa %s", (_n, uri) => {
    expect(parsePairUri(uri)).toBeNull();
  });
});

describe("código de confirmação", () => {
  it("tem 6 dígitos e é estável", () => {
    expect(pairCodeFromSha256Hex("00000000" + "f".repeat(56))).toBe("000000");
    expect(pairCodeFromSha256Hex("ffffffff" + "0".repeat(56))).toBe(String(0xffffffff % 1_000_000).padStart(6, "0"));
    expect(pairCode(token, "chave")).toMatch(/^\d{6}$/);
    expect(pairCode(token, "chave")).toBe(pairCode(token, "chave"));
  });
  it("muda se a chave pública muda", () => {
    expect(pairCode(token, "chave-a")).not.toBe(pairCode(token, "chave-b"));
  });
});

describe("nome do aparelho", () => {
  it("aceita nomes comuns e recusa controle/HTML", () => {
    expect(PAIR_PATTERNS.deviceName.test("Galaxy S23 (Rafa)")).toBe(true);
    expect(PAIR_PATTERNS.deviceName.test("Celular do João")).toBe(true);
    expect(PAIR_PATTERNS.deviceName.test("x\ny")).toBe(false);
    expect(PAIR_PATTERNS.deviceName.test("<script>")).toBe(false);
    expect(PAIR_PATTERNS.deviceName.test("")).toBe(false);
  });
});
