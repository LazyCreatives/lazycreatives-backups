import { describe, it, expect, vi } from "vitest";
import { EventEmitter } from "node:events";
// sidecar.js is a CommonJS Electron-process module (node builtins only).
// @ts-ignore - untyped JS module imported for its runtime behaviour
import * as sidecar from "../electron/sidecar";

const { stopSidecar } = sidecar as any;

function fakeProc() {
  const p: any = new EventEmitter();
  p.pid = 4242;
  p.exitCode = null;
  p.signalCode = null;
  return p;
}

describe("stopSidecar", () => {
  it("does nothing when the sidecar already stopped", async () => {
    const kill = vi.fn();
    await stopSidecar({ proc: fakeProc(), stopped: true }, { kill });
    expect(kill).not.toHaveBeenCalled();
  });

  it("SIGTERMs first, then SIGKILLs after the grace period, and resolves on exit", async () => {
    vi.useFakeTimers();
    const proc = fakeProc();
    const kill = vi.fn();
    const done = stopSidecar({ proc, stopped: false }, { graceMs: 1000, kill });

    expect(kill).toHaveBeenCalledTimes(1);
    expect(kill).toHaveBeenLastCalledWith(proc, "SIGTERM");

    vi.advanceTimersByTime(1000);
    expect(kill).toHaveBeenLastCalledWith(proc, "SIGKILL");

    proc.emit("exit"); // process finally dies
    await done;
    vi.useRealTimers();
  });

  it("does not SIGKILL when the process exits within the grace period", async () => {
    vi.useFakeTimers();
    const proc = fakeProc();
    const kill = vi.fn();
    const done = stopSidecar({ proc, stopped: false }, { graceMs: 1000, kill });

    proc.emit("exit");
    await done;

    vi.advanceTimersByTime(5000);
    const signals = kill.mock.calls.map((c) => c[1]);
    expect(signals).toContain("SIGTERM");
    expect(signals).not.toContain("SIGKILL");
    vi.useRealTimers();
  });
});
