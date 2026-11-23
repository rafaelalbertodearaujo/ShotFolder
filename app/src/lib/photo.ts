/**
 * Prepara a foto para envio: JPEG com no máximo 2048 px no lado maior, qualidade 85%
 * e sem metadados (EXIF/GPS). Tudo nos arquivos privados do app.
 */
import { File } from "expo-file-system";
import { ImageManipulator, SaveFormat } from "expo-image-manipulator";
import { stripJpegMetadata } from "./jpeg";

export const MAX_SIDE = 2048;
export const JPEG_QUALITY = 0.85;

export interface PreparedPhoto {
  /** Arquivo JPEG reduzido, para a prévia. Apague com `discardPhoto` depois. */
  uri: string;
  width: number;
  height: number;
  /** Bytes exatos que serão enviados (já sem metadados). */
  bytes: Uint8Array;
}

function apagar(uri: string): void {
  try {
    new File(uri).delete();
  } catch {
    // já não existe
  }
}

export async function preparePhoto(originalUri: string): Promise<PreparedPhoto> {
  try {
    // Reduz já na decodificação: a foto cheia (50 MP em alguns Samsung) nem entra na memória.
    const ctx = ImageManipulator.manipulate(originalUri, { maxWidth: MAX_SIDE, maxHeight: MAX_SIDE });
    const imagem = await ctx.renderAsync();
    const salvo = await imagem.saveAsync({ format: SaveFormat.JPEG, compress: JPEG_QUALITY });
    const bytes = stripJpegMetadata(await new File(salvo.uri).bytes());
    return { uri: salvo.uri, width: salvo.width, height: salvo.height, bytes };
  } finally {
    apagar(originalUri); // a foto original (com EXIF) não fica no celular
  }
}

export function discardPhoto(p: PreparedPhoto | null): void {
  if (p) apagar(p.uri);
}
