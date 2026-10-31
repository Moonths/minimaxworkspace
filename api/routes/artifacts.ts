import { Hono } from "hono";
import { getRunById } from "../queries/workbench";
import { fetchComfyArtifact } from "../executors/comfyui";

function numericParam(value: string): number | undefined {
  const number = Number(value);
  return Number.isSafeInteger(number) && number >= 0 ? number : undefined;
}

function mockSvg(runId: number): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="960" height="540" viewBox="0 0 960 540">
  <rect width="960" height="540" fill="#0c1220"/>
  <path d="M0 410L190 250L330 355L520 165L710 330L960 115V540H0Z" fill="#111a2b" stroke="#22d3ee" stroke-width="2"/>
  <circle cx="780" cy="120" r="48" fill="none" stroke="#34d399" stroke-width="3"/>
  <text x="56" y="72" fill="#22d3ee" font-family="monospace" font-size="20" letter-spacing="4">SIMULATED OUTPUT</text>
  <text x="56" y="122" fill="#e0e0e0" font-family="sans-serif" font-size="30">MiniMax Workspace · Run #${runId}</text>
  <text x="56" y="490" fill="#9a9aab" font-family="sans-serif" font-size="18">此结果仅用于验证工作台流程，并非真实模型生成。</text>
</svg>`;
}

export const artifactRoutes = new Hono().get(
  "/:runId/artifacts/:artifactIndex",
  async (c) => {
    const runId = numericParam(c.req.param("runId"));
    const artifactIndex = numericParam(c.req.param("artifactIndex"));
    if (!runId || artifactIndex === undefined) {
      return c.json({ error: "运行 ID 或结果序号无效" }, 400);
    }

    const run = await getRunById(runId);
    const artifact = run?.outputs?.[artifactIndex];
    if (!run || !artifact) {
      return c.json({ error: "结果不存在" }, 404);
    }

    if (run.executor === "mock") {
      if (!artifact.simulated) {
        return c.json({ error: "模拟运行不包含远程结果" }, 400);
      }
      return c.body(mockSvg(run.id), 200, {
        "Content-Type": "image/svg+xml; charset=utf-8",
        "Cache-Control": "no-store",
      });
    }

    if (!run.remoteBaseUrl || artifact.simulated) {
      return c.json({ error: "远程结果配置不完整" }, 400);
    }

    try {
      const remote = await fetchComfyArtifact(
        run.remoteBaseUrl,
        artifact,
      );
      const headers = new Headers({
        "Cache-Control": "no-store",
        "Content-Type":
          remote.headers.get("content-type") ?? "application/octet-stream",
      });
      const length = remote.headers.get("content-length");
      if (length) headers.set("Content-Length", length);
      return new Response(remote.body, { status: 200, headers });
    } catch (error) {
      return c.json(
        {
          error:
            error instanceof Error ? error.message : "远程结果读取失败",
        },
        502,
      );
    }
  },
);
