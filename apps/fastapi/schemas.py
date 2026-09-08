"""Pydantic schemas for the Wherehouse Geo API."""

from typing import Any, Dict, List, Literal, Optional
from pydantic import BaseModel, ConfigDict, Field


class Point(BaseModel):
    lat: float
    lon: float


class ScoreRequest(BaseModel):
    point: Point
    weights: Optional[Dict[str, float]] = None


class ConstraintResult(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    id: str
    label: str = ""
    actual: Any
    required: Any
    pass_: bool = Field(alias="pass")


class ScoreResponse(BaseModel):
    h3_index: str
    lat: float
    lon: float
    score: float
    eligible: bool
    subscores: Dict[str, float]
    constraints: List[ConstraintResult]


class BatchScoreRequest(BaseModel):
    points: List[Point]
    weights: Optional[Dict[str, float]] = None


class BatchScoreResponse(BaseModel):
    results: List[ScoreResponse]


class HotspotCell(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    h3_index: str = Field(alias="h3Index")
    eligible: bool
    subscores: Dict[str, float]


class HotspotStatCell(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    h3_index: str = Field(alias="h3Index")
    score: float
    stat: Optional[float] = None
    class_: str = Field(alias="class")


class HotspotResponse(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    dataset_id: str = Field(alias="datasetId")
    h3_resolution: int = Field(alias="h3Resolution")
    cells: List[HotspotCell]


class HotspotsRequest(BaseModel):
    method: Literal["gi_star", "dbscan", "binning"] = "gi_star"
    weights: Optional[Dict[str, float]] = None
    k: int = Field(default=2, ge=1, le=4)
    threshold: float = Field(default=70.0, ge=0.0, le=100.0)
    eps_km: float = Field(default=1.5, ge=0.1, le=10.0)
    min_samples: int = Field(default=4, ge=2, le=50)


class HotspotCluster(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    cluster_id: int = Field(alias="clusterId")
    size: int
    mean_score: float = Field(alias="meanScore")
    centroid_lat: float = Field(alias="centroidLat")
    centroid_lon: float = Field(alias="centroidLon")
    cells: List[str]


class UnderservedCell(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    h3_index: str = Field(alias="h3Index")
    demand: float
    supply: float


class HotspotsResponse(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    dataset_id: str = Field(alias="datasetId")
    h3_resolution: int = Field(alias="h3Resolution")
    method: str
    cells: List[HotspotStatCell]
    clusters: List[HotspotCluster] = []
    underserved: List[UnderservedCell] = []
