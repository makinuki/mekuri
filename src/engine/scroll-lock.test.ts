import { describe, expect, it } from "vite-plus/test";
import { DEFAULT_ALIGNMENT_WINDOW_MS, createScrollAlignmentLock } from "./scroll-lock";

function clockedLock(windowMs = 750) {
  let time = 0;
  return {
    lock: createScrollAlignmentLock({ windowMs, now: () => time }),
    advance(ms: number) {
      time += ms;
    },
  };
}

describe("createScrollAlignmentLock", () => {
  it("is disarmed until a programmatic move is raised", () => {
    const { lock } = clockedLock();
    expect(lock.isArmed()).toBe(false);
    expect(lock.isProgrammatic(0, 0)).toBe(false);
    expect(lock.target()).toBeNull();
  });

  it("records the anchor index and target offset of the raised move", () => {
    const { lock } = clockedLock();
    lock.raise(4, 4120);
    expect(lock.isArmed()).toBe(true);
    expect(lock.anchor()).toBe(4);
    expect(lock.target()).toBe(4120);
  });

  it("treats a report on the anchor index as the programmatic landing", () => {
    const { lock } = clockedLock();
    lock.raise(4, 4120);
    expect(lock.isProgrammatic(4, 900)).toBe(true);
    expect(lock.isArmed()).toBe(false);
  });

  it("treats a report within tolerance of the target offset as arrival", () => {
    const { lock } = clockedLock();
    lock.raise(4, 4120);
    expect(lock.isProgrammatic(3, 4121)).toBe(true);
    expect(lock.isArmed()).toBe(false);
  });

  it("holds reports off the target while the settling window is open", () => {
    const { lock, advance } = clockedLock();
    lock.raise(4, 4120);
    advance(400);
    expect(lock.isProgrammatic(1, 1000)).toBe(true);
    expect(lock.isArmed()).toBe(true);
  });

  it("releases a target the layout cannot reach once the window expires", () => {
    const { lock, advance } = clockedLock();
    lock.raise(4, 4120);
    advance(800);
    expect(lock.isProgrammatic(1, 1000)).toBe(false);
    expect(lock.isArmed()).toBe(false);
  });

  it("restarts the settling window on every raise", () => {
    const { lock, advance } = clockedLock();
    lock.raise(4, 4120);
    advance(700);
    lock.raise(6, 6120);
    advance(700);
    expect(lock.isProgrammatic(1, 1000)).toBe(true);
    advance(100);
    expect(lock.isProgrammatic(1, 1000)).toBe(false);
  });

  it("stops suppressing as soon as the lock is cleared", () => {
    const { lock } = clockedLock();
    lock.raise(4, 4120);
    lock.clear();
    expect(lock.isArmed()).toBe(false);
    expect(lock.target()).toBeNull();
    expect(lock.isProgrammatic(4, 4120)).toBe(false);
  });

  it("defaults to the documented settling window", () => {
    let time = 0;
    const lock = createScrollAlignmentLock({ now: () => time });
    lock.raise(1, 100);
    time = DEFAULT_ALIGNMENT_WINDOW_MS - 1;
    expect(lock.isProgrammatic(9, 5000)).toBe(true);
    time = DEFAULT_ALIGNMENT_WINDOW_MS + 1;
    expect(lock.isProgrammatic(9, 5000)).toBe(false);
  });
});
