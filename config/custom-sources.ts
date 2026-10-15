/**
 * Custom ArcGIS Sources Configuration
 *
 * Add ArcGIS Online organizations, Hub sites, or direct service URLs to index.
 * These are indexed in addition to the Living Atlas.
 */

export interface CustomOrg {
  /** ArcGIS Online username/org ID */
  owner: string;
  /** Display name for attribution */
  name: string;
  /** Optional description */
  description?: string;
  /** Geographic focus area */
  region?: string;
}

export interface CustomHubSite {
  /** Hub site URL (e.g., https://opendata.cityofportland.gov) */
  url: string;
  /** Display name */
  name: string;
  /** ArcGIS Server REST endpoint if different from Hub */
  arcgisServerUrl?: string;
  /** Geographic focus area */
  region?: string;
}

export interface CustomServiceUrl {
  /** Direct URL to Feature Service or Map Service */
  url: string;
  /** Display name */
  name: string;
  /** Source organization */
  org?: string;
}

// ============================================================================
// US FEDERAL AGENCIES (VERIFIED)
// ============================================================================
export const FEDERAL_ORGS: CustomOrg[] = [
  // Major Federal Data Sources - VERIFIED with data counts
  { owner: 'USDOT_BTS', name: 'Bureau of Transportation Statistics', description: '141 services', region: 'USA' },
  { owner: 'EPA_GEO', name: 'EPA GEO', description: 'Environmental Protection Agency - 264 services', region: 'USA' },
  { owner: 'ncei_cds_noaa', name: 'NOAA NCEI', description: 'National Centers for Environmental Information - 142 services', region: 'USA' },
  { owner: 'Federal_User_Community', name: 'Federal User Community', description: '95 services', region: 'USA' },
  { owner: 'Esri_US_Federal_Data', name: 'Esri US Federal Data', description: '135 services', region: 'USA' },
  { owner: 'FEMA_HQ_Preparedness_NIC', name: 'FEMA Preparedness', description: 'FEMA Risk and Hazard Analysis', region: 'USA' },
  { owner: 'CA_Office_of_Emergency_Services_GIS', name: 'California OES', description: 'Office of Emergency Services - 249 services', region: 'California' },
];

// ============================================================================
// US STATE & REGIONAL AGENCIES (VERIFIED)
// ============================================================================
export const STATE_ORGS: CustomOrg[] = [
  // Oregon Metro - VERIFIED
  { owner: 'OregonMetro.RLIS', name: 'Oregon Metro RLIS', description: 'Regional Land Info System - 204 services', region: 'Portland Metro, OR' },
  { owner: 'OregonMetro', name: 'Oregon Metro', description: 'Portland Metro regional government - 91 services', region: 'Portland Metro, OR' },
  { owner: 'OregonMetro.ParksNature', name: 'Oregon Metro Parks', description: 'Parks and Nature', region: 'Portland Metro, OR' },
];

// ============================================================================
// MAJOR US CITIES (VERIFIED)
// ============================================================================
export const CITY_ORGS: CustomOrg[] = [
  // Seattle - VERIFIED
  { owner: 'SeattleData', name: 'Seattle Open Data', description: '86 services', region: 'Seattle, WA' },

  // New York City - VERIFIED
  { owner: 'DCP_GIS', name: 'NYC Dept of City Planning', description: '125 services', region: 'New York City, NY' },

  // San Francisco - VERIFIED
  { owner: 'vll_sfgis', name: 'San Francisco GIS', description: '69 services', region: 'San Francisco, CA' },

  // Philadelphia - VERIFIED
  { owner: 'maps.phl.data', name: 'Philadelphia Open Data', description: '680 services', region: 'Philadelphia, PA' },

  // Austin - VERIFIED
  { owner: 'CTM.Publisher', name: 'Austin CTM', description: 'Communications & Tech Management - 264 services', region: 'Austin, TX' },
  { owner: 'PARD.Administrator', name: 'Austin Parks & Recreation', region: 'Austin, TX' },

  // Los Angeles - VERIFIED
  { owner: 'LARAP_Admin', name: 'LA Recreation & Parks', region: 'Los Angeles, CA' },
  { owner: 'planning.gisonline_ladcp', name: 'LA Dept of City Planning', region: 'Los Angeles, CA' },

  // Denver - VERIFIED
  { owner: '138676_geospatialDenver', name: 'Denver Geospatial', description: '3 services', region: 'Denver, CO' },
];

// ============================================================================
// COUNTIES & REGIONAL AGENCIES (VERIFIED)
// ============================================================================
export const REGIONAL_ORGS: CustomOrg[] = [
  // Major Counties - VERIFIED
  { owner: 'KingCounty', name: 'King County', description: '924 services', region: 'King County, WA' },
  { owner: 'piercer_kingcounty', name: 'King County GIS', region: 'King County, WA' },
  { owner: 'MaricopaElectionsGIS', name: 'Maricopa County Elections', description: '76 services', region: 'Maricopa County, AZ' },
  { owner: 'FairfaxCounty', name: 'Fairfax County', region: 'Fairfax County, VA' },
  { owner: 'WakeCountyGovernment', name: 'Wake County', region: 'Wake County, NC' },

  // LA County users
  { owner: 'dhoffman@planning.lacounty.gov_lacounty', name: 'LA County Planning', region: 'Los Angeles County, CA' },

  // Transit
  { owner: 'ChungJi@metro.net_LAMetro', name: 'LA Metro', description: 'Los Angeles transit', region: 'Los Angeles, CA' },
];

// ============================================================================
// ESRI DATA & DEMOGRAPHICS (VERIFIED)
// ============================================================================
export const ESRI_ORGS: CustomOrg[] = [
  // Esri Demographics - VERIFIED, 2184 services!
  { owner: 'esri_dm', name: 'Esri Demographics', description: '2184 services - Census, ACS, demographics', region: 'USA' },
];

// ============================================================================
// COMBINE ALL ORGANIZATIONS
// ============================================================================
export const ALL_CUSTOM_ORGS: CustomOrg[] = [
  ...FEDERAL_ORGS,
  ...STATE_ORGS,
  ...CITY_ORGS,
  ...REGIONAL_ORGS,
  ...ESRI_ORGS,
];

// ============================================================================
// HUB SITES (for future use)
// ============================================================================
export const HUB_SITES: CustomHubSite[] = [
  { url: 'https://opendata.dc.gov', name: 'DC Open Data', region: 'Washington, DC' },
  { url: 'https://data.cityofnewyork.us', name: 'NYC Open Data', region: 'New York City, NY' },
  { url: 'https://data.cityofchicago.org', name: 'Chicago Data Portal', region: 'Chicago, IL' },
  { url: 'https://data.lacity.org', name: 'LA Open Data', region: 'Los Angeles, CA' },
  { url: 'https://data.sfgov.org', name: 'SF Open Data', region: 'San Francisco, CA' },
  { url: 'https://data.seattle.gov', name: 'Seattle Open Data', region: 'Seattle, WA' },
  { url: 'https://data.boston.gov', name: 'Boston Open Data', region: 'Boston, MA' },
  { url: 'https://data.austintexas.gov', name: 'Austin Open Data', region: 'Austin, TX' },
  { url: 'https://data.denvergov.org', name: 'Denver Open Data', region: 'Denver, CO' },
];

// ============================================================================
// DIRECT SERVICE URLS (for specific services)
// ============================================================================
export const DIRECT_SERVICES: CustomServiceUrl[] = [
  // Add specific service URLs here if needed
  // { url: 'https://services.arcgis.com/xxx/FeatureServer', name: 'Specific Dataset', org: 'Some Org' },
];
