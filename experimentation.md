# Net-JEPA Experimentation Log

End-to-end record of what was built, run, broken, and fixed — in chronological order.
Intended as a reference for writing formal documentation.

> **Note on paths.** This is a chronological log, so commands appear as they were run at
> the time (e.g. `python3 netjepa/scripts/...`). The repository was later reorganised into a
> `src/` layout — today the same scripts live at `src/netjepa/scripts/...`. See
> [`docs/usage.md`](docs/usage.md) for current, reproducible commands.

---

## 1. Preprocessing Pipeline

### What we did
Ran `python3 netjepa/scripts/preprocess_kaggle.py` to convert 75 Wireshark CSV files
from `/indian-slp/Users/ug/ZEPA/Kritik/net_data/5G_Traffic_Datasets` into Parquet splits.

---

### Problem 1 — All folders reported as not found

**Symptom:**
```
[WARN] folder not found: GeForce_Now
[WARN] folder not found: KT_GameBox
... (all 15 apps)
KeyError: 'app_label'
```

**Root cause:**
The script had a hardcoded default path `data/raw/5G_Traffic_Datasets` instead of reading
from `netjepa/configs/default.yaml`. Since the script was run from the repo root and the
real data lives at `/indian-slp/Users/ug/ZEPA/Kritik/net_data/5G_Traffic_Datasets`, every
folder lookup silently failed and no flows were extracted.

**Fix:**
Changed `preprocess_kaggle.py` to load `raw_data_dir` from `default.yaml` at import time:
```python
_CFG = Path(__file__).resolve().parents[2] / 'netjepa/configs/default.yaml'
with open(_CFG) as _f:
    _defaults = yaml.safe_load(_f)['data']
p.add_argument('--raw_dir', default=_defaults['raw_data_dir'])
```

**Insight:**
Scripts that accept CLI arguments for paths should always derive their defaults from the
canonical config file, not hardcoded strings. This prevents silent failures when the
working directory changes.

---

### Problem 2 — `Amazon_Prime` folder not found (non-fatal)

**Symptom:** `[WARN] folder not found: Amazon_Prime`

**Root cause:** The folder was manually deleted from the dataset by the user as it was not
needed. The `rglob`-based directory index correctly returned `None` for missing folders.

**Fix:** None required. The warn-and-skip behaviour is correct. `Amazon_Prime` was removed
from the expected dataset.

---

### Problem 3 — `YouTube_Live_5.csv` encoding error (non-fatal)

**Symptom:**
```
[WARN] YouTube_Live_5.csv: 'utf-8' codec can't decode byte 0x92 in position 135433
```

**Root cause:** One CSV file in the dataset has a Windows-1252 encoded byte (0x92 = right
single quotation mark) that is invalid UTF-8. This is a data quality issue in the source
file, not a code bug.

**Fix:** The `try/except` in the parsing loop catches it and skips the file. The other 4
YouTube Live CSVs processed successfully.

**Insight:** Always wrap per-file parsing in a broad exception handler when processing
third-party datasets. One corrupt file should not abort the entire pipeline.

---

### Problem 4 — Stratified split crashes with single-sample class

**Symptom:**
```
ValueError: The least populated class in y has only 1 member,
which is too few. The minimum number of groups for any class cannot be less than 2.
```

**Root cause:** The `youtube` app class had only 1 flow total (its single CSV is a large
file that hits the 500k-row cap, yielding very few complete bidirectional flows after the
10-packet minimum filter). `sklearn.train_test_split` with `stratify=` requires ≥ 2
samples per class because it must place at least one sample in each split.

**Fix:**
Added a pre-split check in `preprocess.py` that identifies classes with fewer than 2
samples and routes them entirely to the pretrain split (where labels are ignored):
```python
label_counts = Counter(labels)
rare_mask = np.array([label_counts[l] < 2 for l in labels])
rare_indices = indices[rare_mask]
normal_indices = indices[~rare_mask]
# Only stratify on normal_indices; append rare_indices to pretrain
idx_pre = np.concatenate([idx_pre_normal, rare_indices])
```

**Final split (13,987 flows):**
- pretrain: 9,792
- downstream_train: 2,097
- test: 2,098

