mod memory;

fn main() {
    let stats = memory::analyze("app.log");
    println!("{} {}", stats.lines, stats.bytes);
}
