# CodeGraph Viewer

Static browser viewer for `pycodegraph/1.0` artifacts. No backend and no external JavaScript dependencies are required.

## Run

Open `index.html` directly, or serve this directory:

```bash
python -m http.server 8000
```

Then open `http://localhost:8000` and load a CodeGraph JSON file.

## Interaction

- Wheel: zoom.
- Drag empty canvas: pan.
- Drag a node: move that node.
- Structure projection: drag an empty area of a hierarchy frame to move the frame entity and all visible descendants together.
- Click a node: select and focus its incident relations.
- Double-click a module/class: enter Structure projection.
- Double-click a function/method: open its neighborhood.
- Click a relation row (`calls`, `imports`, etc.): expand endpoint names. Relations remain visible while collapsed.

## Visual semantics

- Circular socket: value/interface input or return value.
- Diamond port: static program relation such as calls/imports/uses_type.
- Hierarchy frame: `contains` / ownership. `contains` is represented spatially rather than as a wire.

## Structure projection

Structure mode uses a hierarchy-aware layout. Each top-level class/function subtree receives its own vertical band, descendants are placed in deeper columns, and sibling groups are spaced independently. Semantic relations inside the selected module (`calls`, `imports`, `uses_type`, and other enabled relation kinds) are drawn as wires; `contains` is used only to build hierarchy frames.

## Layout update (v3.3)

Structure view uses semantic relations (`calls`, `imports`, `uses_type`, etc.) to compute a left-to-right layered layout. Hierarchy no longer dictates node columns. Class frames are drawn only after nodes are positioned, so frames are annotations/groups rather than layout constraints. The selected module is not wrapped in one giant frame. Dragging an empty class-frame area still moves the class and its visible descendants together.

## Endpoint aggregation update (v3.4)

Expanded relation groups aggregate repeated relations to the same semantic endpoint. For example, five calls to the same `isinstance` entity are rendered as one endpoint row, `isinstance ×5`, instead of five duplicate rows. The grouping key is the target/source entity ID rather than display text, so unrelated same-named entities are not merged. All underlying edges remain in the graph and are routed through the shared endpoint port.
