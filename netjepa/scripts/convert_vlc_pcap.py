"""Convert the VLC (Valencia) pcapng dataset into the Wireshark-style CSVs the
Net-JEPA preprocessor expects, foldered by app so FOLDER_MAP picks them up.

The training pipeline (netjepa/data/parser.py) ingests Wireshark CSV exports
with columns `No.,Time,Source,Destination,Protocol,Length,Info`, and pulls
ports + TCP flags + TLS Client/Server Hello *out of the Info column* via regex.
VLC ships only raw pcapng, so this script reads each capture with scapy (already
a dependency — no tshark/Wireshark needed) and *synthesises* the Info field as
`sport > dport [FLAGS] Client Hello`, exactly the form parser._parse_info_vectorized
matches.

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
- Filenames are matched to apps by substring (VLC_FILE_MAP) — adjust to the
  actual VLC filenames if they differ.
- To MEASURE cross-dataset generalization (KPI #3), convert VLC into a *separate*
  out_dir and keep it out of training — train on Kaggle, test on VLC.
"""
from __future__ import annotations

import argparse
import csv
import sys
from pathlib import Path

from scapy.layers.inet import IP, TCP, UDP
from scapy.layers.inet6 import IPv6
from scapy.utils import PcapReader

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))
from netjepa.utils.logging import get_logger

_log = get_logger('scripts.convert_vlc')

# Substring in the pcapng filename → output folder name (must match a
# FOLDER_MAP key in netjepa/data/preprocess.py). Files matching none of these
# are skipped (Spotify / browsing have no Net-JEPA category).
VLC_FILE_MAP: dict[str, str] = {
    'netflix': 'VLC_Netflix',
    'prime':   'VLC_Prime',     # Amazon Prime Video → amazon_prime
    'youtube': 'VLC_YouTube',
    'teams':   'VLC_Teams',     # MS Teams → ms_teams (boosts the starved video_conf class)
    'roblox':  'VLC_Roblox',    # filed under metaverse, per Net-JEPA's taxonomy
    'xbox':    'CG_Xbox',       # Xbox Cloud Gaming (5G) → game_streaming
}

CSV_HEADER = ['No.', 'Time', 'Source', 'Destination', 'Protocol', 'Length', 'Info']


def _ip_layer(pkt):
    if IP in pkt:
        return pkt[IP].src, pkt[IP].dst
    if IPv6 in pkt:
        return pkt[IPv6].src, pkt[IPv6].dst
    return None, None


def _proto_name(pkt, sport: int, dport: int, is_tcp: bool) -> str:
    """Coarse protocol string matching parser.PROTOCOL_MAP buckets
    (TCP/TLS→0, UDP→1, QUIC→2). Only the bucket matters downstream."""
    if is_tcp:
        return 'TCP'           # TLS also maps to id 0, so TCP is sufficient
    return 'QUIC' if 443 in (sport, dport) else 'UDP'


def _tls_marker(payload: bytes) -> str:
    # TLS record: type(1)=0x16 handshake, then version(2)+len(2); byte[5] is the
    # handshake message type — 1=ClientHello, 2=ServerHello.
    if len(payload) >= 6 and payload[0] == 0x16:
        if payload[5] == 0x01:
            return ' Client Hello'
        if payload[5] == 0x02:
            return ' Server Hello'
    return ''


def _row(pkt, n: int) -> list | None:
    src, dst = _ip_layer(pkt)
    if src is None:
        return None
    if TCP in pkt:
        tp, is_tcp = pkt[TCP], True
    elif UDP in pkt:
        tp, is_tcp = pkt[UDP], False
    else:
        return None
    sport, dport = int(tp.sport), int(tp.dport)

    flags = []
    info = f'{sport} > {dport}'
    if is_tcp:
        f = tp.flags
        if 'S' in f and 'A' not in f: flags.append('SYN')
        elif 'S' in f and 'A' in f:   flags += ['SYN', 'ACK']
        elif 'A' in f:                flags.append('ACK')
        if 'F' in f: flags.append('FIN')
        if 'R' in f: flags.append('RST')
        if flags:
            info += f' [{", ".join(flags)}]'
        info += _tls_marker(bytes(tp.payload))

    return [n, f'{float(pkt.time):.6f}', src, dst,
            _proto_name(pkt, sport, dport, is_tcp), len(pkt), info]


def convert_one(pcap_path: Path, out_csv: Path, max_packets: int = 0) -> int:
    """Stream a pcapng through scapy → CSV. Returns rows written. `max_packets`>0
    caps output (huge cloud-gaming captures have millions of packets; the parser
    only reads the first 500k rows anyway)."""
    out_csv.parent.mkdir(parents=True, exist_ok=True)
    n = 0
    with PcapReader(str(pcap_path)) as reader, out_csv.open('w', newline='') as fh:
        writer = csv.writer(fh)
        writer.writerow(CSV_HEADER)
        for pkt in reader:
            row = _row(pkt, n + 1)
            if row is not None:
                writer.writerow(row)
                n += 1
                if max_packets and n >= max_packets:
                    break
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
    p.add_argument('--max_packets', type=int, default=0,
                   help='cap packets written per file (0 = unlimited); use ~600000 for '
                        'huge cloud-gaming captures')
    args = p.parse_args()

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
        try:
            rows = convert_one(pcap, out_csv, args.max_packets)
        except Exception as exc:  # noqa: BLE001
            _log.warning('failed on %s: %s', pcap.name, exc)
            continue
        per_folder[folder] = per_folder.get(folder, 0) + rows
        _log.info('%s → %s/%s  (%d packets)', pcap.name, folder, out_csv.name, rows)

    _log.info('done: %d files converted, %d skipped', len(files) - skipped, skipped)
    for folder, n in sorted(per_folder.items()):
        _log.info('  %-14s %d packets', folder, n)
    _log.info('Next: run preprocess_kaggle.py --raw_dir %s (FOLDER_MAP already '
              'includes the VLC_* folders)', out_dir)


if __name__ == '__main__':
    main()
