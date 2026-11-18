//! Raio-X: tudo o que as IAs deixaram ou estão rodando na máquina.

pub mod caches;
pub mod installs;
pub mod machines;
pub mod models;
pub mod procs;
pub mod util;

/// Diagnóstico manual contra a máquina de verdade (só leitura):
/// `cargo test real_machine_report -- --ignored --nocapture`
#[cfg(test)]
mod real {
    #[test]
    #[ignore]
    fn real_machine_report() {
        let t = std::time::Instant::now();
        for c in super::caches::known(&[]) {
            println!("CACHE {:<28} {:>10} MB  {:?}", c.id, super::caches::measure(&c) / 1_048_576, c.display_paths);
        }
        println!("caches em {:?}", t.elapsed());
        let t = std::time::Instant::now();
        let r = super::installs::report(&super::caches::claude_config_dirs());
        println!("históricos lidos: {} · gerenciadores: {:?} · pacotes no sistema: {} · em {:?}", r.transcripts_read, r.managers_found, r.system.len(), t.elapsed());
        for i in r.ai_installs.iter().take(15) {
            println!("IA {:?} {:<24} {:<10} {} · {}", i.manager, i.package, i.status, &i.when.get(..10).unwrap_or(""), i.project);
        }
        println!("total IA: {}", r.ai_installs.len());
        let m = super::machines::report();
        println!("engines: {:?}", m.engines.iter().map(|e| (e.name, e.installed)).collect::<Vec<_>>());
        let mut sys = super::procs::new_system().unwrap();
        super::procs::snapshot(&mut sys);
        std::thread::sleep(std::time::Duration::from_millis(500));
        for g in super::procs::snapshot(&mut sys) {
            println!("AGENTE {} pid {} filhos {} cwd {:?}", g.agent, g.pid, g.children.len(), g.cwd);
            for c in g.children.iter().take(4) {
                println!("   {} {:.1}% {} MB {:?} {}", c.pid, c.cpu, c.mem / 1_048_576, c.ports, &c.cmd.chars().take(70).collect::<String>());
            }
        }
    }
}
