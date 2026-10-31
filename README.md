# MiniMax Workspace

面向个人 AI 视频创作流程的 ComfyUI 执行工作台。当前变更先打通一个可验收的纵向闭环：导入 ComfyUI **API 格式**工作流，保存不可变快照，通过模拟或远程执行器提交任务，恢复状态并预览结果。

> 当前版本不会把自然语言转换为工作流，也尚未使用真实 MiniMax H3 工作流完成真机生成验收。模拟模式只生成带明确标识的 SVG，用于验证产品流程，不调用任何模型。

## 当前能力

- 模拟／ComfyUI 执行器切换，全局模式标识和远程健康检查。
- 粘贴或导入 ComfyUI API JSON，识别损坏 JSON 与 ComfyUI 界面格式。
- 工作流记录与运行快照分离，后续编辑不会改写历史运行。
- 排队、运行、成功、失败状态，按需轮询和错误摘要。
- 历史记录恢复、图片／视频结果预览和受控下载代理。
- 无真实 ComfyUI 时，可用模拟执行器验收完整交互。
- 使用 OpenSpec 管理需求、设计、任务和后续归档。

首版暂不包含自然语言转 VideoSpec、多分镜编排、组件市场和通用节点编辑器。

## 架构与网络边界

```text
Mac 浏览器
   │ HTTP
   ▼
MiniMax Workspace 后端（Hono + tRPC）
   │ Tailscale 私网
   ▼
Windows PC 上的 ComfyUI（MiniMax H3）
```

- 前端：React 19、TypeScript、Vite、Tailwind CSS。
- 服务端：Hono、tRPC、Superjson。
- 持久化：Drizzle ORM + MySQL。
- 执行器：统一 `TaskExecutor` 接口，分为 `mock` 和 `comfyui`。
- 浏览器只访问工作台后端，不直接访问 ComfyUI。
- 结果代理由运行 ID 和结果序号驱动；浏览器不能传入任意远程文件地址。
- 首版是受控私网中的单用户应用，没有登录和多用户权限，**不要直接暴露到公网**。

代码入口：

```text
contracts/workbench.ts          共享类型、API JSON 校验
api/executors/                 模拟与 ComfyUI 执行器
api/workbenchRouter.ts         工作台 tRPC 接口
api/routes/artifacts.ts        受控结果代理
db/schema.ts                   工作流与运行记录
src/pages/Home.tsx             三栏执行台
openspec/changes/              需求变更与实施任务
```

## 环境要求

- Node.js 20.19+ 或 22.12+。
- 一个可访问的 MySQL 数据库。
- 远程执行时：Mac 与 Windows 均加入同一 Tailscale 网络，Windows 已启动 ComfyUI。
- Windows 上的模型、自定义节点和 MiniMax H3 环境由 ComfyUI 侧单独维护。

## Mac 本地启动

```bash
npm install
cp .env.example .env
```

编辑 `.env`，至少填写：

```bash
APP_ID=minimax-workspace-local
APP_SECRET=请替换为本地随机长字符串
DATABASE_URL=mysql://用户名:密码@主机:端口/数据库名
EXECUTOR_MODE=mock
COMFYUI_BASE_URL=
COMFYUI_TIMEOUT_MS=10000
```

初始化数据库并启动开发服务：

```bash
npm run db:push
npm run dev
```

打开 `http://localhost:3000`。`.env` 只保留在本机，不得提交 Git。

## Windows ComfyUI 与 Tailscale

1. 在 Windows 启动 ComfyUI，并确认所需模型和自定义节点已经可用。
2. 让 ComfyUI 监听 Tailscale 接口；具体启动参数按你的 ComfyUI 安装方式配置。
3. 在 Mac 的 Tailscale 网络中确认能访问 Windows 的私网地址。
4. 在工作台切换到“远程”，填写基础地址，例如 `http://100.x.x.x:8188`，不要附加 `/prompt`。
5. 先点击“检查连接”，再导入一个已经在该 Windows 环境验证过的 **API 格式**工作流。

Windows 如需共同开发，可检出同一代码仓库并按上面的本地命令运行；仅提供 ComfyUI 执行服务时，无需在 Windows 启动工作台。

真实 Tailscale 地址、API Key、账号密码、模型文件和生成媒体不得进入 README、OpenSpec、测试或 Git 提交。详细约束见 `docs/configuration.md`。

## 工作流格式

在 ComfyUI 中导出 **API Format / API 格式**，而不是界面编辑器使用的 `nodes`／`links` JSON。每个顶层节点应包含：

```json
{
  "1": {
    "class_type": "CheckpointLoaderSimple",
    "inputs": {
      "ckpt_name": "example.safetensors"
    }
  }
}
```

页面中的“使用示例”只用于测试校验与模拟执行，不代表可直接运行的 MiniMax H3 工作流。

## 生产构建与冷启动

```bash
npm run check
npm run test
npm run build
npm start
```

生产服务默认监听 `http://localhost:3000`，读取同一份 `.env`。首次部署或表结构变化后，先执行 `npm run db:push`；需要纳入版本控制的正式迁移时，再使用 `npm run db:generate` 和 `npm run db:migrate`。

## OpenSpec 工作流

当前变更：`bootstrap-execution-workbench`。

```bash
# 查看变更和任务进度
npx openspec list
npx openspec instructions apply --change bootstrap-execution-workbench

# 严格校验需求格式
npx openspec validate bootstrap-execution-workbench --strict
```

实施时按 `tasks.md` 完成一项勾选一个。变更需先经过审阅和验收，再归档；不要在实现过程中提前归档。

## 验证

```bash
npm run check
npm run lint
npm run test
npm run build
npx openspec validate bootstrap-execution-workbench --strict
```

测试覆盖工作流契约、数据库快照、模拟状态迁移、ComfyUI HTTP 协议、错误分类、结果代理和工作台 HTTP 主流程。ComfyUI 协议测试使用本地伪服务，不等同于真实 MiniMax H3 模型或 Windows 环境的联调验收。

## Git 与敏感文件

`.gitignore` 已排除 `.env`、模型目录、输出目录、常见模型权重和视频文件。两台机器同步代码前，应检查：

```bash
git status --short
git check-ignore .env
```

只提交源码、不包含真实环境信息的 `.env.example`、文档和 OpenSpec 变更。
