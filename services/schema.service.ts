/**
 * Service to fetch schema (field definitions) from ArcGIS Feature Services
 */

export interface FieldDefinition {
  name: string;
  type: string;
  alias: string | null;
  length?: number;
  nullable?: boolean;
  editable?: boolean;
  domain?: {
    type: string;
    name: string;
    codedValues?: Array<{ code: unknown; name: string }>;
  } | null;
}

export interface LayerSchema {
  layerId: number;
  layerName: string;
  geometryType: string | null;
  fields: FieldDefinition[];
}

export interface ServiceSchema {
  layers: LayerSchema[];
  fetchedAt: string;
}

/**
 * Fetch schema from an ArcGIS Feature Service
 * @param serviceUrl - The Feature Service URL (e.g., https://services.arcgis.com/.../FeatureServer)
 * @param maxLayers - Maximum number of layers to fetch (default 5)
 */
export async function fetchServiceSchema(
  serviceUrl: string,
  maxLayers: number = 5
): Promise<ServiceSchema | null> {
  try {
    // First, get the service info to find available layers
    const serviceInfoUrl = `${serviceUrl}?f=json`;
    const serviceResponse = await fetch(serviceInfoUrl);

    if (!serviceResponse.ok) {
      console.warn(`Failed to fetch service info: ${serviceResponse.status}`);
      return null;
    }

    const serviceInfo = await serviceResponse.json();

    // Get layer IDs from the service
    const layerIds: number[] = [];
    if (serviceInfo.layers && Array.isArray(serviceInfo.layers)) {
      for (const layer of serviceInfo.layers.slice(0, maxLayers)) {
        if (typeof layer.id === 'number') {
          layerIds.push(layer.id);
        }
      }
    }

    // If no layers found, try layer 0 as default
    if (layerIds.length === 0) {
      layerIds.push(0);
    }

    // Fetch schema for each layer
    const layers: LayerSchema[] = [];

    for (const layerId of layerIds) {
      try {
        const layerUrl = `${serviceUrl}/${layerId}?f=json`;
        const layerResponse = await fetch(layerUrl);

        if (!layerResponse.ok) continue;

        const layerInfo = await layerResponse.json();

        if (layerInfo.error) continue;

        const fields: FieldDefinition[] = [];

        if (layerInfo.fields && Array.isArray(layerInfo.fields)) {
          for (const field of layerInfo.fields) {
            // Skip geometry and system fields for cleaner output
            if (field.type === 'esriFieldTypeGeometry') continue;

            fields.push({
              name: field.name,
              type: mapEsriType(field.type),
              alias: field.alias || null,
              length: field.length,
              nullable: field.nullable,
              editable: field.editable,
              domain: field.domain || null,
            });
          }
        }

        layers.push({
          layerId,
          layerName: layerInfo.name || `Layer ${layerId}`,
          geometryType: mapGeometryType(layerInfo.geometryType),
          fields,
        });
      } catch (error) {
        console.warn(`Failed to fetch layer ${layerId} schema:`, error);
      }
    }

    if (layers.length === 0) {
      return null;
    }

    return {
      layers,
      fetchedAt: new Date().toISOString(),
    };
  } catch (error) {
    console.warn(`Failed to fetch service schema from ${serviceUrl}:`, error);
    return null;
  }
}

/**
 * Map Esri field types to simpler type names
 */
function mapEsriType(esriType: string): string {
  const typeMap: Record<string, string> = {
    'esriFieldTypeOID': 'ObjectID',
    'esriFieldTypeGlobalID': 'GlobalID',
    'esriFieldTypeInteger': 'Integer',
    'esriFieldTypeSmallInteger': 'SmallInteger',
    'esriFieldTypeDouble': 'Double',
    'esriFieldTypeSingle': 'Float',
    'esriFieldTypeString': 'String',
    'esriFieldTypeDate': 'Date',
    'esriFieldTypeGUID': 'GUID',
    'esriFieldTypeBlob': 'Blob',
    'esriFieldTypeRaster': 'Raster',
    'esriFieldTypeXML': 'XML',
  };

  return typeMap[esriType] || esriType;
}

/**
 * Map Esri geometry types to simpler names
 */
function mapGeometryType(esriType: string | null): string | null {
  if (!esriType) return null;

  const typeMap: Record<string, string> = {
    'esriGeometryPoint': 'Point',
    'esriGeometryMultipoint': 'Multipoint',
    'esriGeometryPolyline': 'Polyline',
    'esriGeometryPolygon': 'Polygon',
    'esriGeometryEnvelope': 'Envelope',
  };

  return typeMap[esriType] || esriType;
}
