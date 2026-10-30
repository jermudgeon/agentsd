import streamDeck, { action, type KeyDownEvent } from "@elgato/streamdeck";
import { ManagedAction } from "./base";
import { iconButton } from "../util/svg";

@action({ UUID: "com.paultyng.agentsd.deny" })
export class DenyButton extends ManagedAction {
  override onKeyDown(_ev: KeyDownEvent): void {
    const id = this.manager?.resolveOldest(false);
    streamDeck.logger.info(id ? `Deny: answered session=${id}` : "Deny pressed: no request is held");
  }

  protected render(): void {
    const awaiting = !!this.manager?.waitingSession;
    const icon = iconButton(
      awaiting ? "#da3633" : "#555555",
      `<path d="M44 44 L100 100 M100 44 L44 100" stroke="white" stroke-width="10" stroke-linecap="round"/>`,
    );
    for (const act of this.actions) {
      act.setTitle("Deny");
      act.setImage(icon);
    }
  }
}
