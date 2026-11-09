# macOS 开发与维护

## 本机数据与 CLI

在 **「设置 → API 配置」** 选择供应商，填写该供应商的 API Key。历史、设置和图片默认保存在 `~/Library/Application Support/com.williamfeng7.gpt-image-playground/data/`。从网页版或 Windows 迁移时，使用应用内的备份导出和导入。

应用打开后，可以在终端查看画廊历史，也可以从 **「设置 → Skill」** 安装随附的使用说明。

```sh
"/Applications/GPT Image Playground.app/Contents/MacOS/gpt-image-playground-cli" history
```

## 本地构建

准备 Xcode Command Line Tools、Node.js 24 和稳定版 Rust。在仓库根目录运行以下命令。

```sh
rustup target add aarch64-apple-darwin
npm ci
CI=true APPLE_SIGNING_IDENTITY=- npm run tauri:build -- --target aarch64-apple-darwin -- --locked
```

`src-tauri/target/aarch64-apple-darwin/release/bundle/` 下的 `macos/` 和 `dmg/` 分别存放应用和磁盘镜像。

也可在 [Build macOS (Apple Silicon)](https://github.com/WilliamFeng7/gpt_image_playground/actions/workflows/macos-arm64.yml) 中运行构建。试用包使用临时签名，面向用户分发的正式安装包使用 Apple Developer ID 签名和公证。

## 上游维护

- [Sync upstream](https://github.com/WilliamFeng7/gpt_image_playground/actions/workflows/sync-upstream.yml) 每 5 分钟调度一次，也可手动运行。GitHub 排队时间会影响实际延迟。它同步 `CookSleep/gpt_image_playground` 的 `main`，保留上游历史和 Fork 的 macOS 提交。
- 候选合并先跑前端构建和测试。涉及桌面构建的路径发生变化时，还会在 Apple Silicon 运行器构建 `.app`。验证通过后，以正常 Git 推送推进 Fork 的 `main`。
- 在干净的独立工作树中，从 Fork 的 `main` 运行 `bash scripts/merge-upstream.sh <上游提交>`。脚本在合并时移除清单里的旧截图、Windows 安装器和网页部署文件，保留其上游提交历史。
- 有冲突、验证失败或上游修改了 Actions 配置时，先查看失败步骤。在独立工作树中从 Fork 的 `main` 合并上游，核对冲突两侧的意图并复跑检查。检查通过后提交并推送合并结果。
