# 当前开发进度

**状态日期：2026-07-29**

## Git 基线

- 稳定基线：`master` at `5299b17`（`feat(room-protocol): websocket message contracts`）。
- 本次验收分支：`feature/recover-current-work`；最终加固后的 validated commit 为 `ffb79c4`。
- Phase 0-1 实现从 `755dc9a`（monorepo）到 `5299b17`（room protocol）建立共享类型、规则包、引擎、账本和协议。
- Socket + AI 后续切片位于 `a030268..ffb79c4`，均为 `5299b17` 之后的线性提交。

## Phase 0-1 Task 1-11

| Task | 状态 | 关键提交/证据 |
| --- | --- | --- |
| 1 Monorepo 骨架 | 完成 | `755dc9a`, `5394d12`；配置与包结构可由代码/提交核验 |
| 2 共享类型 | 完成 | `f7ff6bf`；类型与测试文件存在 |
| 3 Rule Pack | 完成 | `8a3c6f8`；schema、validator、示例包与测试存在 |
| 4 补牌表 | 完成 | `d42a98a`；实现与 13 个当前测试存在 |
| 5 种子 Shoe | 完成 | `549b6e8`；实现与 shoe/RNG 当前测试存在 |
| 6 赔付 | 完成 | `e18cf46`, `d7abdb4`；实现与 19 个当前测试存在 |
| 7 Chip Ledger | 完成 | `fb5c6fb`, `8386354`, `ffb79c4`；实现与 18 个当前测试存在 |
| 8 TableRuntime | 完成 | `a4a5b83`, `d7abdb4..ffb79c4`；状态机与 26 个当前测试存在 |
| 9 Room 协议 | 完成 | `5299b17..8386354`；v5 协议契约与 67 个当前测试存在 |
| 10 最小 Server | 完成 | `98d5b74..fa579d8` 与 `47fce39..5922b38`；实现与当前测试存在 |
| 11 仓库验收 | 实现完成，本地实测 | 根 README 与聚合 scripts 可直接核验；本地 gates、server smoke 与 table-3d E2E 见[验收记录](validation-2026-07-29.md)，不是 CI |

这里的“完成”仅指 Phase 0-1 计划中有代码或提交证据的实现范围，不证明历史运行命令曾在当时执行，也不表示 Postgres、L1-L3 教学、教练后台、生产认证或后续路线图已经完成。

## Socket + AI 切片

| 切片 | 状态 | 关键提交范围 |
| --- | --- | --- |
| Workspace runtime entrypoints + local session | 完成 | `a030268..674c001` |
| Server authority、join credential、自动回合 | 完成 | `98d5b74..fa579d8` |
| WebSocket 真实集成与生命周期 | 完成 | `47fce39..5922b38` |
| Session port / local-remote 抽象 | 完成 | `fb5b8aa..db71b85` |
| Resilient room client | 完成 | `5f7b4e5..5ff03f5` |
| Remote authoritative session | 完成 | `f98acd9..1ecb8ae` |
| Provider-neutral LLM AI boundary | 完成 | `3de3a73..dd90364` |
| Authoritative bet and settlement hardening | 完成 | `d7abdb4..ffb79c4` |

Basic AI 已经工作，会在下注阶段为 AI 席位产生合法决策。LLM 路径提供 provider-neutral 决策接口、输入/输出约束、超时、遥测清洗和 Basic AI fallback，但尚未集成 OpenAI、Anthropic 或其他供应商 SDK；不能把“边界已完成”表述为“供应商 LLM 已上线”。

Remote session 的协议、客户端和真实 WebSocket 集成测试已经覆盖，但 table-3d 默认仍选择 local session。只有受信启动代码显式写入完整 `globalThis.__MCT_ROOM_CONFIG__` 时才启用 remote；credential 不得进入 query、日志或持久化存储。

## 2026-07-29 本地实测

完整的环境、精确命令、退出结果、warnings、进程清理和证据边界见 [2026-07-29 本地验收记录](validation-2026-07-29.md)。该记录来自开发者工作站，不是 CI。

| 命令/检查 | 本地实测结果 |
| --- | --- |
| `pnpm install --frozen-lockfile` | 成功；lockfile unchanged；pnpm 提示 esbuild build script 未批准 |
| `pnpm build` | 成功；7/7 workspace projects；table-3d chunk 751.34 kB / gzip 196.47 kB warning |
| `pnpm test` | 35 test files / 536 tests passed |
| `pnpm typecheck` | 7/7 workspace projects passed |
| `pnpm --filter @mct/server test` | 11 files / 144 tests passed |
| `pnpm --filter @mct/table-3d test` | 14 files / 177 tests passed |
| `pnpm --filter @mct/room-client test` | 1 file / 45 tests passed |
| `pnpm --filter @mct/room-protocol test` | 1 file / 67 tests passed |
| Server start smoke | 临时 `DEMO_ROOM_CREDENTIAL` + 随机空闲端口成功，PID/端口已清理 |
| `verify-click-to-bet.mjs` | 通过：点击、下注、锁筹、发牌、结算、渲染与拒绝路径 |
| `verify-felt-mapping.mjs` | 通过：7 个座位区和 commission row 探针全部命中印刷区域 |

说明：在全新安装、尚无 workspace `dist` 时，首次 `pnpm test` 与 `pnpm typecheck` 会因运行时 package entrypoint 不存在而失败；执行 `pnpm build` 后，两项完整门禁均通过。这是当前脚本顺序限制，不是测试失败被忽略。

## 已知限制与后续优先事项

1. 将 root scripts 调整为对冷 clone 友好的拓扑构建/测试流程，消除先手工 build 的要求。
2. 为 `MemoryEventStore` 设计持久化接口和 Postgres 实现，但不要在完成前标记生产持久化。
3. 接入生产认证、授权、用户/席位模型和 secret 管理；当前仅是 demo credential。
4. 在 provider-neutral LLM 边界外新增可选供应商 adapter，并补充成本、限流、审计和离线确定性测试。
5. 对 table-3d 做 dynamic import/manual chunks，消除大于 500 kB 的 bundle warning。
6. 另行规划 L1-L3 教学、教练、成绩单、真实赌场规则包和多人/语音能力。

相关文档：[README](../../README.md) · [本地验收记录](validation-2026-07-29.md) · [Phase 0-1 计划](../superpowers/plans/2026-07-27-macau-casino-training-phase0-1.md) · [设计规格](../superpowers/specs/2026-07-27-macau-casino-training-design.md)
