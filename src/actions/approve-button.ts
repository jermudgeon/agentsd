import streamDeck, { action, type KeyDownEvent } from "@elgato/streamdeck";
import { ManagedAction } from "./base";
import { iconButton } from "../util/svg";

@action({ UUID: "com.paultyng.agentsd.approve" })
export class ApproveButton extends ManagedAction {
  override onKeyDown(_ev: KeyDownEvent): void {
    const id = this.manager?.resolveOldest(true);
    streamDeck.logger.info(id ? `Approve: answered session=${id}` : "Approve pressed: no request is held");
  }

  protected render(): void {
    const awaiting = !!this.manager?.waitingSession;
    const icon = iconButton(
      awaiting ? "#1a7f37" : "#555555",
      `<path d="M40 72 L62 94 L104 52" stroke="white" stroke-width="10" fill="none" stroke-linecap="round" stroke-linejoin="round"/>`,
    );
    for (const act of this.actions) {
      act.setTitle("Approve");
      act.setImage(icon);
    }
  }
}
