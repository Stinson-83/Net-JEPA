# 8 · Agentic AI in the Build (Claude Code)

> The EnnovateX rubric asks teams to describe how they used **agentic AI tooling**. This is an
> honest account — what it did well, and where it didn't.

Net-JEPA was built by a human (Team FlowState) **pair-working with Claude Code** (Anthropic's
agentic CLI, Claude Opus 4.8). The human set direction, made every research call, and judged
every result; the agent did the heavy lifting of implementation, debugging, and documentation
under continuous human review.

## 8.1 Where the agent was used

- **Whole-repo comprehension** — reading the architecture across `netjepa/`, `server/`,
  `webui/` and explaining how the pieces fit before changing anything.
- **Backend hardening** — removing redundancy in the packet→flow→feature pipeline, making it
  config-driven (`default.yaml`), and adding structured loggers throughout.
- **Debugging non-obvious failures** — e.g. the DBSCAN pseudo-label mapping bug (labels keyed
  by batch position instead of true flow index, so the contrastive term trained on noise), and
  the Phase-3 head collapse from *double* class-imbalance correction (balanced sampler **and**
  class weights at once).
- **Running the pipeline** end-to-end — preprocess → Phase 1 → 2b → 3 → evaluate → export.
- **Folding in real data** — writing the scapy pcap→CSV converter, the `FOLDER_MAP` /
  `PRETRAIN_ONLY_FOLDERS` routing, and stream-extracting only the 5 GB of 5G captures needed
  from a 28 GB Kaggle archive.
- **The cross-domain harness + DANN** — building the train-Kaggle/test-VLC generalization run
  and the gradient-reversal domain-adversarial phase.
- **A full front-end rebuild** — the "Signal Atlas" React/WebGL experience from scratch,
  verified with headless WebGL screenshots.
- **This documentation** — the `docs/` set, `doc.md`, and `experimentation.md`.

## 8.2 What worked

- **Tight loops on hard bugs.** The agent could read the failure, form a hypothesis, change
  code, re-run, and read the new output — compressing debugging cycles dramatically.
- **Honest evaluation.** When Kaggle→VLC transfer measured **5%**, the agent surfaced it,
  diagnosed it (label shift / domain-specific cues), and we *reported* it rather than buried
  it. Agentic tooling made the honest path the cheap path.
- **Breadth without losing the thread.** It moved between PyTorch training code, FastAPI
  serving, and a TypeScript/WebGL front-end while keeping the KPIs in view.
- **Documentation as a first-class artifact** — kept in lockstep with the code, not an
  afterthought.

## 8.3 What didn't (and the human's role)

- **The agent does not invent research direction.** Every key idea — meeting the cosine KPI
  with **α-centering**, treating SupCon at the **category** level, routing out-of-domain data
  to **pretrain-only** to kill the domain confound — came from human insight about the *data*
  and the *KPI definition*. The agent implemented and validated; it did not decide.
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
