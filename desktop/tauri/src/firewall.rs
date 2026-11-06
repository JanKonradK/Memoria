//! Whether Windows lets phones reach Memoria's Wi-Fi sync port, and the
//! elevated step that lets them.
//!
//! A phone that cannot connect is almost always Windows Firewall: no rule for
//! this Memoria.exe (the portable zip runs from wherever it was unpacked), or a
//! home Wi-Fi that Windows marks as a public network. Settings checks both and
//! offers one button for each fix.

use serde_json::{json, Value};

/// Built into the binary so the elevated step never runs a file someone could edit.
const ALLOW_SCRIPT: &str = include_str!("../../Enable-Phone-Sync.ps1");

/// Read-only: the connected networks and whether an inbound rule lets this
/// Memoria.exe through on each. Runs without elevation.
const CHECK_SCRIPT: &str = r#"
$ErrorActionPreference = 'SilentlyContinue'
$networks = @(Get-NetConnectionProfile | Where-Object { $_.IPv4Connectivity -ne 'Disconnected' -and $_.InterfaceAlias -notlike 'vEthernet*' })
$rules = @(Get-NetFirewallApplicationFilter | Where-Object { $_.Program -ieq $program } | Get-NetFirewallRule |
  Where-Object { $_.Enabled -eq 'True' -and $_.Direction -eq 'Inbound' } |
  Where-Object { $port = ($_ | Get-NetFirewallPortFilter).LocalPort; $port -eq 'Any' -or @($port) -contains '17820' })
$result = foreach ($network in $networks) {
  $category = [string]$network.NetworkCategory
  $profile = if ($category -eq 'DomainAuthenticated') { 'Domain' } else { $category }
  $matching = @($rules | Where-Object { $p = [string]$_.Profile; $p -eq 'Any' -or $p -match $profile })
  $off = (Get-NetFirewallProfile -Name $profile).Enabled -eq 'False'
  $blocked = @($matching | Where-Object { [string]$_.Action -eq 'Block' }).Count -gt 0
  $allowed = @($matching | Where-Object { [string]$_.Action -eq 'Allow' }).Count -gt 0
  @{ name = [string]$network.Name; category = $profile; allowed = ($off -or ($allowed -and -not $blocked)) }
}
@{ networks = @($result) } | ConvertTo-Json -Compress -Depth 4
"#;

fn quote(text: &str) -> String {
    format!("'{}'", text.replace('\'', "''"))
}

/// The elevated script: the fixed text above, told which Memoria.exe to allow
/// and whether to mark the current public networks as private.
pub fn allow_command(program: &std::path::Path, make_private: bool) -> String {
    let flag = if make_private { "$true" } else { "$false" };
    format!(
        "$program = {}\n$makePrivate = {flag}\n{ALLOW_SCRIPT}",
        quote(&program.display().to_string())
    )
}

fn check_command(program: &std::path::Path) -> String {
    format!("$program = {}\n{CHECK_SCRIPT}", quote(&program.display().to_string()))
}

#[cfg(windows)]
fn encoded(script: &str) -> String {
    use base64::Engine;
    let utf16: Vec<u8> = script.encode_utf16().flat_map(u16::to_le_bytes).collect();
    base64::engine::general_purpose::STANDARD.encode(utf16)
}

/// Runs PowerShell elevated with the script passed in memory; None if the prompt was declined.
#[cfg(windows)]
pub fn run_elevated_powershell(script: &str) -> Option<u32> {
    use windows_sys::Win32::Foundation::CloseHandle;
    use windows_sys::Win32::System::Threading::{GetExitCodeProcess, WaitForSingleObject, INFINITE};
    use windows_sys::Win32::UI::Shell::{ShellExecuteExW, SEE_MASK_NOCLOSEPROCESS, SHELLEXECUTEINFOW};
    use windows_sys::Win32::UI::WindowsAndMessaging::SW_HIDE;
    let wide = |s: &str| s.encode_utf16().chain(Some(0)).collect::<Vec<u16>>();
    let verb = wide("runas");
    let file = wide("powershell.exe");
    let params = wide(&format!(
        "-NoProfile -NonInteractive -EncodedCommand {}",
        encoded(script)
    ));
    let mut info: SHELLEXECUTEINFOW = unsafe { std::mem::zeroed() };
    info.cbSize = std::mem::size_of::<SHELLEXECUTEINFOW>() as u32;
    info.fMask = SEE_MASK_NOCLOSEPROCESS;
    info.lpVerb = verb.as_ptr();
    info.lpFile = file.as_ptr();
    info.lpParameters = params.as_ptr();
    info.nShow = SW_HIDE;
    unsafe {
        if ShellExecuteExW(&mut info) == 0 || info.hProcess.is_null() {
            return None;
        }
        WaitForSingleObject(info.hProcess, INFINITE);
        let mut code = 1u32;
        GetExitCodeProcess(info.hProcess, &mut code);
        CloseHandle(info.hProcess);
        Some(code)
    }
}

#[cfg(not(windows))]
pub fn run_elevated_powershell(_script: &str) -> Option<u32> {
    None
}

#[cfg(windows)]
fn run_hidden_powershell(script: &str) -> Option<String> {
    use std::os::windows::process::CommandExt;
    const CREATE_NO_WINDOW: u32 = 0x0800_0000;
    let output = std::process::Command::new("powershell.exe")
        .args(["-NoProfile", "-NonInteractive", "-EncodedCommand", &encoded(script)])
        .creation_flags(CREATE_NO_WINDOW)
        .output()
        .ok()?;
    String::from_utf8(output.stdout).ok()
}

#[cfg(not(windows))]
fn run_hidden_powershell(_script: &str) -> Option<String> {
    None
}

/// `{ supported, networks: [{ name, category, allowed }] }`. Blocking: takes a second or two.
pub fn check() -> Value {
    let Ok(exe) = std::env::current_exe() else {
        return json!({ "supported": false });
    };
    run_hidden_powershell(&check_command(&exe))
        .and_then(|text| serde_json::from_str::<Value>(text.trim()).ok())
        .filter(|value| value["networks"].is_array())
        .map(|value| json!({ "supported": true, "networks": value["networks"] }))
        .unwrap_or_else(|| json!({ "supported": false }))
}

/// Shows the administrator prompt and applies the rules. Blocking.
pub fn allow(make_private: bool) -> &'static str {
    match std::env::current_exe().map(|exe| run_elevated_powershell(&allow_command(&exe, make_private))) {
        Ok(Some(0)) => "ok",
        Ok(None) => "declined",
        _ => "failed",
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn scripts_are_built_in_and_quote_the_path() {
        let path = std::path::Path::new(r"C:\Users\O'Neil\Memoria.exe");
        let command = allow_command(path, false);
        assert!(command.starts_with("$program = 'C:\\Users\\O''Neil\\Memoria.exe'\n$makePrivate = $false\n"));
        assert!(command.contains("Profile = 'Private'"));
        // Phones are never let in on a network Windows treats as public.
        assert!(!command.contains("Profile = 'Public'"));
        assert!(!command.contains("RunAs"));
        assert!(allow_command(path, true).contains("$makePrivate = $true\n"));
        assert!(check_command(path).starts_with("$program = 'C:\\Users\\O''Neil\\Memoria.exe'\n"));
    }
}
