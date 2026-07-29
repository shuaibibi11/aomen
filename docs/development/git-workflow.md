# Git 与外部 Worktree 工作流

本文约定适用于本仓库的功能、修复、重构、测试和文档工作。示例均为 PowerShell，并使用显式绝对路径，避免命令落到错误 worktree。

## 分支职责与命名

- `master` 只接收已验证、可稳定集成的提交，不直接承载日常开发。
- `backup/*` 用于保护现场或保留恢复点，不作为长期集成分支。
- 工作分支使用 `feature/*`、`fix/*`、`refactor/*`、`test/*`、`docs/*`。
- 每项独立功能使用一个仓库外 worktree；推荐父目录 `E:\澳门开发-worktrees`。该目录在项目外，因此无需也不应为它修改 `.gitignore`。

## 创建外部 Worktree

先验证父目录存在且位置正确，再创建分支和 worktree：

```powershell
Set-Location "E:\澳门开发"
Get-Item "E:\澳门开发-worktrees" | Select-Object FullName, PSIsContainer
git status --short --branch
git worktree add "E:\澳门开发-worktrees\feature-room-replay" -b "feature/room-replay" master
Set-Location "E:\澳门开发-worktrees\feature-room-replay"
git status --short --branch
```

父目录不存在时，先从其已存在的父级验证后创建：

```powershell
Set-Location "E:\"
Get-Item "E:\" | Select-Object FullName, PSIsContainer
New-Item -ItemType Directory -Path "E:\澳门开发-worktrees"
```

不要在命令间依赖隐含当前目录。自动化和验收命令的每条 Shell 都应以 `Set-Location "<绝对路径>"` 开头。

## 修改、暂存与原子提交

一个 commit 只表达一个可审查目的。先查看状态和 diff，再按文件定向暂存；禁止使用 `git add -A` 将无关改动、secret 或生成物一起带入：

```powershell
Set-Location "E:\澳门开发-worktrees\feature-room-replay"
git status --short
git diff -- "packages/room-client/src/room-connection.ts"
git add -- "packages/room-client/src/room-connection.ts" "packages/room-client/src/room-connection.test.ts"
git diff --cached --check
git diff --cached --stat
git commit -m "fix(room-client): preserve replay cursor across reconnects"
```

不得提交 `.env`、credential、token、真实连接信息、`node_modules`、`dist`、coverage、日志或其他生成物。提交前可定向检查敏感词，但结果必须人工确认上下文：

```powershell
Set-Location "E:\澳门开发-worktrees\feature-room-replay"
git diff --cached --name-only
git diff --cached --check
```

## 验证门禁

每个 commit 前执行与改动对应的定向测试；合并前执行根门禁。全新 install 后先 build，以生成 workspace runtime entrypoint 所需的 `dist`：

```powershell
Set-Location "E:\澳门开发-worktrees\feature-room-replay"
pnpm install --frozen-lockfile
pnpm build
pnpm --filter @mct/room-client test
pnpm test
pnpm typecheck
pnpm build
git diff --check
```

测试必须实际运行并检查 exit code；不能用旧日志或“应该通过”替代验证。

## Dirty Worktree 安全处理

开始前先检查：

```powershell
Set-Location "E:\澳门开发-worktrees\feature-room-replay"
git status --short --branch
git diff --name-only
git diff --cached --name-only
```

若存在非本任务改动，先辨认所有者和用途。不要覆盖、回滚或夹带他人的修改；无法安全隔离时应停止并确认处理方式。禁止使用 `git reset --hard`，也禁止用 `git checkout -- <path>` 覆盖工作区文件。

### 识别 Windows 行尾噪声

`git status` 显示文件 modified，但 `git diff --name-only` 没有相同范围的真实内容差异时，通常要怀疑 CRLF/LF、文件时间戳或索引刷新噪声：

```powershell
Set-Location "E:\澳门开发-worktrees\feature-room-replay"
git status --short
git diff --name-only
git diff --ignore-space-at-eol --name-only
git config --show-origin --get core.autocrlf
git check-attr text eol -- "README.md"
```

本仓库通过 `.gitattributes` 将文本规范为 LF。添加或修改规则后不要对全仓执行大规模 `renormalize`；只提交规则文件和任务真正需要的内容 diff。

## 跨分支依赖与 Fast-forward

工作分支应从已包含其依赖的稳定提交创建。若功能 B 依赖功能 A，应先把 A 验证并集成到稳定基线，再让 B fast-forward 到该基线；不要复制提交或在多个长期分支重复修复。

```powershell
Set-Location "E:\澳门开发"
git fetch --all --prune
git switch master
git merge --ff-only "feature/room-connection"

Set-Location "E:\澳门开发-worktrees\feature-remote-session"
git merge --ff-only master
```

若 `--ff-only` 失败，说明历史已分叉。停止并审查提交图，不要临时强推或重写共享历史：

```powershell
Set-Location "E:\澳门开发-worktrees\feature-remote-session"
git log --oneline --graph --decorate --all -30
```

## 完成与清理

确认提交、门禁和集成状态后，从主 worktree 清理外部 worktree。先移除 worktree，再删除已经合并的本地分支：

```powershell
Set-Location "E:\澳门开发"
git worktree list
git branch --merged master
git worktree remove "E:\澳门开发-worktrees\feature-room-replay"
git branch -d "feature/room-replay"
git worktree prune
```

不要对仍含未提交改动的 worktree 使用强制移除；不要删除尚未合并或仍需作为恢复点的 `backup/*`。
