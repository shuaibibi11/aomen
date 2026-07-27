# 澳门赌场训练系统 — Phase 0–1 实现计划（地基 + 百家乐引擎）

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 从零建立 monorepo 与共享类型，实现权威百家乐 Table Runtime（标准/免佣/边注/补牌/事件流），用自动化测试锁死规则；搭好房间协议与训练币账本最小切片。

**Architecture:** 对局权威在 `packages/table-engine`（纯 TS，无 UI）。`apps/server` 持有 Room + WebSocket，调用引擎处理 Intent 并广播 Snapshot。规则来自版本化 Rule Pack JSON。事件追加写入供回放。

**Tech Stack:** pnpm monorepo · TypeScript · Vitest · Node.js · ws · Zod

**Spec:** `docs/superpowers/specs/2026-07-27-macau-casino-training-design.md`

**范围:** 仅垂直切片 1–2（monorepo + 引擎 + 最小房间/服务）。教学/3D/教练见文末路线图。

---

## 文件结构

```text
packages/shared          # Intent、Event、Snapshot、Card
packages/rule-packs      # Zod 校验 + 示例 JSON
packages/table-engine    # 状态机、补牌、赔付、Shoe、Ledger
packages/room-protocol   # WS 消息契约
apps/server              # RoomManager、基础 AI、WS、内存事件库
```

| 包 | 只做 | 不做 |
|----|------|------|
| shared | 类型 | 业务 |
| rule-packs | 加载/校验 | 牌局 |
| table-engine | Intent→状态/事件 | 网络/3D |
| server | 房间、引擎、AI | 精美 UI |

---

## 前置条件

- 仓库已 git init 且存在设计/计划的 root commit（若全新克隆无 git，先 git init 再提交文档）。
- 本 Phase 边注范围：**仅 player_pair / banker_pair**（龙宝等留待规则包扩展，不进本 Phase DoD）。
- Shoe 切牌/换靴：Rule Pack 可保留字段，**本 Phase 不实现 penetration 换靴**，避免半成品。

## Task 1: Monorepo 骨架

**Files:** Create `package.json`, `pnpm-workspace.yaml`, `tsconfig.base.json`, `.gitignore`, `README.md`, `packages/shared/*`

- [ ] **Step 1:** 确认 `node -v`（>=20）与 `pnpm -v`（无则 `npm i -g pnpm`）
- [ ] **Step 2:** root `package.json`：private、scripts build/test/typecheck、packageManager pnpm@9
- [ ] **Step 3:** `pnpm-workspace.yaml` 含 `packages/*` 与 `apps/*`
- [ ] **Step 4:** `tsconfig.base.json`：strict、module NodeNext、declaration true
- [ ] **Step 5:** `.gitignore`：node_modules、dist、coverage、.env
- [ ] **Step 6:** 初始化 `@mct/shared`（type:module，tsc build，vitest）
- [ ] **Step 7:** Run `pnpm install` 与 `pnpm --filter @mct/shared build` — Expected: dist 产出
- [ ] **Step 8:** Commit `chore: initialize pnpm monorepo and shared package`

---

## Task 2: 共享类型

**Files:** `packages/shared/src/{ids,cards,intents,events,snapshot,session-profile}.ts`, `cards.test.ts`, `vitest.config.ts`

- [ ] **Step 1:** Card、Suit、Rank；`baccaratCardValue`；`baccaratHandTotal`（sum % 10）
- [ ] **Step 2:** Branded ids：TableId、RoundId、SeatId、ActorId + asXxx helpers
- [ ] **Step 3:** TableIntent：place_bet、clear_bets、no_more_bets、deal_next、reveal、settle_round、start_round、buy_in、cash_out
- [ ] **Step 4:** TablePhase、TableEvent、TableSnapshot、SessionProfile（L/R、aiRoster、shoeSeed）
- [ ] **Step 4b:** TableEvent 固定字段对齐 spec §4.6：`tableId, roundId, seq, actorId, intent?, accepted?, rejectReason?, phaseAfter/stateAfter, visibleMask?, rulePackId, rulePackVersion, at`（Intent 类事件必填 intent/accepted；结算类可无 intent）
- [ ] **Step 5:** 测试 K=0、A=1、9+8=>7
- [ ] **Step 6:** Run `pnpm --filter @mct/shared test` — PASS
- [ ] **Step 7:** Commit `feat(shared): add cards, intents, events, snapshot types`

