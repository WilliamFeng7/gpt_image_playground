# macOS Apple Silicon 客户端

适用于运行 macOS 14 或更新版本的 Apple 芯片 Mac。桌面版沿用上游的图像生成、编辑、画廊、Agent 和 API 配置界面。

## 安装与使用

在 [Build macOS (Apple Silicon)](https://github.com/WilliamFeng7/gpt_image_playground/actions/workflows/macos-arm64.yml) 中选择成功的构建并下载 `GPT-Image-Playground-macOS-arm64`。解压后打开 `.dmg`，把应用拖到「应用程序」。安装包使用临时签名，适合本机开发和测试。对外分发时使用 Apple Developer ID 签名和公证。

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

## 上游维护

- [Sync upstream](https://github.com/WilliamFeng7/gpt_image_playground/actions/workflows/sync-upstream.yml) 每 5 分钟调度一次，也可手动运行。GitHub 排队时间会影响实际延迟。它同步 `CookSleep/gpt_image_playground` 的 `main`，保留上游历史和 Fork 的 macOS 提交。
- 候选合并先跑前端构建和测试。涉及桌面构建的路径发生变化时，还会在 Apple Silicon 运行器构建 `.app`。验证通过后，以正常 Git 推送推进 Fork 的 `main`。
- 有冲突、验证失败或上游修改了 Actions 配置时，先查看失败步骤。在独立工作树中从 Fork 的 `main` 合并上游，核对冲突两侧的意图并复跑检查。检查通过后提交并推送合并结果。
