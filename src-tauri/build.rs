use std::path::Path;
use std::process::Command;

fn main() {
    build_voice();
    tauri_build::build()
}

/// Ditado: compila o ajudante em Swift (reconhecimento de fala da Apple) para ir junto no app.
fn build_voice() {
    println!("cargo:rerun-if-changed=voice/main.swift");
    println!("cargo:rerun-if-changed=voice/Info.plist");
    let target = std::env::var("TARGET").unwrap_or_default();
    let out = format!("binaries/veocode-voice-{target}");
    std::fs::create_dir_all("binaries").ok();
    if !target.contains("apple-darwin") {
        // fora do Mac não tem ditado: um arquivo vazio só para o empacotador achar
        if !Path::new(&out).exists() {
            std::fs::write(&out, b"").ok();
        }
        return;
    }
    let arch = if target.starts_with("aarch64") { "arm64" } else { "x86_64" };
    let ok = Command::new("swiftc")
        .args(["-O", "-target", &format!("{arch}-apple-macos13.0"), "voice/main.swift", "-o", &out])
        .args(["-Xlinker", "-sectcreate", "-Xlinker", "__TEXT", "-Xlinker", "__info_plist", "-Xlinker", "voice/Info.plist"])
        .status()
        .map(|s| s.success())
        .unwrap_or(false);
    if !ok {
        println!("cargo:warning=não deu para compilar o ditado (swiftc): o botão de falar não vai funcionar");
        if !Path::new(&out).exists() {
            std::fs::write(&out, b"").ok();
        }
    }
    // app universal (`tauri build --target universal-apple-darwin`): o empacotador procura um
    // ajudante "-universal-apple-darwin", feito juntando os dois quando já existem
    let (arm, intel) = ("binaries/veocode-voice-aarch64-apple-darwin", "binaries/veocode-voice-x86_64-apple-darwin");
    let size = |p: &str| std::fs::metadata(p).map(|m| m.len()).unwrap_or(0);
    if size(arm) > 0 && size(intel) > 0 {
        Command::new("lipo").args(["-create", arm, intel, "-output", "binaries/veocode-voice-universal-apple-darwin"]).status().ok();
    }
}
