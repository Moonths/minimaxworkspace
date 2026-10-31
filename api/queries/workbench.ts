import { desc, eq } from "drizzle-orm";
import {
  runs,
  workflows,
  type NewRunRecord,
  type RunRecord,
  type WorkflowRecord,
} from "@db/schema";
import type { ApiWorkflow } from "@contracts/workbench";
import { getDb } from "./connection";

export async function getWorkflowById(
  id: number,
): Promise<WorkflowRecord | undefined> {
  return getDb().query.workflows.findFirst({ where: eq(workflows.id, id) });
}

export async function getLatestWorkflow(): Promise<WorkflowRecord | undefined> {
  return getDb().query.workflows.findFirst({
    orderBy: desc(workflows.updatedAt),
  });
}

export async function saveWorkflow(data: {
  id?: number;
  name: string;
  apiJson: ApiWorkflow;
}): Promise<WorkflowRecord> {
  if (data.id) {
    await getDb()
      .update(workflows)
      .set({
        name: data.name,
        apiJson: data.apiJson,
        updatedAt: new Date(),
      })
      .where(eq(workflows.id, data.id));
    const updated = await getWorkflowById(data.id);
    if (!updated) throw new Error("保存后未找到工作流");
    return updated;
  }

  const [{ id }] = await getDb()
    .insert(workflows)
    .values({ name: data.name, apiJson: data.apiJson })
    .$returningId();
  const created = await getWorkflowById(id);
  if (!created) throw new Error("创建后未找到工作流");
  return created;
}

export async function createRun(
  data: NewRunRecord,
): Promise<RunRecord> {
  const [{ id }] = await getDb().insert(runs).values(data).$returningId();
  const created = await getRunById(id);
  if (!created) throw new Error("创建后未找到运行记录");
  return created;
}

export async function getRunById(id: number): Promise<RunRecord | undefined> {
  return getDb().query.runs.findFirst({ where: eq(runs.id, id) });
}

export async function listRuns(limit = 20): Promise<RunRecord[]> {
  return getDb()
    .select()
    .from(runs)
    .orderBy(desc(runs.createdAt))
    .limit(limit);
}

export async function updateRun(
  id: number,
  data: Partial<NewRunRecord>,
): Promise<RunRecord> {
  await getDb()
    .update(runs)
    .set({ ...data, updatedAt: new Date() })
    .where(eq(runs.id, id));
  const updated = await getRunById(id);
  if (!updated) throw new Error("更新后未找到运行记录");
  return updated;
}
