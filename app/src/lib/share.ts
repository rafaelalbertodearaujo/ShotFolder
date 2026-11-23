/**
 * Regras do "Compartilhar" (sem nada nativo, para testar no Node).
 * O que chega de outro app é entrada externa: só imagens, no máximo 10 por vez,
 * e nada é enviado sem você confirmar a pasta na tela.
 */

export const MAX_COMPARTILHADAS = 10;
const TIPOS = new Set(["image/jpeg", "image/png", "image/webp", "image/heic", "image/heif"]);

export interface ArquivoCompartilhado {
  path: string;
  mimeType: string;
  fileName?: string | null;
  size?: number | null;
}

export interface Selecao {
  aceitas: ArquivoCompartilhado[];
  /** Quantas foram ignoradas por não serem imagem aceita. */
  ignoradas: number;
  /** Quantas passaram do limite. */
  excedentes: number;
}

export function selecionarImagens(files: ArquivoCompartilhado[] | null | undefined): Selecao {
  const imagens = (files ?? []).filter((f) => TIPOS.has((f.mimeType ?? "").toLowerCase()) && typeof f.path === "string");
  return {
    aceitas: imagens.slice(0, MAX_COMPARTILHADAS),
    ignoradas: (files?.length ?? 0) - imagens.length,
    excedentes: Math.max(0, imagens.length - MAX_COMPARTILHADAS),
  };
}
