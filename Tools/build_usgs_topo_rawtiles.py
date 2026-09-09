#!/usr/bin/env python3
"""Build a CRC-protected UNA rawtiles pack from USGS Topo raster tiles.

The output is WebMercator/XYZ, 256 px ABGR2222 tiles without compression.
USGS attribution is embedded in the pack's ATTR extension.
"""

from __future__ import annotations

import argparse
import math
import os
import shutil
import struct
import sys
import tempfile
import time
import uuid
import zlib
from io import BytesIO
from pathlib import Path
from typing import Iterable
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen

try:
    from PIL import Image
except ImportError as error:
    raise SystemExit("Pillow is required; run this with the workspace .venv Python.") from error


TILE_DIM = 256
TILE_BYTES = TILE_DIM * TILE_DIM
HEADER_BYTES = 292
INDEX_ENTRY_BYTES = 20
FORMAT_MAJOR = 1
FORMAT_MINOR = 0
ABGR2222 = 1
WEB_MERCATOR = 1
QUADTREE = 1
XYZ = 1
NO_COMPRESSION = 0
MAX_MERCATOR_LAT = 85.05112878
USGS_TILE_URLS = (
    "https://basemap.nationalmap.gov/arcgis/rest/services/USGSTopo/MapServer/tile/{z}/{y}/{x}",
    "https://basemap.nationalmap.gov/arcgis/rest/services/USGSTopo/MapServer/WMTS/tile/1.0.0/USGSTopo/default/GoogleMapsCompatible/{z}/{y}/{x}",
)
USGS_ATTRIBUTION = (
    "USGS Topo | Map services and data available from U.S. Geological Survey, "
    "National Geospatial Program."
)
USER_AGENT = "UNA-Watch-rawtiles-builder/1.0 (offline personal map pack)"


def clamp_latitude(latitude: float) -> float:
    return min(MAX_MERCATOR_LAT, max(-MAX_MERCATOR_LAT, latitude))


def lon_to_tile_x(longitude: float, zoom: int) -> int:
    n = 1 << zoom
    return min(n - 1, max(0, int((longitude + 180.0) / 360.0 * n)))


def lat_to_tile_y(latitude: float, zoom: int) -> int:
    n = 1 << zoom
    radians = math.radians(clamp_latitude(latitude))
    return min(n - 1, max(0, int((1.0 - math.asinh(math.tan(radians)) / math.pi) / 2.0 * n)))


def tile_x_to_lon(x: int, zoom: int) -> float:
    return x / (1 << zoom) * 360.0 - 180.0


def tile_y_to_lat(y: int, zoom: int) -> float:
    n = 1 << zoom
    mercator = math.pi * (1.0 - 2.0 * y / n)
    return math.degrees(math.atan(math.sinh(mercator)))


def quantize_channel(value: int) -> int:
    if value <= 42:
        return 0
    if value <= 127:
        return 1
    if value <= 212:
        return 2
    return 3


def quantize_abgr2222(image: Image.Image) -> bytes:
    """Apply rawtiles v0.6's canonical RGB888 -> ABGR2222 quantizer."""
    rgb = image.convert("RGB")
    if rgb.size != (TILE_DIM, TILE_DIM):
        rgb = rgb.resize((TILE_DIM, TILE_DIM), Image.Resampling.LANCZOS)

    source = rgb.tobytes()
    output = bytearray(TILE_BYTES)
    for pixel_index, source_index in enumerate(range(0, len(source), 3)):
        red = quantize_channel(source[source_index])
        green = quantize_channel(source[source_index + 1])
        blue = quantize_channel(source[source_index + 2])
        output[pixel_index] = (3 << 6) | (blue << 4) | (green << 2) | red
    return bytes(output)


def fetch_tile(z: int, x: int, y: int, retries: int, request_interval: float) -> bytes:
    last_error: Exception | None = None
    for attempt in range(retries):
        for template in USGS_TILE_URLS:
            try:
                request = Request(template.format(z=z, x=x, y=y),
                                  headers={"User-Agent": USER_AGENT, "Accept": "image/*"})
                with urlopen(request, timeout=10) as response:
                    payload = response.read()
                with Image.open(BytesIO(payload)) as image:
                    result = quantize_abgr2222(image)
                if request_interval > 0:
                    time.sleep(request_interval)
                return result
            except (HTTPError, URLError, OSError) as error:
                last_error = error
        if attempt + 1 < retries:
            time.sleep(2 ** attempt)
    raise RuntimeError(f"could not fetch z{z}/{x}/{y}: {last_error}")


