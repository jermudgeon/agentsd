import { action } from "@elgato/streamdeck";
import { ManagedAction } from "./base";
import { State } from "../types";
import { statusLines } from "../session-view";
import { textButton } from "../util/svg";

const AGENT_COLORS = ["#1f6feb", "#d29922", "#e16f24", "#da3633"];

function agentColor(count: number): string | null {
  if (count <= 0) return null;
  return AGENT_COLORS[Math.min(count - 1, AGENT_COLORS.length - 1)];
}

@action({ UUID: "com.paultyng.agentsd.status" })
export class StatusButton extends ManagedAction {
  protected render(): void {
    const session = this.manager?.foregroundSession;
    if (!session) {
      for (const act of this.actions) act.setTitle("—");
      return;
    }

    const queued = Math.max(0, (this.manager?.attentionQueue.length ?? 0) - 1);
    const lines = statusLines(session, queued);

    const errorColor = session.state === State.IDLE && session.lastError ? "#da3633" : null;
    const color = errorColor ?? agentColor(session.activeWork);

    for (const act of this.actions) {
      act.setTitle("");
      act.setImage(textButton(color ?? "#000000", lines));
    }
  }
}
