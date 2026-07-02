use base64::engine::general_purpose::STANDARD as BASE64;
use base64::Engine;
use windows::core::PCWSTR;
use windows::Win32::Foundation::{LocalFree, HLOCAL};
use windows::Win32::Security::Cryptography::{
    CryptProtectData, CryptUnprotectData, CRYPT_INTEGER_BLOB,
};

const PREFIX: &str = "dpapi:v1:";

#[tauri::command]
pub fn dpapi_protect(value: String) -> Result<String, String> {
    let encrypted = crypt(value.as_bytes(), true)?;
    Ok(format!("{PREFIX}{}", BASE64.encode(encrypted)))
}

#[tauri::command]
pub fn dpapi_unprotect(value: String) -> Result<String, String> {
    let encoded = value
        .strip_prefix(PREFIX)
        .ok_or("value is not in dpapi:v1 format")?;
    let encrypted = BASE64
        .decode(encoded)
        .map_err(|err| format!("base64: {err}"))?;
    let decrypted = crypt(&encrypted, false)?;
    String::from_utf8(decrypted).map_err(|err| format!("utf8: {err}"))
}

fn crypt(data: &[u8], protect: bool) -> Result<Vec<u8>, String> {
    let input = CRYPT_INTEGER_BLOB {
        cbData: data.len() as u32,
        pbData: data.as_ptr().cast_mut(),
    };
    let mut output = CRYPT_INTEGER_BLOB::default();
    unsafe {
        let result = if protect {
            CryptProtectData(&input, PCWSTR::null(), None, None, None, 0, &mut output)
        } else {
            CryptUnprotectData(&input, None, None, None, None, 0, &mut output)
        };
        if let Err(err) = result {
            let operation = if protect {
                "CryptProtectData"
            } else {
                "CryptUnprotectData"
            };
            eprintln!("{operation} failed: {err}");
            return Err(format!("{operation}: {err}"));
        }
        let bytes = std::slice::from_raw_parts(output.pbData, output.cbData as usize).to_vec();
        LocalFree(Some(HLOCAL(output.pbData.cast())));
        Ok(bytes)
    }
}
