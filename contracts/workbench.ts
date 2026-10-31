import { z } from "zod";

export const executorModeSchema = z.enum(["mock", "comfyui"]);
export type ExecutorMode = z.infer<typeof executorModeSchema>;

export const runStatusSchema = z.enum([
  "queued",
  "running",
  "succeeded",
  "failed",
]);
export type RunStatus = z.infer<typeof runStatusSchema>;

export const workflowNodeSchema = z
  .object({
    class_type: z.string().trim().min(1),
    inputs: z.record(z.string(), z.unknown()),
  })
  .loose();

export const apiWorkflowSchema = z
  .record(z.string(), workflowNodeSchema)
  .refine((value) => Object.keys(value).length > 0, {
    message: "工作流至少需要一个节点",
  });

export type ApiWorkflow = z.infer<typeof apiWorkflowSchema>;

export const artifactSchema = z.object({
  filename: z.string(),
  subfolder: z.string().default(""),
  type: z.string().default("output"),
  kind: z.enum(["image", "video"]),
  simulated: z.boolean().default(false),
});
export type RunArtifact = z.infer<typeof artifactSchema>;

export const workflowNameSchema = z
  .string()
  .trim()
  .min(1, "请输入工作流名称")
  .max(120, "工作流名称不能超过 120 个字符");

export const comfyBaseUrlSchema = z
  .string()
  .trim()
  .max(2048)
  .superRefine((value, ctx) => {
    try {
      normalizeComfyBaseUrl(value);
    } catch (error) {
      ctx.addIssue({
        code: "custom",
        message: error instanceof Error ? error.message : "远程地址无效",
      });
    }
  });

export class WorkflowValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "WorkflowValidationError";
  }
}

export function normalizeComfyBaseUrl(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) {
    throw new Error("请输入 ComfyUI 地址");
  }

  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    throw new Error("请输入完整地址，例如 http://100.x.x.x:8188");
  }

  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error("ComfyUI 地址仅支持 HTTP 或 HTTPS");
  }
  if (url.username || url.password) {
    throw new Error("地址中不能包含用户名或密码");
  }

  url.hash = "";
  url.search = "";
  url.pathname = url.pathname.replace(/\/+$/, "");
  return url.toString().replace(/\/$/, "");
}

export function parseWorkflowText(text: string): {
  workflow: ApiWorkflow;
  nodeCount: number;
  formatted: string;
} {
  if (!text.trim()) {
    throw new WorkflowValidationError("请粘贴或导入 ComfyUI API 格式工作流");
  }

  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    throw new WorkflowValidationError("JSON 无法解析，请检查括号、引号和逗号");
  }

  if (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value) &&
    ("nodes" in value || "links" in value)
  ) {
    throw new WorkflowValidationError(
      "这看起来是 ComfyUI 界面格式，请使用“导出 API 格式”的工作流",
    );
  }

  const result = apiWorkflowSchema.safeParse(value);
  if (!result.success) {
    throw new WorkflowValidationError(
      "工作流必须是节点对象，且每个节点包含 class_type 与 inputs",
    );
  }

  return {
    workflow: result.data,
    nodeCount: Object.keys(result.data).length,
    formatted: JSON.stringify(result.data, null, 2),
  };
}

export const exampleWorkflowText = JSON.stringify(
  {
    "1": {
      class_type: "CheckpointLoaderSimple",
      inputs: { ckpt_name: "example.safetensors" },
    },
    "2": {
      class_type: "SaveImage",
      inputs: { filename_prefix: "MiniMaxWorkspace", images: ["1", 0] },
    },
  },
  null,
  2,
);
