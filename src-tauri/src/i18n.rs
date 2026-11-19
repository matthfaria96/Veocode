//! Idioma das mensagens que saem do Rust (erros, avisos, instruções para a IA).
//! A tela decide o idioma (o ajuste ou o do sistema) e avisa por `i18n_set` ao abrir e ao trocar.

use std::sync::atomic::{AtomicBool, Ordering};

static EN: AtomicBool = AtomicBool::new(false);

pub fn set_en(v: bool) {
    EN.store(v, Ordering::Relaxed);
}

/// A tela está em inglês?
pub fn en() -> bool {
    EN.load(Ordering::Relaxed)
}

/// O texto no idioma da tela: `tr("Pasta não encontrada", "Folder not found")`.
/// Troca o ponto decimal por vírgula em português.
pub fn dec(s: &str) -> String {
    if en() { s.to_string() } else { s.replacen('.', ",", 1) }
}

pub fn tr<'a>(pt: &'a str, en: &'a str) -> &'a str {
    if self::en() {
        en
    } else {
        pt
    }
}

/// Como `format!`, com uma frase para cada idioma: `trf!("{} arquivos", "{} files", n)`.
#[macro_export]
macro_rules! trf {
    ($pt:literal, $en:literal $(, $arg:expr)* $(,)?) => {
        if $crate::i18n::en() { format!($en $(, $arg)*) } else { format!($pt $(, $arg)*) }
    };
}
