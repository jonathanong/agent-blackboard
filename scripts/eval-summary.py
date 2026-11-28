#!/usr/bin/env python3
"""Records a `claude plugin eval` results file in evals/cases.csv and rebuilds the README table.

Usage: [EVAL_COMMIT=<sha>] scripts/eval-summary.py [evals/results/latest.json]
       scripts/eval-summary.py evals/results/live-latest.json   (the live suite, evals/live/)

An attempt passes when every grader but `skill-fired` passed; `loaded` counts the attempts where
`skill-fired` passed. Only the rows of the cases the run covered are replaced. A run with no
without-plugin arm keeps the row's earlier without-plugin result. The table between the
`eval-table` markers in evals/README.md is rebuilt from the plan-only rows of the CSV, and the
one between the `eval-live-table` markers from the `live/` rows.
"""
import csv
import json
import math
import os
import re
import subprocess
import sys
from pathlib import Path

sys.dont_write_bytecode = True
ROOT = Path(__file__).resolve().parent.parent
CSV = ROOT / "evals" / "cases.csv"
README = ROOT / "evals" / "README.md"
TARGETS = {"critical": 80, "high": 70, "medium": 60, "low": 50}
COLUMNS = [
    "case", "skill", "priority", "target", "run_date", "commit", "agent_model", "judge_model",
    "harness_version", "with_passed", "with_attempts", "without_passed", "without_attempts",
    "loaded", "loaded_passed", "verdict", "ceiling", "cost_total", "cost_agent", "cost_judge",
]


def wilson(passes, n, z=1.96):
    if n == 0:
        return (0.0, 0.0)
    p = passes / n
    centre = p + z * z / (2 * n)
    spread = z * math.sqrt(p * (1 - p) / n + z * z / (4 * n * n))
    denom = 1 + z * z / n
    return (max(0.0, (centre - spread) / denom), min(1.0, (centre + spread) / denom))


def rate(passes, n):
    if not n or passes == "":
        return "not run"
    low, high = wilson(int(passes), int(n))
    return f"{round(100 * int(passes) / int(n))} [{round(100 * low)}-{round(100 * high)}], {passes} of {n}"


def loaded(run):
    return any(g["name"] == "skill-fired" and g["passed"] for g in run["graders"])


def passed(run):
    graders = [g for g in run["graders"] if g["name"] != "skill-fired"]
    return run.get("error") is None and bool(graders) and all(g["passed"] for g in graders)


def priority_of(name):
    """The case's `priority-*` tag, read from its prompt.md or case.yaml, since the results file
    omits tags."""
    case_dir = ROOT / "evals" / name
    if (case_dir / "prompt.md").exists():
        front = (case_dir / "prompt.md").read_text().split("\n---", 1)[0]
    else:
        front = (case_dir / "case.yaml").read_text()
    match = re.search(r"^tags:.*\bpriority-(\w+)", front, flags=re.M)
    return match.group(1) if match else "medium"


def read_rows():
    if not CSV.exists():
        return {}
    with CSV.open() as handle:
        return {row["case"]: row for row in csv.DictReader(handle)}


def write_rows(rows):
    with CSV.open("w", newline="") as handle:
        writer = csv.DictWriter(handle, COLUMNS, lineterminator="\n")
        writer.writeheader()
        for name in sorted(rows):
            writer.writerow({column: rows[name].get(column, "") for column in COLUMNS})


def table(rows, live):
    with_arm, without_arm = ("With plugin", "CLI only") if live else ("With skill", "Without")
    lines = [
        f"| Case | Priority | {with_arm} | {without_arm} | Loaded | Verdict |",
        "| ---- | -------- | ---------- | ------- | ------ | ------- |",
    ]
    for name in sorted(name for name in rows if name.startswith("live/") == live):
        row = rows[name]
        ceiling = " (ceiling)" if row["ceiling"] == "yes" else ""
        loads = f"{row['loaded']} of {row['with_attempts']}" if row["loaded"] else "—"
        lines.append(
            f"| `{name}` | {row['priority']} | {rate(row['with_passed'], row['with_attempts'])} "
            f"| {rate(row['without_passed'], row['without_attempts'])} | {loads} "
            f"| {row['verdict']}{ceiling} |"
        )
    return "\n".join(lines)


def main():
    path = sys.argv[1] if len(sys.argv) > 1 else "evals/results/latest.json"
    data = json.load(open(path))
    # EVAL_COMMIT names the commit a run measured when HEAD has moved on since.
    commit = os.environ.get("EVAL_COMMIT") or subprocess.run(
        ["git", "rev-parse", "--short", "HEAD"], capture_output=True, text=True, check=True
    ).stdout.strip()
    rows = read_rows()
    for case in sorted(data["cases"], key=lambda c: c["dir"]):
        name = re.sub(r"^.*?evals/", "", case["dir"])
        runs = case["arms"]["with"]
        without = case["arms"].get("without") or []
        priority = priority_of(name)
        target = TARGETS[priority]
        wins = sum(map(passed, runs))
        every = runs + without
        total = sum(run.get("costUsd") or 0 for run in every)
        judge = sum(run.get("judgeCostUsd") or 0 for run in every)
        fired = [run for run in runs if loaded(run)]
        row = {"without_passed": "", "without_attempts": "", "ceiling": ""} | rows.get(name, {})
        row |= {
            "case": name,
            "skill": name.removeprefix("live/").split("/")[0],
            "priority": priority,
            "target": str(target),
            "run_date": data["startedAt"][:10],
            "commit": commit,
            "agent_model": data["suite"].get("modelOverride") or "",
            "judge_model": data["suite"].get("judgeModel") or "",
            "harness_version": data.get("claudeVersion", ""),
            "with_passed": str(wins),
            "with_attempts": str(len(runs)),
            "loaded": str(len(fired)),
            "loaded_passed": str(sum(map(passed, fired))),
            "verdict": "met" if runs and wins >= math.ceil(target * len(runs) / 100) else "missed",
            "cost_total": f"{total:.4f}",
            "cost_agent": f"{total - judge:.4f}",
            "cost_judge": f"{judge:.4f}",
        }
        if without:
            row["without_passed"] = str(sum(map(passed, without)))
            row["without_attempts"] = str(len(without))
        if row.get("without_attempts"):
            row["ceiling"] = "yes" if row["without_passed"] == row["without_attempts"] else "no"
        rows[name] = row
    write_rows(rows)

    text = README.read_text()
    for marker, live in (("eval-table", False), ("eval-live-table", True)):
        block = f"<!-- {marker}:start -->\n{table(rows, live)}\n<!-- {marker}:end -->"
        pattern = rf"<!-- {marker}:start -->.*<!-- {marker}:end -->"
        text = re.sub(pattern, lambda _: block, text, flags=re.S)
    README.write_text(text)

    print(f"Started {data['startedAt']}, Claude Code {data.get('claudeVersion')}, ${data['costUsd']:.2f}.")
    for case in data["cases"]:
        for arm, runs in case["arms"].items():
            for index, run in enumerate(runs):
                failed = [g["name"] for g in run["graders"] if not g["passed"]]
                if arm == "with" and (failed or run.get("error")):
                    print(f"FAILED {case['dir']} {arm} #{index + 1}: {failed} {run.get('error') or ''}")
                    print(f"  {run.get('tracePath')}")


if __name__ == "__main__":
    main()
