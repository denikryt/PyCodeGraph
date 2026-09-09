from __future__ import annotations

import ast
import json
from collections import Counter
from pathlib import Path
from typing import Iterable

from .analysis import analyze_module
from .index import ModuleRecord, ProjectIndex, entity_id, index_module, module_name
from .model import CodeGraph, Diagnostic, Entity, EntityKind, Relation

DEFAULT_EXCLUDES = {".git", ".hg", ".svn", ".venv", "venv", "env", "__pycache__", "site-packages", "node_modules", "build", "dist"}


def discover_python_files(root: Path) -> Iterable[Path]:
    if root.is_file():
        if root.suffix == ".py":
            yield root
        return
    for path in root.rglob("*.py"):
        if not any(part in DEFAULT_EXCLUDES for part in path.relative_to(root).parts):
            yield path


def analyze_project(root: str | Path, *, include_locals: bool = False) -> CodeGraph:
    root = Path(root).resolve()
    scan_root = root.parent if root.is_file() else root
    index = ProjectIndex(scan_root)
    project_id = entity_id(EntityKind.PROJECT, scan_root.name)
    index.add_entity(Entity(project_id, EntityKind.PROJECT, scan_root.name, scan_root.name, None, None, {"root": scan_root.as_posix()}))
    diagnostics: list[Diagnostic] = []

    for path in sorted(discover_python_files(root)):
        try:
            source = path.read_text(encoding="utf-8")
        except UnicodeDecodeError:
            source = path.read_text(encoding="utf-8", errors="replace")
        try:
            tree = ast.parse(source, filename=str(path), type_comments=True)
        except SyntaxError as exc:
            diagnostics.append(Diagnostic("error", exc.msg, path.as_posix(), exc.lineno, exc.offset))
            continue
        name = module_name(scan_root, path)
        eid = entity_id(EntityKind.MODULE, name)
        record = ModuleRecord(name, path.relative_to(scan_root), tree, eid)
        index.modules[name] = record
        index_module(index, record)

    # Semantic phase runs only after all declarations are indexed, like a compiler query database.
    for record in index.modules.values():
        try:
            analyze_module(index, record, include_locals=include_locals)
        except Exception as exc:
            diagnostics.append(Diagnostic("error", f"semantic analysis failed: {type(exc).__name__}: {exc}", record.path.as_posix()))

    unique_relations: list[Relation] = []
    seen = set()
    for rel in index.relations:
        if rel.key not in seen:
            seen.add(rel.key)
            unique_relations.append(rel)

    counts = Counter(e.kind.value for e in index.entities.values())
    return CodeGraph(
        schema="pycodegraph/1.0",
        generator={"name": "pycodegraph", "version": "0.2.0", "frontend": "python-ast"},
        project={
            "name": scan_root.name,
            "root": scan_root.as_posix(),
            "python_files": len(index.modules),
            "entity_counts": dict(sorted(counts.items())),
            "relation_count": len(unique_relations),
            "include_locals": include_locals,
        },
        entities=sorted(index.entities.values(), key=lambda e: (e.kind.value, e.qualified_name, e.id)),
        relations=sorted(unique_relations, key=lambda r: (r.kind.value, r.source, r.target, r.span.start_line if r.span else -1)),
        diagnostics=diagnostics,
    )


def write_json(graph: CodeGraph, output: str | Path, *, pretty: bool = True) -> None:
    path = Path(output)
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(graph.to_dict(), indent=2 if pretty else None, ensure_ascii=False), encoding="utf-8")
