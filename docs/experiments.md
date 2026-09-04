# Experimentation Log

A formal record of the significant changes, experiments, and engineering decisions made
during the development of Net-JEPA, together with the reasoning behind each and the
measured outcome. Entries are grouped thematically and ordered roughly chronologically.
For the current results, see [results.md](results.md); for the architecture, see
[architecture.md](architecture.md); for how the work was carried out with agentic tooling,
see [ax.md](ax.md).

Conventions used below: **Problem** (motivation), **Change** (what was done),
**Reason** (why), **Result** (measured effect or verification).

> **Leakage fix (2026-08-28).** A capture-level data-leakage bug was found in the split used
> for the headline results. The earlier flow-level random train/test split put flows from the
> *same capture session* into both train and test; because the host-behaviour features in
> `flow_context` (`n_dst_ips`, `n_dst_ports`, `n_src_ports`, `conn_per_sec`) are identical for
> every flow of a capture, the cosine k-NN could match a test flow to its train siblings on that
> shared per-capture fingerprint — inflating the numbers. The "same-capture-neighbour-excluded"
> checks recorded below (sections 9 and 10) did **not** catch this split-level leak. The dataset
> builder now splits **by capture session** (`GroupShuffleSplit` per class, grouping on
> `source_file`), so all flows of a capture go entirely to train or entirely to test. This
> supersedes the retired 70/70/30 numbers (accuracy 0.997 / macro-F1 0.992). The honest
> leak-free figures without encoder-objective alignment were accuracy 0.753 / macro-F1 0.680
> (section 10); with the encoder-objective alignment fix (section 14) the current headline
> leak-free figures are accuracy **0.807** / macro-F1 **0.729** (section 14 and
> [results.md](results.md)). The full progression is 0.997 (leaky) -> 0.753 (leak-free) ->
> 0.807 (leak-free + aligned).

---

## 1. Preprocessing and flow construction

**Problem.** Encrypted traffic must be classified from flow metadata alone (no payload
inspection), so the raw captures (Wireshark CSV exports for the Kaggle 5G dataset; pcap for
the fold-in datasets) had to be turned into a consistent per-flow tensor representation.

**Change.** A four-stage pipeline in `src/netjepa/data/`:
1. `parser.py` — vectorized parsing of the Wireshark schema into a per-packet table
   (timestamps to relative seconds, TCP flags, TLS Client/Server-Hello markers, a 4-class
   protocol id).
2. `flow_builder.py` — grouping into bidirectional flows keyed by
   `frozenset{(src_ip, src_port), (dst_ip, dst_port)} + protocol`, with a 30 s idle split,
   a minimum of 5 packets, and truncation to the first 64 packets.
3. `rtt.py` — RTT estimation via TCP handshake, then TLS handshake, then first-exchange
   fallback.
4. `features.py` — a 64x9 `packet_sequence` (normalized size, log inter-arrival time,
   signed direction, protocol one-hot, RTT) plus a 15-D `flow_context` vector and a
   padding mask.

**Reason.** A fixed-width per-packet sequence is the natural input for a sequence model and
preserves the temporal "rhythm" that distinguishes traffic types; the flow_context vector
carries flow-level and host-level statistics the per-packet view cannot express.

**Result.** The minimum-packet floor was lowered from 10 to 5 after observing that the
10-packet floor discarded a large fraction of short flows; this recovered roughly a third
more flows and improved balance for sparse classes.

---

## 2. Model architecture and the self-supervised objective

**Problem.** Labels for encrypted traffic are scarce and expensive; the model should learn
useful structure from unlabeled flows first.

**Change.** A Joint-Embedding Predictive Architecture (`src/netjepa/model/`): a 4-layer
Temporal Transformer encoder (d=128) with cross-attention fusion of the flow_context
vector. An online branch sees a degraded view of the flow and predicts the latent
representation of the clean view produced by an EMA target encoder; the loss is VICReg
(invariance + variance + covariance), with an optional DBSCAN pseudo-label contrastive term.

**Reason.** Predicting latent representations (rather than reconstructing bytes) is robust to
the high entropy of encrypted payloads; the EMA target prevents representation collapse
without negative pairs.

**Result.** Self-supervised pretraining produces strong intra-class compactness but
insufficient inter-class margin on its own — motivating the supervised stage in section 3.

---

