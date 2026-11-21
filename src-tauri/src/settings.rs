//! Ajustes do Veocode (aparência e afins), em `settings.json` na pasta de configuração do app.
//! Valor desconhecido ou arquivo estragado volta para o padrão em vez de travar a abertura.

use serde::{Deserialize, Serialize};
use std::fs;
use std::path::{Path, PathBuf};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Default)]
#[serde(rename_all = "lowercase")]
pub enum Icons {
    Minimalista,
    #[default]
    Detalhado,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Default)]
#[serde(rename_all = "lowercase")]
pub enum Motion {
    #[default]
    Completa,
    Reduzida,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Default)]
#[serde(rename_all = "lowercase")]
pub enum Theme {
    #[default]
    Escuro,
    Claro,
    /// segue o claro/escuro do sistema
    Sistema,
}

/// Idioma da interface. `Sistema` segue o idioma do computador.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Default)]
#[serde(rename_all = "lowercase")]
pub enum Language {
    #[default]
    Sistema,
    Pt,
    En,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase", default)]
pub struct Settings {
    pub theme: Theme,
    pub language: Language,
    pub icons: Icons,
    pub motion: Motion,
    /// conta do Chat livre (vazio = a conta padrão)
    pub free_account: String,
    /// nível de acesso do Chat livre (0 Leitura … 3 Total); ele sempre pode ler o computador, fora os segredos
    pub free_level: u8,
    /// tela Projetos: o painel de baixo (atividade e terminal) já abre aberto
    pub bottom_panel: bool,
}

/// Lê campo a campo: um valor ruim não derruba os outros.
pub fn load(dir: &Path) -> Settings {
    let Ok(text) = fs::read_to_string(dir.join("settings.json")) else { return Settings::default() };
    let Ok(v) = serde_json::from_str::<serde_json::Value>(&text) else { return Settings::default() };
    let field = |k: &str| v.get(k).cloned().unwrap_or(serde_json::Value::Null);
    Settings {
        theme: serde_json::from_value(field("theme")).unwrap_or_default(),
        language: serde_json::from_value(field("language")).unwrap_or_default(),
        icons: serde_json::from_value(field("icons")).unwrap_or_default(),
        motion: serde_json::from_value(field("motion")).unwrap_or_default(),
        free_account: serde_json::from_value(field("freeAccount")).unwrap_or_default(),
        free_level: serde_json::from_value::<u8>(field("freeLevel")).map(|l| l.min(3)).unwrap_or_default(),
        bottom_panel: serde_json::from_value(field("bottomPanel")).unwrap_or_default(),
    }
}

/// Grava inteiro (arquivo temporário + troca), para nunca ficar pela metade.
pub fn save(dir: &Path, s: &Settings) -> Result<(), String> {
    fs::create_dir_all(dir).map_err(|e| e.to_string())?;
    let file: PathBuf = dir.join("settings.json");
    let tmp = dir.join("settings.json.tmp");
    let text = serde_json::to_string_pretty(s).map_err(|e| e.to_string())?;
    fs::write(&tmp, text).map_err(|e| e.to_string())?;
    fs::rename(&tmp, &file).map_err(|e| e.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn saves_and_survives_bad_values() {
        let dir = std::env::temp_dir().join(format!("veocode-settings-{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        assert_eq!(load(&dir), Settings::default());

        let s = Settings { theme: Theme::Claro, language: Language::En, icons: Icons::Minimalista, motion: Motion::Reduzida, free_account: "acc-1".into(), free_level: 2, bottom_panel: true };
        save(&dir, &s).unwrap();
        assert_eq!(load(&dir), s);

        // valor desconhecido num campo não apaga o outro
        fs::write(dir.join("settings.json"), r#"{"icons":"neon","motion":"reduzida","freeLevel":"sim","freeAccount":"a2","language":"klingon"}"#).unwrap();
        assert_eq!(load(&dir), Settings { theme: Theme::Escuro, language: Language::Sistema, icons: Icons::Detalhado, motion: Motion::Reduzida, free_account: "a2".into(), free_level: 0, bottom_panel: false });

        fs::write(dir.join("settings.json"), "{ quebrado").unwrap();
        assert_eq!(load(&dir), Settings::default());
        let _ = fs::remove_dir_all(&dir);
    }
}
