import pandas as pd
from pathlib import Path

PROTOCOL_MAP = {
    'TCP': 0, 'TLSv1.2': 0, 'TLSv1.3': 0, 'TLS': 0,
    'UDP': 1,
    'QUIC': 2,
}

_DT_FORMAT = '%Y-%m-%d %H:%M:%S.%f'

# Max rows per CSV — 500k rows yields ~800 flows from the largest files.
_MAX_ROWS = 500_000


def _to_float_time(series: pd.Series) -> pd.Series:
    """Convert Time column to float seconds relative to first packet."""
    if pd.api.types.is_float_dtype(series) or pd.api.types.is_numeric_dtype(series):
        s = series.astype('float64')
        return s - s.iloc[0]
    try:
        dt = pd.to_datetime(series, format=_DT_FORMAT)
        return (dt - dt.iloc[0]).dt.total_seconds()
    except Exception:
        try:
            dt = pd.to_datetime(series, format='mixed', dayfirst=False)
            return (dt - dt.iloc[0]).dt.total_seconds()
        except Exception:
            return pd.to_numeric(series, errors='coerce').fillna(0.0)


def _parse_info_vectorized(info: pd.Series) -> pd.DataFrame:
    """Vectorized Info column parsing — ~10× faster than row-wise apply."""
    s = info.fillna('')

    # Ports: first occurrence of "digits > digits"
    ports = s.str.extract(r'(\d+)\s*>\s*(\d+)', expand=True)
    src_port = pd.to_numeric(ports[0], errors='coerce').fillna(0).astype(int)
    dst_port = pd.to_numeric(ports[1], errors='coerce').fillna(0).astype(int)

    # Flag block: extract content of [ ... ] brackets
    flag_block = s.str.extract(r'\[([A-Z,\s]+)\]', expand=False).fillna('')

    is_syn     = flag_block.str.contains(r'SYN',  regex=False) & \
                 ~flag_block.str.contains(r'ACK',  regex=False)
    is_ack     = flag_block.str.contains(r'ACK',  regex=False) & \
                 ~flag_block.str.contains(r'SYN',  regex=False)
    is_syn_ack = flag_block.str.contains(r'SYN',  regex=False) & \
                  flag_block.str.contains(r'ACK',  regex=False)
    is_fin     = flag_block.str.contains(r'FIN',  regex=False)
    is_rst     = flag_block.str.contains(r'RST',  regex=False)

    is_client_hello = s.str.contains('Client Hello', regex=False)
    is_server_hello = s.str.contains('Server Hello', regex=False)

    return pd.DataFrame({
        'src_port':        src_port,
        'dst_port':        dst_port,
        'is_syn':          is_syn,
        'is_ack':          is_ack,
        'is_syn_ack':      is_syn_ack,
        'is_fin':          is_fin,
        'is_rst':          is_rst,
        'is_client_hello': is_client_hello,
        'is_server_hello': is_server_hello,
    })


def _protocol_id(proto: pd.Series) -> pd.Series:
    return proto.map(lambda p: PROTOCOL_MAP.get(str(p).strip(), 3))


def parse_csv(csv_path: Path, app_label: str, category_label: str,
              max_rows: int = _MAX_ROWS) -> pd.DataFrame:
    df = pd.read_csv(csv_path, nrows=max_rows, low_memory=False,
                     dtype={'Length': 'Int64'})
    df = df.rename(columns={'No.': 'no', 'Time': 'time', 'Source': 'src_ip',
                             'Destination': 'dst_ip', 'Protocol': 'protocol',
                             'Length': 'length', 'Info': 'info'})

    df['time']   = _to_float_time(df['time'])
    df['length'] = pd.to_numeric(df['length'], errors='coerce').fillna(0).astype(int)

    parsed = _parse_info_vectorized(df['info'])
    df = pd.concat([df.drop(columns=['info'], errors='ignore'), parsed], axis=1)

    df['protocol_id']    = _protocol_id(df['protocol'])
    df['app_label']      = app_label
    df['category_label'] = category_label

    keep = ['time', 'src_ip', 'dst_ip', 'src_port', 'dst_port',
            'protocol_id', 'length', 'is_syn', 'is_ack', 'is_fin',
            'is_rst', 'is_syn_ack', 'is_client_hello', 'is_server_hello',
            'app_label', 'category_label']
    df = df[keep].sort_values('time').reset_index(drop=True)
    return df
