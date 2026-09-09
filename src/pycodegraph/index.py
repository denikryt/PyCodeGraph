from __future__ import annotations

import ast
from dataclasses import dataclass, field
from pathlib import Path

from .model import Entity, EntityKind, Relation, RelationKind, source_span


def entity_id(kind: EntityKind, qualified_name: str) -> str:
    return f"py:{kind.value}:{qualified_name}"


def module_name(root: Path, path: Path) -> str:
    rel = path.relative_to(root).with_suffix("")
    parts = list(rel.parts)
    if parts and parts[-1] == "__init__":
        parts.pop()
    return ".".join(parts) or root.name


def annotation_text(node: ast.expr | None) -> str | None:
    if node is None:
        return None
    try:
        return ast.unparse(node)
    except Exception:
        return None


def return_profile(node: ast.FunctionDef | ast.AsyncFunctionDef) -> dict[str, object]:
    """Describe explicit returns in *this* function, excluding nested scopes."""
    has_return = False
    returns_value = False
    bare_return = False

    class ReturnScanner(ast.NodeVisitor):
        def visit_Return(self, item: ast.Return) -> None:
            nonlocal has_return, returns_value, bare_return
            has_return = True
            if item.value is None:
                bare_return = True
            else:
                returns_value = True

        def visit_FunctionDef(self, item: ast.FunctionDef) -> None:
            # Nested function belongs to a different semantic scope.
            if item is node:
                self.generic_visit(item)

        def visit_AsyncFunctionDef(self, item: ast.AsyncFunctionDef) -> None:
            if item is node:
                self.generic_visit(item)

        def visit_ClassDef(self, item: ast.ClassDef) -> None:
            return

        def visit_Lambda(self, item: ast.Lambda) -> None:
            return

    scanner = ReturnScanner()
    for stmt in node.body:
        scanner.visit(stmt)
    if returns_value:
        status = "value"
    elif has_return:
        status = "none"
    else:
        status = "implicit_none"
    return {
        "has_explicit_return": has_return,
        "returns_value": returns_value,
        "has_bare_return": bare_return,
        "return_status": status,
    }


@dataclass(slots=True)
class ModuleRecord:
    name: str
    path: Path
    tree: ast.Module
    entity_id: str
    imports: dict[str, str] = field(default_factory=dict)
    star_imports: list[str] = field(default_factory=list)


@dataclass(slots=True)
class ProjectIndex:
    root: Path
    modules: dict[str, ModuleRecord] = field(default_factory=dict)
    entities: dict[str, Entity] = field(default_factory=dict)
    qname_to_id: dict[str, str] = field(default_factory=dict)
    module_members: dict[str, dict[str, str]] = field(default_factory=dict)
    node_entity: dict[int, str] = field(default_factory=dict)
    relations: list[Relation] = field(default_factory=list)

    def add_entity(self, entity: Entity) -> None:
        self.entities.setdefault(entity.id, entity)
        self.qname_to_id.setdefault(entity.qualified_name, entity.id)

    def add_relation(self, relation: Relation) -> None:
        self.relations.append(relation)