**Insight:** Real-world datasets always have class imbalance. Stratified splitting must
be guarded with a minimum-count check. Routing rare classes to pretrain (label-free) is
better than dropping them — they still contribute to the self-supervised representation.

---

## 2. Phase 1 — Self-Supervised Pretraining (150 epochs)

### What we did
Ran `python3 netjepa/scripts/train_phase1.py --device cuda`.

---

### Problem 5 — DataLoader crashes on parquet-loaded arrays

**Symptom:**
```
ValueError: setting an array element with a sequence.
Original TypeError: only length-1 arrays can be converted to Python scalars
```
at `netjepa/data/dataset.py line 23: pkt_seq = np.array(row['packet_sequence'], dtype=np.float32)`

**Root cause:**
When pandas saves a list-of-lists column to Parquet (via PyArrow) and reads it back, the
column has dtype `object`. Each row is a numpy array of dtype `object` where each element
is itself a Python list (e.g. 64 lists of 9 floats). Calling
`np.array(object_array, dtype=float32)` fails because numpy cannot infer the shape from
an object array — it tries to treat each element as a scalar.

**Fix:**
Explicitly unpack the nested structure before converting:
```python
pkt_seq  = np.asarray([list(r) for r in row['packet_sequence']], dtype=np.float32)
flow_ctx = np.asarray(list(row['flow_context']),                  dtype=np.float32)
pad_mask = np.asarray(list(row['padding_mask']),                  dtype=bool)
```
The list comprehension forces each inner row to a plain Python list, which `np.asarray`
can then convert to a proper 2D float array.

**Insight:**
Parquet round-trips of nested list columns produce object-dtype numpy arrays on load.
Never assume `np.array(parquet_value)` will work for nested columns — always unwrap one
level explicitly.

---

### Training results
- 150 epochs, ~2.5s per epoch on GPU
- Loss trajectory: `0.79 → 0.98 → 1.30` (variance term collapses as embeddings spread out, then invariance term dominates once DBSCAN contrastive activates at epoch 20)
- Final: `loss=1.30`, `inv=4.66`, `var=0.13`, `mom=0.999`
- Checkpoint: `checkpoints/phase1/final.pt`

---

## 3. Phase 2 — Embedding Refinement (50 epochs)

### What we did
Ran `python3 netjepa/scripts/train_phase2.py --phase1_ckpt checkpoints/phase1/final.pt`.

No errors. Completed cleanly.

### Training results
- 50 epochs
- Loss held at ~1.30 with `inv≈6–7`
- Target encoder frozen; only DBSCAN contrastive active (refresh every 5 epochs)
- Checkpoint: `checkpoints/phase2/final.pt`

---

## 4. Phase 3 — Downstream Classification (50 epochs)

### What we did
Ran `python3 netjepa/scripts/train_phase3.py --phase2_ckpt checkpoints/phase2/final.pt`.

---

### Problem 6 — CUDA assertion: class index out of bounds

**Symptom:**
```
nll_loss_forward_reduce_cuda_kernel_2d: Assertion `t >= 0 && t < n_classes` failed.
RuntimeError: CUDA error: device-side assert triggered
```

The kNN step completed first (accuracy 0.8594) and `knn.joblib` was saved before the crash.

**Root cause:**
`downstream.num_classes` was set to `14` in `default.yaml`. However `APP_LABELS` has 15
entries (indices 0–14). `zoom` has label index `14`. A 14-class head has output indices
0–13, so label `14` triggers an out-of-bounds assertion in CUDA's NLL loss kernel.

The original intent was `num_classes=14` after dropping `amazon_prime`, but the labels
were never remapped — `amazon_prime` simply has no samples, while all other original
label IDs including `zoom=14` remain in the dataset.

**Fix:**
Changed `num_classes: 14 → 15` in `default.yaml` and the default argument in `phase3.py`.

**Insight:**
When removing a class from a dataset without remapping label IDs, the model's output
dimension must still cover the maximum label index, not the count of present classes.
Always validate `max(labels) < num_classes` before training any classification head.

---

### Training results (Phase 3, baseline)
| Classifier | Accuracy |
|---|---|
| k-NN (k=5, cosine) | 85.94% |
| Shallow MLP | 68.02% |
| Linear Probe | 62.68% |

Checkpoint: `checkpoints/phase3/final.pt`

---

## 5. Evaluation (Baseline)

