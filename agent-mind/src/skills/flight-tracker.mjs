/**
 * Skill: Flight Tracker — 全球航班实时追踪
 *
 * Queries OpenSky Network public API for real-time global flight data.
 * Provides aviation intelligence to the Agent Mind:
 *   - Total aircraft currently in the air
 *   - Top countries by active flights
 *   - Altitude and speed statistics
 *   - Trend vs last check (busier/quieter)
 *
 * Data source: OpenSky Network (free, no API key)
 * Install: drop this file into agent-mind/src/skills/ → restart Console + Mind.
 */

import { Skill } from './base.mjs';

const OPENSKY_URL = 'https://opensky-network.org/api/states/all';

export class FlightTrackerSkill extends Skill {
  constructor() {
    super('flight_tracker', 'Track real-time global flights, airspace activity, and aviation trends');
    this.lastCount = null;
  }

  canActivate(taskType) {
    return taskType === 'proactive' || taskType === 'reflect';
  }

  async gatherContext(kernels, config) {
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 15000);

      const res = await fetch(OPENSKY_URL, { signal: controller.signal });
      clearTimeout(timeout);

      if (!res.ok) return { error: `OpenSky API returned ${res.status}` };

      const data = await res.json();
      const states = data.states || [];
      const totalFlights = states.length;

      // Count by origin country
      const byCountry = {};
      let totalAltitude = 0, altCount = 0;
      let totalSpeed = 0, speedCount = 0;
      let grounded = 0;

      for (const s of states) {
        // s[2] = origin_country, s[7] = geo_altitude (m), s[9] = velocity (m/s), s[8] = on_ground
        const country = s[2] || 'Unknown';
        byCountry[country] = (byCountry[country] || 0) + 1;

        if (s[8]) { grounded++; continue; }

        if (s[7] != null && s[7] > 0) {
          totalAltitude += s[7];
          altCount++;
        }
        if (s[9] != null && s[9] > 0) {
          totalSpeed += s[9];
          speedCount++;
        }
      }

      // Top 10 countries
      const topCountries = Object.entries(byCountry)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 10)
        .map(([country, count]) => ({ country, count }));

      // Averages
      const avgAltitude = altCount > 0 ? Math.round(totalAltitude / altCount) : 0;
      const avgSpeedKmh = speedCount > 0 ? Math.round(totalSpeed / speedCount * 3.6) : 0;

      // Trend vs last check
      let trend = null;
      if (this.lastCount !== null) {
        const delta = totalFlights - this.lastCount;
        const pct = ((delta / this.lastCount) * 100).toFixed(1);
        trend = { previous: this.lastCount, current: totalFlights, delta, percent: pct };
      }
      this.lastCount = totalFlights;

      return {
        totalFlights,
        inAir: totalFlights - grounded,
        grounded,
        topCountries,
        avgAltitudeMeters: avgAltitude,
        avgSpeedKmh,
        trend,
        timestamp: data.time,
        fetchedAt: new Date().toISOString(),
      };
    } catch (err) {
      return { error: err.message };
    }
  }

  formatForBrain(gathered) {
    if (gathered.error) {
      return {
        name: this.name,
        description: this.description,
        data: gathered,
        instructions: `Flight data unavailable: ${gathered.error}`,
      };
    }

    const lines = [];
    lines.push(`Global flights: ${gathered.totalFlights.toLocaleString()} tracked (${gathered.inAir.toLocaleString()} in air, ${gathered.grounded.toLocaleString()} grounded)`);
    lines.push(`Avg altitude: ${gathered.avgAltitudeMeters.toLocaleString()}m | Avg speed: ${gathered.avgSpeedKmh} km/h`);

    if (gathered.topCountries.length > 0) {
      const top3 = gathered.topCountries.slice(0, 3)
        .map(c => `${c.country}(${c.count})`)
        .join(', ');
      lines.push(`Top airspaces: ${top3}`);
    }

    if (gathered.trend) {
      const t = gathered.trend;
      const dir = t.delta > 0 ? 'busier' : 'quieter';
      lines.push(`Trend: ${dir} than last check (${t.previous} → ${t.current}, ${t.percent}%)`);
    }

    return {
      name: this.name,
      description: this.description,
      data: gathered,
      instructions: [
        'FLIGHT TRACKER REPORT:',
        ...lines,
        '',
        'Use this as interesting context in conversations.',
        'Global aviation activity reflects world economic pulse.',
      ].join('\n'),
    };
  }
}
