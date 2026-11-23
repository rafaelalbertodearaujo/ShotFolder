/** JPEG sintético com metadados, para testes (estrutura válida de segmentos). */
const seg = (marker: number, payload: Uint8Array) => {
  const len = payload.length + 2;
  return Uint8Array.from([0xff, marker, len >> 8, len & 0xff, ...payload]);
};
const txt = (s: string) => new TextEncoder().encode(s);

export const APP0 = seg(0xe0, txt("JFIF\0\x01\x01\0\0\x01\0\x01\0\0"));
export const APP1_EXIF = seg(0xe1, txt("Exif\0\0GPS -27.38,-51.61 SM-S911B 2026:11:23"));
export const APP2_ICC = seg(0xe2, txt("ICC_PROFILE\0perfil"));
export const COM = seg(0xfe, txt("comentario secreto"));
export const DQT = seg(0xdb, new Uint8Array(65).fill(1));
/** SOS + "dados da imagem" + EOI. Os dados contêm FF E1 de propósito (não é segmento). */
export const SCAN = Uint8Array.from([0xff, 0xda, 0x00, 0x04, 0x01, 0x02, 0x11, 0x22, 0xff, 0x00, 0xff, 0xe1, 0x33, 0xff, 0xd9]);

export function jpegCom(...partes: Uint8Array[]): Uint8Array {
  const total = 2 + partes.reduce((n, p) => n + p.length, 0);
  const out = new Uint8Array(total);
  out.set([0xff, 0xd8], 0);
  let off = 2;
  for (const p of partes) {
    out.set(p, off);
    off += p.length;
  }
  return out;
}
