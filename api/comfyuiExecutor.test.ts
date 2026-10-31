import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { afterEach, describe, expect, it } from "vitest";
import { parseWorkflowText, exampleWorkflowText } from "@contracts/workbench";
import {
  checkComfyHealth,
  submitComfyPrompt,
  syncComfyPrompt,
} from "./executors/comfyui";

const servers = new Set<ReturnType<typeof createServer>>();

afterEach(async () => {
  await Promise.all(
    [...servers].map(
      (server) =>
        new Promise<void>((resolve) => server.close(() => resolve())),
    ),
  );
  servers.clear();
});

function json(response: ServerResponse, value: unknown, status = 200) {
  response.writeHead(status, { "Content-Type": "application/json" });
  response.end(JSON.stringify(value));
}

async function withServer(
  handler: (request: IncomingMessage, response: ServerResponse) => void,
  run: (baseUrl: string) => Promise<void>,
) {
  const server = createServer(handler);
  servers.add(server);
  await new Promise<void>((resolve) =>
    server.listen(0, "127.0.0.1", () => resolve()),
  );
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("无测试端口");
  await run(`http://127.0.0.1:${address.port}`);
}

describe("ComfyUI 健康检查", () => {
  it("验证系统与队列并返回运行信息", async () => {
    await withServer(
      (request, response) => {
        if (request.url === "/system_stats") {
          return json(response, { devices: [{ name: "Test GPU" }] });
        }
        if (request.url === "/queue") {
          return json(response, { queue_running: [], queue_pending: [1] });
        }
        json(response, {}, 404);
      },
      async (baseUrl) => {
        const health = await checkComfyHealth(baseUrl);
        expect(health).toMatchObject({
          ok: true,
          device: "Test GPU",
          queueRunning: 0,
          queuePending: 1,
        });
      },
    );
  });

  it("区分 HTTP 错误与无法识别的响应", async () => {
    await withServer(
      (_request, response) => json(response, { error: "denied" }, 403),
      async (baseUrl) => {
        const health = await checkComfyHealth(baseUrl);
        expect(health).toMatchObject({ ok: false, code: "http" });
      },
    );

    await withServer(
      (_request, response) => {
        response.writeHead(200, { "Content-Type": "text/plain" });
        response.end("not-json");
      },
      async (baseUrl) => {
        const health = await checkComfyHealth(baseUrl);
        expect(health).toMatchObject({ ok: false, code: "invalid_response" });
      },
    );
  });

  it("识别超时和网络不可达", async () => {
    await withServer(
      (_request, response) => setTimeout(() => json(response, {}), 100),
      async (baseUrl) => {
        const health = await checkComfyHealth(baseUrl, 20);
        expect(health).toMatchObject({ ok: false, code: "timeout" });
      },
    );

    const server = createServer();
    await new Promise<void>((resolve) =>
      server.listen(0, "127.0.0.1", () => resolve()),
    );
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("无测试端口");
    const baseUrl = `http://127.0.0.1:${address.port}`;
    await new Promise<void>((resolve) => server.close(() => resolve()));
    const health = await checkComfyHealth(baseUrl);
    expect(health).toMatchObject({ ok: false, code: "unreachable" });
  });
});

describe("ComfyUI 任务协议", () => {
  it("提交工作流并从历史提取图片与视频", async () => {
    let submittedBody = "";
    await withServer(
      (request, response) => {
        if (request.url === "/prompt" && request.method === "POST") {
          request.on("data", (chunk) => (submittedBody += chunk));
          request.on("end", () => json(response, { prompt_id: "prompt-1" }));
          return;
        }
        if (request.url === "/history/prompt-1") {
          return json(response, {
            "prompt-1": {
              status: { status_str: "success", completed: true },
              outputs: {
                "8": {
                  images: [
                    { filename: "frame.png", subfolder: "shots", type: "output" },
                  ],
                },
                "9": {
                  videos: [
                    { filename: "shot.mp4", subfolder: "", type: "output" },
                  ],
                },
              },
            },
          });
        }
        if (request.url === "/queue") {
          return json(response, { queue_running: [], queue_pending: [] });
        }
        json(response, {}, 404);
      },
      async (baseUrl) => {
        const { workflow } = parseWorkflowText(exampleWorkflowText);
        const remoteId = await submitComfyPrompt(baseUrl, workflow);
        expect(remoteId).toBe("prompt-1");
        expect(JSON.parse(submittedBody).prompt["1"].class_type).toBe(
          "CheckpointLoaderSimple",
        );

        const result = await syncComfyPrompt(baseUrl, remoteId);
        expect(result.status).toBe("succeeded");
        expect(result.outputs).toHaveLength(2);
        expect(result.outputs?.[0]).toMatchObject({
          filename: "frame.png",
          kind: "image",
          simulated: false,
        });
        expect(result.outputs?.[1]?.kind).toBe("video");
      },
    );
  });

  it("从队列恢复运行状态", async () => {
    await withServer(
      (request, response) => {
        if (request.url === "/history/prompt-2") return json(response, {});
        if (request.url === "/queue") {
          return json(response, {
            queue_running: [[0, "prompt-2"]],
            queue_pending: [],
          });
        }
        json(response, {}, 404);
      },
      async (baseUrl) => {
        expect((await syncComfyPrompt(baseUrl, "prompt-2")).status).toBe(
          "running",
        );
      },
    );
  });

  it("保留历史中的节点错误", async () => {
    await withServer(
      (request, response) => {
        if (request.url === "/history/prompt-3") {
          return json(response, {
            "prompt-3": {
              status: {
                status_str: "error",
                messages: [
                  ["execution_error", { exception_message: "模型不存在" }],
                ],
              },
              outputs: {},
            },
          });
        }
        json(response, {}, 404);
      },
      async (baseUrl) => {
        const result = await syncComfyPrompt(baseUrl, "prompt-3");
        expect(result).toMatchObject({
          status: "failed",
          error: "模型不存在",
        });
      },
    );
  });
});
