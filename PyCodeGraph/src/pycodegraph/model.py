from __future__ import annotations

from dataclasses import asdict, dataclass, field
from enum import StrEnum
from pathlib import Path
from typing import Any


class EntityKind(StrEnum):
    PROJECT = "project"
    MODULE = "module"
    CLASS = "class"
    FUNCTION = "function"
    METHOD = "method"
    PARAMETER = "parameter"
    VARIABLE = "variable"
    FIELD = "field"
    TYPE = "type"
    EXTERNAL = "external"


class RelationKind(StrEnum):
    CONTAINS = "contains"
    IMPORTS = "imports"
    INHERITS = "inherits"
    CALLS = "calls"
    READS = "reads"
    WRITES = "writes"
    ACCEPTS = "accepts"
    RETURNS = "returns"
    USES_TYPE = "uses_type"
    DECORATED_BY = "decorated_by"


@dataclass(frozen=True, slots=True)
class SourceSpan:
    path: str
    start_line: int
    start_col: int
    end_line: int
    end_col: int


@dataclass(slots=True)
class Entity:
    id: str
    kind: EntityKind
    name: str
    qualified_name: str
    parent: str | None = None
    span: SourceSpan | None = None
    attributes: dict[str, Any] = field(default_factory=dict)


@dataclass(slots=True)
class Relation:
    kind: RelationKind
    source: str
    target: str
    span: SourceSpan | None = None
    attributes: dict[str, Any] = field(default_factory=dict)

    @property
    def key(self) -> tuple[Any, ...]:
        return (
            self.kind,
            self.source,
            self.target,
            self.span.path if self.span else None,
            self.span.start_line if self.span else None,
            self.span.start_col if self.span else None,
            tuple(sorted((k, repr(v)) for k, v in self.attributes.items())),
        )


@dataclass(slots=True)
class Diagnostic:
    severity: str
    message: str
    path: str | None = None
    line: int | None = None
    column: int | None = None


@dataclass(slots=True)
class CodeGraph:
    schema: str
    generator: dict[str, Any]
    project: dict[str, Any]
    entities: list[Entity] = field(default_factory=list)
    relations: list[Relation] = field(default_factory=list)
    diagnostics: list[Diagnostic] = field(default_factory=list)

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)


def source_span(path: Path, node: Any) -> SourceSpan | None:
    if not hasattr(node, "lineno"):
        return None
    return SourceSpan(
        path=path.as_posix(),
        start_line=int(node.lineno),
        start_col=int(getattr(node, "col_offset", 0)),
        end_line=int(getattr(node, "end_lineno", node.lineno)),
        end_col=int(getattr(node, "end_col_offset", getattr(node, "col_offset", 0))),
    )
