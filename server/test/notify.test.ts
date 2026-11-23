import { describe, expect, it } from "vitest";
import { buildToastXml } from "../src/notify.js";

describe("notificação", () => {
  const pasta = "C:\\Users\\Rafael\\Área de Trabalho\\Prints & Docs";
  const foto = `${pasta}\\2026-11-23_153012_a1b2.jpg`;

  it("clicar abre a pasta; botões abrem a foto e a pasta", () => {
    const xml = buildToastXml("Foto recebida", "x.jpg → Prints", { folderPath: pasta, filePath: foto });
    expect(xml).toMatch(/^<toast activationType="protocol" launch="file:\/\/\/C:\/Users\/Rafael\/%C3%81rea%20de%20Trabalho\/Prints%20&amp;%20Docs"/);
    expect(xml).toContain('<action content="Ver foto" activationType="protocol" arguments="file:///C:/Users/Rafael/%C3%81rea%20de%20Trabalho/Prints%20&amp;%20Docs/2026-11-23_153012_a1b2.jpg"/>');
    expect(xml).toContain('<action content="Abrir pasta"');
  });

  it("texto com caracteres especiais não quebra o XML", () => {
    const xml = buildToastXml("Foto <recebida>", `aspas " e ' & mais`);
    expect(xml).toContain("<text>Foto &lt;recebida&gt;</text>");
    expect(xml).toContain("<text>aspas &quot; e &apos; &amp; mais</text>");
    expect(xml).not.toContain("<actions>");
  });
});
