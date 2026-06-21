# 8 · Agentic AI in the Build (Claude Code)

> The EnnovateX rubric asks teams to describe how they used **agentic AI tooling**. This is a
> factual account of what worked well and what did not.

Net-JEPA was built by a human team (Team FlowState) working with Claude Code (Anthropic's
agentic CLI, Claude Opus 4.8). The human set direction, made every research decision, and
evaluated every result; the agent carried out implementation, debugging, and documentation
under continuous human review.

## 8.1 Where the agent was used

- **Whole-repo comprehension** — reading the architecture across `src/netjepa/`, `src/server/`,
  `webui/` and explaining how the pieces fit before changing anything.
- **Backend hardening** — removing redundancy in the packet→flow→feature pipeline, making it
  config-driven (`default.yaml`), and adding structured loggers throughout.
- **Debugging non-obvious failures** — e.g. the DBSCAN pseudo-label mapping bug (labels keyed
  by batch position instead of true flow index, so the contrastive term trained on noise), and
  the Phase-3 head collapse from *double* class-imbalance correction (balanced sampler **and**
  class weights at once).
- **Running the pipeline** end-to-end — preprocess → Phase 1 → 2b → 3 → evaluate → export.
- **Folding in real data** — writing the scapy pcap→CSV converter and the `FOLDER_TO_TYPE`
  source→traffic-type routing, and stream-extracting only the 5 GB of 5G captures needed
  from a 28 GB Kaggle archive.
- **The 8-traffic-type rebuild** — `build_traffic_dataset.py` (per-type CSVs + leak-free splits),
  the per-capture host-stats fix, and the terminal `infer_pcap` path; plus the optional
  gradient-reversal domain-adversarial (DANN) phase for future cross-deployment.
- **A full front-end rebuild** — the "Signal Atlas" React/WebGL application from scratch,
  verified with headless WebGL screenshots.
- **This documentation** — the `docs/` set, `doc.md`, and `experimentation_log.md`.

## 8.2 What worked

- **Fast iteration on difficult bugs.** The agent could read a failure, form a hypothesis, change
  code, re-run, and read the new output, substantially compressing debugging cycles.
- **Thorough evaluation and root-cause debugging.** Test accuracy appeared acceptable (0.86), yet
  uploaded `.pcap`s misclassified — even the Netflix VOD training source read as cloud_gaming.
  The agent diffed the train vs. inference feature tensors, established that they were byte-identical,
  then isolated the cause: **host stats computed globally instead of per-capture** (an
  unreproducible train/inference leak). Fixing it lifted accuracy **0.86 → 0.997** and made
  real-pcap upload work. The remaining weak spot (single-flow pcaps) is reported rather than omitted.
  Agentic tooling made the thorough path the low-cost path.
- **Breadth without loss of focus.** The agent moved between PyTorch training code, FastAPI
  serving, and a TypeScript/WebGL front-end while keeping the KPIs in view.
- **Documentation as a first-class artifact** — maintained in step with the code rather than as an
  afterthought.

## 8.3 What did not work, and the human's role

- **The agent does not originate research direction.** Every key idea — meeting the cosine KPI
  with **α-centering**, treating SupCon at the **traffic-type** level, and recognising that
  **host stats must be per-capture** (train/inference-consistent) — came from human insight
  about the data and the KPI definition. The agent implemented, diffed, and validated; it
  did not decide.
- **It over-corrects without supervision.** The double class-imbalance fix and a too-large
  DBSCAN `eps` are cases where "more is better" changes degraded results, and a human reading the
  metrics identified the problem.
- **Environment friction was significant** — snap-confined browser sandboxing, a websockets version
  that broke uvicorn's `/ws`, and Kaggle download quirks. The agent worked around each, but
  human-in-the-loop judgement was required to avoid unproductive detours.
- **Guardrails are essential.** A pasted API token had to be handled carefully (written with
  restrictive permissions, used, deleted, and flagged for revocation). Agentic tooling amplifies both
  speed and mistakes; review is required.

## 8.4 Summary

Agentic AI turned a multi-week build into a fast, human-steered loop: the human
owned the science and the judgement; the agent handled the implementation, the plumbing, the
debugging, and the documentation. The result is a project that meets every KPI and can demonstrate it,
with a complete record (this `docs/` set and [`../experimentation_log.md`](../experimentation_log.md)) of how it
was developed, including dead ends.
