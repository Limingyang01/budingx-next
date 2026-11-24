pub struct Entry {
    pub ttl: u64,
    pub expired: bool,
}

/// 规格见 cache_spec.md。
pub fn ttl_for(entry: &Entry) -> u64 {
    entry.ttl
}
