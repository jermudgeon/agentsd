import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { IncomingMessage, ServerResponse } from "node:http";
import { SessionManager } from "../src/session-manager";
import { State, type HookEventName, type PendingPermission } from "../src/types";

const SESSION_A = "sess-aaaa-1111";
const SESSION_B = "sess-bbbb-2222";

function makePendingPermission(toolName = "Bash"): PendingPermission {
  const res = {
    writableEnded: false,
    writeHead: vi.fn(),
    end: vi.fn(function (this: any) {
      this.writableEnded = true;
    }),
  } as unknown as ServerResponse;
  const req = {} as IncomingMessage;
  return {
    req,
    res,
    toolName,
    timer: setTimeout(() => {}, 0),
  };
}

function startedManager() {
  const m = new SessionManager();
  m.start();
  return m;
}

describe("SessionManager state transitions", () => {
  let m: SessionManager;
  afterEach(() => m?.stop());

  it("auto-creates a session on first event with IDLE state, then transitions to PROCESSING", () => {
    m = new SessionManager();
    const s = m.handleEvent("PreToolUse", { session_id: SESSION_A, tool_name: "Bash" });
    expect(s?.state).toBe(State.PROCESSING);
    expect(s?.currentTool).toBe("Bash");
    expect(m.sessionCount).toBe(1);
  });

  it("SessionStart → IDLE, PreToolUse → PROCESSING, Stop → IDLE", () => {
    m = new SessionManager();
    m.handleEvent("SessionStart", { session_id: SESSION_A });
    expect(m.activeSession?.state).toBe(State.IDLE);

    m.handleEvent("PreToolUse", { session_id: SESSION_A, tool_name: "Read" });
    expect(m.activeSession?.state).toBe(State.PROCESSING);
    expect(m.activeSession?.currentTool).toBe("Read");

    m.handleEvent("PostToolUse", { session_id: SESSION_A });
    expect(m.activeSession?.state).toBe(State.PROCESSING);
    expect(m.activeSession?.currentTool).toBeNull();

    m.handleEvent("Stop", { session_id: SESSION_A });
    expect(m.activeSession?.state).toBe(State.IDLE);
  });

  it("PermissionRequest → AWAITING_PERMISSION, tool events do not kick out while permission held", () => {
    m = new SessionManager();
    m.handleEvent("SessionStart", { session_id: SESSION_A });
    m.handleEvent("PermissionRequest", { session_id: SESSION_A });
    m.setPendingPermission(SESSION_A, makePendingPermission());
    expect(m.activeSession?.state).toBe(State.AWAITING_PERMISSION);

    // PreToolUse should NOT transition the session out of AWAITING_PERMISSION
    m.handleEvent("PreToolUse", { session_id: SESSION_A, tool_name: "Bash" });
    expect(m.activeSession?.state).toBe(State.AWAITING_PERMISSION);
  });

  it("PostToolUse moves AWAITING_PERMISSION → PROCESSING when there is no plugin-held pending permission (terminal approval)", () => {
    m = new SessionManager();
    m.handleEvent("SessionStart", { session_id: SESSION_A });
    m.handleEvent("PermissionRequest", { session_id: SESSION_A });
    // No setPendingPermission call: simulates user approving in terminal
    expect(m.activeSession?.state).toBe(State.AWAITING_PERMISSION);

    m.handleEvent("PostToolUse", { session_id: SESSION_A });
    expect(m.activeSession?.state).toBe(State.PROCESSING);
  });

  it("SessionEnd removes the session and emits a final sessionUpdated event", () => {
    m = new SessionManager();
    m.handleEvent("SessionStart", { session_id: SESSION_A });
    expect(m.sessionCount).toBe(1);

    const updates: Array<HookEventName> = [];
    m.on("sessionUpdated", (_s, e) => updates.push(e));
    m.handleEvent("SessionEnd", { session_id: SESSION_A });

    expect(m.sessionCount).toBe(0);
    expect(updates.at(-1)).toBe("SessionEnd");
  });

  it("Elicitation auto-foregrounds the session", () => {
    m = new SessionManager();
    m.handleEvent("SessionStart", { session_id: SESSION_A });
    m.handleEvent("SessionStart", { session_id: SESSION_B });
    expect(m.activeSession?.id).toBe(SESSION_A);

    m.handleEvent("Elicitation", { session_id: SESSION_B });
    expect(m.activeSession?.id).toBe(SESSION_B);
    expect(m.activeSession?.state).toBe(State.AWAITING_ELICITATION);
  });

  it("StopFailure records lastError and returns to IDLE", () => {
    m = new SessionManager();
    m.handleEvent("SessionStart", { session_id: SESSION_A });
    m.handleEvent("PreToolUse", { session_id: SESSION_A, tool_name: "Bash" });
    m.handleEvent("StopFailure", { session_id: SESSION_A, error: "ENOENT" });
    expect(m.activeSession?.state).toBe(State.IDLE);
    expect(m.activeSession?.lastError).toBe("ENOENT");
  });

  it("PostToolUseFailure records lastError without changing PROCESSING state", () => {
    m = new SessionManager();
    m.handleEvent("SessionStart", { session_id: SESSION_A });
    m.handleEvent("PreToolUse", { session_id: SESSION_A, tool_name: "Bash" });
    m.handleEvent("PostToolUseFailure", { session_id: SESSION_A, error: "exit 1" });
    expect(m.activeSession?.state).toBe(State.PROCESSING);
    expect(m.activeSession?.lastError).toBe("exit 1");
    expect(m.activeSession?.currentTool).toBeNull();
  });
});

