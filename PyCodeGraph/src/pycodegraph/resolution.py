from __future__ import annotations

import ast
from dataclasses import dataclass

from .index import ProjectIndex, entity_id
from .model import Entity, EntityKind


@dataclass(frozen=True, slots=True)
class Resolution:
    entity_id: str
    confidence: str


class Resolver:
    def __init__(self, index: ProjectIndex):
        self.index = index

    def external(self, qname: str, kind: EntityKind = EntityKind.EXTERNAL) -> str:
        eid = entity_id(kind, qname)
        if eid not in self.index.entities:
            self.index.add_entity(Entity(eid, kind, qname.rsplit(".", 1)[-1], qname, None, None, {"external": True}))
        return eid

    def resolve_qname(self, qname: str) -> Resolution | None:
        if qname in self.index.qname_to_id:
            return Resolution(self.index.qname_to_id[qname], "exact")
        if qname in self.index.modules:
            return Resolution(self.index.modules[qname].entity_id, "exact")
        # Longest module prefix, then member traversal by qualified name.
        parts = qname.split(".")
        for i in range(len(parts), 0, -1):
            mod = ".".join(parts[:i])
            if mod in self.index.modules:
                candidate = qname
                if candidate in self.index.qname_to_id:
                    return Resolution(self.index.qname_to_id[candidate], "exact")
                return Resolution(self.external(qname), "external")
        return None

    def resolve_name(self, name: str, module: str, scope_qname: str | None = None) -> Resolution | None:
        # Search lexical scope from inner to outer.
        if scope_qname:
            parts = scope_qname.split(".")
            module_parts = module.split(".")
            for end in range(len(parts), len(module_parts) - 1, -1):
                q = ".".join(parts[:end] + [name])
                if q in self.index.qname_to_id:
                    return Resolution(self.index.qname_to_id[q], "exact")
        member = self.index.module_members.get(module, {}).get(name)
        if member:
            return Resolution(member, "exact")
        record = self.index.modules[module]
        imported = record.imports.get(name)
        if imported:
            resolved = self.resolve_qname(imported)
            return resolved or Resolution(self.external(imported), "external")
        for star in record.star_imports:
            member = self.index.module_members.get(star, {}).get(name)
            if member:
                return Resolution(member, "inferred")
        return None

    def dotted_name(self, node: ast.AST) -> str | None:
        if isinstance(node, ast.Name):
            return node.id
        if isinstance(node, ast.Attribute):
            base = self.dotted_name(node.value)
            if base:
                return f"{base}.{node.attr}"
        return None

    def resolve_expr(self, node: ast.AST, module: str, scope_qname: str | None = None, class_qname: str | None = None) -> Resolution | None:
        if isinstance(node, ast.Name):
            return self.resolve_name(node.id, module, scope_qname)
        if isinstance(node, ast.Attribute):
            # self.method / cls.method
            if isinstance(node.value, ast.Name) and node.value.id in {"self", "cls"} and class_qname:
                q = f"{class_qname}.{node.attr}"
                if q in self.index.qname_to_id:
                    return Resolution(self.index.qname_to_id[q], "exact")
            dotted = self.dotted_name(node)
            if dotted:
                head, *tail = dotted.split(".")
                head_res = self.resolve_name(head, module, scope_qname)
                if head_res:
                    head_ent = self.index.entities[head_res.entity_id]
                    # Imported module/entity or class member.
                    base_q = head_ent.qualified_name
                    q = ".".join([base_q, *tail]) if tail else base_q
                    if q in self.index.qname_to_id:
                        return Resolution(self.index.qname_to_id[q], "exact")
                    return Resolution(self.external(q), "inferred")
                # Absolute module path.
                resolved = self.resolve_qname(dotted)
                if resolved:
                    return resolved
        return None
