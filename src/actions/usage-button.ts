import { action, SingletonAction, type KeyDownEvent, type WillAppearEvent, type WillDisappearEvent, type DidReceiveSettingsEvent } from "@elgato/streamdeck";
import { homedir } from "node:os";
import { KeyOrder } from "../usage/key-order";
import { nextMetric, pickAccount, usageDisplay, usageImage, type Metric } from "../usage/display";
import type { UsagePoller } from "../usage/poller";

type UsageSettings = { configDir?: string; label?: string };

const REFRESH_MS = 30_000;

let _poller: UsagePoller | undefined;

export function setUsagePoller(p: UsagePoller): void {
  _poller = p;
}

@action({ UUID: "com.paultyng.agentsd.usage" })
export class UsageButton extends SingletonAction<UsageSettings> {
  private readonly order = new KeyOrder();
  private readonly settings = new Map<string, UsageSettings>();
  private readonly metrics = new Map<string, Metric>();
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
    this.metrics.delete(ev.action.id);
    if (this.order.isEmpty() && this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  override onDidReceiveSettings(ev: DidReceiveSettingsEvent<UsageSettings>): void {
    this.settings.set(ev.action.id, ev.payload.settings);
    this.render();
  }

  override onKeyDown(ev: KeyDownEvent<UsageSettings>): void {
    this.metrics.set(ev.action.id, nextMetric(this.metrics.get(ev.action.id) ?? "fiveHour"));
    this.render();
  }

  private render(): void {
    const accounts = _poller?.accounts() ?? [];
    const unbound = this.order.ids().filter((id) => !this.settings.get(id)?.configDir);
    const now = Date.now();
    for (const act of this.actions) {
      if (!act.isKey()) continue;
      const s = this.settings.get(act.id) ?? {};
      const account = pickAccount(accounts, s.configDir, unbound.indexOf(act.id), homedir());
      const label = s.label || account?.label || "usage";
      const d = usageDisplay(label, this.metrics.get(act.id) ?? "fiveHour", account, now);
      void act.setImage(usageImage(d));
    }
  }
}
