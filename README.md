# 澳门赌场训练系统

这是一个面向澳门百家乐桌面训练的 TypeScript monorepo。当前仓库提供可重复的百家乐规则引擎、训练币账本、内存房间服务、WebSocket 协议与客户端，以及可交互的 Three.js 牌桌演示。

> **合规声明：** 本项目只用于教学、规则验证和软件研发，不提供真钱下注、支付、兑奖或赌博运营能力。演示筹码没有现金价值。部署者仍须自行遵守所在地法律、隐私和信息安全要求。

## 当前状态

截至 2026-07-30，Phase 0-1 的 Task 1-11 已实现；本地仓库验收已实测通过，但仓库尚无 CI。后续 Socket + AI 切片也已合入本分支。当前可用能力包括：

- 标准与免佣百家乐主流程、第三张规则、主注与对子边注赔付、种子牌靴和训练币账本；
- 权威 `TableRuntime`、内存事件流、单真人参与者加基础 AI 的演示房间；
- 带认证 join、消息校验、幂等恢复、心跳和重连的 WebSocket 远端会话；
- 默认本地运行的交互式 Three.js 牌桌、点击下注、发牌和筹码/牌面渲染；
- 已工作的 Basic AI，以及可注入、provider-neutral 的 LLM 决策边界和安全回退。
- 邀请制认证领域、PostgreSQL repository 与 migration 基础层（尚未接入 live room event log）。

LLM 边界目前**没有接入任何具体供应商 SDK**。远端会话默认关闭，浏览器演示默认使用进程内 local session。详细基线和提交范围见 [当前进度](docs/development/current-progress.md)。

## Monorepo 架构

| 路径 | 职责 |
| --- | --- |
| `packages/shared` | Card、ID、Intent、Event、Snapshot 等共享类型 |
| `packages/rule-packs` | 版本化规则包 schema、校验、加载和开发示例 |
| `packages/table-engine` | 纯 TypeScript 权威桌面状态机、牌靴、赔付和账本 |
| `packages/room-protocol` | WebSocket 客户端/服务端消息契约与运行时校验 |
| `packages/room-client` | 浏览器 WebSocket 连接、心跳、重连和请求关联 |
| `packages/table-3d` | Three.js 资产、牌桌预览、本地/远端 session 适配 |
| `apps/server` | 房间管理、自动回合、Basic/LLM AI 边界、内存事件库和 WS gateway |

## 环境与安装

- Node.js `>=20`（2026-07-30 本地实测使用 `v22.17.0`）
- pnpm `10.29.3`（以根 `package.json#packageManager` 为准）

```powershell
Set-Location "E:\path\to\macau-casino-training"
pnpm install --frozen-lockfile
```

工作区包的运行时入口指向 `dist`。全新 clone/install 后应先执行 `pnpm build`，再执行依赖这些入口的 `pnpm test` 或 `pnpm typecheck`。

### 本地 `.env` 配置

Server 入口会显式定位并加载**仓库根目录**的 `.env`，但这只适用于受控的本地开发。将仓库根目录的 `.env.example` 复制为同一目录下、不受 Git 跟踪的 `.env`；仓库 `.gitignore` 已保护 `.env`。即使 `pnpm --filter @mct/server start` 实际从 `apps/server` 运行，该命令也会加载仓库根目录的 `.env`。已有的 `process.env` 值优先，因此 shell 变量和部署注入的配置不会被本地文件覆盖。

不要将 `.env` 用作生产 secret 的交付机制。生产环境应通过 secret manager 或 systemd `EnvironmentFile` 提供这些值；由 systemd `EnvironmentFile` 注入的进程环境变量优先于根目录 `.env`。API token、credential 和 LLM 配置只能存在于 server：绝不可放入 frontend source、client bundle、browser storage、URL 或 log。

### Server persistence foundation

`PERSISTENCE_MODE` 默认是精确值 `memory`，因此当前 demo 的 `Room` / `CreateRoom`
继续使用同步 `MemoryEventStore`，运行行为不变。设置精确值 `postgres` 时，必须由
server 的 secret manager 或 `EnvironmentFile` 提供合法 `postgres://` 或
`postgresql://` `DATABASE_URL`；启动时会在创建 `Room` 或启动 Gateway 前校验该
PostgreSQL 配置，空值、其他协议和拼写变体会立即失败。

`DATABASE_URL` 只属于 server 进程，绝不可提交到 Git、放入前端、WebSocket 消息、
URL 或日志。此切片仅提供邀请认证 repository、SQL migration runner 和 PostgreSQL
基础 schema；**启动只校验 PostgreSQL 配置，本切片不会将对局持久化**：live room
仍使用内存 event log，且尚未接入认证 cookie。这些运行时集成由后续切片完成。

