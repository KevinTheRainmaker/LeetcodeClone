#!/usr/bin/env python3
"""
client_logs/{userId}/p{problemId}.jsonl 파일들을 읽어
사용자 → 문제 계층으로 구조화된 JSON 리포트를 생성합니다.

사용 예:
  python analyze_logs.py                                  # 전체 요약(summary)
  python analyze_logs.py --format json                    # 전체를 pretty JSON으로
  python analyze_logs.py --user kevin                     # 특정 유저만
  python analyze_logs.py --user kevin --problem 1         # 특정 문제만
  python analyze_logs.py --format timeline --user kevin   # 시간순 이벤트 목록
  python analyze_logs.py --format json --out report.json  # 파일로 저장
  python analyze_logs.py --full                           # code/text 원문 전체 포함
"""

import argparse
import json
from collections import Counter, defaultdict
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, Iterator, List, Optional, Tuple

LOG_ROOT = Path(__file__).resolve().parent / "client_logs"
SNIPPET_LIMIT = 240


def iter_log_files(
    user: Optional[str] = None, problem: Optional[int] = None
) -> Iterator[Tuple[str, Optional[int], Path]]:
    if not LOG_ROOT.exists():
        return
    for user_dir in sorted(p for p in LOG_ROOT.iterdir() if p.is_dir()):
        if user and user_dir.name != user:
            continue
        for fp in sorted(user_dir.glob("*.jsonl")):
            stem = fp.stem
            pid: Optional[int] = None
            if stem.startswith("p") and stem[1:].isdigit():
                pid = int(stem[1:])
            if problem is not None and pid != problem:
                continue
            yield user_dir.name, pid, fp


