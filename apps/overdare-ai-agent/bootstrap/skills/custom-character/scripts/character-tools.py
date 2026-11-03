# Copyright OVERDARE, Inc. All Rights Reserved.
"""Call an open Studio's character authoring tools over its native JSON-RPC transport.

Example: character-tools.py --port 13377 character.api
         character-tools.py --port 13377 character.build --request authored.json
Always select the port of the intended Studio. The companion character-source-proof.py --studio-root STUDIO_CHECKOUT
can run fresh-process authoring source proof for the returned buildId. Final assets
use normal native publication; FBX export is available for external interchange.
Verify numeric references and saved-map playback through existing Lua instances.
"""
import argparse
import json
import pathlib
import socket
import sys
import uuid


def call(port, method, params, timeout=900):
    request_id = uuid.uuid4().hex
    message = {"jsonrpc": "2.0", "id": request_id, "method": method, "params": params}
    payload = json.dumps(message, ensure_ascii=False).encode("utf-8") + b"\n"
    if len(payload) > 4 * 1024 * 1024:
        raise ValueError("Studio's maximum request frame is 4 MiB")
    with socket.create_connection(("127.0.0.1", port), timeout=timeout) as connection:
        connection.settimeout(timeout)
        connection.sendall(payload)
        with connection.makefile("rb") as stream:
            response = json.loads(stream.readline())
    if response.get("id") != request_id:
        raise ValueError("Response belongs to a different request")
    return response


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--port", type=int, required=True)
    parser.add_argument("method", choices=[f"{namespace}.{action}" for namespace in ("character",)
                                           for action in ("api", "build", "inspect", "export")])
    parser.add_argument("--request", type=pathlib.Path)
    args = parser.parse_args()
    params = json.loads(args.request.read_text(encoding="utf-8-sig")) if args.request else {}
    response = call(args.port, args.method, params)
    print(json.dumps(response, ensure_ascii=False, indent=2))
    return int("error" in response)


if __name__ == "__main__":
    sys.exit(main())
