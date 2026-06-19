"""Net-JEPA — installable src/ layout.

All first-party packages live under src/ (netjepa, server, capture, flows, model).
`pip install -e .` from the repo root registers them so they import from any
working directory; the training/eval scripts also self-bootstrap sys.path, so they
run with `python src/netjepa/scripts/<script>.py` even without installing.

Metadata is kept here (rather than in a pyproject [project] table) for
compatibility with older setuptools toolchains.
"""
from setuptools import setup, find_packages

# Runtime dependencies mirror requirements.txt. For an exact pinned set,
# `pip install -r requirements.txt` first; `pip install -e .` then registers
# the src/ packages (and fills in anything missing from this list).
INSTALL_REQUIRES = [
    "torch>=2.0.0",
    "torchvision>=0.15.0",
    "numpy>=1.24.0",
    "pandas>=2.0.0",
    "pyarrow>=12.0.0",
    "scikit-learn>=1.3.0",
    "pyyaml>=6.0",
    "tqdm>=4.65.0",
    "matplotlib>=3.7.0",
    "seaborn>=0.12.0",
    "scipy>=1.11.0",
    "scapy>=2.5.0",
    "fastapi>=0.104.0",
    "uvicorn[standard]>=0.24.0",
    "websockets>=10",
    "python-multipart>=0.0.6",
    "joblib>=1.3.0",
    "umap-learn>=0.5.4",
]

setup(
    name="netjepa",
    version="0.1.0",
    description=(
        "Net-JEPA — Context-Aware Flow Embeddings for Adaptive AI-based "
        "Network Traffic Classification"
    ),
    long_description=open("README.md", encoding="utf-8").read(),
    long_description_content_type="text/markdown",
    url="https://github.com/Stinson-83/Net-JEPA",
    license="Apache-2.0",
    python_requires=">=3.10",
    package_dir={"": "src"},
    packages=find_packages(where="src"),
    include_package_data=True,
    install_requires=INSTALL_REQUIRES,
    extras_require={
        "logging": ["wandb>=0.15.0"],
        "publish": ["huggingface_hub>=0.17.0"],
    },
)
