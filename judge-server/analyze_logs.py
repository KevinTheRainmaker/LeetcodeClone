#!/usr/bin/env python3
"""
client_logs/{userId}/{phase}_p{problemId}.jsonl 파일들을 읽어
사용자 → 페이즈 → 문제 계층으로 구조화된 리포트를 생성합니다.

파일명 규칙:
  신규: {phase}_p{pid}.jsonl  (예: normal_p1.jsonl, phase2_p3.jsonl)
  구형: p{pid}.jsonl          (phase="normal" 로 취급)

사용 예:
  python analyze_logs.py                                        # 전체 요약
  python analyze_logs.py --phase phase2                         # phase2만
  python analyze_logs.py --user 251136                          # 특정 유저
  python analyze_logs.py --user 251136 --problem 1              # 특정 문제
  python analyze_logs.py --format json                          # pretty JSON
  python analyze_logs.py --format timeline --user 251136        # 시간순 이벤트
  python analyze_logs.py --format csv                           # 요약 CSV
  python analyze_logs.py --format csv --out summary.csv         # CSV 파일 저장
  python analyze_logs.py --format json --out report.json        # JSON 파일 저장
  python analyze_logs.py --full                                  # code/text 원문 전체 포함
"""

import argparse
import csv
import io
import json
import re
from collections import Counter, defaultdict
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, Iterator, List, Optional, Tuple

LOG_ROOT = Path(__file__).resolve().parent / "client_logs"
SNIPPET_LIMIT = 240

_FILE_NEW = re.compile(r"^(.+)_p(\d+)$")
_FILE_OLD = re.compile(r"^p(\d+)$")


def parse_stem(stem: str) -> Tuple[Optional[str], Optional[int]]:
    """Return (phase, pid) from a .jsonl stem, or (None, None) to skip."""
    m = _FILE_NEW.match(stem)
    if m:
        return m.group(1), int(m.group(2))
    m = _FILE_OLD.match(stem)
    if m:
        return "normal", int(m.group(1))
    return None, None


def iter_log_files(
    user: Optional[str] = None,
    problem: Optional[int] = None,
    phase: Optional[str] = None,
) -> Iterator[Tuple[str, str, Optional[int], Path]]:
    """Yields (userId, phase, pid, filepath)."""
    if not LOG_ROOT.exists():
        return
    for user_dir in sorted(p for p in LOG_ROOT.iterdir() if p.is_dir()):
        if user and user_dir.name != user:
            continue
        for fp in sorted(user_dir.glob("*.jsonl")):
            file_phase, pid = parse_stem(fp.stem)
            if file_phase is None:
                continue
            if phase is not None and file_phase != phase:
                continue
            if problem is not None and pid != problem:
                continue
            yield user_dir.name, file_phase, pid, fp


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

    explain_unlocked = any(e.get("action") == "explain_unlock" for e in events)

    return {
        "solved": counts.get("problem_solved", 0) > 0,
        "explainUnlocked": explain_unlocked,
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
            "phase": e.get("phase", "normal"),
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
            "chars",
        ):
            if k in d:
                row[k] = d[k]
        out.append(row)
    return out


