import streamDeck, { action, type KeyDownEvent } from "@elgato/streamdeck";
import { ManagedAction } from "./base";
import { iconButton } from "../util/svg";

@action({ UUID: "com.paultyng.agentsd.always-allow" })
export class AlwaysAllowButton extends ManagedAction {
  override onKeyDown(_ev: KeyDownEvent): void {
    const id = this.manager?.resolveOldestAlwaysAllow();
    streamDeck.logger.info(id ? `Always Allow: answered session=${id}` : this.manager?.attentionQueue.length ? "Always Allow pressed: the oldest question is waiting in the terminal" : "Always Allow pressed: no request is held");
  }

  protected render(): void {
    const awaiting = !!this.manager?.waitingSession;
    const icon = iconButton(
      awaiting ? "#d29922" : "#555555",
      `<path d="M32 72 L48 88 L80 56" stroke="white" stroke-width="8" fill="none" stroke-linecap="round" stroke-linejoin="round"/>
       <path d="M64 72 L80 88 L112 56" stroke="white" stroke-width="8" fill="none" stroke-linecap="round" stroke-linejoin="round"/>`,
    );
    for (const act of this.actions) {
      act.setTitle("Always");
      act.setImage(icon);
    }
  }
}
