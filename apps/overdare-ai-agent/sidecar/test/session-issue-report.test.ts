// @summary Verify manual webhook configuration and offline preview behavior of the report script.
import { expect, test } from "bun:test";
import { fileURLToPath } from "node:url";

const script = fileURLToPath(
  new URL("../../bootstrap/skills/session-issue-report/scripts/send_report.py", import.meta.url),
);

test("reporting uses only the manually configured URL and allows previews without it", async () => {
  const proc = Bun.spawn(
    [
      "python3",
      "-c",
      `
import contextlib
import importlib.util
import io
import json
import os
import sys
import tempfile
from pathlib import Path
from unittest.mock import MagicMock, patch

spec = importlib.util.spec_from_file_location("send_report", sys.argv[1])
report = importlib.util.module_from_spec(spec)
spec.loader.exec_module(report)

with tempfile.TemporaryDirectory() as directory:
    root = Path(directory)
    (root / ".diligent").mkdir()
    (root / ".diligent" / "issue-report-webhook").write_text("https://example.invalid/file")
    os.chdir(root)
    with patch.dict(os.environ, {"DILIGENT_ISSUE_WEBHOOK": "https://example.invalid/env"}), patch.object(Path, "home", return_value=root), patch.object(report.urllib.request, "urlopen") as post:
        response = MagicMock()
        response.__enter__.return_value.status = 200
        post.return_value = response

        def run(*flags):
            output = io.StringIO()
            with patch.object(sys, "argv", ["send_report.py", "--kind", "product", "--title", "Example defect", *flags]), patch.object(sys, "stdin", io.StringIO("Report body")), contextlib.redirect_stdout(output):
                assert report.main() == 0
            return output.getvalue()

        report.WEBHOOK_URL = "   "
        assert "no webhook configured" in run()
        post.assert_not_called()
        assert not (root / ".diligent" / "issue-reports.jsonl").exists()

        assert "Report body" in run("--dry-run")
        post.assert_not_called()

        report.WEBHOOK_URL = " https://example.invalid/manual "
        assert "sent (200)" in run()
        post.assert_called_once()
        request = post.call_args.args[0]
        assert request.full_url == "https://example.invalid/manual"
        assert request.get_method() == "POST"
        payload = json.loads(request.data)
        assert payload["blocks"][0]["type"] == "header"
        assert any(block.get("text", {}).get("text") == "Report body" for block in payload["blocks"])
        assert payload["mrkdwn"] is False
        assert "제품 문제" in payload["text"]

        formatted = report.build_payload("self", "한글 제목", "작업 상황: 도구 실행\\n\\n발생한 문제: 재시도 낭비", "session-test", ["도구 오류"] * 30, "/test")
        assert formatted["blocks"][0]["text"]["text"] == "한글 제목"
        assert "에이전트 작업 개선" in formatted["text"]
        assert any(b.get("text", {}).get("text") == "*📌 작업 상황*" for b in formatted["blocks"])
        assert any(b.get("text", {}).get("text") == "도구 실행" for b in formatted["blocks"])
        assert any("최근 세션 기록" in b.get("text", {}).get("text", "") for b in formatted["blocks"])
        large = report.build_payload("product", "가" * 160, "나" * 6000, "s" * 4000, ["다" * 400] * 30, "/" + "r" * 4000)
        assert len(large["blocks"]) <= 50
        for block in large["blocks"]:
            if "text" in block:
                assert len(block["text"]["text"]) <= (150 if block["type"] == "header" else 3000)
            for element in block.get("elements", []):
                assert len(element["text"]) <= 2000
        assert (root / ".diligent" / "issue-reports.jsonl").is_file()
`,
      script,
    ],
    { stdout: "pipe", stderr: "pipe", env: { ...process.env, PYTHONDONTWRITEBYTECODE: "1" } },
  );
  const stderr = await new Response(proc.stderr).text();
  expect(await proc.exited, stderr).toBe(0);
});
