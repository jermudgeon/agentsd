import { describe, expect, it } from "vitest";
import { sessionKeyView, statusLines, waitKind } from "../src/session-view";
import { State } from "../src/types";

const base = { state: State.IDLE, currentTool: null, activeWork: 0, lastError: null, permissionInTerminal: false, pendingPermission: null };

describe("waitKind", () => {
  it("tells a held request from a prompt in the terminal and from a question", () => {
    expect(waitKind({ ...base, state: State.AWAITING_PERMISSION, pendingPermission: {} as never })).toBe("held");
    expect(waitKind({ ...base, state: State.AWAITING_PERMISSION, permissionInTerminal: true })).toBe("terminal");
    expect(waitKind({ ...base, state: State.AWAITING_ELICITATION })).toBe("question");
  });

  it("is null for a session that is not waiting", () => {
    expect(waitKind({ ...base, state: State.PROCESSING })).toBeNull();
    expect(waitKind(base)).toBeNull();
  });
});

describe("statusLines", () => {
  it("describes working, idle, error, held, terminal and question states", () => {
    expect(statusLines({ ...base, state: State.PROCESSING, currentTool: "Bash" }, 0)).toEqual(["Working", "Bash"]);
    expect(statusLines(base, 0)).toEqual(["Idle"]);
    expect(statusLines({ ...base, lastError: "x" }, 0)).toEqual(["Error"]);
    expect(statusLines({ ...base, state: State.AWAITING_PERMISSION }, 0)).toEqual(["Permission?"]);
    expect(statusLines({ ...base, state: State.AWAITING_PERMISSION, permissionInTerminal: true }, 0)).toEqual(["Permission?", "in terminal"]);
    expect(statusLines({ ...base, state: State.AWAITING_ELICITATION }, 0)).toEqual(["Question?"]);
  });

  it("adds a queued count only when others are waiting", () => {
    expect(statusLines({ ...base, state: State.AWAITING_PERMISSION }, 2)).toEqual(["Permission?", "+2 queued"]);
    expect(statusLines({ ...base, state: State.AWAITING_PERMISSION }, 0)).toEqual(["Permission?"]);
  });

  it("shows the running agent count", () => {
    expect(statusLines({ ...base, state: State.PROCESSING, activeWork: 2 }, 0)).toEqual(["Working", "", "2 agents"]);
  });
});

describe("sessionKeyView", () => {
  const AMBER = "#d29922";
  const RED = "#da3633";
  const view = (o: Partial<Parameters<typeof sessionKeyView>[0]>) =>
    sessionKeyView({ state: State.IDLE, kind: null, queueLength: 0, count: 3, activeIndex: 0, flashOn: false, ...o });

  it("shows the position among sessions when nothing is waiting", () => {
    expect(view({ activeIndex: 1 })).toEqual({ color: "#1a7f37", suffix: "(2/3)", flashing: false });
    expect(view({ count: 1 }).suffix).toBe("");
  });

  it("a held request is steady amber and says waiting", () => {
    expect(view({ state: State.AWAITING_PERMISSION, kind: "held", queueLength: 1 })).toEqual({ color: AMBER, suffix: "waiting", flashing: false });
  });

  it("shows how many are queued", () => {
    expect(view({ state: State.AWAITING_PERMISSION, kind: "held", queueLength: 3 }).suffix).toBe("1/3 waiting");
  });

  it.each([["terminal", State.AWAITING_PERMISSION], ["question", State.AWAITING_ELICITATION]] as const)(
    "a %s wait flashes between red and its own colour",
    (kind, state) => {
      expect(view({ state, kind, queueLength: 1, flashOn: true })).toMatchObject({ color: RED, flashing: true });
      expect(view({ state, kind, queueLength: 1, flashOn: false })).toMatchObject({ flashing: true });
      expect(view({ state, kind, queueLength: 1, flashOn: false }).color).not.toBe(RED);
    },
  );
});
