//! 命令行程序，见 `cli::command`。macOS 的二进制位于应用包的 `Contents/MacOS`。
fn main() -> std::process::ExitCode {
    gpt_image_playground_lib::run_cli()
}
