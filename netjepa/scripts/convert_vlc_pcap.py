"""Convert the VLC (Valencia) pcapng dataset into the Wireshark-style CSVs the
Net-JEPA preprocessor expects, foldered by app so FOLDER_MAP picks them up.

The training pipeline (netjepa/data/parser.py) ingests Wireshark CSV exports
with columns `No.,Time,Source,Destination,Protocol,Length,Info`, and pulls
ports + TCP flags + TLS Client/Server Hello *out of the Info column* via regex.
VLC ships only raw pcapng, so this script uses tshark to emit those exact
columns — and crucially *synthesises* the Info field as `sport > dport [FLAGS]
Client Hello` so parser._parse_info_vectorized matches it deterministically
(rather than relying on the running Wireshark version's Info formatting, which
may use the "→" arrow and break the `(\d+)\s*>\s*(\d+)` port regex).

Only VLC apps that map onto an existing Net-JEPA label are converted (Netflix,
Prime, YouTube, Teams, Roblox); Spotify / web-browsing have no equivalent in
the 6-category schema and are skipped. Roblox is filed under *metaverse* to
match Net-JEPA's taxonomy (VLC calls it "gaming").

Usage:
    # 1. convert (writes VLC_* folders next to the Kaggle app folders)
    python netjepa/scripts/convert_vlc_pcap.py \
        --vlc_dir /path/to/vlc_pcapng \
        --out_dir /indian-slp/Users/ug/ZEPA/Kritik/net_data/5G_Traffic_Datasets
    # 2. preprocess as usual — FOLDER_MAP now includes the VLC_* folders
    python netjepa/scripts/preprocess_kaggle.py

Notes:
- Requires `tshark` on PATH (Wireshark CLI).
- Filenames are matched to apps by substring (VLC_FILE_MAP) — adjust the map to
  the actual VLC filenames if they differ.
- To MEASURE cross-dataset generalization (KPI #3), convert VLC into a *separate*
  out_dir and keep it out of the training split — train on Kaggle, test on VLC.
"""
from __future__ import annotations

import argparse
import csv
import shutil
import subprocess
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))
from netjepa.utils.logging import get_logger

_log = get_logger('scripts.convert_vlc')

# Substring in the pcapng filename → output folder name (must match a
# FOLDER_MAP key added in netjepa/data/preprocess.py). Files matching none of
# these are skipped (Spotify / browsing have no Net-JEPA category).
VLC_FILE_MAP: dict[str, str] = {
    'netflix': 'VLC_Netflix',
    'prime':   'VLC_Prime',     # Amazon Prime Video → amazon_prime
    'youtube': 'VLC_YouTube',
    'teams':   'VLC_Teams',     # MS Teams → ms_teams (boosts the starved video_conf class)
    'roblox':  'VLC_Roblox',    # filed under metaverse, per Net-JEPA's taxonomy
}

# tshark fields, in order — keep in sync with _build_row() indices below.
TSHARK_FIELDS = [
    'frame.number', 'frame.time_epoch',
    'ip.src', 'ipv6.src', 'ip.dst', 'ipv6.dst',
    '_ws.col.Protocol', 'frame.len',
    'tcp.srcport', 'tcp.dstport', 'udp.srcport', 'udp.dstport',
    'tcp.flags.syn', 'tcp.flags.ack', 'tcp.flags.fin', 'tcp.flags.reset',
    'tls.handshake.type',
]
_SEP = '|'
CSV_HEADER = ['No.', 'Time', 'Source', 'Destination', 'Protocol', 'Length', 'Info']

_TRUE = {'1', 'true', 'True'}


