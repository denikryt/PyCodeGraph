# CodeGraph

This repository contains both parts of the project:

- `Viewer/` root files (`index.html`, `app.js`, `styles.css`) — a static browser-based visualizer for CodeGraph JSON artifacts.
- `PyCodeGraph/` — a Python-only static analyzer that generates CodeGraph JSON artifacts from Python source code.

## Generate a graph

Python 3.11 or newer is required.

```bash
cd PyCodeGraph
python -m pip install -e .
pycodegraph /path/to/python/project -o graph.json --summary
```

See `PyCodeGraph/README.md` for parser details.

## Open the viewer

From the repository root, either open `index.html` directly or serve the directory:

```bash
python -m http.server 8000
```

Then open `http://localhost:8000` and load the generated CodeGraph JSON file.

## Interaction

- Wheel: zoom.
- Drag empty canvas: pan.
- Drag a node: move that node.
- Drag a class frame **header**: move the frame and its visible child nodes together.
- Drag empty space inside a frame body: pan the canvas.
- Click a node: select and focus its incident relations.
- Double-click a module/class: enter Structure projection.
- Double-click a function/method: open its neighborhood.
- Click a relation row (`calls`, `imports`, etc.): expand endpoint names.

## Visual semantics

- Circular socket: value/interface input.
- Diamond port: static program relation such as calls/imports/uses_type.
- Hierarchy frame: `contains` / ownership. `contains` is represented spatially rather than as a wire.
