/// 使用当前 Windows 登录用户的 DPAPI 加密凭证，不保存可迁移的明文令牌。
#[cfg(windows)]
fn transform(value: &[u8], protect: bool) -> Result<Vec<u8>, String> {
    use std::{ffi::c_void, ptr};
    #[repr(C)]
    struct Blob {
        length: u32,
        data: *mut u8,
    }
    #[link(name = "Crypt32")]
    extern "system" {
        fn CryptProtectData(
            input: *mut Blob,
            description: *const u16,
            entropy: *mut Blob,
            reserved: *mut c_void,
            prompt: *mut c_void,
            flags: u32,
            output: *mut Blob,
        ) -> i32;
        fn CryptUnprotectData(
            input: *mut Blob,
            description: *mut *mut u16,
            entropy: *mut Blob,
            reserved: *mut c_void,
            prompt: *mut c_void,
            flags: u32,
            output: *mut Blob,
        ) -> i32;
    }
    #[link(name = "Kernel32")]
    extern "system" {
        fn LocalFree(pointer: *mut c_void) -> *mut c_void;
    }
    let mut input = Blob {
        length: u32::try_from(value.len()).map_err(|_| "凭证大小无效")?,
        data: value.as_ptr() as *mut u8,
    };
    let mut output = Blob {
        length: 0,
        data: ptr::null_mut(),
    };
    // DPAPI 接收同步借用的输入，输出由系统分配；禁止交互并保持用户级作用域。
    let success = unsafe {
        if protect {
            CryptProtectData(
                &mut input,
                ptr::null(),
                ptr::null_mut(),
                ptr::null_mut(),
                ptr::null_mut(),
                1,
                &mut output,
            )
        } else {
            CryptUnprotectData(
                &mut input,
                ptr::null_mut(),
                ptr::null_mut(),
                ptr::null_mut(),
                ptr::null_mut(),
                1,
                &mut output,
            )
        }
    };
    if success == 0 {
        return Err(format!(
            "Windows 凭证保护失败：{}",
            std::io::Error::last_os_error()
        ));
    }
    let result =
        unsafe { std::slice::from_raw_parts(output.data, output.length as usize).to_vec() };
    unsafe {
        if !protect {
            ptr::write_bytes(output.data, 0, output.length as usize);
        }
        LocalFree(output.data.cast());
    }
    Ok(result)
}

#[cfg(not(windows))]
fn transform(_: &[u8], _: bool) -> Result<Vec<u8>, String> {
    Err("当前平台不支持 Windows 凭证保护".into())
}

pub fn protect(token: &str) -> Result<Vec<u8>, String> {
    transform(token.as_bytes(), true)
}
pub fn reveal(ciphertext: &[u8]) -> Result<String, String> {
    if ciphertext.is_empty() {
        return Err("尚未配置云端凭证".into());
    }
    String::from_utf8(transform(ciphertext, false)?)
        .map_err(|_| "Windows 凭证内容无效，请重新配置".into())
}

#[cfg(all(test, windows))]
mod tests {
    #[test]
    fn dpapi_ciphertext_roundtrips_and_is_not_plaintext() {
        let token = "test-only-random-personal-token";
        let protected = super::protect(token).unwrap();
        assert!(!protected
            .windows(token.len())
            .any(|value| value == token.as_bytes()));
        assert_eq!(super::reveal(&protected).unwrap(), token);
        assert!(super::reveal(b"invalid-ciphertext").is_err());
    }
}
