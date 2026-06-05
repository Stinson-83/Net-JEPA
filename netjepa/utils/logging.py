from __future__ import annotations

_wandb_enabled = False


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
