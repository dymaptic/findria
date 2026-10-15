import postgres from 'postgres';
import * as h3 from 'h3-js';

const connectionString =
  process.env.DATABASE_URL ||
  'postgresql://datalibrarian:datalibrarian@localhost:5432/datalibrarian';

const sql = postgres(connectionString);

const H3_RESOLUTION = 2; // ~86,000 km² per cell

interface DatasetRow {
  id: string;
  source: string;
  source_id: string;
  service_url: string | null;
  extent_bbox: { xmin: number; ymin: number; xmax: number; ymax: number } | null;
  supports_coverage_query: boolean;
  arcgis_type: string | null;
}

function generatePopulatedCells(): string[] {
  // Generate H3 cells covering major populated regions
  const regions = [
    // Continental US
    { lat: 39.8, lng: -98.5, radiusKm: 2500 },
    // Europe
    { lat: 50.0, lng: 10.0, radiusKm: 2000 },
    // East Asia
    { lat: 35.0, lng: 120.0, radiusKm: 2500 },
    // South Asia
    { lat: 20.0, lng: 78.0, radiusKm: 1500 },
    // South America
    { lat: -15.0, lng: -55.0, radiusKm: 2500 },
    // Africa
    { lat: 0.0, lng: 20.0, radiusKm: 3000 },
    // Australia
    { lat: -25.0, lng: 135.0, radiusKm: 2000 },
  ];

  const cells = new Set<string>();

  for (const region of regions) {
    const centerCell = h3.latLngToCell(region.lat, region.lng, H3_RESOLUTION);
    const ringCells = h3.gridDisk(
      centerCell,
      Math.ceil(region.radiusKm / 300) // Approximate cells per radius
    );
    ringCells.forEach((cell) => cells.add(cell));
  }

  return Array.from(cells);
}

function getBoundingBox(polygon: [number, number][]): {
  xmin: number;
  ymin: number;
  xmax: number;
  ymax: number;
} {
  const lngs = polygon.map((p) => p[1]);
  const lats = polygon.map((p) => p[0]);
  return {
    xmin: Math.min(...lngs),
    ymin: Math.min(...lats),
    xmax: Math.max(...lngs),
    ymax: Math.max(...lats),
  };
}

function bboxIntersects(
  a: { xmin: number; ymin: number; xmax: number; ymax: number },
  b: { xmin: number; ymin: number; xmax: number; ymax: number }
): boolean {
  return !(
    a.xmax < b.xmin ||
    a.xmin > b.xmax ||
    a.ymax < b.ymin ||
    a.ymin > b.ymax
  );
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function getFeatureCount(
  serviceUrl: string,
  polygon: [number, number][]
): Promise<number> {
  try {
    const params = new URLSearchParams({
      where: '1=1',
      geometry: JSON.stringify({
        rings: [polygon.map(([lat, lng]) => [lng, lat])], // H3 returns [lat, lng], ArcGIS expects [lng, lat]
        spatialReference: { wkid: 4326 },
      }),
      geometryType: 'esriGeometryPolygon',
      spatialRel: 'esriSpatialRelIntersects',
      returnCountOnly: 'true',
      f: 'json',
    });

    const response = await fetch(`${serviceUrl}/query?${params}`);
    const data = await response.json();

    return data.count || 0;
  } catch (error) {
    console.error(`Error querying ${serviceUrl}:`, error);
    return 0;
  }
}

async function storeExtentBasedCoverage(
  dataset: DatasetRow,
  coverageCells: string[]
): Promise<void> {
  if (!dataset.extent_bbox) {
    console.log('  No extent available, skipping');
    return;
  }

  const relevantCells = coverageCells.filter((cell) => {
    const cellBoundary = h3.cellToBoundary(cell);
    const cellBbox = getBoundingBox(cellBoundary);
    return bboxIntersects(cellBbox, dataset.extent_bbox!);
  });

  console.log(`  Storing extent coverage for ${relevantCells.length} cells`);

  for (const h3Index of relevantCells) {
    const h3BigInt = BigInt('0x' + h3Index);
    await sql`
      INSERT INTO coverage (dataset_id, h3_index, feature_count)
      VALUES (${dataset.id}, ${h3BigInt.toString()}, -1)
      ON CONFLICT (dataset_id, h3_index) DO NOTHING
    `;
  }
}

async function computeCoverage() {
  console.log('Starting coverage computation...');

  const coverageCells = generatePopulatedCells();
  console.log(
    `Using ${coverageCells.length} H3 cells at resolution ${H3_RESOLUTION}\n`
  );

  // Get all datasets with service URLs (any source)
  const datasets = await sql<DatasetRow[]>`
    SELECT id, source, source_id, service_url,
           extent_bbox, supports_coverage_query, arcgis_type
    FROM datasets
    WHERE service_url IS NOT NULL
  `;

  console.log(`Processing ${datasets.length} datasets with service URLs...\n`);

  for (const dataset of datasets) {
    console.log(`Processing: ${dataset.source_id}`);

    // For non-Feature Services, just store extent-based coverage
    if (!dataset.supports_coverage_query || !dataset.service_url) {
      console.log(
        `  ${dataset.arcgis_type || 'Unknown'}: Using extent only (no H3 queries)`
      );
      await storeExtentBasedCoverage(dataset, coverageCells);
      continue;
    }

    // For Feature Services, do actual H3 coverage queries
    const relevantCells = coverageCells.filter((cell) => {
      if (!dataset.extent_bbox) return true; // Global datasets check all cells

      const cellBoundary = h3.cellToBoundary(cell);
      const cellBbox = getBoundingBox(cellBoundary);

      return bboxIntersects(cellBbox, dataset.extent_bbox);
    });

    console.log(`  Checking ${relevantCells.length} cells...`);

    let coveredCells = 0;
    for (const h3Index of relevantCells) {
      try {
        const polygon = h3.cellToBoundary(h3Index);

        // Feature Service - query for actual count
        const count = await getFeatureCount(dataset.service_url, polygon);

        if (count > 0) {
          const h3BigInt = BigInt('0x' + h3Index);
          await sql`
            INSERT INTO coverage (dataset_id, h3_index, feature_count)
            VALUES (${dataset.id}, ${h3BigInt.toString()}, ${count})
            ON CONFLICT (dataset_id, h3_index) DO UPDATE SET
              feature_count = EXCLUDED.feature_count,
              indexed_at = NOW()
          `;
          coveredCells++;
        }

        // Rate limiting for ArcGIS queries
        await sleep(200);
      } catch (error) {
        console.error(`    Error on ${h3Index}:`, error);
      }
    }

    console.log(`  Found coverage in ${coveredCells} cells`);
  }

  console.log('\nCoverage computation complete!');
  await sql.end();
}

computeCoverage().catch((error) => {
  console.error('Coverage computation failed:', error);
  process.exit(1);
});
