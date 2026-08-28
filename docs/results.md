# Results

All numbers are on the **held-out test split** of the final 8-class checkpoint
(`checkpoints/traffic8/phase3/final.pt`, 8 common traffic types). The model uses a
**full-supervision, capture-level 70/30 split**: it self-pretrains on the ~70% train set and is
supervised (SupCon + k-NN) on that **same** train set (`downstream_train == pretrain`); the
held-out **~30%** is for evaluation only.

> **Leakage fix (2026-08-28).** Earlier versions of these results (Accuracy **99.7%**, Macro-F1
> **0.992**) were produced by a **flow-level** random split and were inflated by data leakage.
> Because the host-behaviour features (`n_dst_ips`, `n_dst_ports`, `n_src_ports`,
> `conn_per_sec` in `flow_context`) are computed **per capture** (`source_file`), every flow
> from one capture shares an identical 4-value fingerprint. A random flow-level split put flows
> from the *same capture* into both train and test, so the k-NN could match a test flow to its
> train siblings on that shared fingerprint — i.e. it was partly recognising the *capture*, not
> the *traffic type*. The dataset builder now splits **by capture session**
> (`GroupShuffleSplit` per class, grouping on `source_file`), so all flows from a capture go
> **entirely** to train or **entirely** to test — never both. The numbers below are the honest,
> leak-free generalization metrics.

## Headline KPIs (leak-free, capture-level split)

| Benchmark KPI | Target | Achieved | (Leaky flow-split, retired) |
|---|---|---|---|
| Intra-class cosine | > 0.7 | **0.87** | 0.98 |
| Inter-class cosine | < 0.3 | **0.13** | −0.04 |
| Accuracy | ≥ 90% | **75.3%** | ~~99.7%~~ |
| Macro-F1 | — | **0.680** | ~~0.992~~ |
| Weighted-F1 | — | **0.729** | — |
| Generalization (few-shot, η=7) | ≥ 85% | **77.3%** | ~~99.6%~~ |
| Real-time latency / flow | < 100 ms | **6.5 ms** CPU (p95) | 3.5 ms |

silhouette **0.475** · 8 traffic types · 128-D embedding · 28,892 flows (**19,620 train** /
**9,272 test**), split across **111 capture sessions** (73 train / 38 test, **0 shared**).

Two KPIs (intra/inter cosine, latency) still clear their targets; **accuracy and few-shot no
longer do** once capture-level leakage is removed — the true task is substantially harder than
the retired numbers implied.

## Per-class F1 (held-out test, 9,272 flows)

| Traffic type | F1 | precision | recall | support |
|---|---|---|---|---|
| Online gaming | **0.988** | 0.978 | 0.998 | 2000 |
| Live streaming | **0.891** | 0.923 | 0.861 | 830 |
| Metaverse / XR | **0.845** | 0.733 | 0.996 | 1973 |
| Cloud gaming | **0.819** | 0.711 | 0.967 | 211 |
| Audio streaming | **0.779** | 0.801 | 0.758 | 658 |
| Web browsing | **0.609** | 0.549 | 0.684 | 1733 |
| Video on demand | **0.369** | 0.823 | 0.238 | 1627 |
| Video conferencing | **0.139** | 0.140 | 0.138 | 240 |

Few-shot k-NN by labelled shots per class: η=1 **0.756**, η=3 **0.747**, η=5 **0.775**,
η=7 **0.773**, η=10 **0.769** (mean over 10 repeats).

## What the leak-free split reveals

Removing the capture fingerprint separates classes that **generalize** from classes that were
**riding on the leak**:

- **Robust (F1 ≥ 0.82):** online gaming, live streaming, metaverse, cloud gaming — their
  packet-level dynamics (sizes / IATs / directions) carry the class signal, so they survive the
  stricter split.
