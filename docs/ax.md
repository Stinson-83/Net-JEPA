# Agentic AI in the Build (Claude Code)

> The EnnovateX rubric asks teams to describe how they used **open-weight models and/or
> agentic development tooling** to implement their solution. This is a factual, verifiable
> account — every claim below maps to a commit, a script, or a file in this repository.

Net-JEPA was built by a human team (Team FlowState) working with **Claude Code** (Anthropic's
agentic command-line coding tool, running Claude Opus 4.x). The division of labour was
consistent throughout: **the human set direction, made every research decision, and evaluated
every result; the agent carried out implementation, debugging, benchmarking, and documentation
under continuous human review.** The delivered model itself (Net-JEPA) ships as an
**open-weight artifact** — published to the Hugging Face Hub under Apache-2.0
(`kritikahd007/net-jepa`) — so the *solution* is open-weight even though the *development
assistant* is a hosted model.

## Agentic AI setup and harness

- **Harness.** Claude Code is a terminal-native agentic harness that runs inside the working
  copy of the repository. It plans, calls tools, reads their output, and iterates within a
  single human-supervised loop.
- **Tool surface actually used.** File tools (read / targeted edit / write), a shell tool
  (`bash`, including detached **background jobs**), code search (literal + glob), and `git`.
  Network tools were used only for the published-asset fetch/publish steps (Hugging Face Hub,
  Kaggle).
- **Permission model — human-in-the-loop.** Consequential or hard-to-reverse actions were
  gated behind explicit human approval rather than executed autonomously. A concrete example
  recorded in this repo: publishing the derived feature CSVs (`data/traffic_csvs/`) was paused
  for an explicit decision because the underlying 5G dataset's license is "Unknown"
  (see [datasets.md](datasets.md) and `data/traffic_csvs/SOURCES.md`).
- **Topology.** A single human operator and a single primary agent, with **selective
  sub-agent delegation** for well-scoped batch work (see *Multi-agent orchestration* below).
  There is no standing autonomous or always-on agent in the product itself.

## Instruction and context files (the "agents.md" analogue)

This project does **not** ship a committed `AGENTS.md`/`CLAUDE.md`. Durable instructions and
project context were held in two places instead:

- **A persistent, file-based memory store** maintained by the harness — an indexed
  `MEMORY.md` plus one file per fact (e.g. a running *project-status* note and a *feedback*
  note). This is the closest analogue to an `agents.md`: it is the standing, machine-read
  context that shapes the agent's behaviour across sessions (see *Memory and context handling*).
- **The live working context** — the repository itself plus the current session transcript.

The repository's `.claude/settings.local.json` records harness/tool settings; no project
secrets are committed.

## Memory and context handling

- **Persistent cross-session memory.** Facts that needed to survive context resets were
  written to the memory store rather than re-derived. Two that materially changed behaviour:
  a *project-status* memory (current model, dataset, and serving wiring) that let later
  sessions resume without re-reading the whole tree, and a *feedback* memory — **"do not
  remove `framer-motion`"** — recorded after an earlier proposed dependency removal was
  rejected; it is load-bearing in the web UI and the memory prevented a repeat regression.
- **Long-session context compaction.** The build spanned working sessions longer than a single
  context window. When context filled, the harness summarised the prior portion and resumed
  from that summary without losing the task thread — for example, the full per-flow latency
  benchmark was launched, the session compacted, and the result was still picked up and
  reported on the other side of the boundary.
- **Lesson.** Externalising durable facts to memory, and trusting compaction for the rest,
  was more reliable than keeping everything in-context. The failure mode to guard against is a
  stale memory; memories were treated as "true when written" and re-verified against the code
  before being acted on.

## Reasoning and planning pipelines

- **Read-before-write.** Whole-repo comprehension (across `src/netjepa/`, `src/server/`,
  `webui/`) preceded any change, so edits were made against an understood architecture.
- **Hypothesis → change → re-run → read.** Debugging followed an explicit loop: form a
  hypothesis from a failure, make the smallest change that tests it, re-run, and read the new
  output before continuing.
- **Controlled experiment design.** Choosing the production model was run as a controlled
  comparison, not a guess: a full-supervision **70/70/30** split was trained and evaluated
  against the prior **70/15/15** baseline **on the same held-out test set**, lifting accuracy
  **0.977 → 0.997**. Crucially the comparison was made **leak-free** — k-NN evaluation that
  excludes neighbours from the *same source capture* — to rule out the obvious confound before
  adopting the result (the leak-free figure, 0.9963, tracked the headline 0.9968).
- **Root-cause over symptom.** See *What worked* below for the central example (per-capture
  host stats), and [experiments.md](experiments.md) for the full investigation log.

## Tool use and tool chaining

Representative end-to-end chains, each a single human-reviewed sequence:

- **Root-cause debug.** read feature code → `bash` diff of train-vs-inference feature tensors
  (established byte-identity) → edit `build_traffic_dataset.py` (host stats per `source_file`)
  → `bash` rebuild → retrain (Phase 1 → 2b → 3) → evaluate → read KPI delta.
- **Latency benchmark.** write `latency_per_flow.py` → `bash` run on a 2 k-flow subset →
  diagnose anomalous timing as many-core thread-sync overhead → edit
  (`torch.set_num_threads(1)`) → re-run → launch the **full 28,892-flow run as a background
  job** → receive the completion notification → report mean / p50 / p95 / p99.
- **Asset publish.** stage → `git` commit/push; Hugging Face Hub model publish; `kagglehub`
  source fetch.

**Background execution** was the main concurrency primitive: long jobs ran detached and
re-entered the loop on completion, so the human was not blocked waiting on a multi-minute
benchmark or build.