### What we did
Ran `python3 netjepa/scripts/evaluate.py --checkpoint checkpoints/phase3/final.pt`.

---

### Problem 7 — seaborn heatmap crashes on None tick labels

**Symptom:**
```
TypeError: object of type 'NoneType' has no len()
```
inside `seaborn/matrix.py` when `xticklabels=None` is passed.

**Root cause:**
Older versions of seaborn (the version installed) do not accept `None` for `xticklabels`
— they expect a list, `True` (auto), or `False` (hidden). The evaluation script passed
`class_names` which was `None` when no names were supplied.

**Fix:**
```python
labels = class_names if class_names is not None else True
sns.heatmap(cm, annot=True, fmt='d', ax=ax,
            xticklabels=labels, yticklabels=labels)
```

**Insight:**
Always check installed library versions when using optional parameters. Using `True` as
the seaborn fallback is the safe cross-version choice.

---

### Baseline evaluation results

| Metric | Result | Target | Status |
|---|---|---|---|
| Intra-class cosine mean | 0.935 | > 0.7 | ✅ |
| kNN accuracy | 85.9% | ≥ 85% | ✅ |
| CPU latency p95 | 3.2ms | < 100ms | ✅ |
| Inter cosine < 0.3 | 0.000 | — | ❌ (inter=0.897) |
| Few-shot η=7 | 22.4% | ≥ 80% | ❌ |

**Key observation:** Intra-class cosine (0.935) and inter-class cosine (0.897) are both
high and close to each other. The embedding space is dense — flows cluster well within
classes but classes are not well-separated from each other. This is why few-shot
accuracy is low: with only 7 labelled examples per class, kNN finds the right cluster
but cannot reliably distinguish class boundaries.

---

## 6. Phase 2b — Supervised Contrastive Fine-Tuning (30 epochs)

### Motivation
The gap between intra (0.935) and inter (0.897) cosine similarity is only 0.038. The
encoder learned intra-class compactness from self-supervised pretraining but did not
learn inter-class separation because JEPA/VICReg losses are label-free.

SMOTE on raw packet-sequence features was considered but rejected — interpolating between
two network flows in the raw feature space (packet sizes, inter-arrival times) does not
produce a physically meaningful third flow.

Instead, supervised contrastive fine-tuning (SupCon; Khosla et al. 2020) was chosen
because:
- It directly maximises the inter-class margin in embedding space
- It uses the labelled downstream data (~2,097 samples) which is already available
- A very low encoder LR (1e-5) prevents destroying the self-supervised representations

### Architecture
A temporary projection head (`Linear(143→256)→BN→ReLU→Linear(256→128)`) is attached on
top of `forward_downstream`. The SupCon loss is computed in the 128-dim projected space.
The projection head is discarded after training; only the updated encoder weights are kept.

### Problem 8 — `torch.no_grad()` inside `forward_downstream` blocked gradients

**Symptom:** Training ran without errors but loss was stuck — gradients were not
flowing to the temporal encoder.

**Root cause:**
`forward_downstream` had `with torch.no_grad(): pkt_latents = self.temporal_encoder(...)`
inside it. This was originally added for Phase 3 where the encoder is frozen. During
Phase 2b, the encoder must be trainable, but the context manager silently zeroed all
gradients from the encoder path.

**Fix:**
Removed the `with torch.no_grad()` block from `forward_downstream`. Phase 3 and
evaluation already wrap their inference loops in `@torch.no_grad()` at a higher level,
so removing it from the model method is safe.

**Insight:**
Do not bake gradient-suppression into model forward methods — that is the caller's
responsibility. `torch.no_grad()` belongs in training/inference loop wrappers, not in
the model itself.

---

### Problem 9 — `save_checkpoint()` call had wrong argument count

**Symptom:**
```
TypeError: save_checkpoint() missing 1 required positional argument: 'path'
```
All 30 training epochs completed but the checkpoint was not saved.

**Root cause:**
`save_checkpoint` has signature `(model, optimizer, epoch, metrics, path)` but the call
in `phase2b.py` passed only `(model, optimizer, epoch, path)` — missing the `metrics`
dict.

**Fix:**
```python
save_checkpoint(model, optimizer, epoch, {}, Path(ckpt_dir) / 'final.pt')
```

