import { describe, expect, it } from "vitest";
import { redirectSystemPath } from "../src/app/+native-intent";
import { MAX_COMPARTILHADAS, selecionarImagens } from "../src/lib/share";

const img = (n: number, mimeType = "image/jpeg") => ({ path: `file:///cache/${n}.jpg`, mimeType });

describe("o que o Compartilhar aceita", () => {
  it("só imagens (inclusive HEIC), ignora o resto", () => {
    const r = selecionarImagens([img(1), img(2, "image/heic"), img(3, "application/pdf"), img(4, "text/plain"), img(5, "image/svg+xml")]);
    expect(r.aceitas.map((f) => f.path)).toEqual(["file:///cache/1.jpg", "file:///cache/2.jpg"]);
    expect(r.ignoradas).toBe(3);
  });

  it(`no máximo ${MAX_COMPARTILHADAS} por vez`, () => {
    const r = selecionarImagens(Array.from({ length: 13 }, (_, i) => img(i)));
    expect(r.aceitas).toHaveLength(MAX_COMPARTILHADAS);
    expect(r.excedentes).toBe(3);
  });

  it("nada compartilhado", () => {
    expect(selecionarImagens(null)).toEqual({ aceitas: [], ignoradas: 0, excedentes: 0 });
  });
});

describe("links que abrem o app", () => {
  it.each([
    ["shotfolder-app://foto", "/foto"],
    ["shotfolder-app://compartilhar?arquivo=/sdcard/segredo.pdf", "/compartilhar"],
    ["shotfolder-app://dataUrl=shotfolder-appShareKey", "/compartilhar"],
    ["/parear", "/"],
    ["shotfolder-app://parear?host=100.1.2.3", "/"],
    ["shotfolder-app://qualquer/coisa", "/"],
    ["::::", "/"],
  ])("%s → %s", (entrada, esperado) => {
    expect(redirectSystemPath({ path: entrada, initial: true })).toBe(esperado);
  });
});
