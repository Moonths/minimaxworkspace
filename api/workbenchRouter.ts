import { TRPCError } from "@trpc/server";
import { z } from "zod";
import {
  executorModeSchema,
  normalizeComfyBaseUrl,
  parseWorkflowText,
  workflowNameSchema,
} from "@contracts/workbench";
import { checkComfyHealth, createComfyExecutor } from "./executors/comfyui";
import { mockExecutor } from "./executors/mock";
import { env } from "./lib/env";
import { createRouter, publicQuery } from "./middleware";
import {
  createRun,
  getLatestWorkflow,
  getRunById,
  getWorkflowById,
  listRuns,
  saveWorkflow,
  updateRun,
} from "./queries/workbench";

const idSchema = z.number().int().positive();
const optionalBaseUrl = z.string().trim().max(2048).optional();

function requiredRun(id: number) {
  return getRunById(id).then((run) => {
    if (!run) {
      throw new TRPCError({ code: "NOT_FOUND", message: "运行记录不存在" });
    }
    return run;
  });
}

export const workbenchRouter = createRouter({
  config: publicQuery.query(() => ({
    defaultMode: env.executorMode,
    defaultBaseUrl: env.comfyuiBaseUrl,
  })),

  health: publicQuery
    .input(
      z.object({
        mode: executorModeSchema,
        baseUrl: optionalBaseUrl,
      }),
    )
    .mutation(async ({ input }) => {
      if (input.mode === "mock") {
        return {
          ok: true,
          message: "模拟执行器就绪，仅用于验证工作台流程",
        };
      }
      const baseUrl = input.baseUrl || env.comfyuiBaseUrl;
      if (!baseUrl) {
        return {
          ok: false,
          code: "unconfigured",
          message: "请先填写 Windows ComfyUI 的 Tailscale 地址",
        };
      }
      return checkComfyHealth(baseUrl, env.comfyuiTimeoutMs);
    }),

  latestWorkflow: publicQuery.query(async () => {
    return (await getLatestWorkflow()) ?? null;
  }),

  saveWorkflow: publicQuery
    .input(
      z.object({
        id: idSchema.optional(),
        name: workflowNameSchema,
        text: z.string().max(10 * 1024 * 1024),
      }),
    )
    .mutation(async ({ input }) => {
      const { workflow } = parseWorkflowText(input.text);
      if (input.id && !(await getWorkflowById(input.id))) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "要更新的工作流不存在",
        });
      }
      return saveWorkflow({ id: input.id, name: input.name, apiJson: workflow });
    }),

  listRuns: publicQuery
    .input(z.object({ limit: z.number().int().min(1).max(50).default(20) }))
    .query(({ input }) => listRuns(input.limit)),

  getRun: publicQuery
    .input(z.object({ id: idSchema }))
    .query(({ input }) => requiredRun(input.id)),

  createRun: publicQuery
    .input(
      z.object({
        workflowId: idSchema,
        mode: executorModeSchema,
        baseUrl: optionalBaseUrl,
      }),
    )
    .mutation(async ({ input }) => {
      const workflow = await getWorkflowById(input.workflowId);
      if (!workflow) {
        throw new TRPCError({ code: "NOT_FOUND", message: "工作流不存在" });
      }

      let remoteBaseUrl: string | undefined;
      if (input.mode === "comfyui") {
        const baseUrl = input.baseUrl || env.comfyuiBaseUrl;
        if (!baseUrl) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "远程模式需要先配置 ComfyUI 地址",
          });
        }
        remoteBaseUrl = normalizeComfyBaseUrl(baseUrl);
      }

      let run = await createRun({
        workflowId: workflow.id,
        name: workflow.name,
        executor: input.mode,
        status: "queued",
        workflowSnapshot: structuredClone(workflow.apiJson),
        remoteBaseUrl,
      });

      try {
        const executor =
          input.mode === "mock"
            ? mockExecutor
            : createComfyExecutor(remoteBaseUrl!, env.comfyuiTimeoutMs);
        const submitted = await executor.submit(run);
        run = await updateRun(run.id, { remoteId: submitted.remoteId });
      } catch (error) {
        run = await updateRun(run.id, {
          status: "failed",
          error:
            error instanceof Error ? error.message.slice(0, 1000) : "提交失败",
        });
      }
      return run;
    }),

  syncRun: publicQuery
    .input(z.object({ id: idSchema }))
    .mutation(async ({ input }) => {
      const run = await requiredRun(input.id);
      if (run.status === "succeeded" || run.status === "failed") return run;

      try {
        const executor =
          run.executor === "mock"
            ? mockExecutor
            : createComfyExecutor(
                run.remoteBaseUrl ?? "",
                env.comfyuiTimeoutMs,
              );
        const result = await executor.sync(run);
        return await updateRun(run.id, {
          status: result.status,
          error: result.error,
          outputs: result.outputs,
        });
      } catch (error) {
        return await updateRun(run.id, {
          status: "failed",
          error:
            error instanceof Error ? error.message.slice(0, 1000) : "同步失败",
        });
      }
    }),
});
