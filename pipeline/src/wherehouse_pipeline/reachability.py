from __future__ import annotations

import os
import time
from pathlib import Path
from typing import Iterable

import numpy as np
import pandas as pd
import psycopg
import requests

from .config import (
    PIPELINE_DIR,
    REACHABILITY_CHECKPOINT_DIR,
    REACHABILITY_PATH,
)
from .validation import Check


MODE_BANDS: dict[str, tuple[int, ...]] = {
    "car": (10, 20, 30),
    "foot": (10, 20),
}
DEFAULT_OSRM_URLS = {
    "car": "http://127.0.0.1:5000",
    "foot": "http://127.0.0.1:5001",
}
REACH_COLUMNS = (
    "dataset_id",
    "source_h3_index",
    "mode",
    "band_minutes",
    "destination_h3_indexes",
    "destination_count",
    "catchment_population",
)


def _database_url() -> str:
    value = os.getenv("DATABASE_URL", "").strip()
    if not value:
        raise RuntimeError("DATABASE_URL is required for reachability work")
    return value


def read_active_cells(database_url: str | None = None) -> tuple[str, pd.DataFrame]:
    """Read the exact active Neon grid used by the scoring API."""
    with psycopg.connect(database_url or _database_url()) as connection:
        rows = connection.execute(
            """
            SELECT active.dataset_id::text, fact.h3_index, fact.centroid_lat,
                   fact.centroid_lon, fact.population
            FROM geo_active_dataset AS active
            JOIN geo_dataset AS dataset ON dataset.id = active.dataset_id
            JOIN h3_cell_fact AS fact ON fact.dataset_id = active.dataset_id
            WHERE active.singleton = true AND dataset.status = 'active'
            ORDER BY fact.h3_index
            """
        ).fetchall()
    if not rows:
        raise RuntimeError("The active Neon dataset has no H3 cells")
    dataset_ids = {str(row[0]) for row in rows}
    if len(dataset_ids) != 1:
        raise RuntimeError("Expected exactly one active Neon dataset")
    frame = pd.DataFrame(
        [row[1:] for row in rows],
        columns=("h3_index", "centroid_lat", "centroid_lon", "population"),
    )
    return dataset_ids.pop(), frame


def _coordinate_string(frame: pd.DataFrame) -> str:
    return ";".join(
        f"{float(row.centroid_lon):.6f},{float(row.centroid_lat):.6f}"
        for row in frame.itertuples(index=False)
    )


def request_duration_block(
    session: requests.Session,
    base_url: str,
    sources: pd.DataFrame,
    destinations: pd.DataFrame,
    timeout_seconds: float = 120.0,
) -> np.ndarray:
    """Request one source/destination duration block from OSRM."""
    combined = pd.concat([sources, destinations], ignore_index=True)
    source_indexes = ";".join(str(index) for index in range(len(sources)))
    destination_indexes = ";".join(
        str(index) for index in range(len(sources), len(combined))
    )
    url = f"{base_url.rstrip('/')}/table/v1/driving/{_coordinate_string(combined)}"
    response = session.get(
        url,
        params={
            "sources": source_indexes,
            "destinations": destination_indexes,
            "annotations": "duration",
        },
        timeout=timeout_seconds,
    )
    response.raise_for_status()
    payload = response.json()
    if payload.get("code") != "Ok":
        raise RuntimeError(
            f"OSRM table request failed: {payload.get('code')}: {payload.get('message')}"
        )
    durations = payload.get("durations")
    if not isinstance(durations, list) or len(durations) != len(sources):
        raise RuntimeError("OSRM returned an unexpected duration-matrix row count")
    if any(not isinstance(row, list) or len(row) != len(destinations) for row in durations):
        raise RuntimeError("OSRM returned an unexpected duration-matrix column count")
    return np.array(
        [[np.nan if value is None else float(value) for value in row] for row in durations],
        dtype=np.float32,
    )


