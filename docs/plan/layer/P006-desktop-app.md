---
id: P006
status: done
created: 2026-03-02
---

status: done
---

# Diligent Desktop App — Tauri v2 + Bun Sidecar

## Context

`packages/web`은 Bun 서버(WebSocket JSON-RPC) + React SPA 구조. 이걸 Mac/Windows 데스크톱 앱으로 패키징한다. Tauri v2를 선택 — 시스템 WebView 사용으로 바이너리가 가볍고, sidecar를 통해 기존 Bun 서버를 그대로 구동할 수 있다.

**핵심 아키텍처:**
```
Tauri (Rust + System WebView)
  ├── sidecar: Bun 서버 바이너리 (bun build --compile)
  │   ├── React SPA 정적 파일 서빙
  │   ├── DiligentAppServer (in-process)
  │   └── WebSocket RPC
  └── WebView → http://127.0.0.1:{dynamic-port}
```

---

## Step 1: packages/web 서버 수정 (sidecar 호환)

**파일: `packages/web/src/server/index.ts`**

### 1a. `--dist-dir` CLI 인자 추가

`parseArgs`에 `--dist-dir` 파싱 추가. `CreateServerOptions`에 `distDir?: string` 추가.

```typescript
// parseArgs 수정
function parseArgs(argv: string[]): { port?: number; dev: boolean; distDir?: string } {
  const portArg = argv.find((arg) => arg.startsWith("--port="));
  const port = portArg ? Number.parseInt(portArg.split("=")[1], 10) : undefined;
  const dev = argv.includes("--dev");
  const distArg = argv.find((arg) => arg.startsWith("--dist-dir="));
  const distDir = distArg ? distArg.split("=")[1] : undefined;
  return { port: Number.isFinite(port) ? port : undefined, dev, distDir };
}
```

### 1b. dist 경로 해석 수정 (line 66)

`import.meta.dir`은 `bun build --compile`에서 `/$bunfs/root/`를 반환하므로 fallback 체인 필요.

```typescript
// 기존: const distDir = resolve(import.meta.dir, "../../dist/client");
// 변경:
function resolveDistDir(): string {
  // Compiled binary: dist/client is next to the binary
  const candidate = resolve(dirname(process.execPath), "dist", "client");
  if (existsSync(candidate)) return candidate;
  // Dev fallback: relative to source
  return resolve(import.meta.dir, "../../dist/client");
}

const distDir = options.distDir ?? resolveDistDir();
```

### 1c. 포트 출력 프로토콜

sidecar 시작 시 Tauri가 실제 포트를 파싱할 수 있도록 구조화된 출력 추가. `--port=0`이면 OS가 빈 포트 할당.

```typescript
// isDirect 블록의 .then() 수정
.then(({ server }) => {
  console.log(`DILIGENT_PORT=${server.port}`);
  console.log(`Diligent Web CLI server running at http://localhost:${server.port}`);
  console.log(`RPC endpoint: ws://localhost:${server.port}/rpc`);
})
```

---

## Step 2: `apps/desktop` 스캐폴드 생성

`packages/`와 분리 — Rust 프로젝트라 TS 패키지들과 성격이 다르고, 향후 다른 앱 타겟(mobile 등)도 `apps/` 아래에 배치.

```
apps/desktop/
├── package.json
├── scripts/
│   └── build-sidecar.ts        # Bun 서버 컴파일 + 파일 배치
├── loading/
│   └── index.html               # 서버 부팅 중 스플래시
├── src-tauri/
│   ├── Cargo.toml
│   ├── tauri.conf.json
│   ├── capabilities/
│   │   └── default.json
│   ├── binaries/
│   │   └── .gitkeep
│   ├── resources/
│   │   └── .gitkeep             # dist/client가 여기에 복사됨
│   ├── icons/                   # tauri icon 생성
│   └── src/
│       ├── main.rs
│       ├── lib.rs               # Tauri builder + setup
│       └── sidecar.rs           # sidecar 라이프사이클
└── README.md
```

### 주요 설정 파일

**`tauri.conf.json`** — `frontendDist`는 `../loading` (스플래시), `externalBin`에 sidecar 등록, `bundle.resources`에 `dist/client` 등록.

**`capabilities/default.json`** — `shell:allow-spawn`, `shell:allow-kill` 권한으로 sidecar 실행/종료 허용.

**`Cargo.toml`** — 의존성: `tauri 2`, `tauri-plugin-shell 2`, `tauri-plugin-process 2`, `serde`, `reqwest`, `dirs`.

---

## Step 3: Rust sidecar 라이프사이클 (`sidecar.rs`)

### 시작 흐름
1. `app.path().resource_dir()` → dist/client 경로 해석
2. `app.shell().sidecar("diligent-web-server")` + `--port=0 --dist-dir={path}` 으로 spawn
3. stdout에서 `DILIGENT_PORT=<number>` 파싱 (15초 타임아웃)
4. `http://127.0.0.1:{port}/health` 폴링으로 준비 확인
5. WebView를 `http://127.0.0.1:{port}`로 navigate

