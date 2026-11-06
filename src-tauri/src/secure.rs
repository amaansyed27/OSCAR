use anyhow::{anyhow, Result};
use base64::{engine::general_purpose::STANDARD, Engine};
#[cfg(windows)]
pub fn protect(secret: &str) -> Result<String> {
    use windows_sys::Win32::{Foundation::LocalFree, Security::Cryptography::*};
    let mut input = CRYPT_INTEGER_BLOB {
        cbData: secret.len() as u32,
        pbData: secret.as_ptr() as *mut u8,
    };
    let mut output = CRYPT_INTEGER_BLOB {
        cbData: 0,
        pbData: std::ptr::null_mut(),
    };
    let ok = unsafe {
        CryptProtectData(
            &mut input,
            std::ptr::null(),
            std::ptr::null(),
            std::ptr::null_mut(),
            std::ptr::null_mut(),
            CRYPTPROTECT_UI_FORBIDDEN,
            &mut output,
        )
    };
    if ok == 0 {
        return Err(anyhow!("Windows could not protect this credential."));
    }
    let bytes = unsafe { std::slice::from_raw_parts(output.pbData, output.cbData as usize) };
    let encoded = STANDARD.encode(bytes);
    unsafe { LocalFree(output.pbData as _) };
    Ok(encoded)
}
#[cfg(windows)]
pub fn unprotect(encoded: &str) -> Result<String> {
    use windows_sys::Win32::{Foundation::LocalFree, Security::Cryptography::*};
    let mut bytes = STANDARD.decode(encoded)?;
    let mut input = CRYPT_INTEGER_BLOB {
        cbData: bytes.len() as u32,
        pbData: bytes.as_mut_ptr(),
    };
    let mut output = CRYPT_INTEGER_BLOB {
        cbData: 0,
        pbData: std::ptr::null_mut(),
    };
    let ok = unsafe {
        CryptUnprotectData(
            &mut input,
            std::ptr::null_mut(),
            std::ptr::null(),
            std::ptr::null_mut(),
            std::ptr::null_mut(),
            CRYPTPROTECT_UI_FORBIDDEN,
            &mut output,
        )
    };
    if ok == 0 {
        return Err(anyhow!(
            "This credential belongs to another Windows account or is unavailable."
        ));
    }
    let result = String::from_utf8(
        unsafe { std::slice::from_raw_parts(output.pbData, output.cbData as usize) }.to_vec(),
    );
    unsafe { LocalFree(output.pbData as _) };
    Ok(result?)
}
#[cfg(not(windows))]
pub fn protect(_: &str) -> Result<String> {
    Err(anyhow!("Protected Settings credentials require Windows."))
}
#[cfg(not(windows))]
pub fn unprotect(_: &str) -> Result<String> {
    Err(anyhow!("Protected Settings credentials require Windows."))
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn round_trip() {
        let sealed = protect("test-credential-only").unwrap();
        assert!(!sealed.contains("test-credential"));
        assert_eq!(unprotect(&sealed).unwrap(), "test-credential-only");
    }
}
