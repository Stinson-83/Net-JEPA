# Results

All numbers are on the **held-out test split** of the final 8-class checkpoint
(`checkpoints/traffic8/phase3/final.pt`, 8 common traffic types). The model uses a
**full-supervision, capture-level 70/30 split**: it self-pretrains on the ~70% train set and is
supervised (SupCon + k-NN) on that **same** train set (`downstream_train == pretrain`); the
held-out **~30%** is for evaluation only.

> **Two methodology changes shape these numbers.**
> **(1) Leak-free split (2026-08-28).** Earlier results (Accuracy **99.7%**) came from a
> **flow-level** random split. Because host-behaviour features (`n_dst_ips`, `n_dst_ports`,
> `n_src_ports`, `conn_per_sec`) are computed **per capture** (`source_file`), every flow of a
> capture shares an identical fingerprint, and a flow-level split let the k-NN match test flows
> to same-capture train flows. The builder now splits **by capture session**
> (`GroupShuffleSplit` on `source_file`), so no capture spans train and test.
> **(2) Encoder-aligned JEPA pretraining (2026-09-04).** The original Phase-1 objective
> regularised a fused token representation the classifier discards, so pretraining did not help
> (and its VICReg covariance collapsed, `cov≈88`). Phase-1 now adds a VICReg **invariance term on
> the mean-pooled encoder output** — the exact `temporal_encoder → pool` path the classifier uses —
> and a stronger covariance weight (`vicreg_gamma 1→10`). This decorrelates the space (`cov 88→2.8`),
> makes the DBSCAN auxiliary clustering activate, and turns JEPA pretraining into a **net positive**.

## Headline KPIs (leak-free, capture-level split)

| Benchmark KPI | Target | Achieved | (Leaky flow-split, retired) |
|---|---|---|---|
| Intra-class cosine | > 0.7 | **0.89** | 0.98 |
| Inter-class cosine | < 0.3 | **0.05** | −0.04 |
| Accuracy | ≥ 90% | **80.7%** | ~~99.7%~~ |
| Macro-F1 | — | **0.729** | ~~0.992~~ |
| Weighted-F1 | — | **0.764** | — |
| Generalization (few-shot, η=7) | ≥ 85% | **80.3%** | ~~99.6%~~ |
| Real-time latency / flow | < 100 ms | **~7 ms** CPU (p95) | 3.5 ms |

silhouette **0.552** · 8 traffic types · 128-D embedding · 28,892 flows (**19,620 train** /
**9,272 test**), split across **111 capture sessions** (73 train / 38 test, **0 shared**).

Intra/inter cosine and latency clear their targets; accuracy (80.7%) and few-shot (80.3%) are
below the 90%/85% targets but well up from the leak-free baseline once JEPA pretraining is fixed.

## Per-class F1 (held-out test, 9,272 flows)

| Traffic type | F1 | precision | recall | support |
|---|---|---|---|---|
| Online gaming | **0.974** | 0.952 | 0.997 | 2000 |
| Cloud gaming | **0.946** | 0.935 | 0.957 | 211 |
| Metaverse / XR | **0.925** | 0.864 | 0.995 | 1973 |
| Audio streaming | **0.907** | 0.835 | 0.992 | 658 |
| Live streaming | **0.849** | 0.836 | 0.861 | 830 |
| Web browsing | **0.753** | 0.624 | 0.949 | 1733 |
| Video on demand | **0.284** | 0.842 | 0.171 | 1627 |
| Video conferencing | **0.195** | 0.364 | 0.133 | 240 |

Few-shot k-NN by labelled shots per class: η=1 **0.808**, η=3 **0.805**, η=5 **0.803**,
η=7 **0.803**, η=10 **0.803** (mean over 10 repeats) — now clearing the 0.80 operational bar and
notably more stable than the base model (±0.001 at η=10 vs ±0.03).

## What the numbers show

- **Robust (F1 ≥ 0.85):** online gaming, cloud gaming, metaverse, audio streaming, live streaming
  — their packet-level dynamics (sizes / IATs / directions) carry a strong class signal that
  survives the capture-level split, and the aligned pretraining lifts several of them (cloud
  gaming 0.82→0.95, audio 0.78→0.91, metaverse 0.85→0.93).
- **Fragile (F1 ≤ 0.75):** web browsing (0.75), and especially video on demand (0.28) and video
  conferencing (0.20). These share the same VLC capture harness (`VLC_Teams`, `VLC_Web`,
  `VLC_Netflix`, `VLC_Prime`); once the per-capture host stats can't be used as a shortcut, their
  packet dynamics are too similar to separate. Video on demand keeps **high precision (0.84) but
  low recall (0.17)** — it commits rarely but usually correctly. These classes are the standing
  ceiling and the main target for future work.

