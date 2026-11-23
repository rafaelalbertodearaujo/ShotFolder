/**
 * Notificação do Windows (toast) sem dependência externa: chama o PowerShell
 * do próprio Windows. Se falhar, a foto continua gravada; só não há aviso.
 */
import { spawn } from "node:child_process";

export type Notifier = (title: string, body: string) => void;

export const noopNotifier: Notifier = () => {};

const xmlEscape = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&apos;");

/** Identificador do PowerShell, para o Windows aceitar o toast sem instalar nada. */
const APP_ID = "{1AC14E77-02E7-4E5D-B744-2EB1AE5198B7}\\WindowsPowerShell\\v1.0\\powershell.exe";

export const windowsToast: Notifier = (title, body) => {
  const xml =
    `<toast><visual><binding template="ToastGeneric">` +
    `<text>${xmlEscape(title)}</text><text>${xmlEscape(body)}</text>` +
    `</binding></visual></toast>`;
  // O XML vai entre aspas simples do PowerShell: aspas simples viram duas.
  const script = [
    "[Windows.UI.Notifications.ToastNotificationManager, Windows.UI.Notifications, ContentType = WindowsRuntime] | Out-Null",
    "[Windows.Data.Xml.Dom.XmlDocument, Windows.Data.Xml.Dom.XmlDocument, ContentType = WindowsRuntime] | Out-Null",
    "$x = New-Object Windows.Data.Xml.Dom.XmlDocument",
    `$x.LoadXml('${xml.replace(/'/g, "''")}')`,
    `[Windows.UI.Notifications.ToastNotificationManager]::CreateToastNotifier('${APP_ID}').Show([Windows.UI.Notifications.ToastNotification]::new($x))`,
  ].join("; ");
  // -EncodedCommand: o texto vai em base64 (UTF-16), sem risco de o shell interpretar nada.
  const encoded = Buffer.from(script, "utf16le").toString("base64");
  try {
    const child = spawn(
      "powershell.exe",
      ["-NoProfile", "-NonInteractive", "-WindowStyle", "Hidden", "-EncodedCommand", encoded],
      { windowsHide: true, stdio: "ignore" },
    );
    child.on("error", () => {});
    child.unref();
  } catch {
    // sem notificação, segue o jogo
  }
};