describe("SessionManager active work counter", () => {
  let m: SessionManager;
  afterEach(() => m?.stop());

  it("SubagentStart and TaskCreated increment, SubagentStop and TaskCompleted decrement", () => {
    m = new SessionManager();
    m.handleEvent("SessionStart", { session_id: SESSION_A });

    m.handleEvent("SubagentStart", { session_id: SESSION_A });
    m.handleEvent("TaskCreated", { session_id: SESSION_A });
    expect(m.activeSession?.activeWork).toBe(2);

    m.handleEvent("SubagentStop", { session_id: SESSION_A });
    expect(m.activeSession?.activeWork).toBe(1);

    m.handleEvent("TaskCompleted", { session_id: SESSION_A });
    expect(m.activeSession?.activeWork).toBe(0);
  });

  it("never drops below zero", () => {
    m = new SessionManager();
    m.handleEvent("SessionStart", { session_id: SESSION_A });
    m.handleEvent("SubagentStop", { session_id: SESSION_A });
    expect(m.activeSession?.activeWork).toBe(0);
  });
});

describe("SessionManager permission queue", () => {
  let m: SessionManager;
  afterEach(() => m?.stop());

  describe("answering the oldest held request", () => {
    const sent = (p: PendingPermission) => JSON.parse((p.res.end as ReturnType<typeof vi.fn>).mock.calls[0][0]);

    /** A holds a request; B is the active session (as after cycling with the Session key). */
    function twoSessions() {
      m = new SessionManager();
      for (const id of [SESSION_A, SESSION_B]) {
        m.handleEvent("SessionStart", { session_id: id });
      }
      m.handleEvent("PermissionRequest", { session_id: SESSION_A });
      const pendA = makePendingPermission();
      m.setPendingPermission(SESSION_A, pendA);
      m.focusSession(SESSION_B);
      expect(m.activeSession?.id).toBe(SESSION_B);
      return pendA;
    }

    it("waitingSession is the session holding a request, even when another is active", () => {
      twoSessions();
      expect(m.waitingSession?.id).toBe(SESSION_A);
    });

    it("waitingSession is undefined when nothing is held", () => {
      m = new SessionManager();
      m.handleEvent("SessionStart", { session_id: SESSION_A });
      expect(m.waitingSession).toBeUndefined();
    });

    it("resolveOldest(true) allows the held request and returns its session id", () => {
      const pendA = twoSessions();
      expect(m.resolveOldest(true)).toBe(SESSION_A);
      expect(sent(pendA).hookSpecificOutput.decision.behavior).toBe("allow");
      expect(m.waitingSession).toBeUndefined();
    });

    it("resolveOldest(false) denies it", () => {
      const pendA = twoSessions();
      expect(m.resolveOldest(false)).toBe(SESSION_A);
      expect(sent(pendA).hookSpecificOutput.decision.behavior).toBe("deny");
    });

    it("resolveOldestAlwaysAllow allows it and adds a session rule", () => {
      const pendA = twoSessions();
      expect(m.resolveOldestAlwaysAllow()).toBe(SESSION_A);
      const decision = sent(pendA).hookSpecificOutput.decision;
      expect(decision.behavior).toBe("allow");
      expect(decision.updatedPermissions[0].destination).toBe("session");
    });

    it("returns null when nothing is held, including a prompt already handed to the terminal", () => {
      m = new SessionManager();
      m.handleEvent("SessionStart", { session_id: SESSION_A });
      m.handleEvent("PermissionRequest", { session_id: SESSION_A });
      m.setPendingPermission(SESSION_A, makePendingPermission());
      m.clearPendingPermissionById(SESSION_A);
      expect(m.resolveOldest(true)).toBeNull();
      expect(m.resolveOldestAlwaysAllow()).toBeNull();
    });

    it("moves on to the next held request after the first is answered", () => {
      twoSessions();
      m.handleEvent("PermissionRequest", { session_id: SESSION_B });
      m.setPendingPermission(SESSION_B, makePendingPermission());
      expect(m.resolveOldest(true)).toBe(SESSION_A);
      expect(m.waitingSession?.id).toBe(SESSION_B);
    });
  });

  describe("attention queue", () => {
    beforeEach(() => vi.useFakeTimers({ toFake: ["Date"] }));
    afterEach(() => vi.useRealTimers());

    const SESSION_C = "sess-cccc-3333";
    const at = (ms: number) => vi.setSystemTime(ms);

    function threeAsking() {
      m = new SessionManager();
      for (const id of [SESSION_A, SESSION_B, SESSION_C]) m.handleEvent("SessionStart", { session_id: id });
      at(1000);
      m.handleEvent("PermissionRequest", { session_id: SESSION_A });
      m.setPendingPermission(SESSION_A, makePendingPermission());
      at(2000);
      m.handleEvent("Elicitation", { session_id: SESSION_B });
      at(3000);
      m.handleEvent("PermissionRequest", { session_id: SESSION_C });
      m.setPendingPermission(SESSION_C, makePendingPermission());
      return m;
    }

    it("orders every waiting session by when it began waiting, whatever it is waiting for", () => {
      threeAsking();
      expect(m.attentionQueue.map((s) => s.id)).toEqual([SESSION_A, SESSION_B, SESSION_C]);
      expect(m.foregroundSession?.id).toBe(SESSION_A);
    });

    it("falls back to the active session when nothing is waiting", () => {
      m = new SessionManager();
      m.handleEvent("SessionStart", { session_id: SESSION_A });
      expect(m.attentionQueue).toEqual([]);
      expect(m.foregroundSession?.id).toBe(SESSION_A);
    });

    it("a prompt handed to the terminal keeps its place at the head", () => {
      threeAsking();
      m.clearPendingPermissionById(SESSION_A);
      expect(m.attentionQueue.map((s) => s.id)).toEqual([SESSION_A, SESSION_B, SESSION_C]);
    });

    it("the deck answers nothing while the oldest question is waiting in the terminal", () => {
      threeAsking();
      m.clearPendingPermissionById(SESSION_A);
      expect(m.waitingSession).toBeUndefined();
      expect(m.resolveOldest(true)).toBeNull();
    });

    it("answering the head moves the next question to the front", () => {
      threeAsking();
      expect(m.resolveOldest(true)).toBe(SESSION_A);
      expect(m.attentionQueue.map((s) => s.id)).toEqual([SESSION_B, SESSION_C]);
      expect(m.waitingSession).toBeUndefined();
    });

    it("a session leaves the queue once its terminal prompt is answered", () => {
      threeAsking();
      m.clearPendingPermissionById(SESSION_A);
      m.handleEvent("PostToolUse", { session_id: SESSION_A });
      expect(m.attentionQueue.map((s) => s.id)).toEqual([SESSION_B, SESSION_C]);
    });

    it("a question leaves the queue when its result arrives", () => {
      threeAsking();
      m.handleEvent("ElicitationResult", { session_id: SESSION_B });
      expect(m.attentionQueue.map((s) => s.id)).toEqual([SESSION_A, SESSION_C]);
    });
  });

  describe("when a held permission times out and the prompt is handed to the terminal", () => {
    function handedOff() {
      m = new SessionManager();
      m.handleEvent("SessionStart", { session_id: SESSION_A });
      m.handleEvent("PermissionRequest", { session_id: SESSION_A });
      m.setPendingPermission(SESSION_A, makePendingPermission());
      m.clearPendingPermissionById(SESSION_A);
      return m;
    }

    it("clears the held request but keeps the session waiting, flagged as in the terminal", () => {
      handedOff();
      expect(m.activeSession?.pendingPermission).toBeNull();
      expect(m.activeSession?.state).toBe(State.AWAITING_PERMISSION);
      expect(m.activeSession?.permissionInTerminal).toBe(true);
    });

    it("ignores a parallel PreToolUse while the terminal prompt is open", () => {
      handedOff();
      m.handleEvent("PreToolUse", { session_id: SESSION_A });
      expect(m.activeSession?.state).toBe(State.AWAITING_PERMISSION);
    });

    it.each(["PostToolUse", "PostToolUseFailure", "UserPromptSubmit"] as HookEventName[])(
      "%s means the prompt was answered: back to PROCESSING, flag cleared",
      (event) => {
        handedOff();
        m.handleEvent(event, { session_id: SESSION_A });
        expect(m.activeSession?.state).toBe(State.PROCESSING);
        expect(m.activeSession?.permissionInTerminal).toBe(false);
      },
    );

    it("Stop returns the session to IDLE and clears the flag", () => {
      handedOff();
      m.handleEvent("Stop", { session_id: SESSION_A });
      expect(m.activeSession?.state).toBe(State.IDLE);
      expect(m.activeSession?.permissionInTerminal).toBe(false);
    });

    it("a new PermissionRequest takes over from the terminal flag", () => {
      handedOff();
      m.handleEvent("PermissionRequest", { session_id: SESSION_A });
      m.setPendingPermission(SESSION_A, makePendingPermission());
      expect(m.activeSession?.permissionInTerminal).toBe(false);
      expect(m.activeSession?.pendingPermission).not.toBeNull();
    });
  });

  it("resolvePermission writes allow response on approve", () => {
    m = new SessionManager();
    m.handleEvent("SessionStart", { session_id: SESSION_A });
    m.handleEvent("PermissionRequest", { session_id: SESSION_A });
    const pending = makePendingPermission();
    m.setPendingPermission(SESSION_A, pending);

    const ok = m.resolvePermission(SESSION_A, true);
    expect(ok).toBe(true);
    expect(pending.res.writeHead).toHaveBeenCalledWith(200, { "Content-Type": "application/json" });
    const body = JSON.parse((pending.res.end as any).mock.calls[0][0]);
    expect(body.hookSpecificOutput.decision.behavior).toBe("allow");
  });

  it("resolvePermission writes deny response on reject", () => {
    m = new SessionManager();
    m.handleEvent("SessionStart", { session_id: SESSION_A });
    m.handleEvent("PermissionRequest", { session_id: SESSION_A });
    const pending = makePendingPermission();
    m.setPendingPermission(SESSION_A, pending);

    m.resolvePermission(SESSION_A, false, "user denied");
    const body = JSON.parse((pending.res.end as any).mock.calls[0][0]);
    expect(body.hookSpecificOutput.decision.behavior).toBe("deny");
    expect(body.hookSpecificOutput.decision.message).toBe("user denied");
  });

  it("resolvePermissionAlwaysAllow writes addRules response with tool name", () => {
    m = new SessionManager();
    m.handleEvent("SessionStart", { session_id: SESSION_A });
    m.handleEvent("PermissionRequest", { session_id: SESSION_A });
    const pending = makePendingPermission("Edit");
    m.setPendingPermission(SESSION_A, pending);

    const ok = m.resolvePermissionAlwaysAllow(SESSION_A);
    expect(ok).toBe(true);
    const body = JSON.parse((pending.res.end as any).mock.calls[0][0]);
    expect(body.hookSpecificOutput.decision.behavior).toBe("allow");
    expect(body.hookSpecificOutput.decision.updatedPermissions[0].rules[0].toolName).toBe("Edit");
  });

  it("queue: second pending permission focuses session A while A is held; advances to B when A resolves", () => {
    m = new SessionManager();
    m.handleEvent("SessionStart", { session_id: SESSION_A });
    m.handleEvent("SessionStart", { session_id: SESSION_B });
    m.handleEvent("PermissionRequest", { session_id: SESSION_A });
    m.setPendingPermission(SESSION_A, makePendingPermission());
    expect(m.activeSession?.id).toBe(SESSION_A);

    m.handleEvent("PermissionRequest", { session_id: SESSION_B });
    m.setPendingPermission(SESSION_B, makePendingPermission());
    // Active stays on A while A is pending
    expect(m.activeSession?.id).toBe(SESSION_A);

    m.resolvePermission(SESSION_A, true);
    // Now B should be foregrounded
    expect(m.activeSession?.id).toBe(SESSION_B);
  });
});

