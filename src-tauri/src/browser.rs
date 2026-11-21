//! O navegador do painel da direita (modo IA): o que ele precisa do lado do Mac.
//!
//! - Ponte: um script pequeno (bridge.js) que o WebKit põe em toda página aberta dentro de uma
//!   moldura do Veocode. Ele só acorda quando a página está numa moldura do próprio Veocode e só
//!   responde a ela: escolher um elemento, voltar/avançar, contar o endereço e o título e apagar
//!   os dados daquele site. Sem ele, uma página de outra origem (localhost:5173) é uma caixa
//!   fechada para o app.
//! - Captura: o WebKit desenha a área do painel (a página e o que foi riscado por cima) num PNG,
//!   para anexar à conversa ou salvar. Só no macOS.
//! - Arquivos HTML: um servidor mínimo em 127.0.0.1 que entrega só a pasta escolhida, atrás de
//!   um código aleatório, para abrir um .html do projeto (com o CSS e o JS dele) no painel.

use std::collections::HashMap;
use std::hash::{BuildHasher, Hasher};
use std::io::{BufRead, BufReader, Read, Write};
use std::net::{TcpListener, TcpStream};
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex, OnceLock};
use std::time::Duration;

use base64::{engine::general_purpose::STANDARD as B64, Engine};

/// O script que entra em toda página (e moldura) do app.
pub const BRIDGE: &str = include_str!("bridge.js");

/// Plugin só para registrar a ponte em todas as molduras.
pub fn plugin<R: tauri::Runtime>() -> tauri::plugin::TauriPlugin<R> {
    tauri::plugin::Builder::new("veo-browser").js_init_script_on_all_frames(BRIDGE).build()
}

// ---------------------------------------------------------------- captura

/// PNG da área (x, y, largura, altura em pontos da janela) do que está na tela agora.
#[cfg(target_os = "macos")]
pub fn snapshot(webview: &tauri::Webview, x: f64, y: f64, w: f64, h: f64) -> Result<Vec<u8>, String> {
    use std::sync::mpsc;
    if !(w >= 1.0 && h >= 1.0 && w <= 20000.0 && h <= 20000.0) {
        return Err(crate::i18n::tr("área de captura inválida", "invalid capture area").into());
    }
    let (tx, rx) = mpsc::channel::<Result<Vec<u8>, String>>();
    webview
        .with_webview(move |pw| unsafe {
            use objc2_app_kit::NSImage;
            use objc2_core_foundation::{CGPoint, CGRect, CGSize};
            use objc2_foundation::NSError;
            use objc2_web_kit::{WKSnapshotConfiguration, WKWebView};
            let wk: &WKWebView = &*(pw.inner() as *const WKWebView);
            // with_webview roda na thread principal
            let mtm = objc2::MainThreadMarker::new_unchecked();
            let conf = WKSnapshotConfiguration::new(mtm);
            conf.setRect(CGRect::new(CGPoint::new(x, y), CGSize::new(w, h)));
            conf.setAfterScreenUpdates(true);
            let tx = tx.clone();
            let done = block2::RcBlock::new(move |img: *mut NSImage, _err: *mut NSError| {
                let out = if img.is_null() { Err(crate::i18n::tr("o WebKit não devolveu a imagem", "WebKit didn't return the image").to_string()) } else { png_of(&*img) };
                let _ = tx.send(out);
            });
            wk.takeSnapshotWithConfiguration_completionHandler(Some(&conf), &done);
        })
        .map_err(|e| e.to_string())?;
    rx.recv_timeout(Duration::from_secs(10)).map_err(|_| crate::i18n::tr("a captura demorou demais", "the capture took too long").to_string())?
}