### Progression (retired → leak-free base → aligned headline)

| Metric | Leaky flow split (retired) | Leak-free base JEPA | **Leak-free + aligned JEPA (headline)** |
|---|---|---|---|
| kNN accuracy | ~~0.997~~ | 0.753 | **0.807** |
| macro-F1 | ~~0.992~~ | 0.680 | **0.729** |
| weighted-F1 | — | 0.729 | **0.764** |
| intra cosine | ~~0.983~~ | 0.868 | **0.893** |
| inter cosine | ~~−0.040~~ | 0.130 | **0.050** |
| silhouette | ~~0.872~~ | 0.475 | **0.552** |
| few-shot η=7 | ~~0.996~~ | 0.773 | **0.803** |

The retired column measured re-identification of already-seen captures; the current column
measures classification of traffic from **unseen captures** — the metric that matters for
deployment. See [experiments.md](experiments.md) for the full ablation study.

## Ablation highlights (held-out test)

| Change from the full model | accuracy | macro-F1 |
|---|---|---|
| **Full model (aligned JEPA + SupCon + α-center, ours)** | **0.807** | **0.729** |
| − encoder-objective alignment (original JEPA) | 0.753 | 0.680 |
| − Phase-1 pretraining (random init → SupCon) | 0.788 | 0.709 |
| − α-centering † | 0.726 | 0.670 |
| global (not per-capture) host stats † | 0.709 | 0.668 |

α-centering is what meets the inter-class cosine KPI (0.05 with, 0.56 without); per-capture host
stats beat global by 4.4 pts; SupCon makes the read-out choice irrelevant (k-NN 0.807 ≈ LogReg
0.803 ≈ MLP 0.809); and k is insensitive (0.806–0.807 over k∈{1,3,5,10,15}, so k=5).
(† measured on the pre-alignment encoder configuration.)

### Robustness across seeds

Repeating the aligned-vs-random comparison over **three training seeds** (dataset split held fixed):

| Config | seed 42 | seed 1 | seed 2 | mean ± std |
|---|---|---|---|---|
| **Aligned JEPA (ours)** | 0.807 | 0.799 | 0.802 | **0.803 ± 0.004** |
| Random init (no pretraining) | 0.788 | 0.745 | 0.713 | 0.749 ± 0.038 |

The aligned model wins at **every** seed (+0.019 / +0.054 / +0.089) and its run-to-run variance is
~10× smaller — so predictive pretraining both raises accuracy and stabilizes training. The released
checkpoint (0.807, seed 42) is within 0.004 of the 3-seed mean, i.e. representative, not cherry-picked.
(Seeds are set via the `NETJEPA_SEED` env var; the dataset split is unchanged so the test set is identical.)

## Real-pcap inference

> ⚠️ **Pending re-verification.** The end-to-end `infer_pcap.py` numbers previously published here
> were measured on the retired (leaky) checkpoint and have not been re-run against the current
> model, so they are omitted until re-measured — especially for video-on-demand / video-conferencing,
> whose recall is low under the capture-level split.

## Efficiency

- **~7 ms / flow on CPU** (p95; p50 ~3.1 ms, p99 ~13 ms). No GPU required to serve. The alignment
  tweak affects training only — the inference graph is unchanged.
- Model is small (~1.76 M parameters); the live server holds the whole pipeline in memory.

## Reproducing these numbers & plots

```bash
# 1. Rebuild the capture-level, leak-free dataset from raw captures
python -m netjepa.scripts.build_traffic_dataset \
  --raw_dir <5G_Traffic_Datasets> --csv_out data/traffic_csvs --parquet_out data/processed_traffic
# 2-4. Train phase1 -> phase2b -> phase3 (see the Makefile `train` target).
#      traffic.yaml sets align_weight=1.0 and vicreg_gamma=10 so Phase-1 reproduces the headline.
# 5. Evaluate on the held-out test split
python -m netjepa.scripts.evaluate --config src/netjepa/configs/traffic.yaml \
    --checkpoint checkpoints/traffic8/phase3/final.pt --device cuda
```

The evaluation prints the KPI summary and writes diagnostic plots (a confusion matrix and the
intra/inter cosine-similarity distributions) to `eval_results/`.

## Future work

- Close the gap on the fragile classes (video conferencing, video on demand, web browsing) — more
  diverse captures per class and packet-level features that separate the VLC-harness classes.
- Per-app (finer-grained) heads on top of the 8-type category embedding.
- Domain-diverse pretraining (e.g. CESNET-QUIC22) to harden out-of-domain captures.