describe("SessionManager session cycling and PID", () => {
  let m: SessionManager;
  afterEach(() => m?.stop());

  it("cycleSession rotates the active index forward and backward", () => {
    m = new SessionManager();
    m.handleEvent("SessionStart", { session_id: SESSION_A });
    m.handleEvent("SessionStart", { session_id: SESSION_B });
    expect(m.activeSession?.id).toBe(SESSION_A);

    m.cycleSession(1);
    expect(m.activeSession?.id).toBe(SESSION_B);

    m.cycleSession(1);
    expect(m.activeSession?.id).toBe(SESSION_A);

    m.cycleSession(-1);
    expect(m.activeSession?.id).toBe(SESSION_B);
  });

  it("setSessionPid stores the PID on the session", () => {
    m = new SessionManager();
    m.handleEvent("SessionStart", { session_id: SESSION_A });
    m.setSessionPid(SESSION_A, 12345);
    expect(m.activeSession?.pid).toBe(12345);
  });

  it("interruptActiveSession returns false when no PID and false from IDLE", () => {
    m = new SessionManager();
    m.handleEvent("SessionStart", { session_id: SESSION_A });
    expect(m.interruptActiveSession()).toBe(false);

    m.setSessionPid(SESSION_A, 12345);
    // Still IDLE: should refuse
    expect(m.interruptActiveSession()).toBe(false);

    m.handleEvent("PreToolUse", { session_id: SESSION_A, tool_name: "Bash" });
    // Now PROCESSING; mock process.kill via spy
    const killSpy = vi.spyOn(process, "kill").mockImplementation(() => true);
    expect(m.interruptActiveSession()).toBe(true);
    expect(killSpy).toHaveBeenCalledWith(12345, "SIGINT");
    killSpy.mockRestore();
  });
});

