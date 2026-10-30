import { action, type KeyDownEvent } from "@elgato/streamdeck";
import { basename } from "node:path";
import { ManagedAction } from "./base";
import { State } from "../types";
import { escapeXml, svgDataUri, wrapLabel } from "../util/svg";
import { focusSessionTerminal } from "../util/terminal";

const STATE_COLORS: Record<State, string> = {
  [State.DISCONNECTED]: "#333333",
  [State.IDLE]: "#1a7f37",
  [State.PROCESSING]: "#1f6feb",
  [State.AWAITING_PERMISSION]: "#d29922",
  [State.AWAITING_ELICITATION]: "#8957e5",
};

@action({ UUID: "com.paultyng.agentsd.session" })
export class SessionButton extends ManagedAction {
  override onKeyDown(_ev: KeyDownEvent): void {
    const session = this.manager?.cycleSession(1);
    if (session?.pid) void focusSessionTerminal(session.pid);
  }

  protected render(): void {
    const session = this.manager?.activeSession;
    const title = session ? basename(session.cwd) : "No Session";
    const color = session ? STATE_COLORS[session.state] : STATE_COLORS[State.DISCONNECTED];
    const count = this.manager?.sessionCount ?? 0;
    const suffix = count > 1 ? `(${(this.manager?.activeIndex ?? 0) + 1}/${count})` : "";

    const lines = wrapLabel(title, 11, 3);
    const centerY = suffix ? 56 : 72;
    let textSvg = lines
      .map((line, i) =>
        `<text x="72" y="${centerY + (i - (lines.length - 1) / 2) * 24}" text-anchor="middle" dominant-baseline="middle" ` +
        `font-family="sans-serif" font-size="20" font-weight="bold" fill="white">${escapeXml(line)}</text>`)
      .join("");
    if (suffix) {
      textSvg +=
        `<text x="72" y="124" text-anchor="middle" dominant-baseline="middle" ` +
        `font-family="sans-serif" font-size="16" fill="white">${escapeXml(suffix)}</text>`;
    }

    const image = svgDataUri(
      `<svg xmlns="http://www.w3.org/2000/svg" width="144" height="144">` +
      `<rect width="144" height="144" rx="16" fill="${escapeXml(color)}"/>` +
      `${textSvg}</svg>`,
    );

    for (const act of this.actions) {
      act.setTitle("");
      act.setImage(image);
    }
  }
}