def fetch_or_load_tile(z: int, x: int, y: int, args: argparse.Namespace,
                       cache_root: Path) -> bytes:
    cache_path = cache_root / str(z) / str(x) / f"{y}.abgr"
    try:
        if cache_path.stat().st_size == TILE_BYTES:
            return cache_path.read_bytes()
    except FileNotFoundError:
        pass

    data = fetch_tile(z, x, y, args.retries, args.request_interval)
    cache_path.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.NamedTemporaryFile(dir=cache_path.parent,
                                     prefix=cache_path.name + ".",
                                     suffix=".tmp", delete=False) as temporary:
        temporary.write(data)
        temporary.flush()
        os.fsync(temporary.fileno())
        temporary_path = Path(temporary.name)
    os.replace(temporary_path, cache_path)
    return data


def tile_ranges(center_lat: float, center_lon: float, radius_km: float,
                zoom_min: int, zoom_max: int) -> list[tuple[int, int, int, int, int]]:
    if not (-90.0 <= center_lat <= 90.0 and -180.0 <= center_lon <= 180.0):
        raise ValueError("centre must be a valid WGS84 latitude/longitude")
    if radius_km <= 0:
        raise ValueError("radius must be positive")
    if not (0 <= zoom_min <= zoom_max < 24):
        raise ValueError("zoom range must be within 0..23")

    lat_delta = radius_km / 111.32
    lon_delta = radius_km / (111.32 * max(0.01, math.cos(math.radians(center_lat))))
    north = clamp_latitude(center_lat + lat_delta)
    south = clamp_latitude(center_lat - lat_delta)
    west = max(-180.0, center_lon - lon_delta)
    east = min(180.0, center_lon + lon_delta)

    ranges: list[tuple[int, int, int, int, int]] = []
    for zoom in range(zoom_min, zoom_max + 1):
        min_x = lon_to_tile_x(west, zoom)
        max_x = lon_to_tile_x(east, zoom)
        min_y = lat_to_tile_y(north, zoom)
        max_y = lat_to_tile_y(south, zoom)
        ranges.append((zoom, min_x, max_x, min_y, max_y))
    return ranges


def iter_tiles(ranges: Iterable[tuple[int, int, int, int, int]]) -> Iterable[tuple[int, int, int]]:
    for zoom, min_x, max_x, min_y, max_y in ranges:
        for x in range(min_x, max_x + 1):
            for y in range(min_y, max_y + 1):
                yield zoom, x, y


def coverage_bbox(ranges: Iterable[tuple[int, int, int, int, int]]) -> tuple[int, int, int, int]:
    min_lon = 180.0
    min_lat = 90.0
    max_lon = -180.0
    max_lat = -90.0
    for zoom, min_x, max_x, min_y, max_y in ranges:
        min_lon = min(min_lon, tile_x_to_lon(min_x, zoom))
        max_lon = max(max_lon, tile_x_to_lon(max_x + 1, zoom))
        max_lat = max(max_lat, tile_y_to_lat(min_y, zoom))
        min_lat = min(min_lat, tile_y_to_lat(max_y + 1, zoom))
    return tuple(round(value * 1_000_000) for value in (min_lon, min_lat, max_lon, max_lat))


def rawtiles_header(pack_uuid: bytes, zoom_min: int, zoom_max: int,
                    bbox: tuple[int, int, int, int], tile_count: int,
                    extensions_offset: int, zoom_offsets: dict[int, tuple[int, int]]) -> bytes:
    header = bytearray(HEADER_BYTES)
    struct.pack_into("<4sBB2x", header, 0, b"RAWT", FORMAT_MAJOR, FORMAT_MINOR)
    header[8:24] = pack_uuid
    struct.pack_into("<BBBBHBB", header, 56,
                     ABGR2222, WEB_MERCATOR, QUADTREE, XYZ,
                     TILE_DIM, zoom_min, zoom_max)
    struct.pack_into("<iiii", header, 64, *bbox)
    struct.pack_into("<Q", header, 80, int(time.time()))
    struct.pack_into("<II", header, 88, tile_count, HEADER_BYTES)
    for zoom, (offset, count) in zoom_offsets.items():
        struct.pack_into("<II", header, 96 + zoom * 8, offset, count)
    struct.pack_into("<I", header, 288, extensions_offset)
    return bytes(header)


def attr_extension() -> bytes:
    payload = USGS_ATTRIBUTION.encode("utf-8")
    padding = (-len(payload)) % 4
    return struct.pack("<4sI", b"ATTR", len(payload)) + payload + b"\0" * padding