describe("SessionManager pruning", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("prunes IDLE sessions after 60s of inactivity", () => {
    const m = startedManager();
    m.handleEvent("SessionStart", { session_id: SESSION_A });
    expect(m.sessionCount).toBe(1);

    // Advance fake timer past STALE_MS (60s) plus a pruning interval tick (60s).
    vi.advanceTimersByTime(61_000);
    // Trigger the prune interval explicitly
    vi.advanceTimersByTime(60_000);

    expect(m.sessionCount).toBe(0);
    m.stop();
  });

  it("does NOT prune PROCESSING sessions", () => {
    const m = startedManager();
    m.handleEvent("SessionStart", { session_id: SESSION_A });
    m.handleEvent("PreToolUse", { session_id: SESSION_A, tool_name: "Bash" });

    vi.advanceTimersByTime(121_000);
    expect(m.sessionCount).toBe(1);
    expect(m.activeSession?.state).toBe(State.PROCESSING);
    m.stop();
  });
});

describe("SessionManager event emission", () => {
  let m: SessionManager;
  afterEach(() => m?.stop());

  it("emits sessionUpdated with the event name for every transition", () => {
    m = new SessionManager();
    const events: Array<HookEventName> = [];
    m.on("sessionUpdated", (_s, e) => events.push(e));

    m.handleEvent("SessionStart", { session_id: SESSION_A });
    m.handleEvent("PreToolUse", { session_id: SESSION_A, tool_name: "X" });
    m.handleEvent("Stop", { session_id: SESSION_A });

    expect(events).toEqual(["SessionStart", "PreToolUse", "Stop"]);
  });

  it("emits activeSessionChanged when cycling", () => {
    m = new SessionManager();
    m.handleEvent("SessionStart", { session_id: SESSION_A });
    m.handleEvent("SessionStart", { session_id: SESSION_B });

    const changes: Array<string | undefined> = [];
    m.on("activeSessionChanged", (s) => changes.push(s?.id));

    m.cycleSession(1);
    m.cycleSession(1);
    expect(changes).toEqual([SESSION_B, SESSION_A]);
  });
});

