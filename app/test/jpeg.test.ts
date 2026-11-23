import { describe, expect, it } from "vitest";
import { hasJpegMetadata, isJpeg, stripJpegMetadata } from "../src/lib/jpeg";
import { APP0, APP1_EXIF, APP2_ICC, COM, DQT, jpegCom, SCAN } from "./jpeg-fixture";

const contem = (b: Uint8Array, s: string) => Buffer.from(b).includes(Buffer.from(s));

describe("remoção de metadados do JPEG", () => {
  it("tira EXIF (GPS, modelo, data) e comentário; mantém JFIF, ICC e a imagem", () => {
    const original = jpegCom(APP0, APP1_EXIF, APP2_ICC, COM, DQT, SCAN);
    expect(hasJpegMetadata(original)).toBe(true);
    const limpo = stripJpegMetadata(original);
    expect(hasJpegMetadata(limpo)).toBe(false);
    expect(contem(limpo, "GPS")).toBe(false);
    expect(contem(limpo, "SM-S911B")).toBe(false);
    expect(contem(limpo, "comentario")).toBe(false);
    expect(Array.from(limpo)).toEqual(Array.from(jpegCom(APP0, APP2_ICC, DQT, SCAN)));
  });

  it("não mexe em JPEG que já está limpo", () => {
    const limpo = jpegCom(APP0, DQT, SCAN);
    expect(Array.from(stripJpegMetadata(limpo))).toEqual(Array.from(limpo));
  });

  it("não confunde bytes FF E1 dentro da imagem com segmento", () => {
    const limpo = stripJpegMetadata(jpegCom(APP0, DQT, SCAN));
    expect(limpo.subarray(limpo.length - SCAN.length)).toEqual(SCAN);
  });

  it("recusa arquivo que não é JPEG ou está truncado", () => {
    expect(isJpeg(new TextEncoder().encode("<html>"))).toBe(false);
    expect(() => stripJpegMetadata(new TextEncoder().encode("<html>"))).toThrow();
    const truncado = jpegCom(APP0, APP1_EXIF).subarray(0, 12);
    expect(() => stripJpegMetadata(truncado)).toThrow();
  });
});