#[cfg(target_os = "macos")]
unsafe fn png_of(img: &objc2_app_kit::NSImage) -> Result<Vec<u8>, String> {
    use objc2::runtime::AnyObject;
    use objc2_app_kit::{NSBitmapImageFileType, NSBitmapImageRep};
    use objc2_foundation::{NSDictionary, NSString};
    let fail = || crate::i18n::tr("não deu para gerar o PNG", "couldn't make the PNG").to_string();
    let tiff = img.TIFFRepresentation().ok_or_else(fail)?;
    let rep = NSBitmapImageRep::imageRepWithData(&tiff).ok_or_else(fail)?;
    let props = NSDictionary::<NSString, AnyObject>::new();
    let png = unsafe { rep.representationUsingType_properties(NSBitmapImageFileType::PNG, &props) }.ok_or_else(fail)?;
    Ok(png.to_vec())
}

#[cfg(not(target_os = "macos"))]
pub fn snapshot(_webview: &tauri::Webview, _x: f64, _y: f64, _w: f64, _h: f64) -> Result<Vec<u8>, String> {
    Err(crate::i18n::tr("A captura do navegador por enquanto só funciona no Mac.", "Browser capture only works on the Mac for now.").into())
}

/// Salva um PNG (vindo da captura) onde a pessoa escolheu.
pub fn save_png(path: &str, data_b64: &str) -> Result<(), String> {
    let p = Path::new(path);
    if !p.extension().is_some_and(|e| e.eq_ignore_ascii_case("png")) {
        return Err(crate::i18n::tr("o arquivo precisa terminar em .png", "the file needs to end in .png").into());
    }
    let bytes = B64.decode(data_b64.split(',').next_back().unwrap_or("")).map_err(|e| e.to_string())?;
    std::fs::write(p, bytes).map_err(|e| e.to_string())
}

// ---------------------------------------------------------------- cookies

/// Apaga os cookies de `host` (ou todos, com `None`), inclusive os HttpOnly, que a página não
/// alcança. O Veocode em si não usa cookies: os que existem são dos sites abertos no painel.
#[cfg(target_os = "macos")]
pub fn clear_cookies(webview: &tauri::Webview, host: Option<String>) -> Result<usize, String> {
    use std::sync::mpsc;
    let (tx, rx) = mpsc::channel::<usize>();
    webview
        .with_webview(move |pw| unsafe {
            use objc2_foundation::{NSArray, NSHTTPCookie};
            use objc2_web_kit::WKWebView;
            let wk: &WKWebView = &*(pw.inner() as *const WKWebView);
            let store = wk.configuration().websiteDataStore().httpCookieStore();
            let del = store.clone();
            let tx = tx.clone();
            let got = block2::RcBlock::new(move |list: std::ptr::NonNull<NSArray<NSHTTPCookie>>| {
                let list = list.as_ref();
                let mut n = 0;
                for i in 0..list.count() {
                    let c = list.objectAtIndex(i);
                    if host.as_deref().is_none_or(|h| cookie_matches(&c.domain().to_string(), h)) {
                        del.deleteCookie_completionHandler(&c, None);
                        n += 1;
                    }
                }
                let _ = tx.send(n);
            });
            store.getAllCookies(&got);
        })
        .map_err(|e| e.to_string())?;
    rx.recv_timeout(Duration::from_secs(5)).map_err(|_| crate::i18n::tr("os cookies demoraram para responder", "the cookies took too long to answer").to_string())
}

#[cfg(not(target_os = "macos"))]
pub fn clear_cookies(_webview: &tauri::Webview, _host: Option<String>) -> Result<usize, String> {
    Ok(0)
}

/// O cookie de `domain` (".site.com" vale para os subdomínios) vai para `host`?
fn cookie_matches(domain: &str, host: &str) -> bool {
    let d = domain.trim_start_matches('.').to_ascii_lowercase();
    let h = host.trim_end_matches('.').to_ascii_lowercase();
    !d.is_empty() && (h == d || h.ends_with(&format!(".{d}")))
}

// ---------------------------------------------------------------- tem alguém respondendo?

