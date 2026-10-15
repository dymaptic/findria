const GEOCODE_URL = 'https://geocode.arcgis.com/arcgis/rest/services/World/GeocodeServer';

export class GeocodingService {
  async geocode(address: string): Promise<[number, number, number, number] | null> {
    try {
      // Note: ArcGIS geocoding doesn't require authentication for non-stored lookups (forStorage=false)
      const params = new URLSearchParams({
        f: 'json',
        singleLine: address,
        outFields: 'Addr_type,Match_addr',
        forStorage: 'false',
      });

      const response = await fetch(
        `${GEOCODE_URL}/findAddressCandidates?${params}`
      );

      const data = await response.json();

      if (data.candidates && data.candidates.length > 0) {
        const best = data.candidates[0];
        const { extent } = best;

        // Return bbox [xmin, ymin, xmax, ymax]
        if (extent) {
          return [extent.xmin, extent.ymin, extent.xmax, extent.ymax];
        }

        // If no extent, create one from the point (roughly city-sized)
        const { x, y } = best.location;
        const buffer = 0.1; // ~10km buffer
        return [x - buffer, y - buffer, x + buffer, y + buffer];
      }

      return null;
    } catch (error) {
      console.error('Geocoding error:', error);
      return null;
    }
  }

  async suggest(text: string): Promise<Array<{ text: string; magicKey: string }>> {
    try {
      // Note: ArcGIS suggest doesn't require authentication for public suggestions
      const params = new URLSearchParams({
        f: 'json',
        text,
        maxSuggestions: '5',
      });

      const response = await fetch(`${GEOCODE_URL}/suggest?${params}`);
      const data = await response.json();

      return data.suggestions || [];
    } catch (error) {
      console.error('Suggest error:', error);
      return [];
    }
  }
}

export const geocodingService = new GeocodingService();
