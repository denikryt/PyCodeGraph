# PyCodeGraph

PyCodeGraph is a static analyzer for Python projects. It parses Python source code and writes a language-neutral CodeGraph JSON artifact containing entities such as modules, classes, functions, methods, parameters, and typed relations between them.

Currently, PyCodeGraph analyzes **Python only**.

## Install

Python 3.11 or newer is required.

```bash
python -m pip install -e .
```

## Usage

Analyze a project directory:

```bash
pycodegraph /path/to/python/project -o graph.json --summary
```

Analyze a single Python file:

```bash
pycodegraph script.py -o graph.json
```

Include local-variable reads and writes when needed:

```bash
pycodegraph /path/to/project -o graph.json --include-locals
```

The generated JSON is intended to be consumed by a separate visualizer or other tooling.

## Tests

```bash
python -m pytest
```