---

## Task 3: Rule Pack

**Files:** `packages/rule-packs/src/{schema,validate,load,index}.ts`, `packs/dev/generic-macau-baccarat.v1.json`, `validate.test.ts`

- [ ] **Step 1:** 建包，依赖 zod、`@mct/shared`
- [ ] **Step 2:** Zod：variant standard|no_commission、limits、commission、sideBets、shoe、dealing、chipset、scriptPackId、sceneProfile
- [ ] **Step 3:** `validateRulePack`：parse + max>=min
- [ ] **Step 4:** 从 packs/ 相对路径 load JSON
- [ ] **Step 5:** 示例包 8 副、标准、player_pair/banker_pair
- [ ] **Step 6:** 测试合法与 max<min 抛错
- [ ] **Step 7:** Run `pnpm --filter @mct/rule-packs test` — PASS
- [ ] **Step 8:** Commit `feat(rule-packs): schema, validator, sample pack`


---

## Task 4: 补牌表（TDD）

**Files:** `packages/table-engine/src/baccarat/draw-table.ts`, `draw-table.test.ts`, package 骨架

- [ ] **Step 1:** 建 `@mct/table-engine`，依赖 `@mct/shared`、`@mct/rule-packs`，vitest
- [ ] **Step 2:** 写测试：isNatural(8/9)；playerDrawsThird(<=5)；banker 对 player 第三张的标准表（含 banker3 遇 8 不补）
- [ ] **Step 3:** Run test — Expected FAIL
- [ ] **Step 4:** 实现完整 banker/player 第三张规则
- [ ] **Step 5:** Run test — PASS；补充 case 4/5/6 覆盖
- [ ] **Step 6:** Commit `feat(table-engine): baccarat third-card draw table`

---

## Task 5: 种子 Shoe

**Files:** `packages/table-engine/src/rng.ts`, `baccarat/shoe.ts`, `shoe.test.ts`

- [ ] **Step 1:** 测试同 seed 抽牌序列相同；1 副抽 52 张后 empty 抛错
- [ ] **Step 2:** Run — FAIL
- [ ] **Step 3:** 实现 createSeededRng + Fisher–Yates 多副牌 shoe.draw()
- [ ] **Step 4:** Run — PASS
- [ ] **Step 5:** Commit `feat(table-engine): seeded shoe RNG`

---

## Task 6: 赔付

**Files:** `packages/table-engine/src/baccarat/payout.ts`, `payout.test.ts`

- [ ] **Step 1:** 测试：闲 1:1；标准庄赢扣 5% 佣；免佣庄 6 赔 0.5；和局退还主注 0 赢分
- [ ] **Step 2:** 实现 `computeMainBetPayout`
- [ ] **Step 3:** 实现边注对子（前两张同 rank）`computeSideBetPayout`，用 rule pack odds
- [ ] **Step 4:** 测试 PASS
- [ ] **Step 5:** Commit `feat(table-engine): main and side bet payouts`

---

## Task 7: Chip Ledger

**Files:** `packages/table-engine/src/chip-ledger.ts`, `chip-ledger.test.ts`

- [ ] **Step 1:** 测试 buyIn、下注锁筹、余额不足拒绝、settle 加回、cashOut
- [ ] **Step 2:** 实现 ChipLedger 类（getStack / buyIn / tryLockBet / applyPayouts / cashOut）
- [ ] **Step 3:** PASS 后 Commit `feat(table-engine): training-chip ledger`

---

## Task 8: TableRuntime 状态机

**Files:** `packages/table-engine/src/table-runtime.ts`, `table-runtime.test.ts`, `index.ts`

- [ ] **Step 1:** 构造注入 `drawCard: () => Card` 便于测试预定牌序
- [ ] **Step 2:** 集成测试一局：start_round → place_bet → no_more_bets → deal_next* → settle_round；断言 outcome、ledger、events、seq
- [ ] **Step 3:** 实现最小阶段与合法 Intent 表：
  | phase | 合法 Intent |
  |--------|-------------|
  | shoe_ready | start_round (dealer/system) |
  | round_betting | place_bet, clear_bets, no_more_bets |
  | no_more_bets | deal_next |
  | dealing | deal_next（发满初始 4 张后：若 natural 则进 settling；否则按 draw-table 决定是否继续发闲/庄第三张，发完进 settling） |
  | settling | settle_round |
  | round_end | start_round（下一局）或 cash_out |
  **必须**在 dealing 路径调用 `isNatural` / `playerDrawsThird` / `bankerDrawsThird`，禁止两牌了事却声称完成补牌。
