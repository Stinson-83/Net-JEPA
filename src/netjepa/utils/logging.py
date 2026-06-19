from __future__ import annotations

import logging
import sys

_wandb_enabled = False
_logging_configured = False


def get_logger(name: str = 'netjepa', level: int = logging.INFO) -> logging.Logger:
    """Return a process-wide configured logger.

    All loggers live under the ``netjepa`` namespace and share a single stdout
    handler installed on first call. Pass ``name='netjepa.data'`` etc. for a
    module-scoped child; the level/handler are inherited from the root.
    """
    global _logging_configured
    root = logging.getLogger('netjepa')
    if not _logging_configured:
        handler = logging.StreamHandler(sys.stdout)
        handler.setFormatter(logging.Formatter(
            fmt='%(asctime)s | %(levelname)-7s | %(name)s | %(message)s',
            datefmt='%H:%M:%S'))
        root.addHandler(handler)
        root.setLevel(level)
        root.propagate = False
        _logging_configured = True
    if name == 'netjepa' or name.startswith('netjepa.'):
        return logging.getLogger(name)
    return logging.getLogger(f'netjepa.{name}')


def init_wandb(project: str, config: dict | None = None) -> None:
    global _wandb_enabled
    try:
        import wandb
        wandb.init(project=project, config=config or {})
        _wandb_enabled = True
    except Exception as e:
        print(f'[WandB] disabled: {e}')
        _wandb_enabled = False


def log_metrics(metrics: dict, step: int | None = None) -> None:
    if not _wandb_enabled:
        return
    try:
        import wandb
        wandb.log(metrics, step=step)
    except Exception:
        pass