def load_events(fp: Path) -> List[Dict[str, Any]]:
    events: List[Dict[str, Any]] = []
    with fp.open("r", encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if not line:
                continue
            try:
                events.append(json.loads(line))
            except json.JSONDecodeError:
                continue
    events.sort(key=lambda e: e.get("ts", ""))
    return events


def parse_iso(ts: str) -> Optional[datetime]:
    if not ts:
        return None
    try:
        return datetime.fromisoformat(ts.replace("Z", "+00:00"))
    except ValueError:
        return None


def duration_sec(events: List[Dict[str, Any]]) -> float:
    ts_list = [parse_iso(e.get("ts", "")) for e in events]
    ts_list = [t for t in ts_list if t is not None]
    if len(ts_list) < 2:
        return 0.0
    return round((ts_list[-1] - ts_list[0]).total_seconds(), 1)


def summarize_problem(events: List[Dict[str, Any]]) -> Dict[str, Any]:
    counts = Counter(e.get("action", "") for e in events)
    final_submit = None
    final_run = None
    for e in reversed(events):
        act = e.get("action")
        if final_submit is None and act == "submit_result":
            final_submit = e.get("detail")
        if final_run is None and act == "run_result":
            final_run = e.get("detail")
        if final_submit and final_run:
            break

    first_ts = events[0].get("ts") if events else None
    last_ts = events[-1].get("ts") if events else None

    final_code_len = None
    for e in reversed(events):
        d = e.get("detail") or {}
        if e.get("action") in ("code_edit", "manual_save", "submit", "run"):
            final_code_len = d.get("codeLength") or (
                len(d["code"]) if isinstance(d.get("code"), str) else None
            )
            if final_code_len is not None:
                break

    return {
        "solved": counts.get("problem_solved", 0) > 0,
        "eventCount": len(events),
        "durationSec": duration_sec(events),
        "firstEventAt": first_ts,
        "lastEventAt": last_ts,
        "finalCodeLength": final_code_len,
        "actionCounts": dict(counts),
        "codeEdits": counts.get("code_edit", 0),
        "manualSaves": counts.get("manual_save", 0),
        "runs": counts.get("run", 0),
        "submits": counts.get("submit", 0),
        "aiUserMessages": counts.get("ai_user_message", 0),
        "aiAssistantReplies": counts.get("ai_assistant_reply", 0),
        "finalRun": final_run,
        "finalSubmit": final_submit,
    }


def _snippet(text: str, limit: int = SNIPPET_LIMIT) -> str:
    if not isinstance(text, str):
        return text
    if len(text) <= limit:
        return text
    return text[:limit] + f"...<+{len(text) - limit}>"


def timeline_view(
    events: List[Dict[str, Any]], full: bool = False
) -> List[Dict[str, Any]]:
    out = []
    for e in events:
        d = e.get("detail") or {}
        row: Dict[str, Any] = {
            "ts": e.get("ts"),
            "action": e.get("action"),
        }
        if "code" in d:
            code = d.get("code", "")
            if full:
                row["code"] = code
            else:
                row["codePreview"] = _snippet(code)
            row["codeLength"] = d.get("codeLength") or (
                len(code) if isinstance(code, str) else None
            )
        if "text" in d:
            text = d.get("text", "")
            row["text"] = text if full else _snippet(text)
        for k in (
            "model",
            "passed",
            "total",
            "runtimeMs",
            "status",
            "error",
            "to",
            "toIdx",
            "problemIdx",
            "resumedFrom",
            "solvedCount",
            "queueLength",
        ):
            if k in d:
                row[k] = d[k]
        out.append(row)
    return out


def build_report(
    user: Optional[str],
    problem: Optional[int],
    include_timeline: bool,
    full: bool,
) -> Dict[str, Any]:
    grouped: Dict[str, Dict[str, List[Dict[str, Any]]]] = defaultdict(
        lambda: defaultdict(list)
    )
    for u, pid, fp in iter_log_files(user, problem):
        key = f"p{pid}" if pid is not None else "_meta"
        grouped[u][key] = load_events(fp)

    report = {
        "generatedAt": datetime.now(timezone.utc).isoformat().replace(
            "+00:00", "Z"
        ),
        "filters": {"user": user, "problem": problem},
        "users": {},
    }

    for u in sorted(grouped.keys()):
        probs = grouped[u]
        problem_keys = [k for k in probs if k != "_meta"]
        solved = sum(
            1
            for k in problem_keys
            if any(e.get("action") == "problem_solved" for e in probs[k])
        )
        total_events = sum(len(v) for v in probs.values())
        user_block: Dict[str, Any] = {
            "summary": {
                "problemsAttempted": len(problem_keys),
                "problemsSolved": solved,
                "totalEvents": total_events,
            },
            "problems": {},
        }
        for pkey in sorted(probs.keys()):
            evs = probs[pkey]
            entry = {"summary": summarize_problem(evs)}
            if include_timeline:
                entry["timeline"] = timeline_view(evs, full=full)
            user_block["problems"][pkey] = entry
        report["users"][u] = user_block

    return report


def render_summary(report: Dict[str, Any]) -> str:
    lines = [f"# Log Summary · generated {report['generatedAt']}"]
    flt = report.get("filters") or {}
    if flt.get("user") or flt.get("problem") is not None:
        lines.append(f"# filters: {flt}")
    for u, udata in report["users"].items():
        s = udata["summary"]
        lines.append("")
        lines.append(
            f"USER {u}: {s['problemsSolved']}/{s['problemsAttempted']} solved · "
            f"{s['totalEvents']} events"
        )
        for pkey in sorted(udata["problems"].keys()):
            p = udata["problems"][pkey]["summary"]
            mark = "✓" if p["solved"] else "·"
            dur = p["durationSec"]
            dur_s = f"{int(dur // 60)}m{int(dur % 60):02d}s" if dur >= 60 else f"{dur}s"
            lines.append(
                f"  {mark} {pkey}: edits={p['codeEdits']} saves={p['manualSaves']} "
                f"runs={p['runs']} submits={p['submits']} "
                f"ai={p['aiUserMessages']}/{p['aiAssistantReplies']} "
                f"codeLen={p['finalCodeLength']} dur={dur_s}"
            )
    if not report["users"]:
        lines.append("\n(no logs found)")
    return "\n".join(lines)


def main() -> None:
    ap = argparse.ArgumentParser(
        description="Analyze coding platform client logs",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog=__doc__,
    )
    ap.add_argument("--user", help="특정 userId로 필터")
    ap.add_argument("--problem", type=int, help="특정 problemId로 필터")
    ap.add_argument(
        "--format",
        choices=["summary", "json", "timeline"],
        default="summary",
        help="출력 형식 (기본 summary)",
    )
    ap.add_argument(
        "--full",
        action="store_true",
        help="code/text 필드를 자르지 않고 전체 출력",
    )
    ap.add_argument("--out", type=Path, help="출력을 파일로 저장")
    args = ap.parse_args()

    include_timeline = args.format in ("json", "timeline")
    report = build_report(
        user=args.user,
        problem=args.problem,
        include_timeline=include_timeline,
        full=args.full,
    )

    if args.format == "summary":
        text = render_summary(report)
    elif args.format == "timeline":
        rows: List[Dict[str, Any]] = []
        for u, udata in report["users"].items():
            for pkey, pdata in udata["problems"].items():
                for ev in pdata.get("timeline", []):
                    rows.append({"user": u, "problem": pkey, **ev})
        rows.sort(key=lambda r: r.get("ts") or "")
        text = json.dumps(rows, ensure_ascii=False, indent=2)
    else:
        text = json.dumps(report, ensure_ascii=False, indent=2)

    if args.out:
        args.out.write_text(text, encoding="utf-8")
        print(f"Wrote {len(text)} chars to {args.out}")
    else:
        print(text)


if __name__ == "__main__":
    main()
