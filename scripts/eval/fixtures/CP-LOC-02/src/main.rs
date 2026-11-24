mod config;

fn main() {
    println!("{}", config::load_profile());
}
