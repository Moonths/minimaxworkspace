import type { RunRecord } from "@db/schema";
import type { SyncExecutionResult, TaskExecutor } from "./types";

export function syncMockRun(
  run: RunRecord,
  now = new Date(),
): SyncExecutionResult {
  const elapsed = now.getTime() - run.createdAt.getTime();
  if (elapsed < 500) return { status: "queued" };
  if (elapsed < 1500) return { status: "running" };

  return {
    status: "succeeded",
    outputs: [
      {
        filename: `mock-run-${run.id}.svg`,
        subfolder: "",
        type: "output",
        kind: "image",
        simulated: true,
      },
    ],
  };
}

export const mockExecutor: TaskExecutor = {
  async submit() {
    return {};
  },
  async sync(run) {
    return syncMockRun(run);
  },
};