def build_pack(args: argparse.Namespace) -> Path:
    ranges = tile_ranges(args.center_lat, args.center_lon, args.radius_km,
                         args.zoom_min, args.zoom_max)
    tiles = list(iter_tiles(ranges))
    tile_count = len(tiles)
    if tile_count == 0:
        raise RuntimeError("coverage selected no tiles")

    output = args.output.resolve()
    if output.exists() and not args.overwrite:
        raise FileExistsError(f"refusing to overwrite {output}; pass --overwrite")
    output.parent.mkdir(parents=True, exist_ok=True)
    cache_root = (args.tile_cache or output.parent / f".{output.stem}.tiles").resolve()

    index_bytes = tile_count * INDEX_ENTRY_BYTES
    tile_blob_start = HEADER_BYTES + index_bytes
    extensions_offset = tile_blob_start + tile_count * TILE_BYTES
    if extensions_offset > 0xFFFFFFFF:
        raise RuntimeError("pack would exceed the rawtiles v1 4 GiB offset limit")

    zoom_offsets: dict[int, tuple[int, int]] = {}
    start = 0
    for zoom, min_x, max_x, min_y, max_y in ranges:
        count = (max_x - min_x + 1) * (max_y - min_y + 1)
        zoom_offsets[zoom] = (HEADER_BYTES + start * INDEX_ENTRY_BYTES, count)
        start += count

    bbox = coverage_bbox(ranges)
    extension = attr_extension()
    header = rawtiles_header(uuid.uuid4().bytes, args.zoom_min, args.zoom_max,
                             bbox, tile_count, extensions_offset, zoom_offsets)
    index = bytearray(index_bytes)
    for index_number, (zoom, x, y) in enumerate(tiles):
        offset = tile_blob_start + index_number * TILE_BYTES
        struct.pack_into("<BBBBIIII", index, index_number * INDEX_ENTRY_BYTES,
                         zoom, NO_COMPRESSION, 0, 0, x, y, offset, TILE_BYTES)

    with tempfile.NamedTemporaryFile(dir=output.parent, prefix=output.name + ".", suffix=".tmp", delete=False) as temporary:
        temp_path = Path(temporary.name)
        crc = 0

        def emit(data: bytes) -> None:
            nonlocal crc
            temporary.write(data)
            crc = zlib.crc32(data, crc)

        try:
            emit(header)
            emit(index)
            for number, (zoom, x, y) in enumerate(tiles, start=1):
                emit(fetch_or_load_tile(zoom, x, y, args, cache_root))
                print(f"{number}/{tile_count}: z{zoom}/{x}/{y}", end="\r", flush=True)
            emit(extension)
            temporary.write(struct.pack("<I", crc & 0xFFFFFFFF))
            temporary.flush()
            os.fsync(temporary.fileno())
        except BaseException:
            temp_path.unlink(missing_ok=True)
            raise

    os.replace(temp_path, output)
    if not args.keep_tile_cache:
        shutil.rmtree(cache_root, ignore_errors=True)
    print()
    print(f"wrote {output}")
    print(f"tiles: {tile_count}; zooms: {args.zoom_min}..{args.zoom_max}; size: {output.stat().st_size:,} bytes")
    print(f"bbox microdegrees: {bbox}")
    return output


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--center-lat", type=float, default=43.4387179,
                        help="pack centre latitude (Sanford, Maine default)")
    parser.add_argument("--center-lon", type=float, default=-70.7746224,
                        help="pack centre longitude (Sanford, Maine default)")
    parser.add_argument("--radius-km", type=float, default=25.0,
                        help="coverage radius in kilometres (default: 25)")
    parser.add_argument("--zoom-min", type=int, default=11)
    parser.add_argument("--zoom-max", type=int, default=14)
    parser.add_argument("--output", type=Path,
                        default=Path("build/maps/sanford-maine-usgs-topo-z11-14.rawtiles"))
    parser.add_argument("--retries", type=int, default=5)
    parser.add_argument("--request-interval", type=float, default=0.25,
                        help="seconds between USGS requests (default: 0.25)")
    parser.add_argument("--tile-cache", type=Path,
                        help="directory retained across interrupted downloads")
    parser.add_argument("--keep-tile-cache", action="store_true",
                        help="retain downloaded, quantized tiles after a successful pack build")
    parser.add_argument("--overwrite", action="store_true")
    return parser.parse_args()


if __name__ == "__main__":
    try:
        build_pack(parse_args())
    except (ValueError, FileExistsError, RuntimeError) as error:
        raise SystemExit(f"error: {error}") from error
