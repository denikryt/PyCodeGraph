from __future__ import annotations

import ast
import builtins
from pathlib import Path

from .index import ModuleRecord, ProjectIndex, annotation_text, entity_id
from .model import Entity, EntityKind, Relation, RelationKind, source_span
from .resolution import Resolver

_BUILTINS = set(dir(builtins))


class SemanticVisitor(ast.NodeVisitor):
    def __init__(self, index: ProjectIndex, record: ModuleRecord, include_locals: bool = False):
        self.index = index
        self.record = record
        self.resolver = Resolver(index)
        self.include_locals = include_locals
        self.scope_ids: list[str] = [record.entity_id]
        self.scope_qnames: list[str] = [record.name]
        self.class_qnames: list[str | None] = [None]
        self.local_entities: dict[tuple[str, str], str] = {}

    @property
    def scope_id(self) -> str:
        return self.scope_ids[-1]

    @property
    def scope_qname(self) -> str:
        return self.scope_qnames[-1]

    @property
    def class_qname(self) -> str | None:
        return self.class_qnames[-1]

    def relation(self, kind: RelationKind, target: str, node: ast.AST, **attrs) -> None:
        self.index.add_relation(Relation(kind, self.scope_id, target, source_span(self.record.path, node), attrs))

    def relation_role(self, target: str) -> str:
        ent = self.index.entities.get(target)
        if ent is None:
            return "unknown"
        return {
            EntityKind.PARAMETER: "parameter",
            EntityKind.FIELD: "field",
            EntityKind.VARIABLE: "global" if self.index.entities.get(ent.parent or "") and self.index.entities[ent.parent].kind is EntityKind.MODULE else "local",
            EntityKind.FUNCTION: "function",
            EntityKind.METHOD: "method",
            EntityKind.CLASS: "class",
            EntityKind.MODULE: "module",
            EntityKind.TYPE: "type",
            EntityKind.EXTERNAL: "external",
        }.get(ent.kind, ent.kind.value)

    def type_entity(self, annotation: ast.expr | None) -> str | None:
        text = annotation_text(annotation)
        if not text:
            return None
        # Prefer a directly resolvable simple/dotted type; preserve complex annotations textually.
        target = self.resolver.resolve_expr(annotation, self.record.name, self.scope_qname, self.class_qname)
        if target:
            return target.entity_id
        return self.resolver.external(text, EntityKind.TYPE)

    def visit_Import(self, node: ast.Import) -> None:
        for alias in node.names:
            target = self.resolver.resolve_qname(alias.name)
            self.relation(RelationKind.IMPORTS, target.entity_id if target else self.resolver.external(alias.name), node, imported=alias.name)

    def visit_ImportFrom(self, node: ast.ImportFrom) -> None:
        # Imports were normalized by the indexer; emit one relation per bound import.
        for alias in node.names:
            bound = alias.asname or alias.name
            if alias.name == "*":
                continue
            q = self.record.imports.get(bound)
            if q:
                target = self.resolver.resolve_qname(q)
                self.relation(RelationKind.IMPORTS, target.entity_id if target else self.resolver.external(q), node, imported=q)

    def visit_ClassDef(self, node: ast.ClassDef) -> None:
        eid = self.index.node_entity[id(node)]
        ent = self.index.entities[eid]
        old_scope_id = self.scope_id
        for base in node.bases:
            target = self.resolver.resolve_expr(base, self.record.name, self.scope_qname, ent.qualified_name)
            if target:
                self.index.add_relation(Relation(RelationKind.INHERITS, eid, target.entity_id, source_span(self.record.path, base)))
        for deco in node.decorator_list:
            target = self.resolver.resolve_expr(deco.func if isinstance(deco, ast.Call) else deco, self.record.name, self.scope_qname, ent.qualified_name)
            if target:
                self.index.add_relation(Relation(RelationKind.DECORATED_BY, eid, target.entity_id, source_span(self.record.path, deco)))
        self.scope_ids.append(eid)
        self.scope_qnames.append(ent.qualified_name)
        self.class_qnames.append(ent.qualified_name)
        for stmt in node.body:
            self.visit(stmt)
        self.class_qnames.pop(); self.scope_qnames.pop(); self.scope_ids.pop()

    def _visit_function(self, node: ast.FunctionDef | ast.AsyncFunctionDef) -> None:
        eid = self.index.node_entity[id(node)]
        ent = self.index.entities[eid]
        current_class = self.class_qname
        for deco in node.decorator_list:
            target = self.resolver.resolve_expr(deco.func if isinstance(deco, ast.Call) else deco, self.record.name, self.scope_qname, current_class)
            if target:
                self.index.add_relation(Relation(RelationKind.DECORATED_BY, eid, target.entity_id, source_span(self.record.path, deco)))
        if node.returns:
            typ = self.type_entity(node.returns)
            if typ:
                self.index.add_relation(Relation(RelationKind.RETURNS, eid, typ, source_span(self.record.path, node.returns)))
                self.index.add_relation(Relation(RelationKind.USES_TYPE, eid, typ, source_span(self.record.path, node.returns), {"role": "return"}))
        self.scope_ids.append(eid)
        self.scope_qnames.append(ent.qualified_name)
        self.class_qnames.append(current_class)
        # Parameter annotation edges originate from parameter entities.
        args = list(node.args.posonlyargs) + list(node.args.args) + list(node.args.kwonlyargs)
        if node.args.vararg: args.append(node.args.vararg)
        if node.args.kwarg: args.append(node.args.kwarg)
        for arg in args:
            param_q = f"{ent.qualified_name}.{arg.arg}"
            param_id = self.index.qname_to_id.get(param_q)
            typ = self.type_entity(arg.annotation)
            if param_id and typ:
                self.index.add_relation(Relation(RelationKind.USES_TYPE, param_id, typ, source_span(self.record.path, arg.annotation), {"role": "annotation"}))
        for stmt in node.body:
            # Nested function/class declarations need semantic traversal too.
            self.visit(stmt)
        self.class_qnames.pop(); self.scope_qnames.pop(); self.scope_ids.pop()

    visit_FunctionDef = _visit_function
    visit_AsyncFunctionDef = _visit_function

    def visit_Call(self, node: ast.Call) -> None:
        target = self.resolver.resolve_expr(node.func, self.record.name, self.scope_qname, self.class_qname)
        if target:
            self.relation(RelationKind.CALLS, target.entity_id, node, confidence=target.confidence, expression=annotation_text(node.func))
        elif isinstance(node.func, ast.Name) and node.func.id in _BUILTINS:
            self.relation(RelationKind.CALLS, self.resolver.external(f"builtins.{node.func.id}"), node, confidence="builtin", expression=node.func.id)
        else:
            dotted = self.resolver.dotted_name(node.func)
            if dotted:
                self.relation(RelationKind.CALLS, self.resolver.external(dotted), node, confidence="unresolved", expression=dotted)

        # A callee expression such as ``foo`` in ``foo()`` is technically an
        # AST Load, but recording both CALLS(foo) and READS(foo) adds no useful
        # semantic information at this graph level.  Visit only argument/value
        # expressions here. Nested callable expressions are still analyzed.
        if isinstance(node.func, ast.Call):
            self.visit(node.func)
        elif isinstance(node.func, (ast.Subscript, ast.Lambda)):
            self.visit(node.func)
        for arg in node.args:
            self.visit(arg)
        for keyword in node.keywords:
            self.visit(keyword.value)

    def _variable(self, name: str, node: ast.AST, field: bool = False) -> str | None:
        if field and self.class_qname:
            q = f"{self.class_qname}.{name}"
            kind = EntityKind.FIELD
        elif self.include_locals:
            q = f"{self.scope_qname}::<local>.{name}"
            kind = EntityKind.VARIABLE
        else:
            return None
        key = (self.scope_id, q)
        if key in self.local_entities:
            return self.local_entities[key]
        eid = entity_id(kind, q)
        if eid not in self.index.entities:
            ent = Entity(eid, kind, name, q, self.scope_id if not field else self.index.qname_to_id.get(self.class_qname or ""), source_span(self.record.path, node))
            self.index.add_entity(ent)
            if ent.parent:
                self.index.add_relation(Relation(RelationKind.CONTAINS, ent.parent, eid, ent.span))
        self.local_entities[key] = eid
        return eid

    def visit_Name(self, node: ast.Name) -> None:
        if isinstance(node.ctx, ast.Load):
            target = self.resolver.resolve_name(node.id, self.record.name, self.scope_qname)
            if target and target.entity_id != self.scope_id:
                self.relation(
                    RelationKind.READS, target.entity_id, node,
                    confidence=target.confidence, role=self.relation_role(target.entity_id),
                )
            elif self.include_locals:
                var = self._variable(node.id, node)
                if var:
                    self.relation(RelationKind.READS, var, node, role="local")
        elif isinstance(node.ctx, (ast.Store, ast.Del)):
            var = self._variable(node.id, node)
            if var:
                self.relation(RelationKind.WRITES, var, node, role=self.relation_role(var))

    def visit_Attribute(self, node: ast.Attribute) -> None:
        if isinstance(node.value, ast.Name) and node.value.id in {"self", "cls"} and self.class_qname:
            qname = f"{self.class_qname}.{node.attr}"
            known_id = self.index.qname_to_id.get(qname)
            known = self.index.entities.get(known_id) if known_id else None
            # ``self.method`` is a member reference, not an instance field.
            # Only synthesize a FIELD when there is no known declaration with
            # the same qualified name (method/class/etc.).
            if known is None or known.kind is EntityKind.FIELD:
                field = known.id if known and known.kind is EntityKind.FIELD else self._variable(node.attr, node, field=True)
                if field:
                    if isinstance(node.ctx, ast.Load):
                        self.relation(RelationKind.READS, field, node, role="field")
                    elif isinstance(node.ctx, (ast.Store, ast.Del)):
                        self.relation(RelationKind.WRITES, field, node, role="field")
        self.generic_visit(node)


def analyze_module(index: ProjectIndex, record: ModuleRecord, include_locals: bool = False) -> None:
    SemanticVisitor(index, record, include_locals=include_locals).visit(record.tree)
