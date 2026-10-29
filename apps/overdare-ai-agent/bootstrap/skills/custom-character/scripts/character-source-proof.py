# Copyright OVERDARE, Inc. All Rights Reserved.
"""Local semantic build/observe runner; owned fresh processes verify saved authoring source.

Example: python character-source-proof.py --studio-root STUDIO_CHECKOUT verify-source --build-id BUILD_ID
Commit uses the same requestId/input plus commit=true and expectedRevision from the inspected draft.
"""
import argparse
import hashlib
import json
import pathlib
import re
import subprocess
import shutil
import sys
import uuid

TEST = "FCharacterAuthoringServiceRequestTest"


def invoke(studio_root, mode, target, directory, request=None, build_id=None, render=True, user_dir=None):
    binary = studio_root / ("Sandbox/Binaries/Win64/Sandbox.exe" if target == "standalone" else
                     "unreal-engine/Engine/Binaries/Win64/UnrealEditor-Cmd.exe")
    response_path = directory / f"{mode}-response.json"
    log = directory / f"{mode}.log"
    command = [str(binary), str(studio_root / "Sandbox/Sandbox.uproject"), "-unattended", "-nosplash",
               "-RenderOffscreen" if render else "-NullRHI", "-DisablePython", "-PlatformEnv=qa", "-FORCELOGFLUSH", f"-abslog={log}",
               "-ExecCmds=Automation RunTests Sandbox.Character.Service.Request", "-TestExit=Automation Test Queue Empty",
               f"-CharacterMode={mode}", f"-CharacterResponse={response_path}"]
    if target == "standalone":
        command.append(f"-StudioAutomation={TEST}")
    if request:
        command.append(f"-CharacterRequest={pathlib.Path(request).resolve()}")
    if build_id:
        command.append(f"-CharacterBuildId={build_id}")
    if user_dir:
        # Studio clears its numeric asset download cache during startup. A
        # proof process must not clear another open Studio's active cache.
        command.append(f"-UserDir={pathlib.Path(user_dir).resolve()}")
    with (directory / f"{mode}-stdout.log").open("w", encoding="utf-8") as stream:
        process = subprocess.Popen(command, cwd=binary.parent, stdout=stream, stderr=subprocess.STDOUT,
                                   creationflags=subprocess.CREATE_NO_WINDOW if sys.platform == "win32" else 0)
        (directory / f"{mode}-running.json").write_text(json.dumps({"pid": process.pid, "command": command}), encoding="utf-8")
        while True:
            try:
                code = process.wait(timeout=30)
                break
            except subprocess.TimeoutExpired:
                # Shader compilation and fresh loads may take longer than a
                # sampling interval. Keep observing the same owned process.
                print(f"{mode}: still running; owned PID {process.pid}", flush=True)
    (directory / f"{mode}-running.json").unlink()
    text = log.read_text(encoding="utf-8", errors="replace") if log.exists() else ""
    successful = (bool(re.search(rf"StudioAutomation: test={re.escape(TEST)}(?: started=true)? passed=true errors=0(?:\s|$)", text)) if target == "standalone" else
                  bool(re.search(r"Test Completed\. Result=\{Success\}.*Path=\{Sandbox.Character.Service.Request\}", text)))
    # Shader compiler failures are logged as warnings. A semantic playback
    # success cannot certify a saved draft rendered with the default material.
    fallback_lines = [line for line in text.splitlines()
                      if "Failed to compile Material" in line
                      and "Default Material will be used" in line
                      and "ProceduralCharacters" in line
                      and (not build_id or build_id in line)]
    evidence = {"pid": process.pid, "returncode": code,
                "verified": code == 0 and successful and not fallback_lines,
                "materialFallbackWarnings": len(fallback_lines), "command": command}
    (directory / f"{mode}-process.json").write_text(json.dumps(evidence, indent=2), encoding="utf-8")
    result = json.loads(response_path.read_text(encoding="utf-8-sig")) if response_path.exists() else {
        "state": "failed", "diagnostics": [{"code": "NATIVE_PROCESS_FAILED", "message": f"Inspect {log}"}]}
    if fallback_lines:
        result["passed"] = False
        result.setdefault("diagnostics", []).append({"code": "MATERIAL_SHADER_FALLBACK",
                                                     "message": f"Saved authoring materials failed shader compilation; inspect {log}"})
    return evidence["verified"], result