---

### Phase 2b training results
- 30 epochs, ~16 batches/epoch (batch_size=128, drop_last=True on 2,097 samples)
- Loss: `4.43 → 4.04` (SupCon loss scale is different from VICReg — higher values are normal)
- Checkpoint: `checkpoints/phase2b/final.pt`

---

## 7. Phase 3 + Evaluation — After SupCon Fine-Tuning

Re-ran Phase 3 from `checkpoints/phase2b/final.pt` → `checkpoints/phase3b/`.
Re-ran evaluation on `checkpoints/phase3b/final.pt`.

### Comparison: baseline vs. after Phase 2b

| Metric | Baseline | After Phase 2b | Delta |
|---|---|---|---|
| kNN accuracy | 85.9% | **87.2%** | +1.3% |
| Macro F1 | 50.3% | **51.2%** | +0.9% |
| Shallow MLP | 68.0% | **73.6%** | +5.6% |
| Linear probe | 62.7% | **63.7%** | +1.0% |
| Intra cosine | 0.935 | **0.950** | +0.015 |
| Inter cosine | 0.897 | 0.915 | +0.018 |
| Silhouette | -0.137 | **-0.124** | better |
| Latency p95 | 3.2ms | 3.3ms | ~same |
| Few-shot η=7 | 22.4% | 17.7% | -4.7% |

**Observations:**
- MLP head improved by 5.6% — the most responsive to better inter-class margin
- kNN improved by 1.3% — more modest because it already performs well with the full downstream set
- Few-shot slightly worsened — intra tightened more than inter widened, so with only
  7 labelled anchors the neighbourhood is now dominated by the anchor's own class but the
  decision boundary did not improve proportionally
- Latency unchanged — fine-tuning does not affect inference architecture

---

## 8. Root Cause Analysis: Why Few-Shot Remains Low

The target of ≥ 80% at η=7 was not achieved (actual: ~22%). The fundamental constraint is
**data sparsity per class**:

| App | CSVs | Approx. flows |
|---|---|---|
| Roblox | 1 | ~100 |
| Netflix | 1 | ~150 |
| YouTube | 1 | ~130 (1 routed to pretrain) |
| Google Meet | 1 | ~150 |
| MS Teams | 2 | ~300 |

With 14 classes sharing 2,097 downstream samples (~150 per class average, but highly
uneven), the encoder cannot learn fully discriminative boundaries. Few-shot kNN at η=7
means 7 × 14 = 98 labelled anchors for the entire embedding space — too few when
inter-class cosine is 0.915.

**What would move the needle:**
1. **More data per sparse class** — additional `.pcap` captures for Roblox, Netflix, YouTube, Google Meet. Even 5 more CSVs per app would roughly double their flow count.
2. **Longer Phase 2b** — more SupCon epochs or a larger batch size would increase the number of hard negatives seen per step.
3. **Hard negative mining** — explicitly sample hard inter-class pairs (high cosine similarity across different classes) for the contrastive loss rather than random batch sampling.
4. **Label smoothing + temperature search** — the SupCon temperature (0.07) was not tuned; a higher value (0.1–0.2) gives a softer loss and can improve generalisation on small datasets.

---

## 9. Final Model State

```
checkpoints/
  phase1/final.pt       ← self-supervised pretraining (150 epochs)
  phase2/final.pt       ← embedding refinement (50 epochs, frozen target)
  phase2b/final.pt      ← supervised contrastive fine-tuning (30 epochs)
  phase3b/final.pt      ← classification heads trained on phase2b encoder
  phase3b/knn.joblib    ← fitted kNN index for live server inference
```

**Production checkpoint to use:** *(superseded — see §11.5; the current production
checkpoint is `checkpoints/phase3/final.pt` + `checkpoints/phase3/knn.joblib`)*

---

## 11. (2026-06) KPI Compliance, VLC Integration & Cross-Domain Generalization

> Sections 1–9 above predate this work; figures there (inter-class cosine
> ~0.915, `num_classes=14`, `phase3b`) are superseded by the state below.