/// Endereço local (localhost, 127.0.0.1…) tem um servidor ouvindo? Para o painel dizer
/// "nada respondendo" em vez de mostrar uma página em branco. Endereços de fora: não testa.
pub fn probe(url: &str) -> Option<bool> {
    let (scheme, rest) = url.split_once("://")?;
    let auth = rest.split(['/', '?', '#']).next()?;
    let default = if scheme.eq_ignore_ascii_case("https") { 443 } else { 80 };
    let (host, port) = if let Some(v6) = auth.strip_prefix('[') {
        let (h, after) = v6.split_once(']')?;
        (format!("[{h}]"), after.strip_prefix(':').map_or(Some(default), |p| p.parse::<u16>().ok())?)
    } else {
        match auth.rsplit_once(':') {
            Some((h, p)) => (h.to_string(), p.parse::<u16>().ok()?),
            None => (auth.to_string(), default),
        }
    };
    let host = host.to_ascii_lowercase();
    let local = host == "localhost" || host.ends_with(".localhost") || host == "127.0.0.1" || host == "0.0.0.0" || host == "[::1]";
    if !local {
        return None;
    }
    // localhost pode estar só no IPv6 (o Vite às vezes ouve só no ::1)
    let addrs: Vec<std::net::SocketAddr> = match host.as_str() {
        "[::1]" => vec![(std::net::Ipv6Addr::LOCALHOST, port).into()],
        "127.0.0.1" | "0.0.0.0" => vec![(std::net::Ipv4Addr::LOCALHOST, port).into()],
        _ => vec![(std::net::Ipv4Addr::LOCALHOST, port).into(), (std::net::Ipv6Addr::LOCALHOST, port).into()],
    };
    Some(addrs.iter().any(|a| TcpStream::connect_timeout(a, Duration::from_millis(600)).is_ok()))
}

// ---------------------------------------------------------------- ferramentas para a IA

/// Nome do servidor MCP que o Veocode entrega ao Claude pela própria conexão (sem processo à
/// parte): as ferramentas viram `mcp__veocode__browser_*`. Quem faz cada uma é a tela
/// (src/browserTools.ts), no navegador do painel que a pessoa está vendo.
pub const AI_SERVER: &str = "veocode";

/// Instruções do servidor (vão para o Claude, não para a tela).
pub const AI_INSTRUCTIONS: &str = "Veocode shows a web browser in the side panel next to this conversation, and the person watches it. \
Use these tools to look at what you are building, the way a developer checks their work in a browser: open the local dev server (or an .html file of the project), \
take a screenshot after visual changes, read the page text and its interactive elements, click and type to test a flow, and check the page console for errors. \
If nothing is running yet, start the project's dev server first (in the background) and then open its address. \
The tools only act on that panel (never on files) and the person sees every step. Sites that refuse to be framed (most big public sites) can't be opened there: use web fetch for those.";

