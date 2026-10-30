export function escapeXml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&apos;");
}

export function svgDataUri(svg: string): string {
  return `data:image/svg+xml,${encodeURIComponent(svg)}`;
}

/** Render a 144×144 button icon with a colored background and an SVG icon path. */
export function iconButton(color: string, iconPath: string): string {
  return svgDataUri(
    `<svg xmlns="http://www.w3.org/2000/svg" width="144" height="144">` +
    `<rect width="144" height="144" rx="16" fill="${escapeXml(color)}"/>` +
    `${iconPath}</svg>`,
  );
}

/**
 * Split a label into at most maxLines lines of maxChars, breaking after - _ / . and at spaces.
 * A token longer than a line is hard-split; overflow past maxLines ends the last line with an ellipsis.
 */
export function wrapLabel(text: string, maxChars: number, maxLines: number): string[] {
  const lines: string[] = [];
  let cur = "";
  for (let tok of text.split(/(?<=[-_/.])|\s+/).filter(Boolean)) {
    let sep = cur && !/[-_/.]$/.test(cur) ? " " : "";
    if (cur && cur.length + sep.length + tok.length > maxChars) {
      lines.push(cur);
      cur = "";
      sep = "";
    }
    while (cur.length + sep.length + tok.length > maxChars && !cur) {
      lines.push(tok.slice(0, maxChars));
      tok = tok.slice(maxChars);
      if (!tok) break;
    }
    cur += sep + tok;
  }
  if (cur || lines.length === 0) lines.push(cur);
  if (lines.length > maxLines) {
    lines.length = maxLines;
    lines[maxLines - 1] = lines[maxLines - 1].slice(0, maxChars - 1) + "…";
  }
  return lines;
}

const KEY_CHARS = 11;
const MAX_ROWS = 5;

/** A key with centred white text. Each line wraps to the key width; at most five rows are drawn. */
export function textButton(color: string, lines: string[]): string {
  const rows = lines.flatMap((l) => wrapLabel(l, KEY_CHARS, 2)).slice(0, MAX_ROWS);
  const body = rows
    .map((row, i) =>
      row === ""
        ? ""
        : `<text x="72" y="${72 + (i - (rows.length - 1) / 2) * 24}" text-anchor="middle" dominant-baseline="middle" ` +
          `font-family="sans-serif" font-size="20" font-weight="bold" fill="white">${escapeXml(row)}</text>`)
    .join("");
  return iconButton(color, body);
}
