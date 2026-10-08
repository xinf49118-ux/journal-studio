"""素材源连通性自检（SPEC 第 3 节）。

用法::

    python tools/probe_sources.py                 # 检查 wikimedia/artic/met + openverse
    python tools/probe_sources.py --only met      # 只检查指定源
    python tools/probe_sources.py --json          # 输出 JSON，便于脚本消费

说明：``sources.probe()`` 按 SPEC 只探测三个主源；本工具额外用一次真实检索
探测 ``openverse``（本机实测会超时），并如实报告耗时与错误，任何失败都不会
让脚本崩溃。
"""

from __future__ import annotations

import argparse
import json
import os
import sys
import time

# Windows 控制台默认不是 UTF-8，中文会乱码；这里强制 UTF-8 输出
for _stream in (sys.stdout, sys.stderr):
    try:
        _stream.reconfigure(encoding="utf-8", errors="replace")
    except Exception:  # pragma: no cover - 极老环境无 reconfigure
        pass

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from server import sources  # noqa: E402

MAIN_SOURCES = ["wikimedia", "artic", "met"]
STATUS_WIDTH = 12


def _fmt_status(ok):
    return "通" if ok else "不通"


def run(only=None, include_openverse=True, as_json=False):
    report = {}

    if only:
        wanted = [name for name in sources.SOURCES if name in only]
    else:
        wanted = list(MAIN_SOURCES)
        if include_openverse:
            wanted.append("openverse")

    main_wanted = [name for name in wanted if name in MAIN_SOURCES]
    if main_wanted:
        started = time.perf_counter()
        probed = sources.probe()  # 永不抛异常
        elapsed = int(round((time.perf_counter() - started) * 1000))
        for name in main_wanted:
            info = probed.get(name) or {"ok": False, "ms": elapsed, "error": "未返回结果"}
            report[name] = {
                "ok": bool(info.get("ok")),
                "ms": int(info.get("ms") or 0),
                "error": info.get("error"),
                "method": "probe",
            }

    if "openverse" in wanted:
        started = time.perf_counter()
        result = sources.search("openverse", "washi tape", limit=3)
        elapsed = int(round((time.perf_counter() - started) * 1000))
        ok = bool(result.get("results")) and not result.get("error")
        report["openverse"] = {
            "ok": ok,
            "ms": elapsed,
            "error": result.get("error"),
            "method": "search",
            "results": len(result.get("results") or []),
        }

    if as_json:
        print(json.dumps(report, ensure_ascii=False, indent=2))
    else:
        _print_table(report)

    usable = [name for name in MAIN_SOURCES if report.get(name, {}).get("ok")]
    if main_wanted and not usable:
        return 1
    return 0


def _print_table(report):
    print("素材源连通性自检  %s" % time.strftime("%Y-%m-%d %H:%M:%S"))
    print("-" * 66)
    print("%-*s %-6s %-10s %s" % (STATUS_WIDTH, "源", "状态", "耗时", "说明"))
    print("-" * 66)
    for name in sources.SOURCES:
        info = report.get(name)
        if not info:
            continue
        ms = "%d ms" % info["ms"] if info["ms"] else "-"
        note = "-" if info["ok"] else (info.get("error") or "不可用")
        print("%-*s %-6s %-10s %s" % (STATUS_WIDTH, name, _fmt_status(info["ok"]), ms, note))
    print("-" * 66)

    ok_names = [name for name, info in report.items() if info["ok"]]
    bad_names = [name for name, info in report.items() if not info["ok"]]
    print("可用 %d 个：%s" % (len(ok_names), "、".join(ok_names) or "无"))
    if bad_names:
        print("不可用 %d 个：%s（单源不可用不影响其它源）" % (len(bad_names), "、".join(bad_names)))


def main(argv=None):
    parser = argparse.ArgumentParser(description="手账工坊素材源连通性自检")
    parser.add_argument("--only", nargs="*", choices=sources.SOURCES,
                        help="只检查指定素材源")
    parser.add_argument("--skip-openverse", action="store_true",
                        help="跳过 openverse（本机实测超时，会等待 20 秒）")
    parser.add_argument("--json", action="store_true", dest="as_json",
                        help="以 JSON 输出结果")
    args = parser.parse_args(argv)

    return run(only=args.only, include_openverse=not args.skip_openverse, as_json=args.as_json)


if __name__ == "__main__":
    sys.exit(main())
