import { action, type KeyDownEvent } from "@elgato/streamdeck";
import { basename } from "node:path";
import { ManagedAction } from "./base";
import { sessionKeyView, STATE_COLORS, waitKind } from "../session-view";
import { State } from "../types";
import { escapeXml, svgDataUri, wrapLabel } from "../util/svg";
import { focusSessionTerminal } from "../util/terminal";

const FLASH_MS = 600;

@action({ UUID: "com.paultyng.agentsd.session" })
export class SessionButton extends ManagedAction {
  private flashOn = false;
  private flashTimer: ReturnType<typeof setInterval> | null = null;

  /** Raises the oldest waiting session's terminal; with nothing waiting, cycles to the next session. */
  override onKeyDown(_ev: KeyDownEvent): void {
    const session = this.manager?.attentionQueue[0] ?? this.manager?.cycleSession(1);
    if (session?.pid) void focusSessionTerminal(session.pid);
  }

  protected render(): void {
    const session = this.manager?.foregroundSession;
    const title = session ? basename(session.cwd) : "No Session";
    const view = session
      ? sessionKeyView({
          state: session.state,
          kind: waitKind(session),
          queueLength: this.manager?.attentionQueue.length ?? 0,
          count: this.manager?.sessionCount ?? 0,
          activeIndex: this.manager?.activeIndex ?? 0,
          flashOn: this.flashOn,
        })
      : { color: STATE_COLORS[State.DISCONNECTED], suffix: "", flashing: false };
    this.setFlashing(view.flashing);

    const lines = wrapLabel(title, 11, 3);
    const centerY = view.suffix ? 56 : 72;
    let textSvg = lines
      .map((line, i) =>
        `<text x="72" y="${centerY + (i - (lines.length - 1) / 2) * 24}" text-anchor="middle" dominant-baseline="middle" ` +
        `font-family="sans-serif" font-size="20" font-weight="bold" fill="white">${escapeXml(line)}</text>`)
      .join("");
    if (view.suffix) {
      textSvg +=
        `<text x="72" y="124" text-anchor="middle" dominant-baseline="middle" ` +
        `font-family="sans-serif" font-size="16" fill="white">${escapeXml(view.suffix)}</text>`;
    }

    const image = svgDataUri(
      `<svg xmlns="http://www.w3.org/2000/svg" width="144" height="144">` +
      `<rect width="144" height="144" rx="16" fill="${escapeXml(view.color)}"/>` +
      `${textSvg}</svg>`,
    );

    for (const act of this.actions) {
      act.setTitle("");
      act.setImage(image);
    }
  }

  private setFlashing(on: boolean): void {
    if (on && !this.flashTimer) {
      this.flashTimer = setInterval(() => {
        this.flashOn = !this.flashOn;
        this.render();
      }, FLASH_MS);
    } else if (!on && this.flashTimer) {
      clearInterval(this.flashTimer);
      this.flashTimer = null;
      this.flashOn = false;
    }
  }
}
