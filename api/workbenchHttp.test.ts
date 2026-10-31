import { fetchRequestHandler } from "@trpc/server/adapters/fetch";
import { eq } from "drizzle-orm";
import { Hono } from "hono";
import { describe, expect, it } from "vitest";
import { exampleWorkflowText } from "@contracts/workbench";
import { runs, workflows, type RunRecord, type WorkflowRecord } from "@db/schema";
import { createContext } from "./context";
import { getDb } from "./queries/connection";
import { updateRun } from "./queries/workbench";
import { appRouter } from "./router";
import { artifactRoutes } from "./routes/artifacts";

function createTestApp() {
  const app = new Hono();
  app.use("/api/trpc/*", async (c) =>
    fetchRequestHandler({
      endpoint: "/api/trpc",
      req: c.req.raw,
      router: appRouter,
      createContext,
    }),
  );
  app.route("/api/runs", artifactRoutes);
  return app;
}

async function call<T>(
  app: Hono,
  path: string,
  input?: unknown,
  mutation = false,
): Promise<T> {
  const url = `/api/trpc/${path}${
    input === undefined || mutation
      ? ""
      : `?input=${encodeURIComponent(JSON.stringify({ json: input }))}`
  }`;
  const response = await app.request(url, {
    method: mutation ? "POST" : "GET",
    headers: mutation ? { "Content-Type": "application/json" } : undefined,
    body: mutation ? JSON.stringify({ json: input }) : undefined,
  });
  expect(response.status).toBe(200);
  const body = (await response.json()) as {
    result: { data: { json: T } };
  };
  return body.result.data.json;
}

describe("工作台 HTTP API", () => {
  it("完成健康检查、保存、提交、同步、列表和结果读取", async () => {
    const app = createTestApp();
    const health = await call<{ ok: boolean }>(
      app,
      "workbench.health",
      { mode: "mock" },
      true,
    );
    expect(health.ok).toBe(true);

    const workflow = await call<WorkflowRecord>(
      app,
      "workbench.saveWorkflow",
      {
        name: `HTTP 集成-${Date.now()}`,
        text: exampleWorkflowText,
      },
      true,
    );
    const run = await call<RunRecord>(
      app,
      "workbench.createRun",
      { workflowId: workflow.id, mode: "mock" },
      true,
    );

    try {
      expect(run.status).toBe("queued");
      await updateRun(run.id, {
        createdAt: new Date(Date.now() - 2000),
      });
      const synced = await call<RunRecord>(
        app,
        "workbench.syncRun",
        { id: run.id },
        true,
      );
      expect(synced.status).toBe("succeeded");
      expect(synced.outputs?.[0]?.simulated).toBe(true);

      const listed = await call<RunRecord[]>(app, "workbench.listRuns", {
        limit: 20,
      });
      expect(listed.some((item) => item.id === run.id)).toBe(true);

      const artifact = await app.request(
        `/api/runs/${run.id}/artifacts/0`,
      );
      expect(artifact.status).toBe(200);
      expect(artifact.headers.get("content-type")).toContain("image/svg+xml");
    } finally {
      await getDb().delete(runs).where(eq(runs.id, run.id));
      await getDb().delete(workflows).where(eq(workflows.id, workflow.id));
    }
  });
});