- [ ] **Step 4:** 权限：仅 dealer 可停注/发牌/结算；玩家仅本 seat 下注
- [ ] **Step 5:** 停注后下注 rejected 测试
- [ ] **Step 6:** 免佣变体 banker 6 赔付测试
- [ ] **Step 7:** peekAllowed=false 时发牌即 revealed（咪牌完整流程可 Phase 后续加，但 Intent reveal 预留）
- [ ] **Step 8:** `pnpm --filter @mct/table-engine test` — 全绿
- [ ] **Step 9:** Commit `feat(table-engine): TableRuntime betting-deal-settle loop`

---

## Task 9: Room 协议

**Files:** `packages/room-protocol/src/messages.ts`, `index.ts`

- [ ] **Step 1:** ClientMessage：join_room、submit_intent、ping
- [ ] **Step 2:** ServerMessage：joined、snapshot、event、error、pong
- [ ] **Step 3:** build + Commit `feat(room-protocol): websocket message contracts`

---

## Task 10: 最小 Server

**Files:** `apps/server/package.json`, `tsconfig.json`, `vitest.config.ts`, `src/{memory-event-store,room-manager,ws-gateway,app,index}.ts`, `ai/basic-player-ai.ts`, `room-manager.test.ts`

- [ ] **Step 0:** 建 `@mct/server` 包：依赖 workspace 的 shared、rule-packs、table-engine、room-protocol，以及 `ws`、typescript、vitest
- [ ] **Step 1:** MemoryEventStore append/listByTable 测试
- [ ] **Step 2:** RoomManager.createRoom 加载 dev pack，1 human + N basic AI；**创建后对每人座执行 buy_in（或构造时 ledger 预充最小带码）**，保证随后 place_bet 不会因余额 0 被拒
- [ ] **Step 3:** Basic AI：round_betting 无注则最小限红随机闲/庄
- [ ] **Step 4:** 无人类荷官时 SYSTEM_DEALER 在 tick 中自动 deal/settle
- [ ] **Step 5:** RoomManager 单测推进一局（不启端口）
- [ ] **Step 6:** ws 监听 PORT 8787，join + intent
- [ ] **Step 7:** Commit `feat(server): room manager, basic AI, ws gateway`

---

## Task 11: 仓库验收

**Files:** `README.md`

- [ ] **Step 1:** 根 scripts 聚合 test/build
- [ ] **Step 2:** Run `pnpm test` 与 `pnpm build` — 全绿
- [ ] **Step 3:** README：架构、如何测、如何启 server、指向 spec 与后续 Phase
- [ ] **Step 4:** Commit `docs: README for phase0-1 engine slice`

---

## Phase 0–1 DoD

- [ ] monorepo 可 pnpm test / build
- [ ] 补牌表、赔付、种子靴有单测
- [ ] TableRuntime 完整一局 + 事件
- [ ] 标准 + 免佣主路径
- [ ] 边注至少 player_pair / banker_pair
- [ ] 训练币 ledger 与拒超额
- [ ] 内存房间 + 基础 AI + WS
- [ ] 不要求：3D、L1–L3 UI、教练后台、Postgres、多赌场真实包批量

---

## 后续 Phase 路线图（另开 plan 文件）

| Phase | 建议文件名 | 内容 |
|-------|------------|------|
| 2 | `...-pedagogy-realism.md` | L1–L3、R1–R3、Scenario、Rubric |
| 3 | `...-coach-auth-replay.md` | 账号、班级、教练、回放、成绩单、Postgres |
| 4 | `...-web-lobby.md` | React 大厅/工作台 |
| 5 | `...-table-3d.md` | R3F 三视角、分级、hotspot |
| 6 | `...-casino-packs-ai.md` | 多赌场包、AI 人格/挖坑 |
| 7 | `...-voice-multiplayer.md` | VoiceProvider、真多人对桌 |

## 执行约束

1. 严格 Task 顺序；TDD 红→绿→提交
2. Phase 0–1 不实现 Three.js
3. 引擎无 DOM
4. 赌场差异进配置与测试向量，不硬编码单店

*Plan path: docs/superpowers/plans/2026-07-27-macau-casino-training-phase0-1.md*

