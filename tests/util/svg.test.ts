import { describe, it, expect } from "vitest";
import { escapeXml, svgDataUri, iconButton, wrapLabel, textButton } from "../../src/util/svg";

describe("svg.escapeXml", () => {
  it("escapes all five XML entities", () => {
    expect(escapeXml(`& < > " '`)).toBe("&amp; &lt; &gt; &quot; &apos;");
  });

  it("leaves plain text alone", () => {
    expect(escapeXml("hello world 123")).toBe("hello world 123");
  });
});

describe("svg.svgDataUri", () => {
  it("returns a data: URI with URL-encoded content", () => {
    const uri = svgDataUri("<svg/>");
    expect(uri).toBe("data:image/svg+xml,%3Csvg%2F%3E");
  });
});

describe("svg.iconButton", () => {
  it("composes a 144×144 SVG with the given color and icon path", () => {
    const uri = iconButton("#ff0000", `<circle cx="72" cy="72" r="32" fill="white"/>`);
    expect(uri.startsWith("data:image/svg+xml,")).toBe(true);
    const decoded = decodeURIComponent(uri.slice("data:image/svg+xml,".length));
    expect(decoded).toContain('width="144"');
    expect(decoded).toContain('height="144"');
    expect(decoded).toContain('fill="#ff0000"');
    expect(decoded).toContain(`<circle cx="72" cy="72" r="32" fill="white"/>`);
  });

  it("escapes the color string to avoid SVG injection", () => {
    const uri = iconButton(`"/><script>x</script><foo color="`, `<g/>`);
    const decoded = decodeURIComponent(uri.slice("data:image/svg+xml,".length));
    expect(decoded).not.toContain("<script>");
    expect(decoded).toContain("&quot;");
  });
});

describe("wrapLabel", () => {
  it("breaks after hyphens", () => {
    expect(wrapLabel("preseem-airflow-PRS-751", 11, 3)).toEqual(["preseem-", "airflow-", "PRS-751"]);
  });

  it("leaves a short name on one line", () => {
    expect(wrapLabel("Code", 11, 3)).toEqual(["Code"]);
  });

  it("breaks at spaces and drops the space", () => {
    expect(wrapLabel("my project name", 11, 3)).toEqual(["my project", "name"]);
  });

  it("hard-splits a token longer than a line", () => {
    expect(wrapLabel("abcdefghijklmnopqrstuvwxyz", 11, 3)).toEqual(["abcdefghijk", "lmnopqrstuv", "wxyz"]);
  });

  it("ends the last line with an ellipsis when it runs past maxLines", () => {
    expect(wrapLabel("a".repeat(40), 11, 3)).toEqual(["aaaaaaaaaaa", "aaaaaaaaaaa", "aaaaaaaaaa…"]);
  });

  it("returns one empty line for an empty name", () => {
    expect(wrapLabel("", 11, 3)).toEqual([""]);
  });
});

describe("textButton", () => {
  const decode = (uri: string) => decodeURIComponent(uri.slice("data:image/svg+xml,".length));
  const texts = (svg: string) => [...svg.matchAll(/>([^<]*)<\/text>/g)].map((m) => m[1]);

  it("draws each line on a coloured key", () => {
    const svg = decode(textButton("#1f6feb", ["Permission?", "in terminal"]));
    expect(texts(svg)).toEqual(["Permission?", "in terminal"]);
    expect(svg).toContain("#1f6feb");
  });

  it("wraps a long line so no row is wider than the key", () => {
    const svg = decode(textButton("#000000", ["Working", "mcp__claude-in-chrome__browser_batch"]));
    expect(texts(svg).every((t) => t.length <= 11)).toBe(true);
    expect(texts(svg).length).toBeLessThanOrEqual(5);
  });

  it("escapes markup in a line", () => {
    expect(decode(textButton("#000000", ["a<b&c"]))).toContain("a&lt;b&amp;c");
  });
});
