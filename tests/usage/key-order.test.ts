import { describe, expect, it } from "vitest";
import { KeyOrder } from "../../src/usage/key-order";

describe("KeyOrder", () => {
  it("keeps ids in order of first appearance and ignores repeats", () => {
    const o = new KeyOrder();
    o.add("a"); o.add("b"); o.add("a");
    expect(o.ids()).toEqual(["a", "b"]);
  });

  it("removes the named id only", () => {
    const o = new KeyOrder();
    o.add("a"); o.add("b");
    o.remove("a");
    expect(o.ids()).toEqual(["b"]);
  });

  it("leaves the order alone when removing an unknown id", () => {
    const o = new KeyOrder();
    o.add("a"); o.add("b");
    o.remove("zzz");
    expect(o.ids()).toEqual(["a", "b"]);
  });

  it("reports whether it is empty", () => {
    const o = new KeyOrder();
    expect(o.isEmpty()).toBe(true);
    o.add("a");
    expect(o.isEmpty()).toBe(false);
  });
});