/// As ferramentas (esquema MCP).
pub fn ai_tools() -> serde_json::Value {
    let target = serde_json::json!({
        "ref": {"type": "string", "description": "Element ref from browser_read, like \"e12\" (preferred)."},
        "selector": {"type": "string", "description": "CSS selector, used when there is no ref."},
        "text": {"type": "string", "description": "Visible text of the element (button label, link text), used when there is no ref or selector."}
    });
    let tools = [
        ("browser_open", "Open an address in the Veocode panel browser and wait for it to load. Accepts a URL (http://localhost:5173/login), a host:port (localhost:3000), just a port (5173), \
a path to an .html file of the project (relative to the project folder or absolute), or one of: back, forward, reload. Navigates the tab in front unless new_tab is true. \
Returns the final address, the title, and how many console errors the page has.",
         serde_json::json!({"type":"object","properties":{
            "url":{"type":"string","description":"Address, port, .html path, or back / forward / reload."},
            "new_tab":{"type":"boolean","description":"Open in a new tab instead of the one in front."}
         },"required":["url"]})),
        ("browser_screenshot", "Screenshot of the page shown in the panel browser right now (what the person sees, at the current screen size).",
         serde_json::json!({"type":"object","properties":{}})),
        ("browser_read", "Read the page in the panel browser: address, title, scroll position, the visible text and the interactive elements (links, buttons, fields) with a ref to use in browser_click and browser_type.",
         serde_json::json!({"type":"object","properties":{
            "max_chars":{"type":"integer","description":"Most text to return (default 12000)."}
         }})),
        ("browser_click", "Click an element of the page in the panel browser (it flashes so the person sees it). Waits for a navigation it causes. Give ref, selector or text.",
         serde_json::json!({"type":"object","properties":target.clone()})),
        ("browser_type", "Type into a field of the page in the panel browser (replaces what is there unless append is true). Works with React and other frameworks. Give ref, selector or text (the field's label or placeholder).",
         serde_json::json!({"type":"object","properties":{
            "ref":target["ref"].clone(),"selector":target["selector"].clone(),"text":{"type":"string","description":"Label, placeholder or name of the field, used when there is no ref or selector."},
            "value":{"type":"string","description":"What to type."},
            "append":{"type":"boolean","description":"Add to the end instead of replacing."},
            "submit":{"type":"boolean","description":"Press Enter / submit the form after typing."}
         },"required":["value"]})),
        ("browser_scroll", "Scroll the page in the panel browser: to the top, the bottom, a page up or down, or until an element is in view.",
         serde_json::json!({"type":"object","properties":{
            "to":{"type":"string","enum":["top","bottom","up","down"],"description":"Where to scroll."},
            "ref":target["ref"].clone(),"selector":target["selector"].clone()
         }})),
        ("browser_console", "Console messages of the page in the panel browser since it loaded: errors, warnings, logs, uncaught exceptions and failed network requests.",
         serde_json::json!({"type":"object","properties":{
            "errors_only":{"type":"boolean","description":"Only errors and failed requests."},
            "clear":{"type":"boolean","description":"Clear the list after reading."}
         }})),
        ("browser_server_logs", "Latest output of the dev server that serves the page (when Veocode started it from its server list).",
         serde_json::json!({"type":"object","properties":{
            "lines":{"type":"integer","description":"How many lines from the end (default 80, max 400)."}
         }})),
        ("browser_viewport", "Change the screen size of the panel browser to check a responsive layout.",
         serde_json::json!({"type":"object","properties":{
            "size":{"type":"string","enum":["fit","phone","tablet","laptop"],"description":"fit = the whole panel; phone 390×844; tablet 820×1180; laptop 1280×800."}
         },"required":["size"]})),
    ];
    serde_json::Value::Array(tools.into_iter().map(|(name, desc, schema)| serde_json::json!({"name": name, "description": desc, "inputSchema": schema})).collect())
}

/// As mesmas ferramentas no formato das contas por API (OpenAI, DeepSeek, Ollama). Sem a
/// captura de tela: essas APIs não recebem imagem no resultado de uma ferramenta.
pub fn api_tools() -> serde_json::Value {
    let list = ai_tools();
    serde_json::Value::Array(
        list.as_array()
            .into_iter()
            .flatten()
            .filter(|t| t["name"] != "browser_screenshot")
            .map(|t| serde_json::json!({"type":"function","function":{"name":t["name"],"description":t["description"],"parameters":t["inputSchema"]}}))
            .collect(),
    )
}

/// O resultado de uma ferramenta (formato MCP) como texto para as APIs: (texto, deu certo).
pub fn api_result(r: &serde_json::Value) -> (String, bool) {
    let text = r["content"]
        .as_array()
        .into_iter()
        .flatten()
        .filter_map(|c| c["text"].as_str())
        .collect::<Vec<_>>()
        .join("\n");
    (text, r["isError"] != true)
}

// ---------------------------------------------------------------- arquivos HTML