## 3. Meeting the cosine-similarity KPI (SupCon and alpha-centering)

**Problem.** The benchmark requires intra-class cosine > 0.7 and inter-class cosine < 0.3.
Self-supervised pretraining alone did not separate classes by the required margin.

**Change.** Two ideas applied together:
1. Supervised Contrastive (SupCon) fine-tuning on the L2-normalized embedding, supervised at
   the traffic-type level (so flows of the same type are pulled together).
2. Alpha-centering (`set_centering`, alpha ~ 0.65): SupCon separates class *directions* but
   leaves them inside a shared cone (high absolute cosine). Subtracting alpha times the mean
   and re-normalizing isotropizes the space.

**Reason.** The cosine KPI is defined on absolute cosine; SupCon improves the silhouette but
not absolute inter-class cosine. Removing the anisotropic common-mode is what brings absolute
inter-class cosine below the threshold.

**Result.** Both cosine targets were met. This combination remained the core of the final
model.

---

## 4. Folding in real data (VLC, cloud-gaming)

**Problem.** Some classes were under-represented (notably video conferencing), and the model
needed exposure to more diverse real traffic.

**Change.** Two additional public datasets were converted to the common schema with a
scapy-based converter (`convert_vlc_pcap.py`, no Wireshark dependency): the VLC/Valencia
dataset (Zenodo, CC-BY-4.0) and the cloud-gaming telemetry dataset (Kaggle, BSD-3).

**Reason (and an instructive early error).** In the 6-category model, folding the full VLC
set into the *supervised* label set caused a domain confound — the model learned testbed
artifacts, and accuracy regressed. The fix at that stage was to route out-of-domain apps to
self-supervised pretraining only, keeping a small targeted supervised addition (MS Teams) to
rescue the starved video-conferencing class. This decision was later superseded by the
8-traffic-type design (section 7), which trains all sources supervised.

**Result.** The targeted MS Teams addition raised video-conferencing F1 substantially in the
6-category model.

---

## 5. Notable debugging episodes

- **DBSCAN pseudo-label indexing.** Pseudo-labels were keyed by batch position rather than
  true flow index, so the contrastive term trained on misaligned labels (noise). Fixed by
  indexing on the flow id.
- **Phase-3 head collapse.** Applying both a class-balanced sampler and class weights at once
  double-corrected the imbalance and collapsed the head. Resolved by using one mechanism.
- **Parquet round-trips.** Nested list columns return object-dtype arrays on read; these must
  be explicitly stacked (`np.vstack([np.asarray(r) for r in x])`).
- **Stratified split guard.** `train_test_split(stratify=...)` requires a minimum class count;
  rare classes are routed to the train split instead.
- **Infrastructure pins.** A `websockets` minor-version regression broke uvicorn's WebSocket
  endpoint; the dependency was pinned.

---

## 6. Repository restructure and reproducibility

**Problem.** The submission rubric expects a clean `src/` layout, published artifacts, and a
clone-and-run experience.

**Change.**
- All Python packages moved under `src/` (`netjepa`, `server`, `capture`, `flows`, `model`);
  packaged with `setup.py`/`pyproject.toml` (classic `setup.py` because the build host's
  setuptools predates PEP 621).
- The trained model was published to the Hugging Face Hub (Apache-2.0): checkpoint, fitted
  k-NN, config, labels, and a model card.
- `fetch_assets.py` retrieves weights from Hugging Face and rebuilds the processed data from
  source (the primary 5G dataset's license is "Unknown", so the derived data is not
  redistributed). A `Makefile` provides `make demo`, `make reproduce`, `make train`, etc.,
  with dependency installation cached on first run.
- The web UI talks to the API at the same origin via a Vite proxy, so a remote demo only
  needs one tunneled port.

**Reason.** Licensing constraints prevent redistributing the processed data; rebuilding from
source keeps reproduction one command away while remaining within the source licenses.

**Result.** A bare clone can serve the live demo (weights auto-downloaded) and reproduce the
KPIs from source.

---

## 7. The 8-traffic-type model

**Problem.** The benchmark frames classes as traffic *types* (e.g. video streaming vs
gaming), and asks the system to adapt to emerging types such as XR. A type-level taxonomy is
more meaningful and more directly aligned with the KPI examples than a 15-app taxonomy.

