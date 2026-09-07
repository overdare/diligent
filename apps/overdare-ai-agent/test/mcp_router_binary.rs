use std::io::Write;
use std::path::Path;
use std::process::{Command, Stdio};

#[tokio::test]
async fn cancelling_a_running_call_disconnects_the_sidecar_and_preserves_queued_call_order() {
    use serde_json::{json, Value};
    use tokio::io::{AsyncBufReadExt, AsyncReadExt, AsyncWriteExt, BufReader};
    use tokio::time::{timeout, Duration};

    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let sidecar_url = format!("http://{}", listener.local_addr().unwrap());
    let (started_tx, started) = tokio::sync::oneshot::channel();
    let (disconnected_tx, mut disconnected) = tokio::sync::oneshot::channel();
    let sidecar = tokio::spawn(async move {
        let mut started_tx = Some(started_tx);
        let mut disconnected_tx = Some(disconnected_tx);
        loop {
            let (socket, _) = listener.accept().await.unwrap();
            let mut socket = BufReader::new(socket);
            let mut headers = String::new();
            let mut length = 0;
            loop {
                let mut line = String::new();
                socket.read_line(&mut line).await.unwrap();
                if line == "\r\n" {
                    break;
                }
                if let Some(value) = line.to_lowercase().strip_prefix("content-length:") {
                    length = value.trim().parse().unwrap();
                }
                headers.push_str(&line);
            }
            let mut bytes = vec![0; length];
            socket.read_exact(&mut bytes).await.unwrap();
            let body = if headers.starts_with("GET /health") {
                json!({ "ok": true })
            } else {
                let call: Value = serde_json::from_slice(&bytes).unwrap();
                match call["tool"].as_str().unwrap() {
                    "slow_image" => {
                        started_tx.take().unwrap().send(()).unwrap();
                        let mut byte = [0];
                        let closed = socket.read(&mut byte).await;
                        assert!(
                            matches!(closed, Ok(0) | Err(_)),
                            "cancel must close the request"
                        );
                        disconnected_tx.take().unwrap().send(()).unwrap();
                        continue;
                    }
                    "queued_image" => {
                        panic!("a cancelled queued call must never reach the sidecar")
                    }
                    "after_cancel" => {
                        json!({ "content": [{ "type": "text", "text": "still connected" }] })
                    }
                    other => panic!("unexpected tool {other}"),
                }
            };
            let payload = body.to_string();
            let response = format!(
                "HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{payload}",
                payload.len()
            );
            socket.write_all(response.as_bytes()).await.unwrap();
        }
    });
    let temporary_home = std::env::temp_dir().join(format!(
        "overdare-mcp-cancel-{}-{}",
        std::process::id(),
        chrono::Utc::now().timestamp_nanos_opt().unwrap()
    ));
    let registry = temporary_home.join(".overdare/mcp/studios");
    std::fs::create_dir_all(&registry).unwrap();
    let now = chrono::Utc::now().to_rfc3339();
    std::fs::write(registry.join("test.json"), json!({
        "id": "test", "cwd": temporary_home, "sidecarUrl": sidecar_url,
        "sidecarToken": "test-token", "heartbeatAt": now, "startedAt": now, "pid": std::process::id()
    }).to_string()).unwrap();
    let mut child = tokio::process::Command::new(env!("CARGO_BIN_EXE_overdare-mcp"))
        .env("HOME", &temporary_home)
        .env("USERPROFILE", &temporary_home)
        .kill_on_drop(true)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .spawn()
        .unwrap();
    let mut stdin = child.stdin.take().unwrap();
    let mut stdout = BufReader::new(child.stdout.take().unwrap()).lines();
    let slow = json!({ "jsonrpc": "2.0", "id": 1, "method": "tools/call", "params": { "name": "slow_image" } });
    stdin
        .write_all(format!("{slow}\n").as_bytes())
        .await
        .unwrap();
    timeout(Duration::from_secs(3), started)
        .await
        .expect("image call must start")
        .unwrap();

    // An unrelated cancellation cannot interrupt the active image request.
    let unrelated = json!({ "jsonrpc": "2.0", "method": "notifications/cancelled", "params": { "requestId": 99 } });
    stdin
        .write_all(format!("{unrelated}\n").as_bytes())
        .await
        .unwrap();
    assert!(timeout(Duration::from_millis(50), &mut disconnected)
        .await
        .is_err());

    for message in [
        json!({ "jsonrpc": "2.0", "id": 2, "method": "tools/call", "params": { "name": "queued_image" } }),
        json!({ "jsonrpc": "2.0", "id": 3, "method": "ping" }),
        json!({ "jsonrpc": "2.0", "method": "notifications/cancelled", "params": { "requestId": 2 } }),
        json!({ "jsonrpc": "2.0", "method": "notifications/cancelled", "params": { "requestId": 1 } }),
    ] {
        stdin
            .write_all(format!("{message}\n").as_bytes())
            .await
            .unwrap();
    }
    timeout(Duration::from_secs(2), disconnected)
        .await
        .expect("cancel must disconnect HTTP")
        .unwrap();
    let line = timeout(Duration::from_secs(2), stdout.next_line())
        .await
        .unwrap()
        .unwrap()
        .unwrap();
    let response: Value = serde_json::from_str(&line).unwrap();
    assert_eq!(
        response["id"], 3,
        "cancelled calls must not return a late response"
    );

    let followup = json!({ "jsonrpc": "2.0", "id": 4, "method": "tools/call", "params": { "name": "after_cancel" } });
    stdin
        .write_all(format!("{followup}\n").as_bytes())
        .await
        .unwrap();
    let line = timeout(Duration::from_secs(2), stdout.next_line())
        .await
        .unwrap()
        .unwrap()
        .unwrap();
    let response: Value = serde_json::from_str(&line).unwrap();
    assert_eq!(response["id"], 4);
    assert_eq!(response["result"]["content"][0]["text"], "still connected");
    drop(stdin);
    assert!(timeout(Duration::from_secs(2), child.wait())
        .await
        .unwrap()
        .unwrap()
        .success());
    sidecar.abort();
    let _ = sidecar.await;
    std::fs::remove_dir_all(temporary_home).unwrap();
}

