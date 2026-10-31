import { describe, expect, it } from "vitest";
import {
  exampleWorkflowText,
  normalizeComfyBaseUrl,
  parseWorkflowText,
  WorkflowValidationError,
} from "@contracts/workbench";

describe("工作流契约", () => {
  it("接受有效的 API 格式并统计节点", () => {
    const result = parseWorkflowText(exampleWorkflowText);
    expect(result.nodeCount).toBe(2);
    expect(result.workflow["1"]?.class_type).toBe("CheckpointLoaderSimple");
  });

  it("拒绝损坏 JSON", () => {
    expect(() => parseWorkflowText('{"1":')).toThrow(WorkflowValidationError);
    expect(() => parseWorkflowText('{"1":')).toThrow("JSON 无法解析");
  });

  it("识别并拒绝界面格式", () => {
    expect(() =>
      parseWorkflowText(JSON.stringify({ nodes: [], links: [] })),
    ).toThrow("导出 API 格式");
  });

  it("拒绝缺少 inputs 的节点", () => {
    expect(() =>
      parseWorkflowText(JSON.stringify({ "1": { class_type: "Test" } })),
    ).toThrow("每个节点包含 class_type 与 inputs");
  });
});

describe("ComfyUI 地址", () => {
  it("规范化末尾斜杠", () => {
    expect(normalizeComfyBaseUrl("http://100.64.0.1:8188/")).toBe(
      "http://100.64.0.1:8188",
    );
  });

  it("拒绝非 HTTP 协议与内嵌凭据", () => {
    expect(() => normalizeComfyBaseUrl("file:///tmp/comfy")).toThrow(
      "仅支持 HTTP 或 HTTPS",
    );
    expect(() =>
      normalizeComfyBaseUrl("http://user:secret@100.64.0.1:8188"),
    ).toThrow("不能包含用户名或密码");
  });
});