def _checkpoint_path(
    dataset_id: str,
    mode: str,
    source_start: int,
    source_end: int,
    destination_start: int,
    destination_end: int,
) -> Path:
    directory = REACHABILITY_CHECKPOINT_DIR / dataset_id / mode
    directory.mkdir(parents=True, exist_ok=True)
    return directory / (
        f"s{source_start:05d}-{source_end:05d}_"
        f"d{destination_start:05d}-{destination_end:05d}.npz"
    )


def _load_checkpoint(path: Path, source_h3: np.ndarray, destination_h3: np.ndarray) -> np.ndarray:
    try:
        with np.load(path, allow_pickle=False) as checkpoint:
            if not np.array_equal(checkpoint["source_h3"], source_h3):
                raise ValueError("source cells changed")
            if not np.array_equal(checkpoint["destination_h3"], destination_h3):
                raise ValueError("destination cells changed")
            return checkpoint["durations"].astype(np.float32, copy=False)
    except (OSError, KeyError, ValueError) as error:
        raise RuntimeError(
            f"Invalid reachability checkpoint {path}; rerun with --refresh"
        ) from error


def _write_checkpoint(
    path: Path,
    durations: np.ndarray,
    source_h3: np.ndarray,
    destination_h3: np.ndarray,
) -> None:
    temporary = path.with_suffix(".tmp.npz")
    np.savez_compressed(
        temporary,
        durations=durations,
        source_h3=source_h3,
        destination_h3=destination_h3,
    )
    temporary.replace(path)


def build_duration_matrix(
    cells: pd.DataFrame,
    dataset_id: str,
    mode: str,
    base_url: str,
    *,
    source_chunk_size: int = 40,
    destination_chunk_size: int = 160,
    refresh: bool = False,
    session: requests.Session | None = None,
) -> np.ndarray:
    """Build a resumable all-to-all duration matrix for one travel mode."""
    if mode not in MODE_BANDS:
        raise ValueError(f"Unsupported travel mode: {mode}")
    if source_chunk_size < 1 or destination_chunk_size < 1:
        raise ValueError("OSRM chunk sizes must be positive")
    client = session or requests.Session()
    count = len(cells)
    matrix = np.full((count, count), np.nan, dtype=np.float32)
    h3_indexes = cells["h3_index"].astype(str).to_numpy(dtype=str)

    for source_start in range(0, count, source_chunk_size):
        source_end = min(source_start + source_chunk_size, count)
        sources = cells.iloc[source_start:source_end]
        source_h3 = h3_indexes[source_start:source_end]
        for destination_start in range(0, count, destination_chunk_size):
            destination_end = min(destination_start + destination_chunk_size, count)
            destinations = cells.iloc[destination_start:destination_end]
            destination_h3 = h3_indexes[destination_start:destination_end]
            checkpoint = _checkpoint_path(
                dataset_id,
                mode,
                source_start,
                source_end,
                destination_start,
                destination_end,
            )
            if checkpoint.exists() and not refresh:
                block = _load_checkpoint(checkpoint, source_h3, destination_h3)
            else:
                last_error: Exception | None = None
                for attempt in range(3):
                    try:
                        block = request_duration_block(client, base_url, sources, destinations)
                        break
                    except (requests.RequestException, RuntimeError) as error:
                        last_error = error
                        if attempt < 2:
                            time.sleep(2**attempt)
                else:
                    raise RuntimeError(
                        f"OSRM {mode} block {source_start}:{source_end} -> "
                        f"{destination_start}:{destination_end} failed"
                    ) from last_error
                _write_checkpoint(checkpoint, block, source_h3, destination_h3)
            expected_shape = (source_end - source_start, destination_end - destination_start)
            if block.shape != expected_shape:
                raise RuntimeError(
                    f"Checkpoint {checkpoint} has shape {block.shape}; expected {expected_shape}"
                )
            matrix[source_start:source_end, destination_start:destination_end] = block
            print(
                f"[{mode}] sources {source_start + 1}-{source_end}/{count}, "
                f"destinations {destination_start + 1}-{destination_end}/{count}"
            )
    return matrix


