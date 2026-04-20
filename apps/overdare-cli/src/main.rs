mod cli;
mod init;
mod update;
mod webserver;

fn main() {
    if let Err(message) = cli::run() {
        eprintln!("{message}");
        std::process::exit(1);
    }
}
