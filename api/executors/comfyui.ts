import {
  normalizeComfyBaseUrl,
  type ApiWorkflow,
  type RunArtifact,
} from "@contracts/workbench";
import type { TaskExecutor } from "./types";

export type ComfyErrorCode =
  | "invalid_url"
  | "unreachable"
  | "timeout"
  | "http"
  | "invalid_response";

export class ComfyApiError extends Error {
  readonly code: ComfyErrorCode;

  constructor(code: ComfyErrorCode, message: string) {
    super(message);
    this.name = "ComfyApiError";
    this.code = code;
  }
}

export type ComfyHealth = {
  ok: boolean;
  message: string;
  code?: ComfyErrorCode;
  device?: string;
  queueRunning?: number;
  queuePending?: number;
};

async function fetchJson(
  baseUrl: string,
  path: string,
  init: RequestInit = {},
  timeoutMs = 10_000,
): Promise<unknown> {
  let normalized: string;
  try {
    normalized = normalizeComfyBaseUrl(baseUrl);
  } catch (error) {
    throw new ComfyApiError(
      "invalid_url",
      error instanceof Error ? error.message : "ComfyUI 地址无效",
    );
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(`${normalized}${path}`, {
      ...init,
      signal: controller.signal,
      headers: {
        Accept: "application/json",
        ...init.headers,
      },
    });
    if (!response.ok) {
      const body = (await response.text()).slice(0, 300);
      throw new ComfyApiError(
        "http",
        `ComfyUI 返回 HTTP ${response.status}${body ? `：${body}` : ""}`,
      );
    }
    try {
      return await response.json();
    } catch {
      throw new ComfyApiError(
        "invalid_response",
        "服务已响应，但不是可识别的 ComfyUI JSON",
      );
    }
  } catch (error) {
    if (error instanceof ComfyApiError) throw error;
    if (controller.signal.aborted) {
      throw new ComfyApiError(
        "timeout",
        `连接超过 ${timeoutMs}ms，请检查 Tailscale 与 ComfyUI 状态`,
      );
    }
    throw new ComfyApiError(
      "unreachable",
      "无法连接 ComfyUI，请检查地址、Tailscale 和远程服务是否启动",
    );
  } finally {
    clearTimeout(timeout);
  }
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

export async function checkComfyHealth(
  baseUrl: string,
  timeoutMs?: number,
): Promise<ComfyHealth> {
  try {
    const [systemValue, queueValue] = await Promise.all([
      fetchJson(baseUrl, "/system_stats", {}, timeoutMs),
      fetchJson(baseUrl, "/queue", {}, timeoutMs),
    ]);
    const system = asRecord(systemValue);
    const queue = asRecord(queueValue);
    if (!system || !queue || !Array.isArray(queue.queue_running)) {
      throw new ComfyApiError(
        "invalid_response",
        "服务响应缺少 ComfyUI 系统或队列信息",
      );
    }

    const devices = Array.isArray(system.devices) ? system.devices : [];
    const firstDevice = asRecord(devices[0]);
    return {
      ok: true,
      message: "ComfyUI 已连接，系统与队列接口可用",
      device:
        typeof firstDevice?.name === "string" ? firstDevice.name : undefined,
      queueRunning: queue.queue_running.length,
      queuePending: Array.isArray(queue.queue_pending)
        ? queue.queue_pending.length
        : 0,
    };
  } catch (error) {
    if (error instanceof ComfyApiError) {
      return { ok: false, code: error.code, message: error.message };
    }
    return {
      ok: false,
      code: "unreachable",
      message: "健康检查失败，请检查远程服务",
    };
  }
}

export async function submitComfyPrompt(
  baseUrl: string,
  workflow: ApiWorkflow,
  timeoutMs?: number,
): Promise<string> {
  const value = await fetchJson(
    baseUrl,
    "/prompt",
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ prompt: workflow, client_id: crypto.randomUUID() }),
    },
    timeoutMs,
  );
  const response = asRecord(value);
  if (typeof response?.prompt_id !== "string" || !response.prompt_id) {
    throw new ComfyApiError(
      "invalid_response",
      "ComfyUI 未返回有效的 prompt_id",
    );
  }
  return response.prompt_id;
}

