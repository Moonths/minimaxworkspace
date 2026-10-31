import { useEffect, useMemo, useRef, useState } from "react";
import { format } from "date-fns";
import {
  Activity,
  Braces,
  CheckCircle2,
  ChevronRight,
  CircleAlert,
  Cloud,
  FileJson,
  History,
  Image as ImageIcon,
  LoaderCircle,
  Play,
  RefreshCw,
  Server,
  TerminalSquare,
  Upload,
  Video,
  Zap,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { trpc, type RouterOutputs } from "@/providers/trpc";
import {
  exampleWorkflowText,
  parseWorkflowText,
  type ExecutorMode,
  type RunArtifact,
  type RunStatus,
} from "@contracts/workbench";
import "../App.css";

type RunData = RouterOutputs["workbench"]["getRun"];

const statusMeta: Record<
  RunStatus,
  { label: string; className: string }
> = {
  queued: { label: "排队中", className: "status-queued" },
  running: { label: "运行中", className: "status-running" },
  succeeded: { label: "已完成", className: "status-succeeded" },
  failed: { label: "失败", className: "status-failed" },
};

function StatusBadge({ status }: { status: RunStatus }) {
  const meta = statusMeta[status];
  return (
    <span className={`status-badge ${meta.className}`}>
      <span className="status-dot" />
      {meta.label}
    </span>
  );
}

function ArtifactView({
  run,
  artifact,
  index,
}: {
  run: RunData;
  artifact: RunArtifact;
  index: number;
}) {
  const url = `/api/runs/${run.id}/artifacts/${index}`;
  return (
    <div className="artifact-item">
      <div className="artifact-preview">
        {artifact.kind === "image" ? (
          <img src={url} alt={`运行 ${run.id} 的结果 ${artifact.filename}`} />
        ) : (
          <video src={url} controls preload="metadata" />
        )}
      </div>
      <div className="artifact-caption">
        <span className="artifact-type">
          {artifact.kind === "image" ? <ImageIcon /> : <Video />}
          {artifact.filename}
        </span>
        <a href={url} download={artifact.filename}>
          下载
        </a>
      </div>
    </div>
  );
}

export default function Home() {
  const utils = trpc.useUtils();
  const configQuery = trpc.workbench.config.useQuery();
  const workflowQuery = trpc.workbench.latestWorkflow.useQuery();
  const runsQuery = trpc.workbench.listRuns.useQuery({ limit: 20 });

  const [mode, setMode] = useState<ExecutorMode>("mock");
  const [baseUrl, setBaseUrl] = useState("");
  const [workflowId, setWorkflowId] = useState<number | undefined>();
  const [workflowName, setWorkflowName] = useState("MiniMax H3 · 首个执行模板");
  const [workflowText, setWorkflowText] = useState(exampleWorkflowText);
  const [selectedRunId, setSelectedRunId] = useState<number | null>(null);
  const [actionError, setActionError] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const loadedConfig = useRef(false);
  const loadedWorkflow = useRef(false);

  useEffect(() => {
    if (!configQuery.data || loadedConfig.current) return;
    loadedConfig.current = true;
    setMode(configQuery.data.defaultMode);
    setBaseUrl(configQuery.data.defaultBaseUrl);
  }, [configQuery.data]);

  useEffect(() => {
    if (!workflowQuery.data || loadedWorkflow.current) return;
    loadedWorkflow.current = true;
    setWorkflowId(workflowQuery.data.id);
    setWorkflowName(workflowQuery.data.name);
    setWorkflowText(JSON.stringify(workflowQuery.data.apiJson, null, 2));
  }, [workflowQuery.data]);

  useEffect(() => {
    if (selectedRunId === null && runsQuery.data?.length) {
      setSelectedRunId(runsQuery.data[0].id);
    }
  }, [runsQuery.data, selectedRunId]);

  const selectedRunQuery = trpc.workbench.getRun.useQuery(
    { id: selectedRunId ?? 0 },
    { enabled: selectedRunId !== null },
  );
  const selectedRun = selectedRunId !== null ? selectedRunQuery.data : undefined;

  const healthMutation = trpc.workbench.health.useMutation();
  const saveMutation = trpc.workbench.saveWorkflow.useMutation();
  const createMutation = trpc.workbench.createRun.useMutation();
  const syncMutation = trpc.workbench.syncRun.useMutation({
    onSuccess: async (run) => {
      utils.workbench.getRun.setData({ id: run.id }, run);
      await utils.workbench.listRuns.invalidate();
    },
  });

  useEffect(() => {
    if (
      selectedRunId === null ||
      !selectedRun ||
      selectedRun.status === "succeeded" ||
      selectedRun.status === "failed"
    ) {
      return;
    }
    const timer = window.setInterval(() => {
      if (!syncMutation.isPending) syncMutation.mutate({ id: selectedRunId });
    }, 700);
    return () => window.clearInterval(timer);
  }, [selectedRunId, selectedRun, syncMutation]);

  const validation = useMemo(() => {
    try {
      return { ...parseWorkflowText(workflowText), error: "" };
    } catch (error) {
      return {
        workflow: null,
        nodeCount: 0,
        formatted: "",
        error: error instanceof Error ? error.message : "工作流格式无效",
      };
    }
  }, [workflowText]);

  function changeMode(nextMode: ExecutorMode) {
    setMode(nextMode);
    setActionError("");
    healthMutation.reset();
  }

  async function handleImport(file: File | undefined) {
    if (!file) return;
    setActionError("");
    try {
      const text = await file.text();
      setWorkflowText(text);
      setWorkflowName(file.name.replace(/\.json$/i, "") || "导入的工作流");
      setWorkflowId(undefined);
    } catch {
      setActionError("无法读取所选 JSON 文件");
    } finally {
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  }

  async function handleSubmit() {
    setActionError("");
    if (!validation.workflow) {
      setActionError(validation.error);
      return;
    }
    if (mode === "comfyui" && !baseUrl.trim()) {
      setActionError("远程模式需要先填写 ComfyUI 地址");
      return;
    }

    setIsSubmitting(true);
    try {
      const saved = await saveMutation.mutateAsync({
        id: workflowId,
        name: workflowName,
        text: workflowText,
      });
      setWorkflowId(saved.id);
      const run = await createMutation.mutateAsync({
        workflowId: saved.id,
        mode,
        baseUrl: mode === "comfyui" ? baseUrl : undefined,
      });
      setSelectedRunId(run.id);
      utils.workbench.getRun.setData({ id: run.id }, run);
      await Promise.all([
        utils.workbench.listRuns.invalidate(),
        utils.workbench.latestWorkflow.invalidate(),
      ]);
    } catch (error) {
      setActionError(
        error instanceof Error ? error.message : "任务提交失败，请稍后重试",
      );
    } finally {
      setIsSubmitting(false);
    }
  }

  const isBusy = isSubmitting || saveMutation.isPending || createMutation.isPending;
  const runs = runsQuery.data ?? [];

  return (
    <div className="workbench-shell">
      <header className="topbar">
        <div className="brand-lockup">
          <div className="brand-mark">MW</div>
          <div>
            <div className="brand-name">MINIMAX WORKSPACE</div>
            <div className="brand-subtitle">对话式视频工作台 · 执行基线</div>
          </div>
        </div>
        <div className="change-marker">
          <span>CHANGE 001</span>
          <strong>bootstrap-execution-workbench</strong>
        </div>
        <div className={`global-mode ${mode === "comfyui" ? "remote" : ""}`}>
          {mode === "mock" ? <Zap /> : <Cloud />}
          <span>{mode === "mock" ? "模拟执行" : "远程 ComfyUI"}</span>
        </div>
      </header>

      <main className="workspace-grid">
        <aside className="left-rail">
          <section className="rail-section executor-section">
            <div className="section-heading">
              <span>执行器</span>
              <Activity />
            </div>
            <div className="mode-switch" aria-label="执行器模式">
              <button
                type="button"
                aria-pressed={mode === "mock"}
                className={mode === "mock" ? "active" : ""}
                onClick={() => changeMode("mock")}
              >
                <Zap /> 模拟
              </button>
              <button
                type="button"
                aria-pressed={mode === "comfyui"}
                className={mode === "comfyui" ? "active" : ""}
                onClick={() => changeMode("comfyui")}
              >
                <Cloud /> 远程
              </button>
            </div>
            <p className="section-note">
              {mode === "mock"
                ? "生成协议级 SVG，不调用模型，用于验证完整流程。"
                : "由工作台服务端经 Tailscale 连接 Windows ComfyUI。"}
            </p>

            {mode === "comfyui" && (
              <div className="connection-form">
                <label htmlFor="comfy-url">ComfyUI 基础地址</label>
                <Input
                  id="comfy-url"
                  value={baseUrl}
                  onChange={(event) => {
                    setBaseUrl(event.target.value);
                    healthMutation.reset();
                  }}
                  placeholder="http://100.x.x.x:8188"
                  spellCheck={false}
                  autoComplete="off"
                />
                <Button
                  type="button"
                  variant="outline"
                  className="full-action"
                  disabled={healthMutation.isPending}
                  onClick={() =>
                    healthMutation.mutate({ mode, baseUrl: baseUrl || undefined })
                  }
                >
                  {healthMutation.isPending ? (
                    <LoaderCircle className="spin" />
                  ) : (
                    <Server />
                  )}
                  检查连接
                </Button>
              </div>
            )}

            {healthMutation.data && (
              <div
                className={`health-result ${healthMutation.data.ok ? "ok" : "error"}`}
                role="status"
              >
                {healthMutation.data.ok ? <CheckCircle2 /> : <CircleAlert />}
                <div>
                  <strong>{healthMutation.data.ok ? "连接可用" : "尚未连接"}</strong>
                  <p>{healthMutation.data.message}</p>
                  {"device" in healthMutation.data && healthMutation.data.device && (
                    <small>{healthMutation.data.device}</small>
                  )}
                </div>
              </div>
            )}
          </section>

          <section className="rail-section history-section">
            <div className="section-heading">
              <span>最近执行</span>
              <button
                type="button"
                className="icon-action"
                aria-label="刷新执行记录"
                title="刷新执行记录"
                onClick={() => runsQuery.refetch()}
              >
                <RefreshCw className={runsQuery.isFetching ? "spin" : ""} />
              </button>
            </div>
            <div className="run-list">
              {runs.length === 0 && (
                <div className="empty-history">
                  <History />
                  <p>还没有执行记录</p>
                  <span>提交一个工作流后，会在这里持续保留。</span>
                </div>
              )}
              {runs.map((run) => (
                <button
                  type="button"
                  className={`run-list-item ${selectedRunId === run.id ? "selected" : ""}`}
                  key={run.id}
                  onClick={() => setSelectedRunId(run.id)}
                >
                  <div className="run-item-topline">
                    <span>RUN #{run.id}</span>
                    <StatusBadge status={run.status} />
                  </div>
                  <strong>{run.name}</strong>
                  <div className="run-item-meta">
                    <span>{run.executor === "mock" ? "模拟" : "远程"}</span>
                    <time>{format(run.createdAt, "MM-dd HH:mm:ss")}</time>
                  </div>
                </button>
              ))}
            </div>
          </section>
        </aside>

        <section className="editor-stage">
          <div className="editor-header">
            <div>
              <div className="eyebrow-label">WORKFLOW / API FORMAT</div>
              <h1>远程执行台</h1>
              <p>用一个已验证工作流，打通从提交到结果的完整路径。</p>
            </div>
            <div className="workflow-stat">
              <Braces />
              <span>{validation.nodeCount}</span>
              <small>节点</small>
            </div>
          </div>

          <div className="workflow-toolbar">
            <div className="workflow-name-field">
              <label htmlFor="workflow-name">工作流名称</label>
              <Input
                id="workflow-name"
                value={workflowName}
                maxLength={120}
                onChange={(event) => setWorkflowName(event.target.value)}
              />
            </div>
            <input
              ref={fileInputRef}
              className="visually-hidden"
              type="file"
              accept="application/json,.json"
              onChange={(event) => handleImport(event.target.files?.[0])}
            />
            <Button
              type="button"
              variant="outline"
              onClick={() => fileInputRef.current?.click()}
            >
              <Upload /> 导入 JSON
            </Button>
            <Button
              type="button"
              variant="ghost"
              onClick={() => {
                setWorkflowText(exampleWorkflowText);
                setWorkflowId(undefined);
                setWorkflowName("MiniMax H3 · 首个执行模板");
              }}
            >
              <FileJson /> 使用示例
            </Button>
          </div>

          <div className={`code-editor ${validation.error ? "invalid" : ""}`}>
            <div className="code-editor-bar">
              <span>
                <TerminalSquare /> workflow.api.json
              </span>
              <span>{workflowText.length.toLocaleString()} 字符</span>
            </div>
            <Textarea
              aria-label="ComfyUI API 格式工作流 JSON"
              value={workflowText}
              onChange={(event) => {
                setWorkflowText(event.target.value);
                setActionError("");
              }}
              spellCheck={false}
              className="workflow-code"
            />
          </div>
          <div className="editor-validation" aria-live="polite">
            {validation.error ? (
              <span className="validation-error"><CircleAlert /> {validation.error}</span>
            ) : (
              <span className="validation-ok"><CheckCircle2 /> API 格式有效，可以提交</span>
            )}
          </div>

          {actionError && (
            <div className="action-error" role="alert">
              <CircleAlert /> <span>{actionError}</span>
            </div>
          )}

          <div className="submit-bar">
            <div className="submit-context">
              <span className={`context-dot ${mode}`} />
              <div>
                <strong>{mode === "mock" ? "模拟执行器" : "ComfyUI 远程执行器"}</strong>
                <span>提交时保存不可变工作流快照</span>
              </div>
            </div>
            <Button
              type="button"
              className="primary-run"
              disabled={isBusy}
              onClick={handleSubmit}
            >
              {isBusy ? <LoaderCircle className="spin" /> : <Play />}
              {isBusy ? "正在提交" : "提交执行"}
            </Button>
          </div>
        </section>

        <aside className="run-inspector">
          <div className="inspector-heading">
            <div>
              <span className="eyebrow-label">RUN INSPECTOR</span>
              <h2>执行检查器</h2>
            </div>
            {selectedRun && <StatusBadge status={selectedRun.status} />}
          </div>

          {!selectedRun && (
            <div className="empty-inspector">
              <Activity />
              <h3>等待一次执行</h3>
              <p>提交后，这里会显示状态、错误、结果和完整输入快照。</p>
            </div>
          )}

          {selectedRun && (
            <div className="run-detail">
              <div className="run-identity">
                <span>RUN #{selectedRun.id}</span>
                <h3>{selectedRun.name}</h3>
                <p>
                  {selectedRun.executor === "mock" ? "模拟执行" : "远程 ComfyUI"}
                  {" · "}
                  {format(selectedRun.createdAt, "yyyy-MM-dd HH:mm:ss")}
                </p>
              </div>

              {selectedRun.status !== "failed" ? (
                <div className="run-timeline">
                  {(["queued", "running", "succeeded"] as const).map((status, index) => {
                    const currentIndex = ["queued", "running", "succeeded"].indexOf(
                      selectedRun.status,
                    );
                    return (
                      <div
                        className={`timeline-step ${index <= currentIndex ? "reached" : ""}`}
                        key={status}
                      >
                        <span>{index + 1}</span>
                        <small>{statusMeta[status].label}</small>
                      </div>
                    );
                  })}
                </div>
              ) : (
                <div className="run-error">
                  <CircleAlert />
                  <div>
                    <strong>执行失败</strong>
                    <p>{selectedRun.error || "未返回详细错误"}</p>
                  </div>
                </div>
              )}

              <section className="outputs-section">
                <div className="section-heading">
                  <span>输出结果</span>
                  <span>{selectedRun.outputs?.length ?? 0}</span>
                </div>
                {selectedRun.status === "succeeded" &&
                  (!selectedRun.outputs || selectedRun.outputs.length === 0) && (
                    <div className="no-outputs">任务已完成，但未发现可识别结果。</div>
                  )}
                {selectedRun.outputs?.map((artifact, index) => (
                  <ArtifactView
                    key={`${artifact.filename}-${index}`}
                    run={selectedRun}
                    artifact={artifact}
                    index={index}
                  />
                ))}
                {selectedRun.status !== "succeeded" && selectedRun.status !== "failed" && (
                  <div className="waiting-output">
                    <LoaderCircle className="spin" />
                    <span>正在等待执行结果</span>
                  </div>
                )}
              </section>

              <details className="snapshot-details">
                <summary>
                  查看提交快照 <ChevronRight />
                </summary>
                <pre>{JSON.stringify(selectedRun.workflowSnapshot, null, 2)}</pre>
              </details>
            </div>
          )}
        </aside>
      </main>

      <footer className="statusbar">
        <span><span className="live-dot" /> OPENSPEC / SPEC-DRIVEN</span>
        <span>浏览器 → 工作台后端 → Tailscale → ComfyUI</span>
        <span>{runs.length} 条执行记录</span>
      </footer>
    </div>
  );
}
