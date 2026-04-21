use crate::init;
use crate::update::{self, UpdateProgress};
use crate::webserver;

pub fn run() -> Result<(), String> {
    let mut args = std::env::args().skip(1);
    let Some(command) = args.next() else {
        print_help();
        return Ok(());
    };

    match command.as_str() {
        "init" => run_init(args.collect()),
        "webserver" => run_webserver(args.collect()),
        "help" | "--help" | "-h" => {
            print_help();
            Ok(())
        }
        other => Err(format!("Unknown command: {other}")),
    }
}

fn run_update() -> Result<(), String> {
    let mut log = String::new();
    let mut progress = |event: UpdateProgress| match event {
        UpdateProgress::Disabled => println!("update disabled"),
        UpdateProgress::BootstrapRequired => println!("runtime bootstrap required"),
        UpdateProgress::Checking { current_version } => println!("checking updates (current: v{current_version})"),
        UpdateProgress::Downloading { target_version } => println!("downloading v{target_version}"),
        UpdateProgress::Verifying { target_version } => println!("verifying v{target_version}"),
        UpdateProgress::Extracting { target_version } => println!("extracting v{target_version}"),
        UpdateProgress::Applying { target_version } => println!("applying v{target_version}"),
        UpdateProgress::UpToDate => println!("already up-to-date"),
        UpdateProgress::Updated { target_version } => println!("updated to v{target_version}"),
    };

    let updated = update::run_with_progress(&mut log, Some(&mut progress))?;
    if !log.is_empty() {
        eprint!("{log}");
    }
    init::run(updated)?;
    Ok(())
}

fn run_init(args: Vec<String>) -> Result<(), String> {
    let skip_update = args.iter().any(|arg| arg == "--skip-update");
    let (current, latest) = update::init_status()?;
    let installed = update::runtime_installed();

    println!("Current version: {}", current.clone().unwrap_or_else(|| "not installed".to_string()));
    println!("Latest version: {latest}");

    if skip_update {
        if !installed {
            return Err("--skip-update cannot be used before the runtime has been downloaded at least once.".to_string());
        }
        println!("Skipping update as requested.");
        init::run(false)?;
        return Ok(());
    }

    run_update()
}

fn run_webserver(args: Vec<String>) -> Result<(), String> {
    let options = webserver::parse_args(&args)?;
    let runtime = tokio::runtime::Runtime::new().map_err(|e| format!("failed to create tokio runtime: {e}"))?;
    let running = runtime.block_on(webserver::start_foreground(options))?;
    println!("DILIGENT_PORT={}", running.port);
    runtime.block_on(running.wait())?;
    Ok(())
}

fn print_help() {
    println!(
        "overdare-ai-agent\n\nCommands:\n  init [--skip-update]   Ensure runtime exists, print current/latest, and update unless skipped\n  webserver [options]    Run updated runtime diligent-web-server as a subprocess"
    );
}

#[cfg(test)]
mod tests {
    #[test]
    fn skip_update_requires_existing_runtime_message_is_stable() {
        let message = "--skip-update cannot be used before the runtime has been downloaded at least once.";
        assert!(message.contains("--skip-update"));
        assert!(message.contains("downloaded at least once"));
    }
}