struct Server {
    port: u16,
    /// código → pasta servida
    roots: Mutex<HashMap<String, PathBuf>>,
}

static SERVER: OnceLock<Arc<Server>> = OnceLock::new();

fn token() -> String {
    let a = std::collections::hash_map::RandomState::new().build_hasher().finish();
    let mut h = std::collections::hash_map::RandomState::new().build_hasher();
    h.write_u128(std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_nanos()).unwrap_or(0));
    format!("{a:016x}{:016x}", h.finish())
}

fn server() -> Result<Arc<Server>, String> {
    if let Some(s) = SERVER.get() {
        return Ok(s.clone());
    }
    let listener = TcpListener::bind("127.0.0.1:0").map_err(|e| e.to_string())?;
    let port = listener.local_addr().map_err(|e| e.to_string())?.port();
    let s = Arc::new(Server { port, roots: Mutex::new(HashMap::new()) });
    // duas chamadas ao mesmo tempo: fica a primeira (a outra porta só fecha)
    if SERVER.set(s.clone()).is_err() {
        return Ok(SERVER.get().unwrap().clone());
    }
    let srv = s.clone();
    std::thread::spawn(move || {
        for stream in listener.incoming().flatten() {
            let srv = srv.clone();
            std::thread::spawn(move || {
                let _ = handle(&srv, stream);
            });
        }
    });
    Ok(s)
}

/// Endereço para abrir `file` no painel. `root` (a pasta do projeto, se o arquivo estiver nela)
/// deixa o HTML achar o CSS e o JS de pastas vizinhas; sem ela, serve a pasta do arquivo.
pub fn serve(file: &str, root: Option<&str>) -> Result<String, String> {
    let file = Path::new(file).canonicalize().map_err(|_| crate::i18n::tr("não achei esse arquivo", "couldn't find that file").to_string())?;
    if !file.is_file() {
        return Err(crate::i18n::tr("escolha um arquivo, não uma pasta", "pick a file, not a folder").into());
    }
    let base = root
        .and_then(|r| Path::new(r).canonicalize().ok())
        .filter(|r| file.starts_with(r))
        .or_else(|| file.parent().map(Path::to_path_buf))
        .ok_or(crate::i18n::tr("pasta inválida", "invalid folder"))?;
    let s = server()?;
    let mut roots = s.roots.lock().map_err(|e| e.to_string())?;
    let tok = roots.iter().find(|(_, p)| **p == base).map(|(t, _)| t.clone()).unwrap_or_else(|| {
        let t = token();
        roots.insert(t.clone(), base.clone());
        t
    });
    let rel = file.strip_prefix(&base).unwrap_or(&file);
    let rel: Vec<String> = rel.components().map(|c| encode(&c.as_os_str().to_string_lossy())).collect();
    Ok(format!("http://127.0.0.1:{}/{tok}/{}", s.port, rel.join("/")))
}

fn encode(s: &str) -> String {
    s.bytes()
        .map(|b| if b.is_ascii_alphanumeric() || b"-._~".contains(&b) { (b as char).to_string() } else { format!("%{b:02X}") })
        .collect()
}

fn decode(s: &str) -> String {
    let b = s.as_bytes();
    let mut out = Vec::with_capacity(b.len());
    let mut i = 0;
    let hex = |c: u8| (c as char).to_digit(16).map(|d| d as u8);
    while i < b.len() {
        if b[i] == b'%' && i + 2 < b.len() {
            if let (Some(h), Some(l)) = (hex(b[i + 1]), hex(b[i + 2])) {
                out.push(h * 16 + l);
                i += 3;
                continue;
            }
        }
        out.push(b[i]);
        i += 1;
    }
    String::from_utf8_lossy(&out).into_owned()
}

