use std::fs;

pub struct Stats {
    pub lines: usize,
    pub bytes: usize,
}

pub fn analyze(path: &str) -> Stats {
    let text = fs::read_to_string(path).unwrap_or_default();
    Stats {
        lines: text.lines().count(),
        bytes: text.len(),
    }
}
