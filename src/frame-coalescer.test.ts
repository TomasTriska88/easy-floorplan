import { describe, it, expect, vi } from "vitest";
import { FrameCoalescer, type FrameScheduler } from "./frame-coalescer";

/** A scheduler whose frames only run when the test says so. */
function manualFrames() {
  const queue = new Map<number, () => void>();
  let next = 1;
  const scheduler: FrameScheduler = {
    request(cb) {
      const handle = next++;
      queue.set(handle, cb);
      return handle;
    },
    cancel(handle) {
      queue.delete(handle);
    },
  };
  return {
    scheduler,
    get depth() {
      return queue.size;
    },
    /** Run every callback currently queued. */
    tick() {
      const due = [...queue.entries()];
      queue.clear();
      for (const [, cb] of due) cb();
    },
  };
}

describe("FrameCoalescer", () => {
  it("delivers only the newest value of a burst", () => {
    const frames = manualFrames();
    const deliver = vi.fn();
    const c = new FrameCoalescer<number>(frames.scheduler, deliver);

    c.push(1);
    c.push(2);
    c.push(3);
    expect(deliver).not.toHaveBeenCalled();

    frames.tick();
    expect(deliver.mock.calls).toEqual([[3]]);
  });

  it("schedules one frame per burst, not one per value", () => {
    const frames = manualFrames();
    const c = new FrameCoalescer<number>(frames.scheduler, vi.fn());

    c.push(1);
    c.push(2);
    expect(frames.depth).toBe(1);
  });

  it("queues again after a frame has run", () => {
    const frames = manualFrames();
    const deliver = vi.fn();
    const c = new FrameCoalescer<number>(frames.scheduler, deliver);

    c.push(1);
    frames.tick();
    c.push(2);
    frames.tick();
    expect(deliver.mock.calls).toEqual([[1], [2]]);
  });

  it("settle delivers the newest value without waiting for the frame", () => {
    const frames = manualFrames();
    const deliver = vi.fn();
    const c = new FrameCoalescer<number>(frames.scheduler, deliver);

    c.push(1);
    c.push(2);
    c.settle();
    expect(deliver.mock.calls).toEqual([[2]]);
  });

  it("settle consumes the pending value, so its frame is a no-op", () => {
    const frames = manualFrames();
    const deliver = vi.fn();
    const c = new FrameCoalescer<number>(frames.scheduler, deliver);

    c.push(1);
    c.settle();
    frames.tick();
    expect(deliver).toHaveBeenCalledTimes(1);
  });

  it("settle with nothing queued delivers nothing", () => {
    const frames = manualFrames();
    const deliver = vi.fn();
    const c = new FrameCoalescer<number>(frames.scheduler, deliver);

    c.settle();
    expect(deliver).not.toHaveBeenCalled();
  });

  it("cancel drops the queued value and its frame", () => {
    const frames = manualFrames();
    const deliver = vi.fn();
    const c = new FrameCoalescer<number>(frames.scheduler, deliver);

    c.push(1);
    c.cancel();
    frames.tick();
    expect(deliver).not.toHaveBeenCalled();
    expect(frames.depth).toBe(0);
  });

  it("delivers a queued null like any other value", () => {
    const frames = manualFrames();
    const deliver = vi.fn();
    const c = new FrameCoalescer<number | null>(frames.scheduler, deliver);

    c.push(null);
    expect(c.pending).toBe(true);
    frames.tick();
    expect(deliver).toHaveBeenCalledWith(null);
  });

  it("settles a queued null rather than treating it as nothing queued", () => {
    const frames = manualFrames();
    const deliver = vi.fn();
    const c = new FrameCoalescer<number | null>(frames.scheduler, deliver);

    c.push(null);
    c.settle();
    expect(deliver).toHaveBeenCalledWith(null);
    expect(frames.depth).toBe(0);
  });

  it("reports whether a value is waiting", () => {
    const frames = manualFrames();
    const c = new FrameCoalescer<number>(frames.scheduler, vi.fn());

    expect(c.pending).toBe(false);
    c.push(1);
    expect(c.pending).toBe(true);
    frames.tick();
    expect(c.pending).toBe(false);
  });
});
