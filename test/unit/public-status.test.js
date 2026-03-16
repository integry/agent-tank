/**
 * Unit tests for public-status.js module
 *
 * Tests the parsing of status page JSON responses and status indicator mapping
 * without making actual network requests.
 */

const {
  parseStatuspageResponse,
  parseGoogleCloudResponse,
  getStatusBadgeClass,
  getStatusText,
  STATUS_PAGES,
} = require('../../src/public-status.js');

describe('public-status', () => {
  describe('parseStatuspageResponse', () => {
    it('parses operational status (none indicator)', () => {
      const json = JSON.stringify({
        page: {
          id: 'test-page',
          name: 'Test Service',
          url: 'https://test.statuspage.io',
          updated_at: '2026-03-16T10:00:00Z',
        },
        status: {
          indicator: 'none',
          description: 'All Systems Operational',
        },
      });

      const result = parseStatuspageResponse(json);

      expect(result.status).toBe('operational');
      expect(result.indicator).toBe('none');
      expect(result.description).toBe('All Systems Operational');
      expect(result.updatedAt).toBe('2026-03-16T10:00:00Z');
    });

    it('parses minor degradation status', () => {
      const json = JSON.stringify({
        page: { updated_at: '2026-03-16T10:00:00Z' },
        status: {
          indicator: 'minor',
          description: 'Minor Service Degradation',
        },
      });

      const result = parseStatuspageResponse(json);

      expect(result.status).toBe('degraded');
      expect(result.indicator).toBe('minor');
      expect(result.description).toBe('Minor Service Degradation');
    });

    it('parses major outage status', () => {
      const json = JSON.stringify({
        page: { updated_at: '2026-03-16T10:00:00Z' },
        status: {
          indicator: 'major',
          description: 'Major Service Outage',
        },
      });

      const result = parseStatuspageResponse(json);

      expect(result.status).toBe('outage');
      expect(result.indicator).toBe('major');
      expect(result.description).toBe('Major Service Outage');
    });

    it('parses critical outage status', () => {
      const json = JSON.stringify({
        page: { updated_at: '2026-03-16T10:00:00Z' },
        status: {
          indicator: 'critical',
          description: 'Critical System Outage',
        },
      });

      const result = parseStatuspageResponse(json);

      expect(result.status).toBe('outage');
      expect(result.indicator).toBe('critical');
      expect(result.description).toBe('Critical System Outage');
    });

    it('handles missing status object', () => {
      const json = JSON.stringify({
        page: { updated_at: '2026-03-16T10:00:00Z' },
      });

      const result = parseStatuspageResponse(json);

      expect(result.status).toBe('operational');
      expect(result.indicator).toBe('none');
      expect(result.description).toBe('Unknown');
    });

    it('handles missing page object', () => {
      const json = JSON.stringify({
        status: {
          indicator: 'none',
          description: 'All Systems Operational',
        },
      });

      const result = parseStatuspageResponse(json);

      expect(result.status).toBe('operational');
      expect(result.updatedAt).toBeNull();
    });

    it('handles unknown indicator value', () => {
      const json = JSON.stringify({
        status: {
          indicator: 'unknown_value',
          description: 'Some Status',
        },
      });

      const result = parseStatuspageResponse(json);

      expect(result.status).toBe('unknown');
      expect(result.indicator).toBe('unknown_value');
    });
  });

  describe('parseGoogleCloudResponse', () => {
    it('returns operational when no incidents', () => {
      const json = JSON.stringify([]);

      const result = parseGoogleCloudResponse(json, 'test-product');

      expect(result.status).toBe('operational');
      expect(result.indicator).toBe('none');
      expect(result.description).toBe('All Systems Operational');
    });

    it('returns operational when all incidents are old', () => {
      const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString();
      const threeHoursAgo = new Date(Date.now() - 3 * 60 * 60 * 1000).toISOString();

      const json = JSON.stringify([
        {
          id: 'incident-1',
          begin: threeHoursAgo,
          end: twoHoursAgo,
          status: 'SERVICE_DISRUPTION',
          external_desc: 'Old incident',
          affected_products: [{ id: 'test-product' }],
        },
      ]);

      const result = parseGoogleCloudResponse(json, 'test-product');

      expect(result.status).toBe('operational');
    });

    it('detects service disruption for matching product', () => {
      const json = JSON.stringify([
        {
          id: 'incident-1',
          begin: new Date().toISOString(),
          status: 'SERVICE_DISRUPTION',
          external_desc: 'API experiencing elevated error rates',
          modified: '2026-03-16T10:00:00Z',
          affected_products: [{ id: 'test-product', title: 'Test API' }],
        },
      ]);

      const result = parseGoogleCloudResponse(json, 'test-product');

      expect(result.status).toBe('degraded');
      expect(result.indicator).toBe('minor');
      expect(result.description).toBe('API experiencing elevated error rates');
    });

    it('detects service outage for matching product', () => {
      const json = JSON.stringify([
        {
          id: 'incident-1',
          begin: new Date().toISOString(),
          status: 'SERVICE_OUTAGE',
          external_desc: 'API is unavailable',
          modified: '2026-03-16T10:00:00Z',
          affected_products: [{ id: 'test-product', title: 'Test API' }],
        },
      ]);

      const result = parseGoogleCloudResponse(json, 'test-product');

      expect(result.status).toBe('outage');
      expect(result.indicator).toBe('major');
      expect(result.description).toBe('API is unavailable');
    });

    it('ignores incidents for different products', () => {
      const json = JSON.stringify([
        {
          id: 'incident-1',
          begin: new Date().toISOString(),
          status: 'SERVICE_OUTAGE',
          external_desc: 'Other service is down',
          affected_products: [{ id: 'other-product', title: 'Other Service' }],
        },
      ]);

      const result = parseGoogleCloudResponse(json, 'test-product');

      expect(result.status).toBe('operational');
    });

    it('matches products by gemini keyword in title', () => {
      const json = JSON.stringify([
        {
          id: 'incident-1',
          begin: new Date().toISOString(),
          status: 'SERVICE_DISRUPTION',
          external_desc: 'Gemini API issues',
          modified: '2026-03-16T10:00:00Z',
          affected_products: [{ id: 'some-id', title: 'Gemini API' }],
        },
      ]);

      const result = parseGoogleCloudResponse(json, 'different-product-id');

      expect(result.status).toBe('degraded');
    });

    it('matches products by vertex keyword in title', () => {
      const json = JSON.stringify([
        {
          id: 'incident-1',
          begin: new Date().toISOString(),
          status: 'SERVICE_DISRUPTION',
          external_desc: 'Vertex AI issues',
          modified: '2026-03-16T10:00:00Z',
          affected_products: [{ id: 'some-id', title: 'Vertex AI' }],
        },
      ]);

      const result = parseGoogleCloudResponse(json, 'different-product-id');

      expect(result.status).toBe('degraded');
    });

    it('considers recent incidents (ended less than 1 hour ago)', () => {
      const thirtyMinsAgo = new Date(Date.now() - 30 * 60 * 1000).toISOString();
      const fortyMinsAgo = new Date(Date.now() - 40 * 60 * 1000).toISOString();

      const json = JSON.stringify([
        {
          id: 'incident-1',
          begin: fortyMinsAgo,
          end: thirtyMinsAgo,
          status: 'SERVICE_DISRUPTION',
          external_desc: 'Recent disruption',
          modified: thirtyMinsAgo,
          affected_products: [{ id: 'test-product' }],
        },
      ]);

      const result = parseGoogleCloudResponse(json, 'test-product');

      expect(result.status).toBe('degraded');
    });

    it('prioritizes outage over disruption when both present', () => {
      const json = JSON.stringify([
        {
          id: 'incident-1',
          begin: new Date().toISOString(),
          status: 'SERVICE_DISRUPTION',
          external_desc: 'Minor issues',
          affected_products: [{ id: 'test-product' }],
        },
        {
          id: 'incident-2',
          begin: new Date().toISOString(),
          status: 'SERVICE_OUTAGE',
          external_desc: 'Major outage',
          modified: '2026-03-16T10:00:00Z',
          affected_products: [{ id: 'test-product' }],
        },
      ]);

      const result = parseGoogleCloudResponse(json, 'test-product');

      expect(result.status).toBe('outage');
    });
  });

  describe('getStatusBadgeClass', () => {
    it('returns green class for operational', () => {
      expect(getStatusBadgeClass('operational')).toBe('status-badge-green');
    });

    it('returns yellow class for degraded', () => {
      expect(getStatusBadgeClass('degraded')).toBe('status-badge-yellow');
    });

    it('returns red class for outage', () => {
      expect(getStatusBadgeClass('outage')).toBe('status-badge-red');
    });

    it('returns grey class for unknown', () => {
      expect(getStatusBadgeClass('unknown')).toBe('status-badge-grey');
    });

    it('returns grey class for invalid status', () => {
      expect(getStatusBadgeClass('invalid')).toBe('status-badge-grey');
    });

    it('returns grey class for null', () => {
      expect(getStatusBadgeClass(null)).toBe('status-badge-grey');
    });

    it('returns grey class for undefined', () => {
      expect(getStatusBadgeClass(undefined)).toBe('status-badge-grey');
    });
  });

  describe('getStatusText', () => {
    it('returns Operational for operational status', () => {
      expect(getStatusText('operational')).toBe('Operational');
    });

    it('returns Degraded for degraded status', () => {
      expect(getStatusText('degraded')).toBe('Degraded');
    });

    it('returns Outage for outage status', () => {
      expect(getStatusText('outage')).toBe('Outage');
    });

    it('returns Unknown for unknown status', () => {
      expect(getStatusText('unknown')).toBe('Unknown');
    });

    it('returns Unknown for invalid status', () => {
      expect(getStatusText('invalid')).toBe('Unknown');
    });

    it('returns Unknown for null', () => {
      expect(getStatusText(null)).toBe('Unknown');
    });
  });

  describe('STATUS_PAGES configuration', () => {
    it('has configuration for claude', () => {
      expect(STATUS_PAGES.claude).toBeDefined();
      expect(STATUS_PAGES.claude.url).toContain('anthropic.statuspage.io');
      expect(STATUS_PAGES.claude.type).toBe('statuspage');
    });

    it('has configuration for codex (OpenAI)', () => {
      expect(STATUS_PAGES.codex).toBeDefined();
      expect(STATUS_PAGES.codex.url).toContain('status.openai.com');
      expect(STATUS_PAGES.codex.type).toBe('statuspage');
    });

    it('has configuration for gemini (Google Cloud)', () => {
      expect(STATUS_PAGES.gemini).toBeDefined();
      expect(STATUS_PAGES.gemini.url).toContain('status.cloud.google.com');
      expect(STATUS_PAGES.gemini.type).toBe('google-cloud');
      expect(STATUS_PAGES.gemini.productId).toBeDefined();
    });
  });
});

describe('Error Handling', () => {
  describe('parseStatuspageResponse', () => {
    it('throws on invalid JSON', () => {
      expect(() => parseStatuspageResponse('not json')).toThrow();
    });

    it('throws on empty string', () => {
      expect(() => parseStatuspageResponse('')).toThrow();
    });
  });

  describe('parseGoogleCloudResponse', () => {
    it('throws on invalid JSON', () => {
      expect(() => parseGoogleCloudResponse('not json', 'test')).toThrow();
    });

    it('handles empty array gracefully', () => {
      const result = parseGoogleCloudResponse('[]', 'test');
      expect(result.status).toBe('operational');
    });
  });
});
