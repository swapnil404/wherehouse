"""Pydantic schemas for the Wherehouse Geo API."""

from typing import Annotated, Any, Dict, List, Literal, Optional

from pydantic import BaseModel, ConfigDict, Field

PresetName = Literal["warehouse", "retail", "ev"]
WeightName = Literal["demographics", "transport", "poi", "zoning", "flood", "aqi"]
WeightValue = Annotated[float, Field(ge=0, allow_inf_nan=False)]
Weights = Dict[WeightName, WeightValue]


class Point(BaseModel):
    lat: Annotated[float, Field(ge=-90, le=90, allow_inf_nan=False)]
    lon: Annotated[float, Field(ge=-180, le=180, allow_inf_nan=False)]


class ScoreRequest(BaseModel):
    point: Point
    preset: PresetName = "warehouse"
    weights: Optional[Weights] = None


class Subscores(BaseModel):
    demographics: float
    transport: float
    poi: float
    zoning: float
    flood: float
    aqi: float


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
    subscores: Subscores
    constraints: List[ConstraintResult]


class BatchScoreRequest(BaseModel):
    points: Annotated[List[Point], Field(min_length=1, max_length=5000)]
    preset: PresetName = "warehouse"
    weights: Optional[Weights] = None


class BatchScoreResponse(BaseModel):
    results: List[ScoreResponse]


class HeatmapCell(BaseModel):
    """One heatmap cell: identity + weight-independent subscores only.

    No composite score, no geometry — the frontend derives boundaries
    with h3-js and recomputes the weighted composite locally.
    """

    model_config = ConfigDict(populate_by_name=True)

    h3_index: str = Field(alias="h3Index")
    eligible: bool
    subscores: Subscores


class HeatmapResponse(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    dataset_id: str = Field(alias="datasetId")
    h3_resolution: int = Field(alias="h3Resolution")
    preset: PresetName
    cells: List[HeatmapCell]


class HotspotStatCell(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    h3_index: str = Field(alias="h3Index")
    score: float
    stat: Optional[float] = None
    class_: str = Field(alias="class")


class HotspotsRequest(BaseModel):
    method: Literal["gi_star", "dbscan", "binning"] = "gi_star"
    preset: PresetName = "warehouse"
    weights: Optional[Weights] = None
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
    preset: PresetName
    method: str
    cells: List[HotspotStatCell]
    clusters: List[HotspotCluster] = []
    underserved: List[UnderservedCell] = []
