from pathlib import Path

from pycodegraph import EntityKind, RelationKind, analyze_project


def test_project_semantics(tmp_path: Path):
    (tmp_path / "base.py").write_text('''\nclass Base:\n    def run(self, x: int) -> int:\n        return x\n''')
    (tmp_path / "app.py").write_text('''\nfrom base import Base\n\nclass App(Base):\n    def __init__(self):\n        self.value = 1\n\n    def work(self, n: int) -> int:\n        return self.run(n)\n\ndef main() -> App:\n    a = App()\n    return a\n''')
    graph = analyze_project(tmp_path)
    qnames = {e.qualified_name for e in graph.entities}
    assert "app.App" in qnames
    assert "app.App.work" in qnames
    assert "base.Base" in qnames
    assert "app.App.value" in qnames
    kinds = {(r.kind, graph.entities_by_id[r.target].qualified_name) for r in graph.relations} if False else None
    assert any(r.kind is RelationKind.INHERITS and r.source.endswith("app.App") and r.target.endswith("base.Base") for r in graph.relations)
    assert any(r.kind is RelationKind.CALLS and r.source.endswith("app.main") and r.target.endswith("app.App") for r in graph.relations)
    assert not graph.diagnostics


def test_call_does_not_duplicate_read(tmp_path: Path):
    (tmp_path / "m.py").write_text('''\ndef callee():\n    return 1\n\ndef caller():\n    return callee()\n''')
    graph = analyze_project(tmp_path)
    by_q = {e.qualified_name: e for e in graph.entities}
    caller = by_q["m.caller"].id
    callee = by_q["m.callee"].id
    assert any(r.kind is RelationKind.CALLS and r.source == caller and r.target == callee for r in graph.relations)
    assert not any(r.kind is RelationKind.READS and r.source == caller and r.target == callee for r in graph.relations)


def test_method_reference_not_synthesized_as_field(tmp_path: Path):
    (tmp_path / "m.py").write_text('''\nclass C:\n    def helper(self):\n        return 1\n\n    def run(self):\n        return self.helper()\n''')
    graph = analyze_project(tmp_path)
    same_q = [e for e in graph.entities if e.qualified_name == "m.C.helper"]
    assert len(same_q) == 1
    assert same_q[0].kind is EntityKind.METHOD


def test_return_profile_and_module_global(tmp_path: Path):
    (tmp_path / "m.py").write_text('''\nTOKEN = 3\n\ndef value():\n    return TOKEN\n\ndef empty():\n    return\n\ndef implicit():\n    pass\n''')
    graph = analyze_project(tmp_path)
    by_q = {e.qualified_name: e for e in graph.entities}
    assert by_q["m.TOKEN"].kind is EntityKind.VARIABLE
    assert by_q["m.value"].attributes["return_status"] == "value"
    assert by_q["m.empty"].attributes["return_status"] == "none"
    assert by_q["m.implicit"].attributes["return_status"] == "implicit_none"
    token_reads = [r for r in graph.relations if r.kind is RelationKind.READS and r.target == by_q["m.TOKEN"].id]
    assert token_reads and token_reads[0].attributes.get("role") == "global"
