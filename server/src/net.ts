/** Faixa de IPs que o Tailscale usa (100.64.0.0/10, ou seja, 100.64.x.x a 100.127.x.x). */
export function isTailscaleIPv4(ip: string): boolean {
  const m = /^100\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(ip);
  if (!m) return false;
  const [a, b, c] = m.slice(1).map(Number) as [number, number, number];
  return a >= 64 && a <= 127 && b <= 255 && c <= 255;
}
