import streamDeck from "@elgato/streamdeck";
import { homedir } from "node:os";

import { HookServer } from "./hook-server";
import { SessionManager } from "./session-manager";
import { setManager } from "./actions/base";

import { AlwaysAllowButton } from "./actions/always-allow-button";
import { ApproveButton } from "./actions/approve-button";
import { DenyButton } from "./actions/deny-button";
import { FocusButton } from "./actions/focus-button";
import { ModeButton } from "./actions/mode-button";
import { SessionButton } from "./actions/session-button";
import { SessionDial } from "./actions/session-dial";
import { StatusButton } from "./actions/status-button";
import { StopButton } from "./actions/stop-button";
import { setUsagePoller, UsageButton } from "./actions/usage-button";

import { fetchUsage } from "./usage/api";
import { readCredential } from "./usage/credentials";
import { UsagePoller } from "./usage/poller";

// Global error handlers — prevent silent crashes
process.on("uncaughtException", (err) => {
  streamDeck.logger.error(`Uncaught exception: ${err}`);
});
process.on("unhandledRejection", (err) => {
  streamDeck.logger.error(`Unhandled rejection: ${err}`);
});

const sessionManager = new SessionManager();
const hookServer = new HookServer(sessionManager);

const usagePoller = new UsagePoller({
  home: homedir(),
  now: Date.now,
  readCredential: (service) => readCredential(service),
  fetchUsage: (token) => fetchUsage(token),
  loadAccounts: async () => {
    const saved = await streamDeck.settings.getGlobalSettings<{ usageAccounts?: string[] }>();
    return Array.isArray(saved.usageAccounts) ? saved.usageAccounts : [];
  },
  saveAccounts: async (dirs) => {
    const saved = await streamDeck.settings.getGlobalSettings();
    await streamDeck.settings.setGlobalSettings({ ...saved, usageAccounts: dirs });
  },
});
sessionManager.on("configDirSeen", (dir: string) => usagePoller.noteConfigDir(dir));
setUsagePoller(usagePoller);

// Wire manager into all managed actions (single setter replaces per-action setters)
setManager(sessionManager);

// Register actions
streamDeck.actions.registerAction(new SessionButton());
streamDeck.actions.registerAction(new ModeButton());
streamDeck.actions.registerAction(new StatusButton());
streamDeck.actions.registerAction(new StopButton());
streamDeck.actions.registerAction(new ApproveButton());
streamDeck.actions.registerAction(new AlwaysAllowButton());
streamDeck.actions.registerAction(new DenyButton());
streamDeck.actions.registerAction(new FocusButton());
streamDeck.actions.registerAction(new SessionDial());
streamDeck.actions.registerAction(new UsageButton());

streamDeck.logger.setLevel("info");

// Start hook server
hookServer.start().then(() => {
  streamDeck.logger.info("Hook server listening on :9200");
  return usagePoller.start();
}).catch((err) => {
  streamDeck.logger.error(`Failed to start hook server: ${err}`);
});

sessionManager.start();

// Graceful shutdown
async function shutdown(): Promise<void> {
  streamDeck.logger.info("Shutting down...");
  sessionManager.stop();
  usagePoller.stop();
  await hookServer.stop();
}

process.on("SIGTERM", () => { shutdown(); });
process.on("SIGINT", () => { shutdown(); });

// Connect to Stream Deck
streamDeck.connect();
