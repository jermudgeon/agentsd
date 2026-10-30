import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const UI = "com.paultyng.agentsd.sdPlugin/ui";

describe("usage settings page", () => {
  const html = readFileSync(`${UI}/usage.html`, "utf-8");

  it("loads no script, style, or other resource from a remote host", () => {
    expect(html).not.toMatch(/(?:src|href)\s*=\s*["']https?:/i);
  });

  it("ships the sdpi-components script it references", () => {
    const m = html.match(/<script[^>]+src\s*=\s*["']([^"']+)["']/i);
    expect(m).not.toBeNull();
    expect(existsSync(`${UI}/${m![1]}`)).toBe(true);
  });
});
