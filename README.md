# 黑暗森林 · 网页卡牌游戏

支持 3–6 人在线对战、多人全知观战和同设备 Demo。游戏规则以项目根目录的 `docs/项目规则摘要.md` 和后续用户裁定为准。

## 在线功能

- 使用账号名和密码注册或登录，账号有固定的 8 位 ID；好友可申请、查看状态和邀请进入房间。加入房间需输入 6 位房间码。
- 房间支持 3–6 名真人或 AI 玩家，以及多个观战者；玩家与观战者可以按设置保存、下载和导入回放。
- 服务器使用 Cloudflare Workers 和 SQLite Durable Objects 保存账号、房间和对局，由权威规则引擎处理行动，并通过 WebSocket 按身份发送视角。支持跨浏览器登录后恢复座位。
- 三档本地 AI 每次行动前等待 5 秒；DeepSeek 不额外等待。DeepSeek 每座位保留独立对话，使用 `deepseek-flash`、开启思考并设置 `high` 推理。每次决策会重发当前对话，长局输入和费用可能增长；API 失败时回退本地策略。
- 真人行动没有自动超时。只剩一名文明时，仍须等待全部在飞打击结算后结束；没有启用 240 回合强制结束。

## 本地运行和测试

安装 Node.js 22 和 pnpm 10，在本目录运行：

```sh
pnpm install --frozen-lockfile
pnpm dev
```

访问终端显示的地址。`pnpm demo` 只运行静态同设备演示，不提供在线账号和房间。运行 `pnpm test` 执行 Node 测试。`pnpm check:worker` 和 `pnpm check:social` 是需要本地 Worker 服务的检查脚本。

## 配置和部署

Worker 配置位于 `wrangler.jsonc`，入口是 `server/worker.js`，静态资源和共享规则当前位于 `dist/`。在线账号需要配置 `AUTH_PEPPER`，DeepSeek 需要 `DEEPSEEK_API_KEY`，后台日志接口需要 `ADMIN_LOG_TOKEN`。密钥应通过 Worker Secret 配置；本地开发可使用不纳入版本控制的 `.dev.vars`。

`pnpm deploy` 部署到 Cloudflare。GitHub Actions 在推送 `main` 或手动触发时安装依赖、运行测试，测试通过后才部署。Actions 需要仓库 Secret `CLOUDFLARE_API_TOKEN` 和 `CLOUDFLARE_ACCOUNT_ID`。

线上后台日志可能包含隐藏牌局信息，只能通过管理员密钥读取。`pnpm logs` 列出对局索引，具体导出参数见 `scripts/export-private-logs.mjs`；不要提交密钥或导出的私有日志。
