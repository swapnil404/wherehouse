from pathlib import Path
import h3
import pandas as pd

BASE_DIR = Path(__file__).resolve().parent
DEFAULT_CSV_PATH = BASE_DIR / "project.csv"

_df = None
_cell_index = None

def load_data(csv_path: str | Path = DEFAULT_CSV_PATH):
    global _df, _cell_index
    if _df is None:
        _df = pd.read_csv(csv_path)
        _cell_index = None  # rebuild on next access
        # (optional) pre-compute everything once here if you want
    return _df

def get_df():
    if _df is None:
        raise RuntimeError("Data not loaded. Call load_data() first.")
    return _df

def get_h3_resolution() -> int:
    """H3 resolution of the dataset, derived from the first row."""
    return h3.get_resolution(str(get_df()["h3_index"].iloc[0]))

def get_cell_index() -> dict:
    """Exact lookup: h3_index string -> row position. Built once."""
    global _cell_index
    if _cell_index is None:
        df = get_df()
        _cell_index = {str(h): i for i, h in enumerate(df["h3_index"].values)}
    return _cell_index
