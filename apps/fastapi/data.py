from pathlib import Path
import pandas as pd

_df = None

def load_data(csv_path: str = "austin_warehouse_sites_h3 (1) (1).csv"):
    global _df
    if _df is None:
        _df = pd.read_csv(csv_path)
        # (optional) pre-compute everything once here if you want
    return _df

def get_df():
    if _df is None:
        raise RuntimeError("Data not loaded. Call load_data() first.")
    return _df