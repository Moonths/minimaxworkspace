import { eq } from "drizzle-orm";
import { afterEach, describe, expect, it } from "vitest";
import { runs, workflows } from "@db/schema";
import { getDb } from "./queries/connection";
import {
  createRun,
  getRunById,
  saveWorkflow,
} from "./queries/workbench";

const workflowIds: number[] = [];
const runIds: number[] = [];

afterEach(async () => {
  for (const id of runIds.splice(0)) {
    await getDb().delete(runs).where(eq(runs.id, id));
  }
  for (const id of workflowIds.splice(0)) {
    await getDb().delete(workflows).where(eq(workflows.id, id));
  }
});

describe("工作流与运行持久化", () => {
  it("创建后可读取，且运行快照不随工作流编辑改变", async () => {
    const original = {
      "1": { class_type: "Original", inputs: { value: 1 } },
    };
    const workflow = await saveWorkflow({
      name: `测试工作流-${Date.now()}`,
      apiJson: original,
    });
    workflowIds.push(workflow.id);
    expect(workflow.id).toBeGreaterThan(0);

    const run = await createRun({
      workflowId: workflow.id,
      name: workflow.name,
      executor: "mock",
      status: "queued",
      workflowSnapshot: structuredClone(original),
    });
    runIds.push(run.id);

    await saveWorkflow({
      id: workflow.id,
      name: workflow.name,
      apiJson: {
        "1": { class_type: "Changed", inputs: { value: 2 } },
      },
    });

    const restored = await getRunById(run.id);
    expect(restored?.workflowSnapshot["1"]?.class_type).toBe("Original");
    expect(restored?.executor).toBe("mock");
  });
});
