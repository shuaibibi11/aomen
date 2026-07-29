# 2026-07-29 本地仓库验收记录

本文件记录一次开发者工作站上的本地验收，**不是 CI 结果**，也不证明历史计划中的命令曾在当时执行。记录目的仅是让本次会话实际执行的范围、环境和结果可审查，而不粘贴大量生成日志或任何敏感值。

## 验收基线

- 日期：2026-07-29
- 分支：`docs/socket-ai-workflow`
- validated commit：`ca8bc64d47d286d694980dd536e3c4a5f5ac79e3`
- 操作系统：Windows
- Node.js：`v22.17.0`
- pnpm：`10.29.3`
- 工作区：8 个项目（根项目加 7 个可构建/测试 workspace 项目）

本文档本身在上述 commit 之后创建；“validated commit”特指执行以下验收命令时的代码基线，不把文档提交误写为被测代码。

## 精确命令与结果

所有命令均从仓库根目录执行，并显式切换目录。下列命令退出码均为 `0`。

```powershell
Set-Location "E:\澳门开发-worktrees\docs-validation"; node -v; pnpm -v
Set-Location "E:\澳门开发-worktrees\docs-validation"; pnpm install --frozen-lockfile
Set-Location "E:\澳门开发-worktrees\docs-validation"; pnpm build
Set-Location "E:\澳门开发-worktrees\docs-validation"; pnpm test
Set-Location "E:\澳门开发-worktrees\docs-validation"; pnpm typecheck
Set-Location "E:\澳门开发-worktrees\docs-validation"; pnpm --filter @mct/server test
Set-Location "E:\澳门开发-worktrees\docs-validation"; pnpm --filter @mct/table-3d test
Set-Location "E:\澳门开发-worktrees\docs-validation"; pnpm --filter @mct/room-client test
Set-Location "E:\澳门开发-worktrees\docs-validation"; pnpm --filter @mct/room-protocol test
```

测试和构建摘要：

| 检查 | 本地实测结果 |
| --- | --- |
| frozen install | 成功；lockfile 已是最新，无依赖变更 |
| `pnpm build` | 7/7 workspace 项目成功 |
| `pnpm test` | 35 个测试文件、507 个测试通过 |
| `pnpm typecheck` | 7/7 workspace 项目成功 |
| `@mct/server` | 11 个测试文件、142 个测试通过 |
| `@mct/table-3d` | 14 个测试文件、176 个测试通过 |
| `@mct/room-client` | 1 个测试文件、45 个测试通过 |
| `@mct/room-protocol` | 1 个测试文件、60 个测试通过 |

## Server 与浏览器 smoke

Server smoke 使用运行时生成的临时 credential 和临时空闲本机端口启动已构建入口；自动 TCP probe 确认监听成功后终止进程，并再次确认端口不再监听。实际启动入口等价于：

```powershell
Set-Location "E:\澳门开发-worktrees\docs-validation"; $env:DEMO_ROOM_CREDENTIAL = "<runtime-generated-temporary-value>"; $env:PORT = "<ephemeral-local-port>"; node apps/server/dist/index.js
```

浏览器 smoke 在临时空闲本机端口启动 Vite，然后执行两个 Playwright 验证脚本：

```powershell
Set-Location "E:\澳门开发-worktrees\docs-validation"; pnpm --filter @mct/table-3d exec vite --host 127.0.0.1 --port <ephemeral-local-port> --strictPort
Set-Location "E:\澳门开发-worktrees\docs-validation"; node packages/table-3d/tools/verify-click-to-bet.mjs http://127.0.0.1:<ephemeral-local-port>/
Set-Location "E:\澳门开发-worktrees\docs-validation"; node packages/table-3d/tools/verify-felt-mapping.mjs http://127.0.0.1:<ephemeral-local-port>/
```

- `verify-click-to-bet.mjs`：通过点击、下注、锁筹、发牌、结算、牌/筹码渲染和拒绝路径。
- `verify-felt-mapping.mjs`：7 个座位区和 commission row 的探针均命中预期印刷区域。
- Server 与 Vite 验收进程均已终止，临时监听端口均已清理。

尖括号参数表示每次运行时生成的非敏感临时值，不是需要照抄的固定值。为避免泄露或诱导复用，本记录不保存临时 credential、端口或大段运行日志。

## Warnings 与边界

- pnpm 报告 `esbuild@0.24.2` build script 未批准；安装和本次后续门禁仍以退出码 `0` 完成。
- table-3d 生产 bundle 为 748.23 kB（gzip 195.71 kB），Vite 报告 chunk 大于 500 kB；这是已有性能 warning，不是构建失败。
- 本次验收未写入真实 secret，未将临时 credential 记录到文档、Git、URL 或持久化存储。
- 本文件是操作者对本地命令结果的记录，不具备 CI 的独立性。将来应由受控 CI 在干净 checkout 上自动安装、构建、测试和执行 smoke，保留机器生成的 run、日志与 commit 关联，才能形成独立且可重复的持续证据。