function queueContains(value: unknown, remoteId: string): boolean {
  return (
    Array.isArray(value) &&
    value.some(
      (item) => Array.isArray(item) && item[1] === remoteId,
    )
  );
}

function historyError(entry: Record<string, unknown>): string {
  const status = asRecord(entry.status);
  const messages = Array.isArray(status?.messages) ? status.messages : [];
  for (const message of messages) {
    if (!Array.isArray(message)) continue;
    const details = asRecord(message[1]);
    if (typeof details?.exception_message === "string") {
      return details.exception_message.slice(0, 1000);
    }
  }
  return "ComfyUI 返回执行失败，请在远程日志中查看节点错误";
}

export function extractArtifacts(value: unknown): RunArtifact[] {
  const outputs = asRecord(value);
  if (!outputs) return [];
  const artifacts: RunArtifact[] = [];

  for (const nodeOutput of Object.values(outputs)) {
    const record = asRecord(nodeOutput);
    if (!record) continue;
    for (const key of ["images", "gifs", "videos"] as const) {
      const files = record[key];
      if (!Array.isArray(files)) continue;
      for (const file of files) {
        const item = asRecord(file);
        if (typeof item?.filename !== "string") continue;
        artifacts.push({
          filename: item.filename,
          subfolder:
            typeof item.subfolder === "string" ? item.subfolder : "",
          type: typeof item.type === "string" ? item.type : "output",
          kind: key === "images" ? "image" : "video",
          simulated: false,
        });
      }
    }
  }
  return artifacts;
}

export async function syncComfyPrompt(
  baseUrl: string,
  remoteId: string,
  timeoutMs?: number,
): Promise<{
  status: "queued" | "running" | "succeeded" | "failed";
  error?: string;
  outputs?: RunArtifact[];
}> {
  const historyValue = await fetchJson(
    baseUrl,
    `/history/${encodeURIComponent(remoteId)}`,
    {},
    timeoutMs,
  );
  const history = asRecord(historyValue);
  const entry = asRecord(history?.[remoteId]);
  if (entry) {
    const status = asRecord(entry.status);
    if (status?.status_str === "error") {
      return { status: "failed", error: historyError(entry) };
    }
    return {
      status: "succeeded",
      outputs: extractArtifacts(entry.outputs),
    };
  }

  const queueValue = await fetchJson(baseUrl, "/queue", {}, timeoutMs);
  const queue = asRecord(queueValue);
  if (queueContains(queue?.queue_running, remoteId)) {
    return { status: "running" };
  }
  return { status: "queued" };
}

export async function fetchComfyArtifact(
  baseUrl: string,
  artifact: RunArtifact,
  timeoutMs = 10_000,
): Promise<Response> {
  const normalized = normalizeComfyBaseUrl(baseUrl);
  const query = new URLSearchParams({
    filename: artifact.filename,
    subfolder: artifact.subfolder,
    type: artifact.type,
  });
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(`${normalized}/view?${query}`, {
      signal: controller.signal,
    });
    if (!response.ok) {
      throw new ComfyApiError(
        "http",
        `结果文件读取失败：HTTP ${response.status}`,
      );
    }
    return response;
  } catch (error) {
    if (error instanceof ComfyApiError) throw error;
    if (controller.signal.aborted) {
      throw new ComfyApiError("timeout", "结果文件读取超时");
    }
    throw new ComfyApiError("unreachable", "无法从 ComfyUI 读取结果文件");
  } finally {
    clearTimeout(timeout);
  }
}

export function createComfyExecutor(
  baseUrl: string,
  timeoutMs?: number,
): TaskExecutor {
  return {
    async submit(run) {
      const remoteId = await submitComfyPrompt(
        baseUrl,
        run.workflowSnapshot,
        timeoutMs,
      );
      return { remoteId };
    },
    async sync(run) {
      if (!run.remoteId) {
        return { status: "failed", error: "远程任务缺少 prompt_id" };
      }
      return syncComfyPrompt(baseUrl, run.remoteId, timeoutMs);
    },
  };
}
