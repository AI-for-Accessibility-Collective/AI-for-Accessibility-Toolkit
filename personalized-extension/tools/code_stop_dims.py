#!/usr/bin/env python3
"""Code the labeled stops' questions on the six cost dimensions.

The recordings behind tools/stop-labels.json predate the cost coding, and
most of their findings have no bank question to join to (the cart run is the
corpus path, the multiway run used a generated model). At runtime today both
paths would carry costDims - the corpus via the coded banks, a generated
model via the coding stage - so the AUROC measurement needs the codes those
findings WOULD have carried.

This runs the same dimension definitions as deck/hta/code_costdims.py over
each labeled finding's question text, temperature 0, and writes
tools/stop-costdims.json keyed `run|widget`. The coder sees the question and
the run's typed task ONLY - never the worth-it verdict - so this attaches
inputs, it does not fit anything to the labels.

Usage: python3 tools/code_stop_dims.py [--model gemini-3.5-flash]
       [--dir ~/Downloads/validation-recordings-snapshot-2026-08-21]
"""

import argparse
import json
import os
import sys
import time
import urllib.error
import urllib.request
from pathlib import Path

HERE = Path(__file__).resolve().parent
API = "https://generativelanguage.googleapis.com/v1beta/models"
KEY = os.environ.get("GEMINI_API_KEY", "")
DIMS = ["money", "privacy", "thirdParty", "safety", "reversibility", "recovery"]

CODER_DIR = Path.home() / ("Stanford/Summer Project Ideation /"
                           "Verification Affordances/deck/hta")
sys.path.insert(0, str(CODER_DIR))
from code_costdims import DIM_TEXT, http_json, valid_dims  # noqa: E402

PROMPT = """The task is: {task}

You are coding validation questions raised while an AI agent ran this task.
Each line is `key | the question`.

{dims}

Questions to code, all of them:

{scope}

Answer with only JSON, no prose:
{{"codings": [{{"key": "the key exactly as given", "costDims": {{"money": 0,
"privacy": 0, "thirdParty": 0, "safety": 0, "reversibility": 0,
"recovery": 0}}}}]}}
"""


def call_model(model, prompt):
    body = {"contents": [{"parts": [{"text": prompt}]}],
            "generationConfig": {"temperature": 0, "maxOutputTokens": 16384,
                                 "responseMimeType": "application/json"}}
    out = http_json(f"{API}/{model}:generateContent?key={KEY}", body)
    return json.loads(out["candidates"][0]["content"]["parts"][0]["text"])


def run_query(rec_dir, run):
    p = rec_dir / run / "steps.jsonl"
    if not p.is_file():
        return run
    for line in p.read_text().splitlines():
        try:
            ev = json.loads(line)
        except json.JSONDecodeError:
            continue
        if ev.get("query"):
            return ev["query"]
    return run


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--model", default="gemini-3.5-flash")
    ap.add_argument("--dir", default=str(Path.home() / "Downloads/"
                    "validation-recordings-snapshot-2026-08-21"))
    args = ap.parse_args()
    if not KEY:
        raise SystemExit("GEMINI_API_KEY is not set")
    rec_dir = Path(args.dir).expanduser()

    labels = json.loads((HERE / "stop-labels.json").read_text())
    rows = labels["rows"] if isinstance(labels, dict) else labels
    by_run = {}
    for r in rows:
        by_run.setdefault(r["run"], set()).add(r["widget"])

    out = {}
    for run, widgets in sorted(by_run.items()):
        task = run_query(rec_dir, run)
        widgets = sorted(widgets)
        keys = {f"q{i}": w for i, w in enumerate(widgets)}
        scope = "\n".join(f'{k} | "{w}"' for k, w in keys.items())
        got = call_model(args.model,
                         PROMPT.format(task=task, dims=DIM_TEXT, scope=scope))
        for c in got.get("codings", []):
            key = str(c.get("key", "")).split(" | ")[0].strip()
            w = keys.get(key)
            d = valid_dims(c.get("costDims"))
            if w is None or d is None:
                continue
            out[f"{run}|{w}"] = d
        print(f"{run}: {sum(1 for k in out if k.startswith(run + '|'))}"
              f"/{len(widgets)} coded")
        time.sleep(1)

    payload = {
        "note": "Six-dimension cost codes for the labeled stops' questions, "
                "coded blind (question text + run task only, never the "
                "verdict) at temperature 0 by " + args.model + ". These are "
                "what the runtime coding would attach; the recordings "
                "predate costDims.",
        "dims": DIMS,
        "codes": out,
    }
    (HERE / "stop-costdims.json").write_text(
        json.dumps(payload, indent=1, ensure_ascii=False) + "\n")
    print(f"wrote {len(out)} codes -> tools/stop-costdims.json")


if __name__ == "__main__":
    main()
