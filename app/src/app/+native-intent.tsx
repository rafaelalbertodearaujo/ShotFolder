/**
 * Links que abrem o app (shotfolder-app://...). Só três destinos são aceitos;
 * qualquer outra coisa cai na tela inicial. Nenhum parâmetro de link é usado pelas telas,
 * então um link externo não consegue escolher arquivo, pasta ou PC.
 */
const PERMITIDOS = new Set(["/", "/foto", "/compartilhar"]);

export function redirectSystemPath({ path }: { path: string; initial: boolean }): string {
  try {
    // Aviso de "compartilhar" da biblioteca expo-share-intent (formato dataUrl=...).
    if (path.includes("dataUrl=")) return "/compartilhar";
    // "shotfolder-app://foto?x=1" ou "/foto?x=1" → "/foto" (parâmetros são descartados).
    const semEsquema = path.replace(/^[a-z][a-z0-9+.-]*:\/\//i, "/");
    const rota = "/" + semEsquema.split(/[?#]/)[0]!.replace(/^\/+|\/+$/g, "");
    return PERMITIDOS.has(rota) ? rota : "/";
  } catch {
    return "/";
  }
}