**11.1 Meeting the cosine KPI.** The DBSCAN contrastive had a real bug
(pseudo-labels keyed by *batch position*, not by flow — training on noise);
fixing the mapping + `eps` helped but did not separate classes. The decisive
changes: (a) the model emits an L2-normalised, **category-supervised** embedding
from a kept `embed_head` (SupCon trains the space we actually measure, on the
*category* level the KPI defines — "Youtube and Netflix" are intra-class); and
(b) **α-centering** (`set_centering`, α≈0.65) removes the anisotropic common-mode
that pinned cosine high (SupCon separates directions but leaves a shared cone).
Result: intra **0.81**, inter **0.13**, accuracy **0.92**, few-shot **0.92**,
latency ~4.5 ms — all five benchmark KPIs met.

**11.2 Class imbalance + VLC fold-in.** Class-balanced SupCon + weighted-CE
heads rescued `video_conferencing` (F1 0.00 → 0.67). Folding in the VLC
(Valencia) dataset via a scapy converter (`convert_vlc_pcap.py` → Wireshark-CSV
→ `FOLDER_MAP`): **Teams** in the supervised set lifted `video_conferencing` F1
to **0.90**. Adding the other VLC apps (Netflix/Prime/YouTube/Roblox) to the
*supervised* set **regressed** it (0.90 → 0.57) via a domain confound — the model
learned VLC-testbed artifacts and confused VLC-Teams with VLC-Netflix. Fix:
`PRETRAIN_ONLY_FOLDERS` routes those apps to Phase-1 pretraining only.

**11.3 Cross-domain generalization (Kaggle → VLC).** Built a held-out harness
(`--holdout_folders` → `holdout.parquet`; `evaluate.py --test_parquet`). A
Kaggle-only model (VLC never seen, not even in pretraining):

| | in-domain (Kaggle→Kaggle) | cross-domain (Kaggle→VLC, unseen) |
|---|---|---|
| kNN accuracy | 0.918 | **0.054** |
| macro-F1 | 0.858 | 0.037 |
| silhouette | 0.50 | 0.02 |

**Finding:** the embedding does **not** transfer across capture domains —
2,687/4,280 VLC flows are classified as `live_streaming` (a category VLC doesn't
contain). Genuine domain shift, not a bug. KPI #3 ("generalize to unseen types
in *cross-validation*") is met by the in-domain few-shot (0.92); the stricter
cross-*dataset* transfer is near-zero, so the model is domain-specific. Honest
negative result — it motivates domain-diverse pretraining / domain adaptation
for real cross-deployment.

**11.4 Domain adaptation (DANN).** To try to close the cross-domain gap, added
domain-adversarial training (`model/domain.py` gradient-reversal + discriminator;
`training/phase2c.py`): continue category SupCon on labelled Kaggle while a
GRL discriminator aligns the *unlabelled* VLC distribution. Evaluated on a
held-out VLC test (1,284 flows):

| k labelled VLC / category | baseline (Kaggle-only) | DANN-adapted |
|---|---|---|
| 0 (unsupervised) | 0.050 | 0.056 |
| 5 | 0.237 | 0.111 |
| 10 | 0.266 | 0.367 |
| 20 | 0.295 | **0.388** |

**Findings:** (1) Unsupervised DANN aligns the domains (discriminator accuracy
0.65 → 0.51) but does **not** improve transfer alone — a known DANN limitation
under *label shift* (VLC covers only 3 of 6 categories: aligning p(x) doesn't
align p(category|x)). (2) **Semi-supervised** DA — DANN + a few labelled target
flows — *does* improve it (0.05 → 0.39 at k=20) and beats the baseline once
k≥10; the adversarial alignment makes the space amenable to cheap few-shot
target adaptation. VLC stays a hard target (0.39, not 0.85): full closure needs
substantial target labels, at which point it's "train on target", not adaptation.

**Production checkpoint (current):** `checkpoints/phase3/final.pt` +
`checkpoints/phase3/knn.joblib` (category-level, isotropised, VLC-pretrain-augmented),
served by `server/app.py` with `DATASET_ID=phase3b_supcon`.

