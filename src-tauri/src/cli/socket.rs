use std::fs::{self, File, OpenOptions};
use std::io::{self, ErrorKind};
use std::os::unix::fs::{DirBuilderExt, FileTypeExt, MetadataExt};
use std::path::{Path, PathBuf};

use tokio::net::{UnixListener, UnixStream};

fn uid() -> u32 {
    unsafe extern "C" {
        fn geteuid() -> u32;
    }

    unsafe { geteuid() }
}

// 使用短路径以适应 macOS 的 sockaddr_un 长度限制。仅当前用户可进入此目录。
fn socket_dir() -> PathBuf {
    let mode = if cfg!(debug_assertions) { "dev" } else { "app" };
    std::env::temp_dir().join(format!("gip-fork-{}-{mode}", uid()))
}

fn check_dir(dir: &Path) -> io::Result<()> {
    let meta = fs::symlink_metadata(dir)?;
    if !meta.is_dir() || meta.uid() != uid() || meta.mode() & 0o077 != 0 {
        return Err(io::Error::new(
            ErrorKind::PermissionDenied,
            "命令行连接目录必须仅供当前用户访问",
        ));
    }
    Ok(())
}

pub struct Listener {
    listener: UnixListener,
    socket: PathBuf,
    _lock: File,
}

impl Listener {
    pub fn bind() -> io::Result<Self> {
        let dir = socket_dir();
        match fs::DirBuilder::new().mode(0o700).create(&dir) {
            Err(err) if err.kind() == ErrorKind::AlreadyExists => {}
            result => result?,
        }
        check_dir(&dir)?;
        let lock = OpenOptions::new()
            .write(true)
            .create(true)
            .truncate(false)
            .open(dir.join("lock"))?;
        lock.try_lock()?;

        let socket = dir.join("cli.sock");
        match fs::symlink_metadata(&socket) {
            Ok(meta) if meta.file_type().is_socket() => fs::remove_file(&socket)?,
            Ok(_) => {
                return Err(io::Error::new(
                    ErrorKind::AlreadyExists,
                    "命令行套接字路径已被占用",
                ))
            }
            Err(err) if err.kind() == ErrorKind::NotFound => {}
            Err(err) => return Err(err),
        }
        Ok(Self {
            listener: UnixListener::bind(&socket)?,
            socket,
            _lock: lock,
        })
    }

    pub async fn accept(&mut self) -> io::Result<Option<UnixStream>> {
        let (stream, _) = self.listener.accept().await?;
        Ok(stream
            .peer_cred()
            .is_ok_and(|peer| peer.uid() == uid())
            .then_some(stream))
    }
}

impl Drop for Listener {
    fn drop(&mut self) {
        let _ = fs::remove_file(&self.socket);
    }
}

pub async fn open() -> io::Result<UnixStream> {
    let dir = socket_dir();
    check_dir(&dir)?;
    let stream = UnixStream::connect(dir.join("cli.sock")).await?;
    if stream.peer_cred()?.uid() != uid() {
        return Err(io::Error::new(
            ErrorKind::PermissionDenied,
            "命令行连接的应用不属于当前用户",
        ));
    }
    Ok(stream)
}