## Multi-agent / sub-agent orchestration

The primary loop is single-agent. Where work was naturally parallelisable and well-scoped, it
was **delegated to a sub-agent** while the main thread continued. The clearest case: the
repository-cleanup and documentation-formalisation pass (removing dead checkpoints/datasets,
de-emojifying and restructuring `docs/`, writing the experimentation log) ran as a delegated
sub-agent, and the human gated the final commit/push on its completion. Background jobs
provided a second, lighter form of parallelism. We did **not** operate a standing multi-agent
system as part of the product — orchestration was a build-time convenience, used selectively,
and is described here as exactly that.

## MCP servers and skills

The Claude Code harness exposes external **MCP servers** (e.g. Canva, Excalidraw, Google
Drive) and slash-command **skills** (e.g. a multi-agent code-review command). For transparency:
the **Net-JEPA training pipeline and serving stack did not route any step through an MCP server
or external skill** — all build work used the local file, shell, search, and `git` tools. We
note their availability for completeness and because keeping the core build's dependency
surface small and auditable was a deliberate choice, not an oversight.

## Where the agent was used

- **Whole-repo comprehension** — mapping how `src/netjepa/`, `src/server/`, and `webui/` fit
  together before changing anything.
- **Backend hardening** — removing redundancy in the packet → flow → feature pipeline, making
  it config-driven (YAML configs under `src/netjepa/configs/`), and adding structured logging.
- **Debugging non-obvious failures** — e.g. an early DBSCAN pseudo-label mapping bug (labels
  keyed by batch position instead of true flow index, so the contrastive term trained on
  noise), and a Phase-3 head collapse caused by *double* class-imbalance correction (a balanced
  sampler **and** class weights applied at once).
- **Running the pipeline** end-to-end — preprocess → Phase 1 → 2b → 3 → evaluate → export.
- **Folding in real data** — a scapy `pcap → CSV` converter and the `FOLDER_TO_TYPE`
  source → traffic-type routing, stream-extracting only the ~5 GB of 5G captures needed from a
  ~28 GB archive.
- **The 8-traffic-type rebuild** — `build_traffic_dataset.py` (per-type CSVs + leak-free
  splits), the per-capture host-stats fix, and the terminal `infer_pcap` path.
- **A full front-end rebuild** — the "Signal Atlas" React/WebGL application, plus the Proof Lab
  upload demos wired to the live FastAPI backend.
- **Benchmarking** — `latency_per_flow.py` and the `make latency` target.
- **This documentation** — the `docs/` set, including [implementation.md](implementation.md)
  and [experiments.md](experiments.md).

## What worked

- **Fast iteration on difficult bugs.** Read a failure, hypothesise, change, re-run, read the
  new output — the loop substantially compressed debugging cycles.
- **Thorough evaluation and root-cause debugging.** Test accuracy looked acceptable (0.86) yet
  uploaded `.pcap`s misclassified — even the Netflix VOD *training* source read as
  cloud_gaming. The agent diffed train-vs-inference feature tensors, established they were
  byte-identical, and isolated the cause: **host stats computed globally instead of
  per-capture** — an unreproducible train/inference inconsistency. Fixing it lifted accuracy
  **0.86 → 0.977** and made real-pcap upload work (full supervision later took it to **0.997**).
  The remaining weak spot (single-flow pcaps)
  is reported rather than hidden. Agentic tooling made the thorough path the cheap path.
- **Breadth without loss of focus.** The agent moved between PyTorch training, FastAPI serving,
  and a TypeScript/WebGL front-end while keeping the KPIs in view.
- **Documentation and provenance as first-class artifacts** — kept in step with the code,
  including a per-source license/provenance file for the published data.

## What did not work, and the human's role

- **The agent does not originate research direction.** The ideas that actually moved the
  metrics — meeting the cosine KPI with **α-centering**, applying SupCon at the
  **traffic-type** level, and recognising that **host stats must be per-capture** — came from
  human insight about the data and the KPI. The agent implemented, diffed, and validated; it
  did not decide.
- **It over-corrects without supervision.** The double class-imbalance fix and a too-large
  DBSCAN `eps` are cases where "more is better" *degraded* results, and a human reading the
  metrics caught it.
- **Environment and portability friction was real.** A UMAP 2-D reducer pickled under Python
  3.10 would not unpickle under 3.13 and aborted the whole server load; the fix was to make the
  reducer optional with a centroid-based projection fallback so classification works on any
  Python. The first latency run reported a misleading ~100 ms because, for a batch-1 small
  model on a many-core box, thread-sync overhead dominated; pinning `torch.set_num_threads(1)`
  recovered the true ~3-13 ms figure. Bundled demo pcaps first misclassified because a
  flow-subset changes the per-capture host stats; the fix was to keep **every** flow's first 64
  packets so the host-stat context matches the original capture. NFS-backed `git` operations
  occasionally stalled and had to be retried. Each was worked around, but human judgement was
  needed to avoid unproductive detours.
- **Guardrails are essential.** An API token pasted into the session had to be handled
  carefully — used, then flagged for revocation/rotation — and the dataset-publish decision was
  deliberately escalated to the human rather than taken by the agent. Agentic tooling amplifies
  both speed and mistakes; review is non-negotiable.

## Summary

Agentic AI turned a multi-week build into a fast, human-steered loop: the human owned the
science and the judgement; the agent handled implementation, plumbing, debugging,
benchmarking, and documentation, with selective sub-agent and background-job parallelism and a
persistent memory that carried context across sessions. The result is a project that meets
every KPI and can demonstrate it, with a complete and auditable record — this `docs/` set and
[experiments.md](experiments.md) — of how it was developed, dead ends included.