describe("configDirSeen", () => {
  it("emits the config dir taken from transcript_path", () => {
    const m = new SessionManager();
    const seen: string[] = [];
    m.on("configDirSeen", (d: string) => seen.push(d));
    m.handleEvent("SessionStart", {
      session_id: SESSION_A,
      transcript_path: "/Users/x/.claude-idealoft/projects/p/s.jsonl",
    });
    expect(seen).toEqual(["/Users/x/.claude-idealoft"]);
  });

  it("emits nothing without a usable transcript_path", () => {
    const m = new SessionManager();
    const seen: string[] = [];
    m.on("configDirSeen", (d: string) => seen.push(d));
    m.handleEvent("SessionStart", { session_id: SESSION_A });
    m.handleEvent("SessionStart", { session_id: SESSION_B, transcript_path: "/tmp/no-marker.jsonl" });
    expect(seen).toEqual([]);
  });

  it("still handles the event when a listener throws", () => {
    const m = new SessionManager();
    m.on("configDirSeen", () => {
      throw new Error("listener failure");
    });
    let session;
    expect(() => {
      session = m.handleEvent("SessionStart", {
        session_id: SESSION_A,
        transcript_path: "/Users/x/.claude/projects/p/s.jsonl",
      });
    }).not.toThrow();
    expect(session).toMatchObject({ id: SESSION_A });
  });
});
