use std::path::Path;

#[cfg(windows)]
/// 原子替换既有业务文件，保留调用方自己的串行写入边界。
pub(crate) fn replace_file(source: &Path, destination: &Path) -> std::io::Result<()> {
    use std::{ffi::OsStr, os::windows::ffi::OsStrExt};

    const MOVEFILE_REPLACE_EXISTING: u32 = 0x1;
    const MOVEFILE_WRITE_THROUGH: u32 = 0x8;
    #[link(name = "Kernel32")]
    extern "system" {
        fn MoveFileExW(existing: *const u16, new: *const u16, flags: u32) -> i32;
    }
    fn wide(value: &OsStr) -> Vec<u16> {
        value.encode_wide().chain(Some(0)).collect()
    }
    let source = wide(source.as_os_str());
    let destination = wide(destination.as_os_str());
    let result = unsafe {
        MoveFileExW(
            source.as_ptr(),
            destination.as_ptr(),
            MOVEFILE_REPLACE_EXISTING | MOVEFILE_WRITE_THROUGH,
        )
    };
    if result == 0 {
        Err(std::io::Error::last_os_error())
    } else {
        Ok(())
    }
}

#[cfg(not(windows))]
pub(crate) fn replace_file(source: &Path, destination: &Path) -> std::io::Result<()> {
    std::fs::rename(source, destination)
}
