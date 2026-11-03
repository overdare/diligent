// @summary Verifies isolated character proof installation and protection of changed source drafts.
import { describe, expect, test } from "bun:test";
import { fileURLToPath } from "node:url";

const runner = fileURLToPath(
  new URL("../../../../bootstrap/skills/custom-character/scripts/character-source-proof.py", import.meta.url),
);

function verifyFixture(action: string): Record<string, unknown> {
  const script = `
import importlib.util, json, pathlib, sys, tempfile
from unittest.mock import patch
spec = importlib.util.spec_from_file_location("character_proof", sys.argv[1])
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)
with tempfile.TemporaryDirectory() as temp:
    root = pathlib.Path(temp)
    studio = root / "arbitrary-studio-checkout"
    build_id = "A" * 32
    source = studio / "Sandbox/Saved/ProceduralCharacters" / build_id
    source.mkdir(parents=True)
    (source / "Bundle.uasset").write_bytes(b"reviewed-source")
    directory = root / "evidence"
    directory.mkdir()
    def invoke(studio_root, mode, target, evidence, build_id=None, user_dir=None):
        assert studio_root == studio and mode == "verify_source"
        copied = user_dir / "Saved/ProceduralCharacters" / build_id
        assert (copied / "Bundle.uasset").read_bytes() == b"reviewed-source"
        (copied / "source_reload.json").write_text('{"passed":true}')
        ${action}
    with patch.object(module, "invoke", invoke):
        passed, result = module.verify_isolated(studio, "standalone", directory, build_id)
    print(json.dumps({"passed": passed, "result": result, "proofInstalled": (source / "source_reload.json").exists(), "source": (source / "Bundle.uasset").read_text()}))
`;
  const interpreter = process.platform === "win32" ? "python" : "python3";
  const child = Bun.spawnSync([interpreter, "-B", "-c", script, runner]);
  if (child.exitCode !== 0) throw new Error(child.stderr.toString());
  expect(child.exitCode).toBe(0);
  return JSON.parse(child.stdout.toString());
}

describe("Diligent character source proof", () => {
  test.each(["build", "observe"])("%s permits explicit rendering without automatically replaying source", (action) => {
    const script = `
import importlib.util, json, pathlib, sys, tempfile
from unittest.mock import patch
spec = importlib.util.spec_from_file_location("character_proof", sys.argv[1])
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)
with tempfile.TemporaryDirectory() as temp:
    studio = pathlib.Path(temp)
    (studio / "Sandbox").mkdir()
    (studio / "Sandbox/Sandbox.uproject").write_text("{}")
    calls = []
    def invoke(*args, **kwargs):
        calls.append({"mode": args[1], "render": kwargs.get("render")})
        return True, {"state": "preview_ready", "buildId": "A" * 32}
    with patch.object(module, "invoke", invoke), patch.object(module, "verify_isolated", side_effect=AssertionError("Source replay must be explicitly requested")), patch.object(sys, "argv", [sys.argv[1], "--studio-root", str(studio), "${action}", "--request", "authored.json"]):
        code = module.main()
    print(json.dumps({"exitCode": code, "calls": calls}))
`;
    const interpreter = process.platform === "win32" ? "python" : "python3";
    const child = Bun.spawnSync([interpreter, "-B", "-c", script, runner]);
    expect(child.exitCode).toBe(0);
    const output = JSON.parse(child.stdout.toString().trim().split("\n").at(-1)!);
    expect(output).toEqual({ exitCode: 0, calls: [{ mode: action, render: true }] });
  });

  test("copies an arbitrary Studio root and installs proof for unchanged source", () => {
    const result = verifyFixture("return True, {'passed': True}");
    expect(result.passed).toBe(true);
    expect(result.proofInstalled).toBe(true);
    expect(result.source).toBe("reviewed-source");
  });

  test("refuses proof when the original source changes during the independent process", () => {
    const result = verifyFixture("(source / 'Bundle.uasset').write_bytes(b'changed'); return True, {'passed': True}");
    expect(result.passed).toBe(false);
    expect(result.proofInstalled).toBe(false);
    expect(result.source).toBe("changed");
    expect(result.result).toMatchObject({ diagnostics: [{ code: "SOURCE_CHANGED" }] });
  });

  test("does not install a proof file from a failed native verification", () => {
    const result = verifyFixture("return False, {'passed': False}");
    expect(result.passed).toBe(false);
    expect(result.proofInstalled).toBe(false);
    expect(result.source).toBe("reviewed-source");
  });
});
