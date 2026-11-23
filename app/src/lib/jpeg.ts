/**
 * Remove metadados de um JPEG sem decodificar a imagem.
 *
 * Por quê: o EXIF pode levar a localização (GPS), o modelo do aparelho e a data.
 * O reencode do expo-image-manipulator normalmente já não copia o EXIF, mas isso não
 * está documentado — então o app garante a remoção aqui, de forma verificável em teste.
 *
 * Remove: APP1 (EXIF e XMP), APP13 (IPTC/Photoshop) e COM (comentários).
 * Mantém: APP0 (JFIF), APP2 (perfil de cor ICC) e todo o resto da imagem.
 */

const SOI = 0xd8;
const SOS = 0xda;
const EOI = 0xd9;
const REMOVER = new Set([0xe1, 0xed, 0xfe]);

export function isJpeg(b: Uint8Array): boolean {
  return b.length >= 3 && b[0] === 0xff && b[1] === SOI && b[2] === 0xff;
}

/** Devolve um novo JPEG sem os segmentos de metadados. Lança erro se o arquivo estiver malformado. */
export function stripJpegMetadata(b: Uint8Array): Uint8Array {
  if (!isJpeg(b)) throw new Error("Não é um JPEG.");
  const partes: Uint8Array[] = [b.subarray(0, 2)];
  let i = 2;
  while (i < b.length) {
    if (b[i] !== 0xff) throw new Error("JPEG malformado.");
    const marker = b[i + 1];
    if (marker === undefined) throw new Error("JPEG truncado.");
    if (marker === 0xff) {
      i += 1; // preenchimento
      continue;
    }
    if (marker === SOS || marker === EOI) {
      // Daqui em diante são os dados da imagem: copia tudo.
      partes.push(b.subarray(i));
      break;
    }
    // Marcadores sem tamanho (RSTn, TEM).
    if ((marker >= 0xd0 && marker <= 0xd7) || marker === 0x01) {
      partes.push(b.subarray(i, i + 2));
      i += 2;
      continue;
    }
    const hi = b[i + 2];
    const lo = b[i + 3];
    if (hi === undefined || lo === undefined) throw new Error("JPEG truncado.");
    const len = (hi << 8) | lo;
    if (len < 2 || i + 2 + len > b.length) throw new Error("Segmento JPEG inválido.");
    if (!REMOVER.has(marker)) partes.push(b.subarray(i, i + 2 + len));
    i += 2 + len;
  }
  const total = partes.reduce((n, p) => n + p.length, 0);
  const out = new Uint8Array(total);
  let off = 0;
  for (const p of partes) {
    out.set(p, off);
    off += p.length;
  }
  return out;
}

/** Algum segmento de metadados (APP1/APP13/COM) antes da imagem? Usado em testes e como checagem final. */
export function hasJpegMetadata(b: Uint8Array): boolean {
  if (!isJpeg(b)) return false;
  let i = 2;
  while (i + 3 < b.length && b[i] === 0xff) {
    const marker = b[i + 1]!;
    if (marker === SOS || marker === EOI) return false;
    if (REMOVER.has(marker)) return true;
    if ((marker >= 0xd0 && marker <= 0xd7) || marker === 0x01 || marker === 0xff) {
      i += marker === 0xff ? 1 : 2;
      continue;
    }
    i += 2 + ((b[i + 2]! << 8) | b[i + 3]!);
  }
  return false;
}
