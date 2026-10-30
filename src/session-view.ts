import { State, type SessionState } from "./types";

export type WaitKind = "held" | "terminal" | "question";

type Waiting = Pick<SessionState, "state" | "pendingPermission" | "permissionInTerminal">;
type Described = Pick<SessionState, "state" | "currentTool" | "activeWork" | "lastError" | "permissionInTerminal">;

export const STATE_COLORS: Record<State, string> = {
  [State.DISCONNECTED]: "#333333",
  [State.IDLE]: "#1a7f37",
  [State.PROCESSING]: "#1f6feb",
  [State.AWAITING_PERMISSION]: "#d29922",
  [State.AWAITING_ELICITATION]: "#8957e5",
};

const ALERT_RED = "#da3633";

/** What a waiting session is waiting for, or null when it is not waiting. */
export function waitKind(s: Waiting): WaitKind | null {
  if (s.state === State.AWAITING_PERMISSION) return s.pendingPermission ? "held" : "terminal";
  if (s.state === State.AWAITING_ELICITATION) return "question";
  return null;
}

/** The text lines of the Status key, with a count of other sessions queued behind this one. */
export function statusLines(s: Described, queued: number): string[] {
  const lines: string[] = [];
  switch (s.state) {
    case State.PROCESSING:
      lines.push("Working");
      if (s.currentTool) lines.push(s.currentTool);
      break;
    case State.AWAITING_PERMISSION:
      lines.push("Permission?");
      if (s.permissionInTerminal) lines.push("in terminal");
      break;
    case State.AWAITING_ELICITATION:
      lines.push("Question?");
      break;
    case State.IDLE:
      lines.push(s.lastError ? "Error" : "Idle");
      break;
    default:
      lines.push(s.state);
  }
  if (s.activeWork > 0) lines.push("", `${s.activeWork} agent${s.activeWork > 1 ? "s" : ""}`);
  if (queued > 0) lines.push(`+${queued} queued`);
  return lines;
}

/** Colour, caption and flashing for the Session key. A wait the deck cannot answer flashes. */
export function sessionKeyView(a: {
  state: State;
  kind: WaitKind | null;
  queueLength: number;
  count: number;
  activeIndex: number;
  flashOn: boolean;
}): { color: string; suffix: string; flashing: boolean } {
  if (a.kind === null) {
    return { color: STATE_COLORS[a.state], suffix: a.count > 1 ? `(${a.activeIndex + 1}/${a.count})` : "", flashing: false };
  }
  const suffix = a.queueLength > 1 ? `1/${a.queueLength} waiting` : "waiting";
  const flashing = a.kind !== "held";
  return { color: flashing && a.flashOn ? ALERT_RED : STATE_COLORS[a.state], suffix, flashing };
}
