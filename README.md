# PyCodeGraph

PyCodeGraph is a Python static-analysis project that converts Python source code into a language-neutral CodeGraph JSON artifact. The repository also includes a browser-based Viewer for exploring generated graphs.

Currently, the analyzer supports **Python only**.

## Install

Python 3.11 or newer is required.

```bash
python -m pip install -e .
```

## Generate a graph

Analyze a project directory:

```bash
pycodegraph /path/to/python/project -o graph.json --summary
```

Analyze a single Python file:

```bash
pycodegraph script.py -o graph.json
```

Use `--include-locals` when local-variable reads and writes are needed.

## Open the Viewer

The Viewer is in `Viewer/` and does not require a backend. You can open `Viewer/index.html` directly, or serve it locally:

```bash
python -m http.server 8000
```

Then open `http://localhost:8000/Viewer/` and load a generated CodeGraph JSON file.

## Tests

```bash
python -m pytest
```