远端 PostgreSQL 使用精确值 `DATABASE_TLS_MODE=verify-full`，且这是默认值；Pool 会
设置 `ssl: { rejectUnauthorized: true }` 来校验服务器证书。为避免连接串覆盖此策略，
`DATABASE_URL` 不接受 `ssl`、`sslmode` 或其他 `ssl*` 查询参数。只有显式 loopback
endpoint（`127.0.0.1`、`::1`、`localhost`）或 Unix socket 本地开发数据库可以设为
`DATABASE_TLS_MODE=disable`；远端数据库设为 `disable` 或其他非精确 TLS mode 会在启动
前以不含 URL 或 credential 的错误拒绝。未来如需私有 CA，应通过受审查的独立配置支持，
而不是添加连接串 SSL 参数。

## 验证命令

```powershell
Set-Location "E:\path\to\macau-casino-training"
pnpm build
pnpm test
pnpm typecheck
```

常用聚焦测试：

```powershell
pnpm --filter @mct/server test
pnpm --filter @mct/table-3d test
pnpm --filter @mct/room-client test
pnpm --filter @mct/room-protocol test
```

## 启动演示 Server

Server 要求显式提供演示房间 credential。只使用临时开发值，不要将真实 secret 写入仓库：

```powershell
Set-Location "E:\path\to\macau-casino-training"
$env:DEMO_ROOM_CREDENTIAL = "replace-with-a-temporary-development-value"
$env:PORT = "8787"
$env:BIND_HOST = "127.0.0.1"
# Leave ALLOWED_ORIGIN unset for local loopback development.
$env:WEBSOCKET_MAX_PAYLOAD_BYTES = "65536"
pnpm --filter @mct/server start
```

默认演示配置：

- table：`demo-table`
- human actor：`demo-human`
- seats：7
- AI actors：默认 2 个 Basic AI（可仅在服务端启用 LLM）
- rule pack：`dev/generic-macau-baccarat.v1.json`
- loopback health：`http://127.0.0.1:8787/livez` 和 `http://127.0.0.1:8787/healthz`
- loopback WebSocket：`ws://127.0.0.1:8787/ws`

### Secure HTTP and WebSocket hosting

The server owns one cleartext Node HTTP listener for `/livez`, `/healthz`, and
the exact WebSocket upgrade endpoint `/ws`. It is intentionally a loopback
listener, not an Internet-facing TLS endpoint. `BIND_HOST` defaults to the
exact value `127.0.0.1` and only accepts `127.0.0.1`, `::1`, or `localhost`.
Do not use a direct public IP or expose `ws://` / `http://` traffic without TLS.

Put a trusted Nginx TLS terminator in front of the process. It must proxy both
`/ws` with WebSocket upgrade headers and the `/livez` and `/healthz` endpoints.
The browser-facing endpoint must use an external HTTPS/WSS origin. For example,
`https://203.0.113.10:8443` and `wss://203.0.113.10:8443/ws` use a documentation
address only; replace it with the real deployment address before deployment.

| Variable | Requirement / default |
| --- | --- |
| `PORT` | Integer from `1` through `65535`; default `8787` |
| `BIND_HOST` | Exact loopback host; default `127.0.0.1` |
| `ALLOWED_ORIGIN` | Omit for controlled local loopback development. For a proxy deployment, set an exact canonical `http` or `https` origin; every `/ws` upgrade must carry the identical `Origin` header. |
| `WEBSOCKET_MAX_PAYLOAD_BYTES` | Positive integer up to `1048576`; default `65536` |
| `WEBSOCKET_PER_MESSAGE_DEFLATE` | Unsupported as environment input and always disabled |

In a proxy deployment, set `ALLOWED_ORIGIN` to the exact deployed browser
origin, replacing the documentation value before deployment (for example,
`ALLOWED_ORIGIN=https://203.0.113.10:8443`). Leave it unset only for controlled
local development and test use. There is no wildcard CORS response. This slice
only establishes the secure host boundary; it does not add cookie authentication
or an administrative REST API.

### Server-only LLM decision configuration

`AI_MODE` 默认是 `basic`，因此不配置 LLM 时仍使用已有的 Basic AI。设置为精确的 `llm` 后，server 会在创建房间前校验以下**服务端环境变量**；缺失或无效配置会使启动失败，而不会在运行中静默降级配置：