def source_files(directory):
    """Fence the exact immutable files copied into the independent process."""
    return {str(path.relative_to(directory)): hashlib.sha256(path.read_bytes()).hexdigest()
            for path in directory.rglob("*") if path.is_file()
            and path.name != "source_reload.json"}


def verify_isolated(studio_root, target, directory, build_id, source_user_dir=None):
    saved = pathlib.Path(source_user_dir).resolve() / "Saved" if source_user_dir else studio_root / "Sandbox/Saved"
    source = saved / "ProceduralCharacters" / build_id
    if not source.is_dir():
        return False, {"state": "failed", "diagnostics": [{"code": "SOURCE_NOT_FOUND",
                       "message": "The saved draft directory is unavailable."}]}
    before = source_files(source)
    user_dir = directory / "isolated-user"
    copied = user_dir / "Saved/ProceduralCharacters" / build_id
    shutil.copytree(source, copied)
    if source_files(copied) != before:
        return False, {"state": "failed", "diagnostics": [{"code": "SOURCE_CHANGED",
                       "message": "Draft files changed while copying the source snapshot."}]}
    succeeded, result = invoke(studio_root, "verify_source", target, directory, build_id=build_id,
                               user_dir=user_dir)
    if not succeeded:
        return False, result
    proof = copied / "source_reload.json"
    if source_files(source) != before or not proof.is_file():
        return False, {"state": "failed", "diagnostics": [{"code": "SOURCE_CHANGED",
                       "message": "The original draft changed during proof; no proof was installed."}]}
    temporary = source / ("source-reload-" + uuid.uuid4().hex + ".tmp")
    temporary.write_bytes(proof.read_bytes())
    temporary.replace(source / "source_reload.json")
    result["isolatedUserDirectory"] = str(user_dir)
    return True, result


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--studio-root", type=pathlib.Path, required=True, help="Studio checkout containing Sandbox/Sandbox.uproject")
    parser.add_argument("action", choices=["build", "observe", "verify-source"])
    parser.add_argument("--request")
    parser.add_argument("--build-id")
    parser.add_argument("--target", choices=["standalone", "editor"], default="standalone")
    parser.add_argument("--source-user-dir", help="Existing Studio -UserDir containing the saved draft; verify-source only")
    args = parser.parse_args()
    studio_root = args.studio_root.resolve()
    if not (studio_root / "Sandbox/Sandbox.uproject").is_file():
        parser.error("--studio-root must contain Sandbox/Sandbox.uproject")
    verifying = args.action == "verify-source"
    if verifying and (not args.build_id or not re.fullmatch(r"[A-Fa-f0-9]{32}", args.build_id)):
        parser.error("--build-id must be a saved build GUID for verification")
    if not verifying and not args.request:
        parser.error("--request is required for build/observe")
    if args.source_user_dir and not verifying:
        parser.error("--source-user-dir applies only to verify-source")
    directory = studio_root / "Sandbox/Saved/ProceduralCharacters/ClientLogs" / uuid.uuid4().hex
    directory.mkdir(parents=True)
    mode = args.action.replace("-", "_")
    if verifying:
        succeeded, result = verify_isolated(studio_root, args.target, directory, args.build_id, args.source_user_dir)
    else:
        succeeded, result = invoke(studio_root, mode, args.target, directory, request=args.request, build_id=args.build_id,
                                   render=args.action == "build")
    if succeeded and args.action == "build" and result.get("state") == "preview_ready":
        passed, proof = verify_isolated(studio_root, args.target, directory, result["buildId"])
        result["reloadValidation"] = proof
        succeeded = passed
    result["runnerEvidencePath"] = str(directory)
    print(json.dumps(result, ensure_ascii=False, indent=2))
    return 0 if succeeded else 1


if __name__ == "__main__":
    sys.exit(main())
