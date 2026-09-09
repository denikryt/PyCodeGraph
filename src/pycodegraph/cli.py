from __future__ import annotations

import argparse
import json
from collections import Counter
from pathlib import Path

from .project import analyze_project, write_json


def build_parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(prog="pycodegraph", description="Extract a semantic graph from Python source code.")
    p.add_argument("path", help="Python file or project directory")
    p.add_argument("-o", "--output", default="codegraph.json", help="Output CodeGraph IR JSON")
    p.add_argument("--include-locals", action="store_true", help="Emit local variable entities and read/write edges")
    p.add_argument("--compact", action="store_true", help="Write compact JSON")
    p.add_argument("--summary", action="store_true", help="Print entity/relation summary")
    return p


def main(argv: list[str] | None = None) -> int:
    args = build_parser().parse_args(argv)
    graph = analyze_project(args.path, include_locals=args.include_locals)
    write_json(graph, args.output, pretty=not args.compact)
    if args.summary:
        relations = Counter(r.kind.value for r in graph.relations)
        print(json.dumps({"project": graph.project, "relations": dict(sorted(relations.items())), "diagnostics": len(graph.diagnostics)}, indent=2))
    errors = sum(1 for d in graph.diagnostics if d.severity == "error")
    return 1 if errors else 0


if __name__ == "__main__":
    raise SystemExit(main())