| 变量 | 要求 / 默认值 |
| --- | --- |
| `DEMO_ROOM_CREDENTIAL` | 必填；演示房间 client join credential |
| `AI_MODE` | `basic`（默认）或 `llm` |
| `LLM_API_KEY` | `AI_MODE=llm` 时必填；仅由部署平台的 secret manager 注入 |
| `LLM_COMPLETIONS_URL` | HTTPS URL；默认 `https://platform.rainflowtb.com/v1/chat/completions` |
| `LLM_MODEL` | 非空；默认 `deepseek-chat` |
| `LLM_TIMEOUT_MS` | 正安全整数，最大 `60000`；默认 `4500` |

LLM key、请求 URL 和模型配置只存在于 server 进程环境中：它们不会写入房间事件、WebSocket 协议、前端 bundle 或浏览器存储。真实外部 LLM 调用不在本切片的测试范围内；测试通过注入的 fetch mock 验证请求，而不发起任何平台 HTTP 请求。

## 启动 table-3d

```powershell
Set-Location "E:\path\to\macau-casino-training"
pnpm --filter @mct/table-3d dev
```

不提供配置时，table-3d 使用 local session，不连接 server，也不需要 credential。

### 受信内存配置启用 remote session

远端配置必须由受信任的启动代码写入内存；下面只展示占位值，不能放真实 secret：

```html
<script>
  globalThis.__MCT_ROOM_CONFIG__ = Object.freeze({
    runtime: "remote",
    wsUrl: "ws://127.0.0.1:8787/ws",
    tableId: "demo-table",
    actorId: "demo-human",
    credential: "inject-at-runtime-not-a-real-secret"
  });
</script>
```

在 Nginx TLS 部署中，remote session 必须使用与浏览器同源的 WSS endpoint：
`wss://<staging-ip>:8443/ws`。不要省略 `/ws`，也不要让浏览器绕过 Nginx 直连
loopback server。

该对象必须在应用模块加载前写入。不要通过 URL/query string 传 credential；不要将 credential 打入日志，也不要写入 localStorage、sessionStorage、IndexedDB 或其他持久化存储。实现会忽略 URL 中的远端 endpoint、身份与 credential，避免不受信链接改变信任单元。

## 本地实测矩阵（2026-07-30）

以下结果来自 [2026-07-30 本地验收记录](docs/development/validation-2026-07-29.md)，不是 CI 结果。

| 范围 | 结果 |
| --- | ---: |
| 全仓 `pnpm test` | 35 files / 545 tests passed |
| `@mct/server` | 11 files / 149 tests passed |
| `@mct/table-3d` | 14 files / 181 tests passed |
| `@mct/room-client` | 1 file / 45 tests passed |
| `@mct/room-protocol` | 1 file / 67 tests passed |
| `pnpm typecheck` | 7 workspace projects passed |
| `pnpm build` | 7 workspace projects passed |
| Local table E2E | `verify-click-to-bet` 与 `verify-felt-mapping` 通过 |

## 已知限制

- 事件存储仅为进程内 `MemoryEventStore`，重启即丢失；尚无 Postgres 或持久回放服务。
- PostgreSQL schema、migration runner 与邀请认证 repository 已具备，但尚未接到 live
  room event log 或认证 cookie；当前 demo 仍是内存房间服务。HTTP/WS 仅提供由 Nginx
  TLS 终止保护的 loopback host boundary，不是完整的部署配置。
- 演示房间仅支持一个 human actor，不是生产多人账号/席位系统。
- Basic AI 已工作；LLM 仅有 provider-neutral 接口、校验、超时和回退，未接具体 provider SDK。
- 尚无生产级认证、授权、用户目录、secret 管理或教练后台服务。
- table-3d 生产 bundle 当前为 751.74 kB（gzip 196.47 kB），Vite 会报告 chunk 大于 500 kB 的 warning；后续需 code splitting/manual chunks。
- L1-L3 教学、教练、成绩单、真实多赌场批量规则包、语音和真钱相关能力均不在当前完成范围。

## 文档

- [Phase 0-1 设计规格](docs/superpowers/specs/2026-07-27-macau-casino-training-design.md)
- [UI/场景设计规格](docs/superpowers/specs/2026-07-27-macau-casino-ui-scene-design-spec.md)
- [Phase 0-1 实现计划](docs/superpowers/plans/2026-07-27-macau-casino-training-phase0-1.md)
- [当前进度与提交基线](docs/development/current-progress.md)
- [2026-07-30 本地验收记录（非 CI）](docs/development/validation-2026-07-29.md)
- [对局架构说明](docs/architecture/game-architecture.md)
- [百家乐新手训练指南](docs/guides/baccarat-beginner-guide.md)
- [Git 与外部 worktree 工作流](docs/development/git-workflow.md)
