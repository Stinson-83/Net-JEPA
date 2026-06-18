# 2 · Architecture

A high-level tour. For ASCII block diagrams and every module, see [`../doc.md`](../doc.md).

## 2.1 Data → features

```
Raw capture (.pcap / Wireshark CSV)
   → parse (ports, TCP flags, TLS Client/Server Hello)
   → group into bidirectional flows  (5-tuple, 30 s idle split, ≥5 packets, ≤64 packets)
   → RTT extraction  (TCP handshake → TLS handshake → first-exchange fallback)
   → features:
        packet_sequence (64 × 9): [size/1500, log1p(IAT)/10, signed size,
                                    proto one-hot×4, rtt_norm, rtt_flag]
        flow_context (15): proto, durations, IAT stats, SYN/FIN/RST ratios,
                           pkts/s, per-host stats, packet count, RTT
        padding_mask (64,)
```

`min_packets`, `max_packets`, `flow_timeout` are all config-driven (`netjepa/configs/default.yaml`).

## 2.2 The model — a JEPA

Net-JEPA never reconstructs raw bytes. It predicts *latent representations* of hidden
flow segments — the JEPA idea — which is what lets it learn structure without labels.

- **Online branch** (sees a *degraded* copy of the flow): Temporal Transformer encoder
  (4 layers, d=128) → cross-attention fusion with the flow-context vector → adaptive
  masking (30–50 % of positions hidden) → a 3-layer predictor fills in the masked latents.
- **Target branch** (sees the *clean* flow): an **EMA copy** of the encoder
  (momentum 0.99→0.999, stop-gradient) produces the prediction targets. This is the
  anti-collapse mechanism — no negative pairs needed.
- **Loss:** **VICReg** = invariance (predicted ≈ target) + variance (don't collapse) +
  covariance (don't correlate dimensions). An optional DBSCAN pseudo-label contrastive
  term adds coarse class structure, guarded to skip when it finds <2 clusters.

## 2.3 The embedding — where the KPIs are won

The downstream embedding is the part the cosine KPI measures, so it gets special care:

1. **Attention pooling** collapses the 64 packet latents into one flow vector, concatenated
   with the raw 15-D context → 143-D.
2. **`embed_head`** MLP (143→256→128) → **L2-normalise** → a point on the unit sphere.
3. **Category SupCon** (Phase 2b) trains this embedding so same-*category* flows point
   together. Crucially supervised at the **category** level — "Youtube and Netflix" are the
   same class — because the KPI defines class that way.
4. **α-centering** (`set_centering`, α≈0.65): SupCon separates class *directions* but leaves
   them in a shared cone (high absolute cosine). Subtracting α·mean and re-normalising
   isotropises the space, dropping inter-class cosine below 0.3 while intra stays above 0.7.

Classification is a **cosine k-NN (k=5)** over the labelled embeddings — ~4.5 ms on CPU.

## 2.4 Training phases

| Phase | Data | What it does |
|---|---|---|
| **1 — Pretrain** (150 ep) | ~18k flows, **labels ignored** | Self-supervised JEPA (VICReg + masking + EMA) |
| **2b — SupCon** (120 ep) | downstream train (labelled) | Category contrastive on the kept embedding + α-centering. Init from Phase 1. |
| **3 — Heads** (50 ep) | downstream train | Freeze encoder; fit k-NN + class-weighted linear/MLP heads; save `knn.joblib` |
| *2c — DANN* (optional) | + unlabelled target | Domain-adversarial adaptation for cross-domain transfer |

(Phase 2 — an unsupervised contrastive refinement — is retained but skipped in the
recommended path; it didn't help separation.)

## 2.5 The live system

```
  .pcap upload ─► server/app.py (FastAPI)
                    PcapReplay → FlowTable → NetJEPAClassifier.predict()
                    → forward_downstream → cosine k-NN → category + confidence
                    → UMAP.transform → 2-D point appended to the growing cloud
                  every stage streamed over /ws  ──►  webui animates it live
  GET /api/cloud   reference cloud + everything inferred so far
  GET /api/metrics KPIs / per-class stats
```

The web UI ("Signal Atlas") reads a static export when the server is down and the live
server when it's up — see [features.md](features.md) and [usage.md](usage.md).

## 2.6 Repository layout

```
netjepa/        core ML package (data, model, loss, training, downstream, evaluation, scripts)
capture/        live packet capture (pcap replay)
flows/          flow grouping for the live server
model/          server-facing classifier adapter
server/         FastAPI + WebSocket backend
webui/          "Signal Atlas" React/WebGL front-end
docs/           this documentation
doc.md          deep engineering reference
experimentation.md  honest chronological research log
```