def build_report(
    user: Optional[str],
    problem: Optional[int],
    phase: Optional[str],
    include_timeline: bool,
    full: bool,
) -> Dict[str, Any]:
    # grouped[userId][phase][pid_key] = [events]
    grouped: Dict[str, Dict[str, Dict[str, List[Dict[str, Any]]]]] = defaultdict(
        lambda: defaultdict(lambda: defaultdict(list))
    )
    for u, ph, pid, fp in iter_log_files(user, problem, phase):
        key = f"p{pid}" if pid is not None else "_meta"
        grouped[u][ph][key] = load_events(fp)

    report = {
        "generatedAt": datetime.now(timezone.utc).isoformat().replace("+00:00", "Z"),
        "filters": {"user": user, "problem": problem, "phase": phase},
        "users": {},
    }

    for u in sorted(grouped.keys()):
        phases = grouped[u]
        user_block: Dict[str, Any] = {"phases": {}}

        for ph in sorted(phases.keys()):
            probs = phases[ph]
            problem_keys = [k for k in probs if k != "_meta"]
            solved = sum(
                1
                for k in problem_keys
                if any(e.get("action") == "problem_solved" for e in probs[k])
            )
            total_events = sum(len(v) for v in probs.values())
            phase_block: Dict[str, Any] = {
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
                phase_block["problems"][pkey] = entry
            user_block["phases"][ph] = phase_block

        report["users"][u] = user_block

    return report


def render_summary(report: Dict[str, Any]) -> str:
    lines = [f"# Log Summary · generated {report['generatedAt']}"]
    flt = report.get("filters") or {}
    active = {k: v for k, v in flt.items() if v is not None}
    if active:
        lines.append(f"# filters: {active}")

    for u, udata in report["users"].items():
        lines.append("")
        lines.append(f"USER {u}")
        for ph, phdata in sorted(udata["phases"].items()):
            s = phdata["summary"]
            lines.append(
                f"  [{ph}] {s['problemsSolved']}/{s['problemsAttempted']} solved · "
                f"{s['totalEvents']} events"
            )
            for pkey in sorted(phdata["problems"].keys()):
                p = phdata["problems"][pkey]["summary"]
                mark = "✓" if p["solved"] else "·"
                dur = p["durationSec"]
                dur_s = (
                    f"{int(dur // 60)}m{int(dur % 60):02d}s"
                    if dur >= 60
                    else f"{dur}s"
                )
                unlock = " unlock=✓" if p.get("explainUnlocked") else ""
                lines.append(
                    f"    {mark} {pkey}: edits={p['codeEdits']} saves={p['manualSaves']} "
                    f"runs={p['runs']} submits={p['submits']} "
                    f"ai={p['aiUserMessages']}/{p['aiAssistantReplies']} "
                    f"codeLen={p['finalCodeLength']} dur={dur_s}{unlock}"
                )

    if not report["users"]:
        lines.append("\n(no logs found)")
    return "\n".join(lines)


CSV_FIELDS = [
    "userId",
    "phase",
    "problemId",
    "solved",
    "explainUnlocked",
    "durationSec",
    "eventCount",
    "codeEdits",
    "manualSaves",
    "runs",
    "submits",
    "aiUserMessages",
    "aiAssistantReplies",
    "finalCodeLength",
    "firstEventAt",
    "lastEventAt",
]


def render_csv(report: Dict[str, Any]) -> str:
    buf = io.StringIO()
    writer = csv.DictWriter(buf, fieldnames=CSV_FIELDS, extrasaction="ignore")
    writer.writeheader()
    for u, udata in sorted(report["users"].items()):
        for ph, phdata in sorted(udata["phases"].items()):
            for pkey, pdata in sorted(phdata["problems"].items()):
                s = pdata["summary"]
                pid = int(pkey[1:]) if pkey.startswith("p") and pkey[1:].isdigit() else pkey
                writer.writerow(
                    {
                        "userId": u,
                        "phase": ph,
                        "problemId": pid,
                        "solved": s["solved"],
                        "explainUnlocked": s.get("explainUnlocked", False),
                        "durationSec": s["durationSec"],
                        "eventCount": s["eventCount"],
                        "codeEdits": s["codeEdits"],
                        "manualSaves": s["manualSaves"],
                        "runs": s["runs"],
                        "submits": s["submits"],
                        "aiUserMessages": s["aiUserMessages"],
                        "aiAssistantReplies": s["aiAssistantReplies"],
                        "finalCodeLength": s["finalCodeLength"],
                        "firstEventAt": s["firstEventAt"],
                        "lastEventAt": s["lastEventAt"],
                    }
                )
    return buf.getvalue()


def main() -> None:
    ap = argparse.ArgumentParser(
        description="Analyze coding platform client logs",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog=__doc__,
    )
    ap.add_argument("--user", help="특정 userId로 필터")
    ap.add_argument("--problem", type=int, help="특정 problemId로 필터")
    ap.add_argument("--phase", help="특정 phase로 필터 (normal | phase2)")
    ap.add_argument(
        "--format",
        choices=["summary", "json", "timeline", "csv"],
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
        phase=args.phase,
        include_timeline=include_timeline,
        full=args.full,
    )

    if args.format == "summary":
        text = render_summary(report)
    elif args.format == "csv":
        text = render_csv(report)
    elif args.format == "timeline":
        rows: List[Dict[str, Any]] = []
        for u, udata in report["users"].items():
            for ph, phdata in udata["phases"].items():
                for pkey, pdata in phdata["problems"].items():
                    for ev in pdata.get("timeline", []):
                        rows.append({"user": u, "phase": ph, "problem": pkey, **ev})
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