class DeclarationIndexer(ast.NodeVisitor):
    def __init__(self, index: ProjectIndex, record: ModuleRecord):
        self.index = index
        self.record = record
        self.stack: list[tuple[str, str, EntityKind]] = [(record.name, record.entity_id, EntityKind.MODULE)]

    @property
    def current_qname(self) -> str:
        return self.stack[-1][0]

    @property
    def current_id(self) -> str:
        return self.stack[-1][1]

    @property
    def current_kind(self) -> EntityKind:
        return self.stack[-1][2]

    def _add(self, kind: EntityKind, name: str, node: ast.AST, **attrs) -> Entity:
        qname = f"{self.current_qname}.{name}"
        eid = entity_id(kind, qname)
        entity = Entity(eid, kind, name, qname, self.current_id, source_span(self.record.path, node), attrs)
        self.index.add_entity(entity)
        self.index.node_entity[id(node)] = eid
        self.index.add_relation(Relation(RelationKind.CONTAINS, self.current_id, eid, entity.span))
        if self.current_kind is EntityKind.MODULE:
            self.index.module_members.setdefault(self.record.name, {})[name] = eid
        return entity

    def visit_Import(self, node: ast.Import) -> None:
        for alias in node.names:
            bound = alias.asname or alias.name.split(".")[0]
            self.record.imports[bound] = alias.name

    def visit_ImportFrom(self, node: ast.ImportFrom) -> None:
        base = self._resolve_from_module(node)
        for alias in node.names:
            if alias.name == "*":
                self.record.star_imports.append(base)
                continue
            bound = alias.asname or alias.name
            self.record.imports[bound] = f"{base}.{alias.name}" if base else alias.name

    def _resolve_from_module(self, node: ast.ImportFrom) -> str:
        if node.level == 0:
            return node.module or ""
        parts = self.record.name.split(".")
        package = parts[:-1] if self.record.path.name != "__init__.py" else parts
        trim = max(node.level - 1, 0)
        if trim:
            package = package[:-trim]
        if node.module:
            package.extend(node.module.split("."))
        return ".".join(package)

    def _declare_assignment_target(self, target: ast.AST, node: ast.AST, annotation: ast.expr | None = None) -> None:
        if not isinstance(target, ast.Name):
            return
        if self.current_kind is EntityKind.MODULE:
            kind = EntityKind.VARIABLE
        elif self.current_kind is EntityKind.CLASS:
            kind = EntityKind.FIELD
        else:
            return
        qname = f"{self.current_qname}.{target.id}"
        eid = entity_id(kind, qname)
        if eid in self.index.entities or qname in self.index.qname_to_id:
            return
        entity = Entity(
            eid, kind, target.id, qname, self.current_id, source_span(self.record.path, node),
            {"annotation": annotation_text(annotation), "declaration": "assignment"},
        )
        self.index.add_entity(entity)
        self.index.add_relation(Relation(RelationKind.CONTAINS, self.current_id, eid, entity.span))
        if self.current_kind is EntityKind.MODULE:
            self.index.module_members.setdefault(self.record.name, {})[target.id] = eid

    def visit_Assign(self, node: ast.Assign) -> None:
        for target in node.targets:
            self._declare_assignment_target(target, node)
        self.generic_visit(node)

    def visit_AnnAssign(self, node: ast.AnnAssign) -> None:
        self._declare_assignment_target(node.target, node, node.annotation)
        self.generic_visit(node)

    def visit_ClassDef(self, node: ast.ClassDef) -> None:
        entity = self._add(EntityKind.CLASS, node.name, node, decorators=[annotation_text(x) for x in node.decorator_list])
        self.stack.append((entity.qualified_name, entity.id, EntityKind.CLASS))
        for stmt in node.body:
            self.visit(stmt)
        self.stack.pop()

    def _visit_function(self, node: ast.FunctionDef | ast.AsyncFunctionDef) -> None:
        kind = EntityKind.METHOD if self.current_kind is EntityKind.CLASS else EntityKind.FUNCTION
        entity = self._add(
            kind,
            node.name,
            node,
            async_=isinstance(node, ast.AsyncFunctionDef),
            returns=annotation_text(node.returns),
            decorators=[annotation_text(x) for x in node.decorator_list],
            **return_profile(node),
        )
        self.stack.append((entity.qualified_name, entity.id, kind))
        args = list(node.args.posonlyargs) + list(node.args.args) + list(node.args.kwonlyargs)
        if node.args.vararg:
            args.append(node.args.vararg)
        if node.args.kwarg:
            args.append(node.args.kwarg)
        for arg in args:
            param = self._add(EntityKind.PARAMETER, arg.arg, arg, annotation=annotation_text(arg.annotation))
            self.index.add_relation(Relation(RelationKind.ACCEPTS, entity.id, param.id, param.span))
        # Discover declarations anywhere in the function body (for example a
        # helper defined inside an if/try). Do not treat arbitrary names as declarations.
        def visit_declarations(item: ast.AST) -> None:
            if isinstance(item, (ast.FunctionDef, ast.AsyncFunctionDef, ast.ClassDef)):
                self.visit(item)
                return
            for child in ast.iter_child_nodes(item):
                visit_declarations(child)

        for stmt in node.body:
            visit_declarations(stmt)
        self.stack.pop()

    visit_FunctionDef = _visit_function
    visit_AsyncFunctionDef = _visit_function


def index_module(index: ProjectIndex, record: ModuleRecord) -> None:
    module_entity = Entity(
        record.entity_id,
        EntityKind.MODULE,
        record.name.rsplit(".", 1)[-1],
        record.name,
        entity_id(EntityKind.PROJECT, index.root.name),
        None,
        {"path": record.path.as_posix()},
    )
    index.add_entity(module_entity)
    index.module_members.setdefault(record.name, {})
    index.add_relation(Relation(RelationKind.CONTAINS, module_entity.parent, module_entity.id))
    DeclarationIndexer(index, record).visit(record.tree)