def reachability_rows(
    dataset_id: str,
    cells: pd.DataFrame,
    mode: str,
    durations: np.ndarray,
) -> list[dict[str, object]]:
    """Pack one duration matrix into source/mode/band reachability rows."""
    if durations.shape != (len(cells), len(cells)):
        raise ValueError("Duration matrix does not match the active H3 grid")
    h3_indexes = cells["h3_index"].astype(str).to_numpy(dtype=str)
    populations = cells["population"].fillna(0).to_numpy(dtype=np.int64)
    rows: list[dict[str, object]] = []
    for source_position, source_h3 in enumerate(h3_indexes):
        source_durations = durations[source_position]
        for band_minutes in MODE_BANDS[mode]:
            mask = np.isfinite(source_durations) & (source_durations <= band_minutes * 60)
            destinations = h3_indexes[mask].tolist()
            rows.append(
                {
                    "dataset_id": dataset_id,
                    "source_h3_index": str(source_h3),
                    "mode": mode,
                    "band_minutes": band_minutes,
                    "destination_h3_indexes": destinations,
                    "destination_count": len(destinations),
                    "catchment_population": int(populations[mask].sum()),
                }
            )
    return rows


def build_reachability(
    *,
    refresh: bool = False,
    source_chunk_size: int = 40,
    destination_chunk_size: int = 160,
) -> Path:
    """Build car and foot reachability for the active Neon dataset."""
    dataset_id, cells = read_active_cells()
    all_rows: list[dict[str, object]] = []
    with requests.Session() as session:
        for mode in MODE_BANDS:
            base_url = os.getenv(f"OSRM_{mode.upper()}_URL", DEFAULT_OSRM_URLS[mode])
            durations = build_duration_matrix(
                cells,
                dataset_id,
                mode,
                base_url,
                source_chunk_size=source_chunk_size,
                destination_chunk_size=destination_chunk_size,
                refresh=refresh,
                session=session,
            )
            all_rows.extend(reachability_rows(dataset_id, cells, mode, durations))
    output = pd.DataFrame(all_rows, columns=REACH_COLUMNS)
    REACHABILITY_PATH.parent.mkdir(parents=True, exist_ok=True)
    temporary = REACHABILITY_PATH.with_suffix(".tmp.parquet")
    output.to_parquet(temporary, index=False)
    temporary.replace(REACHABILITY_PATH)
    return REACHABILITY_PATH


def validate_reachability_frame(
    frame: pd.DataFrame,
    dataset_id: str,
    cells: pd.DataFrame,
) -> list[Check]:
    missing = sorted(set(REACH_COLUMNS) - set(frame.columns))
    checks = [Check("reach_required_columns", not missing, f"missing={missing}")]
    if missing:
        return checks

    cell_h3 = cells["h3_index"].astype(str).tolist()
    valid_h3 = set(cell_h3)
    populations = dict(zip(cell_h3, cells["population"].fillna(0).astype(int)))
    keys = ["dataset_id", "source_h3_index", "mode", "band_minutes"]
    checks.append(
        Check(
            "reach_dataset",
            set(frame["dataset_id"].astype(str)) == {dataset_id},
            f"expected={dataset_id}",
        )
    )
    duplicate_count = int(frame.duplicated(keys).sum())
    checks.append(Check("reach_unique_keys", duplicate_count == 0, f"duplicates={duplicate_count}"))
    checks.append(
        Check(
            "reach_modes",
            set(frame["mode"]) == set(MODE_BANDS),
            f"modes={sorted(set(frame['mode']))}",
        )
    )
    expected_rows = len(cells) * sum(len(bands) for bands in MODE_BANDS.values())
    checks.append(Check("reach_row_count", len(frame) == expected_rows, f"rows={len(frame)}"))

    invalid_destinations = 0
    duplicate_destinations = 0
    incorrect_counts = 0
    incorrect_population = 0
    missing_sources = 0
    nesting_errors = 0
    for (source_h3, mode), group in frame.groupby(["source_h3_index", "mode"]):
        previous: set[str] = set()
        expected_bands = MODE_BANDS.get(str(mode), ())
        actual_bands = tuple(sorted(int(value) for value in group["band_minutes"]))
        if actual_bands != expected_bands:
            nesting_errors += 1
        for row in group.sort_values("band_minutes").itertuples(index=False):
            destinations = [str(value) for value in row.destination_h3_indexes]
            destination_set = set(destinations)
            invalid_destinations += len(destination_set - valid_h3)
            duplicate_destinations += len(destinations) - len(destination_set)
            incorrect_counts += int(int(row.destination_count) != len(destinations))
            expected_population = sum(populations.get(cell, 0) for cell in destination_set)
            incorrect_population += int(int(row.catchment_population) != expected_population)
            missing_sources += int(str(source_h3) not in destination_set)
            nesting_errors += int(not previous.issubset(destination_set))
            previous = destination_set
    checks.extend(
        [
            Check(
                "reach_source_coverage",
                set(frame["source_h3_index"].astype(str)) == valid_h3,
                f"sources={frame['source_h3_index'].nunique()}, expected={len(valid_h3)}",
            ),
            Check(
                "reach_destinations",
                invalid_destinations == 0,
                f"invalid={invalid_destinations}",
            ),
            Check(
                "reach_destination_uniqueness",
                duplicate_destinations == 0,
                f"duplicates={duplicate_destinations}",
            ),
            Check("reach_destination_counts", incorrect_counts == 0, f"invalid={incorrect_counts}"),
            Check("reach_population", incorrect_population == 0, f"invalid={incorrect_population}"),
            Check("reach_source_included", missing_sources == 0, f"missing={missing_sources}"),
            Check("reach_nested_bands", nesting_errors == 0, f"invalid={nesting_errors}"),
        ]
    )
    return checks