- **Fragile (F1 ≤ 0.61):** web browsing, video on demand, and especially video conferencing
  collapse. The confusion matrix shows video conferencing is almost entirely misread as web
  browsing (206 / 240), and video-on-demand splits into metaverse / web / audio. Several of
  these come from the same VLC capture harness (`VLC_Teams`, `VLC_Web`, `VLC_Netflix`,
  `VLC_Prime`), so once the model can no longer key on the per-capture host stats, their packet
  dynamics are too similar to tell apart. Video on demand keeps **high precision (0.82) but low
  recall (0.24)** — when it commits it is usually right, but it abstains toward other classes.

### Honest comparison

| Metric | Leaky flow-level split (retired) | **Leak-free capture-level split (current)** |
|---|---|---|
| kNN accuracy | ~~0.997~~ | **0.753** |
| macro-F1 | ~~0.992~~ | **0.680** |
| weighted-F1 | — | **0.729** |
| intra cosine | ~~0.983~~ | **0.868** |
| inter cosine | ~~−0.040~~ | **0.130** |
| silhouette | ~~0.872~~ | **0.475** |
| few-shot η=7 | ~~0.996~~ | **0.773** |

The retired column measured how well the model could re-identify a capture it had already seen
during training; the current column measures whether it can classify traffic from **captures it
has never seen** — the metric that actually matters for deployment.

## Embedding separation (the cosine result)

Cosine similarity of flow pairs: different-class pairs sit near **0.13** and same-class pairs
near **0.87**, a clear but no longer near-orthogonal gap (the retired leaky run reported
0.98 / −0.04). This separation still defines the classifier; the cosine k-NN reads it directly.
It is produced by:

1. **Traffic-type SupCon** on the L2-normalised embedding (separates directions).
2. **α-centering** to remove the anisotropic common-mode (keeps absolute inter-cosine < 0.3).
3. **Per-capture, inference-consistent features** so the geometry the model learns is the
   geometry it sees at serving time.

## Real-pcap inference

> ⚠️ **Pending re-verification.** The end-to-end `infer_pcap.py` numbers previously published
> here were measured on the **retired (leaky) checkpoint** and have **not** been re-run against
> the leak-free model, so they are omitted until re-measured. Given that video-on-demand and
> video-conferencing recall dropped sharply under the capture-level split, real-pcap behaviour
> for those classes in particular must be re-checked before any inference claims are restored.

## Efficiency

- **6.5 ms / flow on CPU** (p95; p50 ~3.3 ms, p99 ~10 ms). No GPU required to serve.
- Model is small (~1.76 M parameters); the live server holds the whole pipeline in memory.

## Reproducing these numbers & plots

```bash
# 1. Rebuild the capture-level, leak-free dataset from raw captures
python -m netjepa.scripts.build_traffic_dataset \
  --raw_dir <5G_Traffic_Datasets> --csv_out data/traffic_csvs --parquet_out data/processed_traffic
# 2-4. Train phase1 -> phase2b -> phase3  (see the Makefile `train` target)
# 5. Evaluate on the held-out test split
python -m netjepa.scripts.evaluate --config src/netjepa/configs/traffic.yaml \
    --checkpoint checkpoints/traffic8/phase3/final.pt --device cuda
```

The evaluation prints the KPI summary and writes diagnostic plots (a confusion matrix and the
intra/inter cosine-similarity distributions) to `eval_results/`.

> **Note on `make reproduce-local` / `--from-csvs`.** The committed feature CSVs now carry a
> `source_file` column and a leak-free `split` column, so rebuilding the parquet from them
> reproduces the capture-level partition. (Capture-level *re-splitting* still requires the raw
> captures, since a group split needs `source_file`; `--from-csvs` honours the split already
> recorded in the CSVs.)

## Future work

- Close the gap on the fragile classes (video conferencing, video on demand, web browsing),
  which the leak-free split exposes as the real challenge — more/diverse captures per class and
  packet-level features that separate the VLC-harness classes.
- Per-app (finer-grained) heads on top of the 8-type category embedding.
- Domain-diverse pretraining (e.g. CESNET-QUIC22) to harden out-of-domain captures.
- Conditional domain adaptation (CDAN/MDD) for cross-deployment transfer.