**11.5 Cloud-gaming + MS-Teams fold-in (final data state).** The galaxy looked
sparse and uneven for the two rarest classes. The user ruled out both mocking
*and* capping the big classes down — so we found **real** data. (a) **Cloud
gaming:** `carloshfm/cloud-gaming-network-telemetry` (BSD-3, Xbox Cloud over 5G).
The pcaps are ~1 GB each (millions of packets) and the full Kaggle archive is
28 GB; we stream-extracted only the ~5 GB of 5G captures (`stream-unzip`) and
capped parsing at `--max_packets 600000`. Routed to **pretrain-only**
(`CG_Xbox` → game_streaming) — cross-testbed, so not in the labelled set.
(b) **Video conferencing:** more MS-Teams captures into the *supervised* set.
Net effect on the dense, ground-truth galaxy (`export_cloud.py`, capped 1500/class):

| class | galaxy points before → after | F1 before → after |
|---|---|---|
| game_streaming | 398 → **739** | 0.72 → 0.71 (density was the goal) |
| video_conferencing | 510 → **742** | 0.67 → **0.93** |

Final galaxy: **7,481** real flows. Final test metrics: accuracy **0.924**,
macro-F1 **0.897**, intra **0.81**, inter **0.138**, silhouette **0.51**.

**11.6 Front-end rebuild — "Signal Atlas".** The old static dashboard was
replaced from scratch with a React 19 + WebGL (regl) experience built for the
Samsung judges: a fly-through **galaxy of 7,481 flows** coloured by true class
(the cosine KPI made literal), **click-to-inspect** (packet heartbeat + verdict
+ k-NN neighbours), **drop-a-.pcap** live inference with every pipeline stage
streamed over `/ws`, **"simulate &lt;class&gt;"** chips as a no-network fallback,
and Model / Proof / Journey scenes. Auto-detects the server ("LIVE MODEL");
falls back to the committed static export when it's down so the demo never
hard-fails. Kiosk deep-links (`?skipintro`, `?scene=`, keys 1–4). Verified via
headless WebGL screenshots. Feature tour: `docs/features.md`. Bumps along the
way: TS6 strictness (unused locals, `verbatimModuleSyntax`, Float32Array generic
drift), snap-confined chromium couldn't write `/tmp` (used google-chrome), and
`websockets` 9.1 broke uvicorn's `/ws` (pinned ≥10).

---

## 10. Lessons Learned

| # | Lesson |
|---|---|
| 1 | Always derive script argument defaults from the config file, not hardcoded strings |
| 2 | Parquet round-trips of nested list columns return object-dtype arrays — unpack explicitly |
| 3 | Guard `train_test_split(stratify=)` with a minimum class count check before calling |
| 4 | When removing a class without remapping IDs, `num_classes` must equal `max(label)+1`, not the count of present classes |
| 5 | Do not put `torch.no_grad()` inside model forward methods — let callers own gradient context |
| 6 | Check installed library versions for optional parameter support (seaborn `xticklabels`) |
| 7 | SMOTE on raw time-series features is inappropriate — apply it in embedding space or not at all |
| 8 | Self-supervised JEPA learns intra-class compactness well; inter-class margin requires a supervised signal (SupCon or fine-tuning with labels) |
| 9 | Few-shot performance is a data quantity problem first, a model problem second |
| 10 | A cosine KPI must be measured in the space the model is *trained* to separate; SupCon separates *directions* but leaves a common-mode cone — subtract α·mean (isotropisation) to make absolute cosine reflect class structure |
| 11 | Define the cosine/accuracy class level to match the KPI's own examples (category, not app) — app-level contrast pushes same-category apps apart, fighting the target |
| 12 | More data isn't always better: out-of-domain data across multiple categories invites a domain confound — use it for self-supervised pretraining, not the supervised/labelled set |
| 13 | Distinguish in-domain cross-validation generalization (strong) from cross-*dataset* transfer (near-zero here) — report both honestly; a clean negative result on the latter is a strength, not a failure |
| 14 | When a class looks sparse, the right fix is *real* data, not mocking and not capping the majority classes down — find a permissively-licensed source and fold it in (cloud-gaming/Teams lifted density and rescued video-conf to F1 0.93) |
| 15 | Pin transitive infra deps that the framework leans on (uvicorn ⇄ `websockets` ≥10) — a silent minor-version regression broke the entire `/ws` live stream |
| 14 | Unsupervised domain adaptation (DANN) aligns marginal p(x) but not p(y\|x) under label shift — verify the discriminator is confused AND that target *accuracy* moves; here only a few labelled target samples (semi-supervised DA) actually improved transfer (0.05 → 0.39) |
