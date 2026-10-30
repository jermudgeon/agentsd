import { homedir } from "node:os";
import { action, SingletonAction, type DidReceiveSettingsEvent, type WillAppearEvent, type WillDisappearEvent } from "@elgato/streamdeck";
import { autoSlot, pickAccount, usageDisplay, usageImage, type WindowKey } from "../usage/display";
import { KeyOrder } from "../usage/key-order";
import type { UsagePoller } from "../usage/poller";

type UsageSettings = { configDir?: string; label?: string; window?: WindowKey };

const REFRESH_MS = 30_000;

let _poller: UsagePoller | undefined;

export function setUsagePoller(p: UsagePoller): void {
  _poller = p;
}

@action({ UUID: "com.paultyng.agentsd.usage" })
export class UsageButton extends SingletonAction<UsageSettings> {
  private readonly order = new KeyOrder();
  private readonly settings = new Map<string, UsageSettings>();
  private timer: ReturnType<typeof setInterval> | null = null;
  private bound = false;

  override onWillAppear(ev: WillAppearEvent<UsageSettings>): void {
    this.order.add(ev.action.id);
    this.settings.set(ev.action.id, ev.payload.settings);
    if (!this.bound && _poller) {
      _poller.on("updated", () => this.render());
      this.bound = true;
    }
    this.timer ??= setInterval(() => this.render(), REFRESH_MS);
    this.render();
  }

  override onWillDisappear(ev: WillDisappearEvent<UsageSettings>): void {
    this.order.remove(ev.action.id);
    this.settings.delete(ev.action.id);
    if (this.order.isEmpty() && this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  override onDidReceiveSettings(ev: DidReceiveSettingsEvent<UsageSettings>): void {
    this.settings.set(ev.action.id, ev.payload.settings);
    this.render();
  }

  private render(): void {
    const accounts = _poller?.accounts() ?? [];
    const unbound = this.order.ids().filter((id) => !this.settings.get(id)?.configDir);
    const now = Date.now();
    for (const act of this.actions) {
      if (!act.isKey()) continue;
      const s = this.settings.get(act.id) ?? {};
      const slot = autoSlot(unbound.indexOf(act.id));
      const account = pickAccount(accounts, s.configDir, slot.accountIndex, homedir());
      const window = s.window ?? (s.configDir ? "fiveHour" : slot.window);
      const d = usageDisplay(s.label || account?.label || "usage", window, account, now);
      void act.setImage(usageImage(d));
    }
  }
}