**Change.** `build_traffic_dataset.py` builds a dataset of **8 common traffic types**
(audio_streaming, cloud_gaming, live_streaming, metaverse, online_gaming,
video_conferencing, video_on_demand, web_browsing) from the full Kaggle 5G + VLC + Xbox
cloud-gaming sources, **all supervised**, mapped by a `FOLDER_TO_TYPE` table. It writes
per-type CSVs (raw arrays) and the tensor parquet splits plus `labels.json`. Total: 28,892
flows.

**Reason.** Type-level classes match the KPI definition ("YouTube and Netflix are the same
class"), allow a single supervised pipeline, and remove the earlier domain-confound special
case.

**Result.** First trained version reached k-NN accuracy 0.86 (see section 9 for why this was
later found to be artificially low) and exposed a real-pcap inference problem (section 8-9).

---

## 8. Real-pcap inference: flow-construction audit and the direction fix

**Problem.** Uploading an arbitrary `.pcap` produced poor classifications. An audit was
requested to confirm the flow-construction logic is correct and identical across the Kaggle
CSV path, the VLC pcap path, and the raw-pcap inference path.

**Change.** The audit confirmed all three paths share the same `flow_builder.extract_flows`
and `features.py` code (verified by comparing the resulting feature tensors byte-for-byte).
One genuine defect was found and fixed: `_identify_client` chose the first packet's source as
the client when no SYN was present, which inverts direction on real captures grabbed
mid-stream (the first observed packet may be the server's). The fix prefers the SYN initiator,
then the private/local endpoint, then the first packet's source.

**Reason.** Clean per-app training captures start at connection setup, so the first packet is
the device; real captures do not, so direction was inverted for no-SYN, server-first flows.

**Result.** Measured on a sample, the fix changes the client for only about 3.7% of flows
(no-SYN, server-first); clean training captures are unaffected (old and new logic agree).
The fix corrects direction on real captures but, evaluated in isolation, moved test accuracy
negligibly (0.859 -> 0.860) — indicating the real-pcap problem lay elsewhere (section 9).

Two inference-side improvements were added at the same time: a packet-weighted /
confidence-filtered / dominant-class summary in `infer_pcap.py` (so a few short setup flows
cannot outvote the sustained media flow), and a `--labels` loader that fails loudly when a
labels file is missing instead of silently treating the path as a class name. A dead import
was removed and an optional unlabeled-pcap pretraining hook (`pretrain_add_pcaps.py`) added.

---

## 9. Root cause of real-pcap misclassification: per-capture host stats

**Problem.** Even after the direction fix, uploaded captures misclassified — and strikingly,
the exact Netflix capture used as `video_on_demand` training data classified as
`cloud_gaming` through the inference path, while the test parquet scored 0.86. A model that
is healthy on its test set but wrong on its own training source, via a different code path,
indicates a train/inference inconsistency.

**Investigation.** The two pcap readers (`convert_vlc_pcap` for training, `pcap_to_flows` for
inference) were shown to produce byte-identical features, ruling them out. The decisive test
was overriding the host-behaviour features at inference, which flipped the prediction wholesale
— identifying host stats as the dominant signal and the source of the inconsistency.

**Change.** `compute_src_host_stats` (`n_dst_ips`, `n_dst_ports`, `n_src_ports`,
`conn_per_sec`) was being computed **globally over all flows** in `build_traffic_dataset.py`.
A reused testbed client IP therefore had its destinations merged across every application's
capture, producing inflated values that a single uploaded pcap can never reproduce. The fix
computes host stats **per `source_file` (per capture)**, exactly as `infer_pcap`/the server
compute them over a single uploaded pcap.

**Reason.** Context features must be computed over the same population at training and serving
time, or they become an unreproducible leak. The global computation made the feature both
non-discriminative (the same values appeared on different classes) and inconsistent between
training and inference.

**Result.** After rebuild and retrain (70/15/15 split at this stage): k-NN accuracy
0.860 -> 0.977, macro-F1 0.791 -> 0.954, intra cosine 0.798 -> 0.972, inter cosine
0.103 -> -0.008, silhouette 0.374 -> 0.703. This was a genuine *inference-correctness* fix —
it made the host-stat features reproducible at serving time, so real captures then classified
correctly, including a held-out browser-QUIC YouTube capture (never in training) reading as
`video_on_demand`. This single change fixed both pcap inference and the training/inference
consistency of the feature.

(At the time this was accompanied by a "leak-free k-NN excluding same-capture neighbours"
check that scored 0.9767, cited as evidence the test-set gain was not leakage. That check was
later shown to be flawed — it did not account for the *split-level* leak from the flow-level
train/test partition, in which whole batches of same-capture siblings sit on the train side.
See the 2026-08-28 note above and section 10 for the correction. The per-capture host-stats
change remains valid as an inference fix; it is only the accompanying leakage clearance that
did not hold.)

A note on tooling: the option of replacing the in-house flow construction with an external
tool (e.g. CICFlowMeter, nfstream) was considered and rejected — CICFlowMeter emits aggregate
statistics rather than the per-packet sequences this architecture consumes, and any
pcap-only tool cannot process the Kaggle CSV training source, which would reintroduce the
train/inference inconsistency. The in-house builder is standard flow-segmentation logic and is
the only component that processes all sources identically.

---

## 10. Full-supervision split experiment (70/15/15 vs 70/70/30)

**Problem.** The 70/15/15 split uses only a 15% labeled slice for SupCon and the k-NN, which
demonstrates label efficiency but may leave accuracy on the table. The question: does using
the full training set for the supervised stages improve generalization to unseen data?

**Change.** A controlled comparison was run. Variant A (70/15/15): pretrain on 70%, SupCon and
k-NN on a disjoint 15%, evaluate on 15%. Variant B (70/70/30, "full supervision"): pretrain on
70%, SupCon and k-NN on the *same* 70%, evaluate on a held-out 30%. Both were evaluated on the
identical held-out 15% test set for a fair comparison.

**Reason.** More labeled reference data generally improves a non-parametric classifier (denser
k-NN) and the supervised contrastive separation; the held-out evaluation keeps the comparison
honest.

**Result (as originally recorded).** On the same held-out test, full supervision appeared
clearly better: k-NN 0.977 -> 0.997, macro-F1 0.954 -> 0.992, intra cosine 0.94 -> 0.98,
inter -0.01 -> -0.04, silhouette 0.70 -> 0.87, few-shot (eta=7) 0.976 -> 0.996. A "leak-free"
check (same-capture neighbours excluded) gave 0.9963 versus a naive 0.9968, and was taken as
confirmation that the gain was real generalization rather than a per-capture fingerprint. Full
supervision was adopted, `build_traffic_dataset.py` was set to produce the 70/70/30 split, and
the model was re-published with per-class F1 from 0.971 (cloud gaming) to 1.000 (metaverse).

**Correction (2026-08-28) — the 0.997 was leakage.** The conclusion above was wrong. Both
variants split train/test at the **flow level**, so flows from a single capture session were
scattered across train and test. Since the four host-behaviour features in `flow_context`
(`n_dst_ips`, `n_dst_ports`, `n_src_ports`, `conn_per_sec`) are computed per `source_file` and
are therefore *identical for every flow of a capture*, each test flow had many train siblings
carrying its exact per-capture fingerprint. The cosine k-NN was partly re-identifying the
*capture*, not classifying the *traffic type*. The "same-capture-neighbour-excluded" check did
**not** catch this: excluding a handful of nearest same-capture neighbours still leaves the
capture's fingerprint densely represented among the remaining train flows, so the excluded-kNN
score stayed near 0.996 and gave false reassurance. The lesson is that a nearest-neighbour
exclusion cannot detect leakage that is baked into a shared feature value across the whole
split — only a group-aware split can.

**Corrected outcome.** The builder was changed to split **by capture session**: a per-class
`GroupShuffleSplit` grouping on `source_file`, so all flows of a capture go entirely to train
or entirely to test (73 train / 38 test captures, 0 shared). Re-evaluating full supervision on
this leak-free capture-level 70/30 split gives the honest generalization numbers: k-NN accuracy
**0.753** (was 0.997), macro-F1 **0.680** (was 0.992), weighted-F1 **0.729**, intra cosine
**0.87** (was 0.98), inter cosine **0.13** (was -0.04), silhouette **0.475** (was 0.87),
few-shot (eta=7) **0.773** (was 0.996). Per-class F1 now ranges from **0.988** (online gaming)
down to **0.139** (video conferencing), with video-on-demand at **0.369** — the classes that
had ridden on the per-capture fingerprint (video conferencing, video on demand, web browsing)
collapse once it is removed, while packet-dynamics-driven classes (online/cloud gaming, live
streaming, metaverse) survive. The capture-level split is now the production configuration and
supersedes the 70/70/30 numbers throughout. The out-of-domain limitation is unchanged by the
split — that remains a data-diversity question. See [results.md](results.md) for the full
per-class breakdown and confusion analysis.

---

## 11. Serving robustness and Python-version portability

**Problem.** On a laptop running Python 3.13, the server failed to load with
`code() argument 13 must be str, not int`. The fitted UMAP reducer's joblib pickle contains
Python-version-specific code objects and could not be unpickled on a different Python than the
one that produced it (3.10). Because the reducer was loaded inside the main load block, this
failure took down classification entirely, even though the checkpoint and the string-metric
k-NN load fine across versions.

**Change.** The UMAP reducer was made optional in `server/app.py`: it loads in its own
try/except, and on failure the server falls back to projecting a new flow to its predicted
class's centroid in the seed cloud (with a small deterministic offset). `/api/health` reports
`projection: "umap"` or `"centroid-fallback"`.

**Reason.** The 2-D projection is a visualization aid; it must not be able to disable
classification, which is the core function and is version-portable.

**Result.** Classification works on any Python version; the live demo runs on the Python 3.13
laptop with `projection: centroid-fallback` and correct predictions. Verified that the normal
UMAP path is unchanged on the build host and the fallback path classifies identically.

---

## 12. User interface: per-capture breakdown and the Proof Lab

**Problem (breakdown).** A single capture usually contains a mix of traffic types (e.g. a
video stream plus the web traffic around it). The UI previously reduced an upload to a single
representative flow, which often disagreed with the terminal's packet-weighted dominant.

**Change.** `/api/infer` now returns a `summary` (flow counts, packet-weighted percentages,
dominant type) computed over all flows; the UI lands the comet at the packet-weighted dominant
class and renders a per-class breakdown. Every flow still lands individually in the galaxy.

**Problem (Proof Lab).** The three problem-statement KPIs (intra-class similarity, inter-class
separation, robustness under changing conditions) should be demonstrable live.

**Change.** A "Proof Lab" panel with three one-click runs on bundled real captures
(`webui/public/demo/`):
1. Intra — Netflix vs YouTube: both classify as video_on_demand; cosine of their
   representative embeddings is reported against the > 0.7 target.
2. Inter — streaming vs gaming: different classes; cosine reported against the < 0.3 target.
3. Degraded — a flow and a degraded copy: the server applies the JEPA `degrade_flow`
   augmentation (RTT change, time shift, packet loss) and re-classifies; the class is
   expected to be unchanged.

Backend support: `/api/infer` returns `summary.rep_embedding` (the L2-normalized
dominant-class mean) so the client can compute the exact cosine, and accepts a `degrade`
field; `NetJEPAClassifier.predict_flow` gained a `degrade` hook.

**Reason.** The demo captures keep the full flow population (the first 64 packets of every
flow) so their host-stat context matches the real capture and they classify correctly, while
staying small enough to commit (≤ 3.2 MB each).

**Result (measured via the live endpoint).** Intra cosine(Netflix, YouTube) = 0.995 (> 0.7);
inter cosine(Netflix, gaming) = -0.291 (< 0.3); a degraded Netflix capture (RTT + jitter +
35% packet loss) still classifies as video_on_demand.

---

## 13. Repository cleanup and documentation

**Change.** Removed backup/temporary model and data directories and test artifacts; cleaned
caches. Standardized the documentation set to a formal technical tone, removed decorative and
status emoji, and consolidated the experiment record into this log.

**Reason.** A submission repository should be clean, navigable, and consistently professional.

---

## 14. Encoder-objective alignment — making JEPA pretraining help

**Problem.** The original Phase-1 JEPA/VICReg pretraining did not actually help. A controlled
ablation showed random-init SupCon reaching accuracy **0.788**, at or above JEPA-pretrained
SupCon at **0.753** — i.e. the self-supervised stage was, at best, neutral and arguably a small
regression. This directly contradicted the premise of section 2 (that pretraining learns useful
structure the supervised stage builds on).

**Root cause.** The VICReg objective was being applied to a *fused token representation that the
downstream classifier discards*. The classifier consumes the mean-pooled temporal-encoder
output, but VICReg was optimizing a different, fused-token path — so the two objectives were not
aligned on the same representation. Worse, the covariance term on that path had collapsed
(covariance ≈ **88**), meaning the pretrained features were highly redundant, and the DBSCAN
auxiliary contrastive term was inert (it produced a single cluster and never activated). The
pretext task was optimizing a representation the classifier never sees.

**Change ("encoder-objective alignment").** Phase-1 now adds a VICReg invariance term computed
on the **mean-pooled temporal-encoder output** — the exact path the classifier uses — between
the degraded online view and the clean EMA-target view, plus a stronger covariance weight
(`vicreg_gamma` raised 1 -> 10; config `loss.align_weight = 1.0`). The invariance is thus
enforced on the representation that is actually carried forward, not on a discarded fused token.

**Reason.** A self-supervised objective can only help the downstream task if it shapes the same
representation the downstream task consumes. Aligning the VICReg invariance and covariance onto
the mean-pooled encoder output makes the pretext gradient improve exactly the features the k-NN
and SupCon stages later use; the stronger covariance weight breaks the redundancy collapse.

**Result.** Covariance dropped **88 -> 2.8** (the redundancy collapse was resolved), and the
DBSCAN auxiliary clustering now activates and contributes (it had been inert at 1 cluster). With
the alignment in place, JEPA pretraining becomes a **net gain** rather than a wash: on the same
leak-free capture-level split, accuracy rose **0.753 -> 0.807**, macro-F1 **0.680 -> 0.729**,
weighted-F1 **0.764**, intra cosine **0.87 -> 0.893**, inter cosine **0.13 -> 0.050**,
silhouette **0.475 -> 0.552**, few-shot (eta=7) **0.773 -> 0.803** — and few-shot is now stable
across eta (±0.001) where it previously varied. Per-class F1 tops out at **0.974** (online
gaming); the hard classes remain video conferencing **0.195** and video on demand **0.284** (the
latter regressed slightly), with web browsing recovering to **0.753**.

This ablation **supersedes** the earlier "JEPA doesn't help" finding (random-init SupCon 0.788 ≥
JEPA-pretrained 0.753): that result held only because the pretext objective was misaligned with
the classifier's representation. Once the objectives are aligned, pretraining helps as originally
intended in section 2. The 0.753 figure recorded in section 10 is now the "leak-free **without**
alignment" intermediate; 0.807 is the leak-free + aligned headline. The full progression is
0.997 (leaky) -> 0.753 (leak-free) -> 0.807 (leak-free + aligned).

Accuracy (**0.807**) and few-shot (**0.803**) still fall short of the ≥90% / ≥85% targets,
though few-shot now clears 0.80. The remaining gap is a data-diversity limitation on the hard
video classes rather than a pretraining-alignment one.

---

## Final state (summary)

- Model: 8 traffic types, self-supervised JEPA + traffic-type SupCon + alpha-centering, cosine
  k-NN classifier, full-supervision on a leak-free **capture-level 70/30 split**
  (`GroupShuffleSplit` on `source_file`; 111 captures, 73 train / 38 test, 0 shared; 28,892
  flows -> 19,620 train / 9,272 test).
- KPIs (held-out test, leak-free + encoder-objective alignment): accuracy **0.807**, macro-F1
  **0.729**, weighted-F1 **0.764**, intra cosine **0.89**, inter cosine **0.05**, silhouette
  **0.552**, few-shot (eta=7) **0.803**, latency **~7 ms/flow** on CPU (p95). Intra/inter cosine
  and latency clear their targets; **accuracy (0.807) and few-shot (0.803) still fall short** of
  their ≥90% / ≥85% targets, though few-shot now clears 0.80. See section 14 for the alignment
  fix that took accuracy 0.753 -> 0.807.
- Progression: 0.997 (leaky, flow-level split) -> 0.753 (leak-free capture-level split,
  section 10) -> 0.807 (leak-free + encoder-objective alignment, section 14). The 0.753 figure
  is the leak-free result **without** alignment.
- Correction: the retired 70/70/30 numbers (accuracy 0.997, macro-F1 0.992, few-shot 0.996)
  were inflated by capture-level leakage from a flow-level split; the "leak-free" same-capture
  exclusion checks (0.9767 / 0.9963) did not detect it. See section 10 and the 2026-08-28 note.
- Artifacts: published to the Hugging Face Hub; reproducible end-to-end from source.
