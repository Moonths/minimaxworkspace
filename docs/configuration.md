# 配置与私网边界

## 本地配置

复制 `.env.example` 为 `.env`，填写数据库和远程执行配置。`.env`、其他 `.env.*` 本地文件、模型目录和生成媒体均不进入 Git；只有不包含真实地址与凭据的 `.env.example` 可以提交。

```bash
EXECUTOR_MODE=mock
COMFYUI_BASE_URL=http://100.x.x.x:8188
COMFYUI_TIMEOUT_MS=10000
```

- `EXECUTOR_MODE`：默认执行器。首次联调建议保持 `mock`。
- `COMFYUI_BASE_URL`：Windows 上 ComfyUI 的 Tailscale 地址，不包含 `/prompt` 等接口路径。
- `COMFYUI_TIMEOUT_MS`：服务端访问 ComfyUI 的单次请求超时。

## 网络边界

工作台后端通过 Tailscale 访问 ComfyUI，浏览器只访问工作台后端。ComfyUI 不应为此暴露到公网。首版面向受控私网中的单用户场景，不包含登录与多用户权限，不应直接部署到不可信公网。

真实地址不得写入 OpenSpec、README、测试快照或 Git 提交。工作流 JSON 可以包含模型文件名，但不得包含 API Key、账号密码或其他敏感信息。