fn mime(p: &Path) -> &'static str {
    match p.extension().and_then(|e| e.to_str()).map(str::to_ascii_lowercase).as_deref() {
        Some("html" | "htm") => "text/html; charset=utf-8",
        Some("css") => "text/css; charset=utf-8",
        Some("js" | "mjs") => "text/javascript; charset=utf-8",
        Some("json" | "map") => "application/json",
        Some("svg") => "image/svg+xml",
        Some("png") => "image/png",
        Some("jpg" | "jpeg") => "image/jpeg",
        Some("gif") => "image/gif",
        Some("webp") => "image/webp",
        Some("avif") => "image/avif",
        Some("ico") => "image/x-icon",
        Some("woff") => "font/woff",
        Some("woff2") => "font/woff2",
        Some("ttf") => "font/ttf",
        Some("otf") => "font/otf",
        Some("mp4") => "video/mp4",
        Some("webm") => "video/webm",
        Some("mp3") => "audio/mpeg",
        Some("wav") => "audio/wav",
        Some("wasm") => "application/wasm",
        Some("txt" | "md") => "text/plain; charset=utf-8",
        Some("pdf") => "application/pdf",
        _ => "application/octet-stream",
    }
}

const MAX_FILE: u64 = 64 * 1024 * 1024;

fn handle(s: &Server, mut stream: TcpStream) -> std::io::Result<()> {
    stream.set_read_timeout(Some(Duration::from_secs(10)))?;
    let mut reader = BufReader::new(stream.try_clone()?);
    let mut line = String::new();
    reader.by_ref().take(8192).read_line(&mut line)?;
    // o resto do cabeçalho: lê e descarta
    loop {
        let mut h = String::new();
        if reader.by_ref().take(8192).read_line(&mut h)? == 0 || h == "\r\n" || h == "\n" {
            break;
        }
    }
    let mut parts = line.split_whitespace();
    let method = parts.next().unwrap_or("");
    let target = parts.next().unwrap_or("/");
    let head = method == "HEAD";
    if method != "GET" && !head {
        return reply(&mut stream, 405, "text/plain", b"", head);
    }
    let path = decode(target.split(['?', '#']).next().unwrap_or("/"));
    let mut segs = path.trim_start_matches('/').splitn(2, '/');
    let tok = segs.next().unwrap_or("");
    let rest = segs.next().unwrap_or("");
    let root = match s.roots.lock().ok().and_then(|r| r.get(tok).cloned()) {
        Some(r) => r,
        None => return reply(&mut stream, 404, "text/plain", b"not found", head),
    };
    if rest.split('/').any(|c| c == "..") {
        return reply(&mut stream, 403, "text/plain", b"forbidden", head);
    }
    let mut file = root.join(rest);
    if file.is_dir() {
        file = file.join("index.html");
    }
    // não sai da pasta (nem por atalho simbólico)
    let real = match file.canonicalize() {
        Ok(r) if r.starts_with(&root) && r.is_file() => r,
        _ => return reply(&mut stream, 404, "text/plain", b"not found", head),
    };
    let size = real.metadata().map(|m| m.len()).unwrap_or(0);
    if size > MAX_FILE {
        return reply(&mut stream, 413, "text/plain", b"too large", head);
    }
    let body = if head { Vec::new() } else { std::fs::read(&real).unwrap_or_default() };
    reply(&mut stream, 200, mime(&real), &body, head)
}

