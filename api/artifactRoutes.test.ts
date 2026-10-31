import { createServer } from "node:http";
import { eq } from "drizzle-orm";
import { Hono } from "hono";
import { afterEach, describe, expect, it } from "vitest";
import { runs, workflows } from "@db/schema";
import { getDb } from "./queries/connection";
import { createRun, saveWorkflow } from "./queries/workbench";
import { artifactRoutes } from "./routes/artifacts";

const cleanup = async (runId?: number, workflowId?: number) => {
  if (runId) await getDb().delete(runs).where(eq(runs.id, runId));
  if (workflowId)
    await getDb().delete(workflows).where(eq(workflows.id, workflowId));
};

afterEach(async () => {
  await cleanup();
});

describe("结果代理", () => {
  it("通过运行 ID 与序号读取模拟 SVG", async () => {
    const workflow = await saveWorkflow({
      name: `模拟结果-${Date.now()}`,
      apiJson: { "1": { class_type: "Test", inputs: {} } },
    });
    const run = await createRun({
      workflowId: workflow.id,
      name: workflow.name,
      executor: "mock",
      status: "succeeded",
      workflowSnapshot: workflow.apiJson,
      outputs: [
        {
          filename: "mock.svg",
          subfolder: "",
          type: "output",
          kind: "image",
          simulated: true,
        },
      ],
    });

    try {
      const app = new Hono().route("/api/runs", artifactRoutes);
      const response = await app.request(
        `/api/runs/${run.id}/artifacts/0?url=http://attacker.invalid`,
      );
      expect(response.status).toBe(200);
      expect(response.headers.get("content-type")).toContain("image/svg+xml");
      expect(await response.text()).toContain(`Run #${run.id}`);
      expect(
        (await app.request(`/api/runs/${run.id}/artifacts/99`)).status,
      ).toBe(404);
    } finally {
      await cleanup(run.id, workflow.id);
    }
  });

  it("忽略查询参数中的地址与文件名，只使用保存的远程引用", async () => {
    let requestedUrl = "";
    const server = createServer((request, response) => {
      requestedUrl = request.url ?? "";
      response.writeHead(200, { "Content-Type": "image/png" });
      response.end(Buffer.from([1, 2, 3]));
    });
    await new Promise<void>((resolve) =>
      server.listen(0, "127.0.0.1", () => resolve()),
    );
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("无测试端口");

    const workflow = await saveWorkflow({
      name: `远程结果-${Date.now()}`,
      apiJson: { "1": { class_type: "Test", inputs: {} } },
    });
    const run = await createRun({
      workflowId: workflow.id,
      name: workflow.name,
      executor: "comfyui",
      status: "succeeded",
      workflowSnapshot: workflow.apiJson,
      remoteId: "prompt-1",
      remoteBaseUrl: `http://127.0.0.1:${address.port}`,
      outputs: [
        {
          filename: "trusted.png",
          subfolder: "shots",
          type: "output",
          kind: "image",
          simulated: false,
        },
      ],
    });

    try {
      const app = new Hono().route("/api/runs", artifactRoutes);
      const response = await app.request(
        `/api/runs/${run.id}/artifacts/0?baseUrl=http://attacker.invalid&filename=evil.png`,
      );
      expect(response.status).toBe(200);
      expect(new Uint8Array(await response.arrayBuffer())).toEqual(
        new Uint8Array([1, 2, 3]),
      );
      expect(requestedUrl).toContain("filename=trusted.png");
      expect(requestedUrl).not.toContain("attacker");
      expect(requestedUrl).not.toContain("evil.png");
    } finally {
      await cleanup(run.id, workflow.id);
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });
});
