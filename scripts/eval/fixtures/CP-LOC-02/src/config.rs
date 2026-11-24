use std::env;
use std::fs;

pub fn load_profile() -> String {
    if let Ok(value) = env::var("APP_PROFILE") {
        return value;
    }
    if let Ok(text) = fs::read_to_string("config.local.toml") {
        return parse(&text);
    }
    let text = fs::read_to_string("config.toml").unwrap_or_default();
    parse(&text)
}

fn parse(text: &str) -> String {
    text.lines()
        .find_map(|line| line.strip_prefix("profile = "))
        .unwrap_or("base")
        .trim()
        .to_string()
}
