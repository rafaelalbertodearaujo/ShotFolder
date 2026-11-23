import { describe, expect, it } from "vitest";
import { allExcept, firewallScript, intToIp, ipToInt } from "../src/firewall.js";

describe("faixas de IP", () => {
  it("ida e volta", () => {
    for (const ip of ["0.0.0.0", "100.64.0.1", "100.101.102.103", "255.255.255.255"]) expect(intToIp(ipToInt(ip))).toBe(ip);
  });
  it("todos menos o celular", () => {
    expect(allExcept("100.101.102.103")).toEqual(["0.0.0.0-100.101.102.102", "100.101.102.104-255.255.255.255"]);
    expect(allExcept("0.0.0.0")).toEqual(["0.0.0.1-255.255.255.255"]);
    expect(allExcept("255.255.255.255")).toEqual(["0.0.0.0-255.255.255.254"]);
  });
  it("recusa IP inválido", () => {
    expect(() => ipToInt("100.1.1")).toThrow();
    expect(() => ipToInt("100.1.1.256")).toThrow();
  });
});

describe("script do firewall", () => {
  const base = { phoneIp: "100.90.1.2", pcIp: "100.80.3.4", port: 47800, nodePath: "C:\\Program Files\\nodejs\\node.exe" };

  it("permite só o celular, só no IP do PC, só o node.exe; bloqueia o resto", () => {
    const s = firewallScript(base);
    expect(s).toContain("#Requires -RunAsAdministrator");
    expect(s).toMatch(/permitir celular' -Direction Inbound -Action Allow/);
    expect(s).toContain("-LocalPort 47800 -RemoteAddress '100.90.1.2' -LocalAddress '100.80.3.4'");
    expect(s).toContain("-Program 'C:\\Program Files\\nodejs\\node.exe'");
    expect(s).toMatch(/bloquear outros' -Direction Inbound -Action Block/);
    expect(s).toContain("@('0.0.0.0-100.90.1.1', '100.90.1.3-255.255.255.255')");
    // recria do zero: apaga as regras antigas do ShotFolder primeiro
    expect(s.indexOf("Remove-NetFirewallRule")).toBeLessThan(s.indexOf("New-NetFirewallRule"));
  });

  it("aspas simples no caminho não quebram o script", () => {
    expect(firewallScript({ ...base, nodePath: "C:\\it's\\node.exe" })).toContain("'C:\\it''s\\node.exe'");
  });

  it.each([
    ["celular fora do Tailscale", { phoneIp: "192.168.0.10" }],
    ["PC fora do Tailscale", { pcIp: "10.0.0.1" }],
    ["mesmo IP nos dois", { phoneIp: "100.80.3.4" }],
  ])("recusa %s", (_n, troca) => {
    expect(() => firewallScript({ ...base, ...troca })).toThrow();
  });
});