fn reply(stream: &mut TcpStream, code: u16, kind: &str, body: &[u8], head: bool) -> std::io::Result<()> {
    let text = match code {
        200 => "OK",
        403 => "Forbidden",
        404 => "Not Found",
        405 => "Method Not Allowed",
        _ => "Payload Too Large",
    };
    write!(stream, "HTTP/1.1 {code} {text}\r\nContent-Type: {kind}\r\nContent-Length: {}\r\nCache-Control: no-store\r\nConnection: close\r\n\r\n", body.len())?;
    if !head {
        stream.write_all(body)?;
    }
    stream.flush()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn get(url: &str) -> (u16, String) {
        let rest = url.trim_start_matches("http://");
        let (host, path) = rest.split_once('/').unwrap();
        let mut s = TcpStream::connect(host).unwrap();
        write!(s, "GET /{path} HTTP/1.1\r\nHost: {host}\r\n\r\n").unwrap();
        let mut out = String::new();
        s.read_to_string(&mut out).unwrap();
        let code = out.split_whitespace().nth(1).unwrap().parse().unwrap();
        (code, out.split("\r\n\r\n").nth(1).unwrap_or("").to_string())
    }

    #[test]
    fn cookie_domains() {
        assert!(cookie_matches("localhost", "localhost"));
        assert!(cookie_matches(".site.com", "app.site.com"));
        assert!(cookie_matches("site.com", "site.com"));
        assert!(!cookie_matches("site.com", "outrosite.com"));
        assert!(!cookie_matches("", "site.com"));
    }

    #[test]
    fn probe_only_local_addresses() {
        assert_eq!(probe("https://example.com/x"), None);
        assert_eq!(probe("nada"), None);
        let l = TcpListener::bind("127.0.0.1:0").unwrap();
        let port = l.local_addr().unwrap().port();
        assert_eq!(probe(&format!("http://localhost:{port}/a?b")), Some(true));
        assert_eq!(probe(&format!("http://127.0.0.1:{port}")), Some(true));
        drop(l);
        assert_eq!(probe(&format!("http://127.0.0.1:{port}/")), Some(false));
    }

    #[test]
    fn api_tools_skip_the_screenshot() {
        let list = api_tools();
        let names: Vec<&str> = list.as_array().unwrap().iter().map(|t| t["function"]["name"].as_str().unwrap()).collect();
        assert!(names.contains(&"browser_open") && names.contains(&"browser_read") && !names.contains(&"browser_screenshot"));
        assert!(list.as_array().unwrap().iter().all(|t| t["type"] == "function" && t["function"]["parameters"]["type"] == "object"));
        let (t, ok) = api_result(&serde_json::json!({"content":[{"type":"text","text":"a"},{"type":"image","data":"x"},{"type":"text","text":"b"}]}));
        assert_eq!((t.as_str(), ok), ("a\nb", true));
        assert!(!api_result(&serde_json::json!({"content":[{"type":"text","text":"x"}],"isError":true})).1);
    }

    #[test]
    fn ai_tools_are_well_formed() {
        let t = ai_tools();
        let names: Vec<&str> = t.as_array().unwrap().iter().map(|x| x["name"].as_str().unwrap()).collect();
        assert!(names.contains(&"browser_open") && names.contains(&"browser_screenshot") && names.contains(&"browser_console"));
        assert!(t.as_array().unwrap().iter().all(|x| x["inputSchema"]["type"] == "object"));
    }

    #[test]
    fn serves_only_the_chosen_folder() {
        let base = std::env::temp_dir().join(format!("veocode-br-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&base);
        std::fs::create_dir_all(base.join("site/css")).unwrap();
        std::fs::write(base.join("site/página.html"), "<h1>oi</h1>").unwrap();
        std::fs::write(base.join("site/css/a.css"), "h1{}").unwrap();
        std::fs::write(base.join("segredo.txt"), "não").unwrap();
        let url = serve(base.join("site/página.html").to_str().unwrap(), None).unwrap();
        assert!(url.ends_with("/p%C3%A1gina.html"), "{url}");
        assert_eq!(get(&url), (200, "<h1>oi</h1>".into()));
        let dir = url.rsplit_once('/').unwrap().0;
        assert_eq!(get(&format!("{dir}/css/a.css")).0, 200);
        assert_eq!(get(&format!("{dir}/../segredo.txt")).0, 403);
        assert_eq!(get(&format!("{dir}/%2E%2E/segredo.txt")).0, 403);
        assert_eq!(get(&format!("http://127.0.0.1:{}/codigo-errado/página.html", server().unwrap().port)).0, 404);
        let _ = std::fs::remove_dir_all(&base);
    }
}
