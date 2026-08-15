# LoopX Console (BitFun MiniApp)

**把 [LoopX](https://github.com/huangruiteng/loopx) 接入 BitFun 的控制台小程序**：宿主心跳驱动、自适应轮询间隔、GitHub issue 录入、BitFun 宿主 Agent 执行 turn、显眼的 gate 审批。

这是 loopx-console MiniApp 的**独立发布仓库**——BitFun 仓库只保留通用分发包能力，本仓库负责出 `.bitfun-miniapp` 安装包。

## 仓库结构

| 路径 | 职责 |
|---|---|
| `source/` | MiniApp 前端 + worker（`ui.js` 心跳状态机 / `worker.js` loopx CLI 封装） |
| `meta.json` | MiniApp 元信息与权限声明 |
| `bitfun-miniapp.json` | 分发包清单（package_id / 版本 / 发布者 / loopx CLI 运行时依赖与探测命令） |
| `scripts/package-miniapp.mjs` | 打包：生成可复现的 `.bitfun-miniapp` zip（SHA-256 清单） |
| `scripts/verify-package.mjs` | CI 校验：必需文件、哈希一致性、禁止打包运行期数据 |
| `scripts/stamp-version.mjs` | 发布前给清单盖版本号 |
| `packaging/loopx_launcher.py` | PyInstaller 入口（可选：产出独立 loopx.exe） |
| `.github/workflows/release.yml` | 手动触发发版：校验 → 打包 →（可选）PyInstaller 二进制 → GitHub Release |

## 用户在 BitFun 里安装

1. 下载本仓库 Release 里的 `*.bitfun-miniapp`。
2. BitFun → 小应用画廊 → 「安装小应用包」→ 选择该文件。
3. 确认单展示发布者/版本/权限/运行时依赖（探测本机 loopx CLI 版本），确认后自动编译打开。

同一包同版本重复安装会被拒绝；同包新版本会作为新实例并存。

## 发版（每次跟随 loopx 官方新版）

1. （可选）更新 `source/` 以适配新 loopx，然后盖版本号：

   ```bash
   npm install
   npm run stamp -- 3.1.0
   git commit -am "release 3.1.0"
   ```

2. 在 GitHub 仓库页 **Actions → release → Run workflow**，填写：
   - `loopx_version`：要配对的 loopx 官方 tag（如 `0.4.6`）
   - `miniapp_version`：留空则用清单里的版本
   - `build_windows_binary`：是否用 PyInstaller 打独立 `loopx.exe`（实验性，见下）
3. CI 会校验包并创建 GitHub Release，附上 `.bitfun-miniapp`（以及可选的 exe）。

> loopx 未发布到 PyPI，包不携带二进制时，用户需自行 `pip install -e <loopx 源码>`。
> 等 BitFun 支持「运行时随包分发」后，Release 里的 exe 资产可以直接作为包的运行时依赖来源。

## 本地开发

在 BitFun 里用「从文件夹导入」导入本仓库根目录即可（导入会重新编译；不要手动复制目录进数据目录）。改动 `source/` 后重新导入或重新打包安装。

独立冒烟测试（需要本机有 loopx + registry）：

```bash
node -e "global.rpcEmit=()=>{}; const w=require('./source/worker.js'); (async()=>{ console.log(await w['loopx.detect']({})); const g=await w['loopx.listGoals']({}); console.log(g.registryPath, g.goals.length); })()"
```

## 本地打包

```bash
npm install
npm run package          # → dist/miniapps/org.loopx.console-<版本>.bitfun-miniapp
node scripts/verify-package.mjs dist/miniapps/org.loopx.console-<版本>.bitfun-miniapp
```

## PyInstaller 二进制（实验性）

`release.yml` 里的 `build_windows_binary` 会执行
`pyinstaller --onefile --collect-all loopx packaging/loopx_launcher.py`，
产出独立 `loopx.exe`。loopx 有数据文件与动态路径假设，**首次使用前请人工验证**
`loopx.exe quota status` 等命令在干净机器上可用，再将其作为分发资产。
