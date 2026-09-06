from pathlib import Path
import pandas as pd

BASE_DIR = Path(__file__).resolve().parent
DEFAULT_CSV_PATH = BASE_DIR / "project.csv"

_df = None

def load_data(csv_path: str | Path = DEFAULT_CSV_PATH):
    global _df
    if _df is None:
        _df = pd.read_csv(csv_path)
        # (optional) pre-compute everything once here if you want
    return _df

def get_df():
    if _df is None:
        raise RuntimeError("Data not loaded. Call load_data() first.")
    return _df