### 종료 흐름
- `RunEvent::ExitRequested` 또는 `RunEvent::Exit`에서 `child.kill()` 호출
- `SidecarState`를 `Mutex<Option<CommandChild>>`로 관리

### `lib.rs` setup
```rust
.setup(|app| {
    let handle = app.handle().clone();
    tauri::async_runtime::spawn(async move {
        match start_sidecar(&handle).await {
            Ok(port) => {
                if let Some(window) = handle.get_webview_window("main") {
                    let _ = window.navigate(format!("http://127.0.0.1:{}", port).parse().unwrap());
                }
            }
            Err(e) => eprintln!("Sidecar failed: {e}"),
        }
    });
    Ok(())
})
```

---

## Step 4: 빌드 파이프라인

### `scripts/build-sidecar.ts`

1. `bun run --cwd packages/web build` → `dist/client/` 생성
2. `bun build --compile --target=<target> packages/web/src/server/index.ts --outfile ...` → sidecar 바이너리 생성
3. 바이너리를 Tauri 명명 규칙에 맞게 이동:
   - `binaries/diligent-web-server-aarch64-apple-darwin`
   - `binaries/diligent-web-server-x86_64-apple-darwin`
   - `binaries/diligent-web-server-x86_64-pc-windows-msvc.exe`
4. `dist/client/`를 `resources/dist/client/`로 복사

### Root `package.json` 스크립트 추가
```json
"desktop:dev": "bun run --cwd apps/desktop dev",
"desktop:build": "bun run --cwd apps/desktop build"
```

### `apps/desktop/package.json` 스크립트
```json
"build:sidecar": "bun run scripts/build-sidecar.ts",
"build:frontend": "bun run --cwd ../../packages/web build",
"dev": "bun run build:sidecar && cargo tauri dev",
"build": "bun run build:frontend && bun run build:sidecar && cargo tauri build"
```

---

## Step 5: 스플래시 화면

`loading/index.html` — Diligent 디자인 토큰 사용 (배경 `#0f1415`, 텍스트 `#eff7f8`, 액센트 `#5ad9b8`). "Starting server..." 메시지 표시. sidecar 준비 후 `window.navigate()`로 전환.

---

## 변경 파일 요약

| 파일 | 변경 |
|------|------|
| `packages/web/src/server/index.ts` | `--dist-dir` 인자, `resolveDistDir()`, `DILIGENT_PORT=` 출력 |
| `package.json` (root) | `desktop:dev`, `desktop:build` 스크립트 |
| `apps/desktop/` (신규) | Tauri v2 앱 전체 (Rust + config + 빌드 스크립트) |

기존 `packages/web/src/client/` 코드는 **변경 없음** — WebSocket URL이 `window.location.host` 기반이므로 WebView에서도 그대로 동작.

---

## 검증 방법

1. `packages/web` 서버 수정 후: `bun run packages/web/src/server/index.ts --port=0` → `DILIGENT_PORT=` 출력 확인
2. `bun run packages/web/src/server/index.ts --dist-dir=/tmp/test` → dist-dir 인자 동작 확인
3. `cd apps/desktop && cargo tauri dev` → 네이티브 창에 웹 UI 표시 확인
4. `cargo tauri build` → `.dmg` (Mac) 또는 `.exe` (Windows) 생성 확인
5. 앱 종료 시 sidecar 프로세스 정리 확인 (`ps aux | grep diligent-web-server`)
6. 기존 `bun test packages/web/` 테스트 통과 확인