def _build_row(f: list[str]) -> list[str] | None:
    """One tshark field-line → a CSV row matching parser.py's schema, or None
    to drop (non-IP / non-transport)."""
    src = f[2] or f[3]          # ip.src or ipv6.src
    dst = f[4] or f[5]
    if not src or not dst:
        return None
    sport = f[8] or f[10]       # tcp.srcport or udp.srcport
    dport = f[9] or f[11]

    flags = []
    if f[12] in _TRUE: flags.append('SYN')
    if f[13] in _TRUE: flags.append('ACK')
    if f[14] in _TRUE: flags.append('FIN')
    if f[15] in _TRUE: flags.append('RST')

    # Synthesise the Wireshark-style Info the parser regexes expect.
    info = f'{sport} > {dport}' if (sport and dport) else ''
    if flags:
        info += f' [{", ".join(flags)}]'
    hs = f[16]
    if hs == '1':
        info += ' Client Hello'
    elif hs == '2':
        info += ' Server Hello'

    return [f[0], f[1], src, dst, f[6], f[7], info.strip()]


def convert_one(pcap_path: Path, out_csv: Path, tshark: str) -> int:
    """Stream a pcapng through tshark → CSV. Returns rows written."""
    cmd = [
        tshark, '-r', str(pcap_path),
        '-Y', '(ip or ipv6) and (tcp or udp)',
        '-T', 'fields', '-E', f'separator={_SEP}', '-E', 'occurrence=f',
    ]
    for field in TSHARK_FIELDS:
        cmd += ['-e', field]

    out_csv.parent.mkdir(parents=True, exist_ok=True)
    n = 0
    with subprocess.Popen(cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
                          text=True, bufsize=1) as proc, \
            out_csv.open('w', newline='') as fh:
        writer = csv.writer(fh)
        writer.writerow(CSV_HEADER)
        assert proc.stdout is not None
        for line in proc.stdout:
            parts = line.rstrip('\n').split(_SEP)
            if len(parts) < len(TSHARK_FIELDS):
                parts += [''] * (len(TSHARK_FIELDS) - len(parts))
            row = _build_row(parts)
            if row is not None:
                writer.writerow(row)
                n += 1
        err = proc.stderr.read() if proc.stderr else ''
    if proc.returncode not in (0, None):
        _log.warning('tshark exit %s on %s: %s', proc.returncode, pcap_path.name, err[:200])
    return n


def _folder_for(name: str) -> str | None:
    low = name.lower()
    for key, folder in VLC_FILE_MAP.items():
        if key in low:
            return folder
    return None


def main() -> None:
    p = argparse.ArgumentParser(description=__doc__,
                                formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument('--vlc_dir', required=True, help='directory of VLC .pcapng/.pcap files')
    p.add_argument('--out_dir', required=True,
                   help='root to write VLC_* CSV folders into (e.g. the Kaggle raw dir, '
                        'or a separate dir for a cross-dataset test split)')
    p.add_argument('--tshark', default=shutil.which('tshark') or 'tshark')
    args = p.parse_args()

    if shutil.which(args.tshark) is None:
        _log.error('tshark not found (install Wireshark CLI). Looked for: %s', args.tshark)
        sys.exit(1)

    vlc_dir, out_dir = Path(args.vlc_dir), Path(args.out_dir)
    files = sorted([*vlc_dir.rglob('*.pcapng'), *vlc_dir.rglob('*.pcap')])
    if not files:
        _log.error('no .pcapng/.pcap files under %s', vlc_dir)
        sys.exit(1)

    per_folder: dict[str, int] = {}
    skipped = 0
    for pcap in files:
        folder = _folder_for(pcap.name)
        if folder is None:
            _log.info('skip (no app mapping): %s', pcap.name)
            skipped += 1
            continue
        out_csv = out_dir / folder / f'{pcap.stem}.csv'
        rows = convert_one(pcap, out_csv, args.tshark)
        per_folder[folder] = per_folder.get(folder, 0) + rows
        _log.info('%s → %s/%s  (%d packets)', pcap.name, folder, out_csv.name, rows)

    _log.info('done: %d files converted, %d skipped', len(files) - skipped, skipped)
    for folder, n in sorted(per_folder.items()):
        _log.info('  %-14s %d packets', folder, n)
    _log.info('Now add the VLC_* FOLDER_MAP entries (already in preprocess.py) and '
              'run preprocess_kaggle.py --raw_dir %s', out_dir)


if __name__ == '__main__':
    main()
