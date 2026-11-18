//! VMs e containers: pergunta para cada ferramenta que estiver instalada
//! (Docker, Lima, UTM, Parallels, VirtualBox). Ferramenta ausente = simplesmente pulada.

use super::util::{run, which};
use serde::Serialize;
use serde_json::Value;
use std::time::Duration;

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Machine {
    pub id: String,
    pub name: String,
    /// "container" | "vm"
    pub kind: &'static str,
    pub engine: &'static str,
    pub running: bool,
    pub status_text: String,
    pub detail: Option<String>,
    pub cpu: Option<String>,
    pub ram: Option<String>,
    pub disk: Option<String>,
    pub ports: Option<String>,
    /// Dá para ligar/desligar pelo Veocode.
    pub can_toggle: bool,
    /// Pasta do projeto que criou (Docker Compose grava isso no container).
    pub project: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Engine {
    pub name: &'static str,
    pub installed: bool,
    /// Instalado mas não respondeu (ex.: Docker Desktop fechado).
    pub not_responding: bool,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MachineReport {
    pub machines: Vec<Machine>,
    pub engines: Vec<Engine>,
}

const T: Duration = Duration::from_secs(10);

fn gb(bytes: f64) -> String {
    format!("{:.1} GB", bytes / 1024f64.powi(3)).replace('.', ",")
}

/// `a=b,c=d` → valor de uma chave.
fn label(labels: &str, key: &str) -> Option<String> {
    labels.split(',').find_map(|kv| kv.strip_prefix(key)?.strip_prefix('=')).map(str::to_string).filter(|v| !v.is_empty())
}

pub fn parse_docker_ps(out: &str) -> Vec<Machine> {
    out.lines()
        .filter_map(|l| serde_json::from_str::<Value>(l).ok())
        .map(|v| {
            let s = |k: &str| v.get(k).and_then(Value::as_str).unwrap_or("").to_string();
            let state = s("State");
            Machine {
                id: s("ID"),
                name: s("Names"),
                kind: "container",
                engine: "Docker",
                running: state == "running",
                status_text: s("Status"),
                detail: Some(s("Image")).filter(|x| !x.is_empty()),
                cpu: None,
                ram: None,
                disk: Some(s("Size")).filter(|x| !x.is_empty()),
                ports: Some(s("Ports")).filter(|x| !x.is_empty()),
                can_toggle: true,
                project: label(&s("Labels"), "com.docker.compose.project.working_dir"),
            }
        })
        .collect()
}

fn docker() -> Option<Result<Vec<Machine>, ()>> {
    which("docker")?;
    let Some(out) = run("docker", &["ps", "-a", "--size", "--format", "{{json .}}"], T) else { return Some(Err(())) };
    let mut list = parse_docker_ps(&out);
    if list.iter().any(|m| m.running) {
        if let Some(stats) = run("docker", &["stats", "--no-stream", "--format", "{{json .}}"], T) {
            for v in stats.lines().filter_map(|l| serde_json::from_str::<Value>(l).ok()) {
                let name = v.get("Name").and_then(Value::as_str).unwrap_or("");
                if let Some(m) = list.iter_mut().find(|m| m.name == name) {
                    m.cpu = v.get("CPUPerc").and_then(Value::as_str).map(String::from);
                    m.ram = v.get("MemUsage").and_then(Value::as_str).map(|s| s.split('/').next().unwrap_or(s).trim().to_string());
                }
            }
        }
    }
    Some(Ok(list))
}

pub fn parse_lima(out: &str) -> Vec<Machine> {
    out.lines()
        .filter_map(|l| serde_json::from_str::<Value>(l).ok())
        .map(|v| {
            let name = v.get("name").and_then(Value::as_str).unwrap_or("").to_string();
            let status = v.get("status").and_then(Value::as_str).unwrap_or("").to_string();
            Machine {
                id: name.clone(),
                name,
                kind: "vm",
                engine: "Lima",
                running: status == "Running",
                cpu: v.get("cpus").and_then(Value::as_u64).map(|c| format!("{c} CPUs")),
                ram: v.get("memory").and_then(Value::as_f64).map(gb),
                disk: v.get("disk").and_then(Value::as_f64).map(gb),
                status_text: status,
                detail: v.get("arch").and_then(Value::as_str).map(String::from),
                ports: None,
                can_toggle: true,
                project: None,
            }
        })
        .collect()
}

pub fn parse_utm(out: &str) -> Vec<Machine> {
    out.lines()
        .skip(1)
        .filter_map(|l| {
            let mut it = l.split_whitespace();
            let id = it.next()?.to_string();
            let status = it.next()?.to_string();
            let name = it.collect::<Vec<_>>().join(" ");
            Some(Machine {
                id,
                name,
                kind: "vm",
                engine: "UTM",
                running: status == "started",
                status_text: status,
                detail: None,
                cpu: None,
                ram: None,
                disk: None,
                ports: None,
                can_toggle: false,
                project: None,
            })
        })
        .collect()
}

fn simple_vm(engine: &'static str, id: String, name: String, running: bool) -> Machine {
    Machine { id, name, kind: "vm", engine, running, status_text: if running { "running".into() } else { "stopped".into() }, detail: None, cpu: None, ram: None, disk: None, ports: None, can_toggle: false, project: None }
}

fn parallels() -> Option<Result<Vec<Machine>, ()>> {
    which("prlctl")?;
    let out = run("prlctl", &["list", "-a", "-j"], T);
    Some(out.and_then(|o| serde_json::from_str::<Value>(&o).ok()).and_then(|v| v.as_array().cloned()).map(|a| {
        a.iter()
            .map(|v| {
                let s = |k: &str| v.get(k).and_then(Value::as_str).unwrap_or("").to_string();
                simple_vm("Parallels", s("uuid"), s("name"), s("status") == "running")
            })
            .collect()
    }).ok_or(()))
}

/// `"nome" {uuid}` por linha.
pub fn parse_vbox(out: &str) -> Vec<(String, String)> {
    out.lines()
        .filter_map(|l| {
            let name = l.split('"').nth(1)?.to_string();
            let id = l.rsplit('{').next()?.trim_end_matches('}').to_string();
            Some((id, name))
        })
        .collect()
}

fn virtualbox() -> Option<Result<Vec<Machine>, ()>> {
    which("VBoxManage")?;
    let Some(all) = run("VBoxManage", &["list", "vms"], T) else { return Some(Err(())) };
    let running: Vec<String> = run("VBoxManage", &["list", "runningvms"], T).map(|o| parse_vbox(&o).into_iter().map(|(id, _)| id).collect()).unwrap_or_default();
    Some(Ok(parse_vbox(&all).into_iter().map(|(id, name)| simple_vm("VirtualBox", id.clone(), name, running.contains(&id))).collect()))
}

pub fn report() -> MachineReport {
    let probes: [(&'static str, fn() -> Option<Result<Vec<Machine>, ()>>); 5] = [
        ("Docker", docker),
        ("Lima", || which("limactl").map(|_| run("limactl", &["list", "--json"], T).map(|o| parse_lima(&o)).ok_or(()))),
        ("UTM", || which("utmctl").map(|_| run("utmctl", &["list"], T).map(|o| parse_utm(&o)).ok_or(()))),
        ("Parallels", parallels),
        ("VirtualBox", virtualbox),
    ];
    let results: Vec<(&'static str, Option<Result<Vec<Machine>, ()>>)> =
        std::thread::scope(|s| probes.iter().map(|(n, f)| (*n, s.spawn(*f))).collect::<Vec<_>>().into_iter().map(|(n, h)| (n, h.join().ok().flatten())).collect());

    let mut machines = Vec::new();
    let mut engines = Vec::new();
    for (name, r) in results {
        engines.push(Engine { name, installed: r.is_some(), not_responding: matches!(r, Some(Err(()))) });
        if let Some(Ok(list)) = r {
            machines.extend(list);
        }
    }
    machines.sort_by(|a, b| b.running.cmp(&a.running).then(a.name.cmp(&b.name)));
    MachineReport { machines, engines }
}

/// Liga/desliga. Só Docker e Lima (os outros não têm CLI confiável para isso).
pub fn toggle(engine: &str, id: &str, start: bool) -> Result<(), String> {
    if id.is_empty() || id.starts_with('-') || id.contains(char::is_whitespace) {
        return Err("identificador inválido".into());
    }
    let action = if start { "start" } else { "stop" };
    let ok = match engine {
        "Docker" => run("docker", &[action, id], Duration::from_secs(60)).is_some(),
        "Lima" => run("limactl", &[action, id], Duration::from_secs(180)).is_some(),
        _ => return Err(format!("{engine} não pode ser controlado pelo Veocode ainda")),
    };
    if ok { Ok(()) } else { Err(format!("{engine} não conseguiu {}", if start { "iniciar" } else { "parar" })) }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_docker_lima_utm_vbox() {
        let d = parse_docker_ps(r#"{"ID":"ab12","Names":"pg","Image":"postgres:17","State":"running","Status":"Up 2 hours","Ports":"0.0.0.0:5432->5432/tcp","Size":"63B (virtual 438MB)"}"#);
        assert_eq!((d[0].name.as_str(), d[0].running, d[0].ports.as_deref()), ("pg", true, Some("0.0.0.0:5432->5432/tcp")));

        let l = parse_lima(r#"{"name":"default","status":"Stopped","cpus":4,"memory":4294967296,"disk":107374182400,"arch":"aarch64"}"#);
        assert_eq!((l[0].running, l[0].ram.as_deref(), l[0].disk.as_deref()), (false, Some("4,0 GB"), Some("100,0 GB")));

        let u = parse_utm("UUID                                 Status   Name\n1A2B started  Ubuntu Testes\n");
        assert_eq!((u[0].name.as_str(), u[0].running), ("Ubuntu Testes", true));

        assert_eq!(parse_vbox("\"Win 11\" {abc-123}\n"), vec![("abc-123".into(), "Win 11".into())]);
    }

    #[test]
    fn refuses_weird_ids() {
        assert!(toggle("Docker", "--all", false).is_err());
        assert!(toggle("Docker", "a b", false).is_err());
        assert!(toggle("UTM", "x", true).is_err());
    }
}
