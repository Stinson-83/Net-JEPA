# 8 · Agentic AI in the Build (Claude Code)

> The EnnovateX rubric asks teams to describe how they used **agentic AI tooling**. This is an
> honest account — what it did well, and where it didn't.

Net-JEPA was built by a human (Team FlowState) **pair-working with Claude Code** (Anthropic's
agentic CLI, Claude Opus 4.8). The human set direction, made every research call, and judged
every result; the agent did the heavy lifting of implementation, debugging, and documentation
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
- **A full front-end rebuild** — the "Signal Atlas" React/WebGL experience from scratch,
  verified with headless WebGL screenshots.
- **This documentation** — the `docs/` set, `doc.md`, and `experimentation.md`.

## 8.2 What worked

- **Tight loops on hard bugs.** The agent could read the failure, form a hypothesis, change
  code, re-run, and read the new output — compressing debugging cycles dramatically.
- **Honest evaluation + root-cause debugging.** Test accuracy looked fine (0.86) yet uploaded
  `.pcap`s misclassified — even the literal Netflix VOD training source read as cloud_gaming.
  The agent diffed the train vs. inference feature tensors, proved they were byte-identical,
  then isolated the real cause: **host stats computed globally instead of per-capture** (an
  unreproducible train/inference leak). Fixing it lifted accuracy **0.86 → 0.977** *and* made
  real-pcap upload work. We report the remaining weak spot (single-flow pcaps) rather than bury
  it. Agentic tooling made the honest path the cheap path.
- **Breadth without losing the thread.** It moved between PyTorch training code, FastAPI
  serving, and a TypeScript/WebGL front-end while keeping the KPIs in view.
- **Documentation as a first-class artifact** — kept in lockstep with the code, not an
  afterthought.

## 8.3 What didn't (and the human's role)

- **The agent does not invent research direction.** Every key idea — meeting the cosine KPI
  with **α-centering**, treating SupCon at the **traffic-type** level, and realising that
  **host stats must be per-capture** (train/inference-consistent) — came from human insight
  about the *data* and the *KPI definition*. The agent implemented, diffed, and validated; it
  did not decide.
- **It will over-correct if unsupervised.** The double class-imbalance fix and a too-large
  DBSCAN `eps` are examples where naïve "more is better" changes hurt, and a human reading the
  metrics caught it.
- **Environment friction was real** — snap-confined browser sandboxing, a websockets version
  that broke uvicorn's `/ws`, Kaggle's download quirks. The agent worked around each, but it
  took human-in-the-loop judgement to not go down rabbit holes.
- **Guardrails matter.** A pasted API token had to be handled carefully (written with
  restrictive perms, used, deleted, flagged for revocation). Agentic tooling amplifies both
  speed *and* mistakes; review is non-negotiable.

## 8.4 The takeaway

Agentic AI turned a multi-week build into a **fast, tight, human-steered loop**: the human
owned the science and the judgement; the agent owned the typing, the plumbing, the debugging,
and the docs. The result is a project that meets every KPI **and** can prove it — with a paper
trail (this `docs/` set + [`../experimentation.md`](../experimentation.md)) of exactly how it
got there, dead ends included.