#[test]
fn dedicated_binary_starts_the_router_without_a_subcommand() {
    let executable = env!("CARGO_BIN_EXE_overdare-mcp");
    let expected_name = if cfg!(windows) {
        "overdare-mcp.exe"
    } else {
        "overdare-mcp"
    };
    assert_eq!(
        Path::new(executable)
            .file_name()
            .and_then(|name| name.to_str()),
        Some(expected_name)
    );

    let temporary_home =
        std::env::temp_dir().join(format!("overdare-mcp-binary-{}", std::process::id()));
    std::fs::create_dir_all(&temporary_home).expect("create temporary home");

    let mut child = Command::new(executable)
        .env("HOME", &temporary_home)
        .env("USERPROFILE", &temporary_home)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .expect("start dedicated MCP router");

    let request = serde_json::json!({
        "jsonrpc": "2.0",
        "id": 1,
        "method": "initialize",
        "params": {
            "protocolVersion": "2025-06-18",
            "capabilities": {},
            "clientInfo": {
                "name": "dedicated-router-test",
                "version": "1.0.0"
            }
        }
    });
    writeln!(child.stdin.as_mut().expect("router stdin"), "{}", request)
        .expect("write initialize request");
    drop(child.stdin.take());

    let output = child.wait_with_output().expect("wait for router");
    assert!(
        output.status.success(),
        "router failed: {}",
        String::from_utf8_lossy(&output.stderr)
    );

    let response: serde_json::Value =
        serde_json::from_slice(&output.stdout).expect("parse initialize response");
    assert_eq!(response["id"], 1);
    assert_eq!(
        response["result"]["serverInfo"]["name"],
        "overdare-ai-agent"
    );
    assert!(response["result"]["capabilities"]["tools"].is_object());
    assert!(
        String::from_utf8_lossy(&output.stderr).contains("[mcp-router] ready on stdio"),
        "router readiness log missing"
    );

    let _ = std::fs::remove_dir_all(temporary_home);
}