def validate_reachability(path: Path = REACHABILITY_PATH) -> list[Check]:
    if not path.exists():
        return [Check("reach_output_exists", False, f"missing={path}")]
    dataset_id, cells = read_active_cells()
    return validate_reachability_frame(pd.read_parquet(path), dataset_id, cells)


def require_valid_reachability(path: Path = REACHABILITY_PATH) -> list[Check]:
    checks = validate_reachability(path)
    failed = [check for check in checks if not check.passed]
    if failed:
        details = "; ".join(f"{check.name}: {check.detail}" for check in failed)
        raise RuntimeError(f"Reachability validation failed; Neon was not changed. {details}")
    return checks


def load_reachability(path: Path = REACHABILITY_PATH) -> tuple[str, int]:
    """Replace reachability rows for the still-active dataset atomically."""
    require_valid_reachability(path)
    frame = pd.read_parquet(path)
    dataset_id = str(frame["dataset_id"].iloc[0])
    database_url = _database_url()
    with psycopg.connect(database_url) as connection:
        connection.execute("SELECT pg_advisory_xact_lock(82460318)")
        for migration in sorted((PIPELINE_DIR / "sql").glob("*.sql")):
            connection.execute(migration.read_text(encoding="utf-8"))
        active = connection.execute(
            "SELECT dataset_id::text FROM geo_active_dataset WHERE singleton = true"
        ).fetchone()
        if active is None or str(active[0]) != dataset_id:
            raise RuntimeError(
                "The active Neon dataset changed after reachability was built; rebuild it"
            )
        connection.execute("DELETE FROM cell_reach WHERE dataset_id = %s", (dataset_id,))
        rows: Iterable[tuple[object, ...]] = (
            (
                dataset_id,
                str(row.source_h3_index),
                str(row.mode),
                int(row.band_minutes),
                [str(value) for value in row.destination_h3_indexes],
                int(row.destination_count),
                int(row.catchment_population),
            )
            for row in frame.itertuples(index=False)
        )
        with connection.cursor() as cursor:
            cursor.executemany(
                """
                INSERT INTO cell_reach (
                    dataset_id, source_h3_index, mode, band_minutes,
                    destination_h3_indexes, destination_count, catchment_population
                ) VALUES (%s, %s, %s, %s, %s, %s, %s)
                """,
                rows,
            )
        stored = connection.execute(
            "SELECT count(*) FROM cell_reach WHERE dataset_id = %s", (dataset_id,)
        ).fetchone()[0]
        if stored != len(frame):
            raise RuntimeError(f"Reachability load expected {len(frame)} rows, found {stored}")
    return dataset_id, int(stored)
