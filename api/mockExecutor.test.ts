import { describe, expect, it } from "vitest";
import type { RunRecord } from "@db/schema";
import { syncMockRun } from "./executors/mock";

function runAt(createdAt: Date): RunRecord {
  return {
    id: 42,
    workflowId: 7,
    name: "模拟测试",
    executor: "mock",
    status: "queued",
    workflowSnapshot: {},
    remoteId: null,
    remoteBaseUrl: null,
    error: null,
    outputs: null,
    createdAt,
    updatedAt: createdAt,
  };
}

describe("模拟执行器", () => {
  const createdAt = new Date("2026-01-01T00:00:00.000Z");

  it("按经过时间确定性地推进状态", () => {
    const run = runAt(createdAt);
    expect(syncMockRun(run, new Date(createdAt.getTime() + 100)).status).toBe(
      "queued",
    );
    expect(syncMockRun(run, new Date(createdAt.getTime() + 800)).status).toBe(
      "running",
    );
    expect(syncMockRun(run, new Date(createdAt.getTime() + 1600)).status).toBe(
      "succeeded",
    );
  });

  it("刷新恢复后保留模拟标识与相同结果", () => {
    const run = runAt(createdAt);
    const now = new Date(createdAt.getTime() + 2000);
    const first = syncMockRun(run, now);
    const restored = syncMockRun(run, now);
    expect(restored).toEqual(first);
    expect(restored.outputs?.[0]?.simulated).toBe(true);
    expect(restored.outputs?.[0]?.filename).toBe("mock-run-42.svg");
  });
});
