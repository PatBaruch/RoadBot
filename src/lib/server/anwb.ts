/**
 * This file handles all interactions with the ANWB API, which provides real-time traffic data.
 */

import { z } from 'zod';
import { error } from '@sveltejs/kit';
import { env } from '$env/dynamic/private';

// Get the ANWB API key from environment variables.
const ANWB_API_KEY = env.ANWB_API_KEY;
if (!ANWB_API_KEY) throw new Error('Missing ANWB_API_KEY');

/* -------------------------------------------------------------
 * 1. Schemas
 * ------------------------------------------------------------*/

/**
 * This is the schema for a clean, simplified traffic incident.
 * We use Zod to define the shape of the data we want to work with.
 */
export const CleanIncident = z.object({
	id: z.string(),
	road: z.string(),
	location: z.string(),
	category: z.enum(['accident', 'construction', 'congestion', 'obstruction', 'weather', 'other']),
	status: z.enum(['open', 'closed']),
	closure: z.string().optional(),
	delay: z.number().optional(), // in minutes
	startISO: z.string().optional()
});
export type Clean = z.infer<typeof CleanIncident>;

/* -------------------------------------------------------------
 * 2. Classify & Clean
 * ------------------------------------------------------------*/

/**
 * Classifies a raw incident from the ANWB API into one of our defined categories.
 * This helps standardize the data we get from the API.
 * @param raw The raw incident data.
 * @param bucket The type of incident (e.g., traffic jam, road work).
 * @returns The category of the incident.
 */
function classify(raw: any, bucket: 'trafficJams' | 'roadWorks' | 'radars'): Clean['category'] {
	const txt = `${raw.reason ?? ''} ${raw.description ?? ''}`.toLowerCase();
	if (bucket === 'roadWorks') return 'construction';
	if (/ongeval|botsing|crash/.test(txt)) return 'accident';
	if (/mist|gladheid|wateroverlast|storm/.test(txt)) return 'weather';
	if (/obstakel|stilgevallen|verlies van lading/.test(txt)) return 'obstruction';
	if (bucket === 'trafficJams') return 'congestion';
	return 'other';
}

/**
 * Converts a raw incident from the ANWB API into our clean, simplified format.
 * This function extracts relevant details and applies our classification.
 * @param raw The raw incident data.
 * @param bucket The type of incident.
 * @param road The road the incident is on.
 * @returns A clean incident object.
 */
function toClean(
	raw: any,
	bucket: 'trafficJams' | 'roadWorks' | 'radars',
	road: string
): Clean {
	const closed = /dicht/.test(raw.reason ?? raw.description ?? '');
	const closure =
		raw.start && raw.stop
			? `${new Date(raw.start).toLocaleString('nl-NL', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })} – ${new Date(raw.stop).toLocaleString('nl-NL', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })}`
			: undefined;
	return CleanIncident.parse({
		id: String(raw.id ?? raw.msgNr ?? crypto.randomUUID()),
		road,
		location: raw.location ?? `${road} ${raw.from ?? ''}→${raw.to ?? ''}`.trim(),
		category: classify(raw, bucket),
		status: closed ? 'closed' : 'open',
		closure,
		delay: raw.delay ? Math.round(raw.delay / 60) : undefined, // Convert seconds to minutes
		startISO: raw.start ?? raw.timestamp ?? undefined
	});
}

/* -------------------------------------------------------------
 * 3. Fetch + flatten ANWB feed
 * ------------------------------------------------------------*/

// We cache the data for 1 minute to avoid making too many requests to the API.
let cache: { ts: number; data: Clean[] } | null = null;

/**
 * Fetches the latest traffic incidents from the ANWB API.
 * This function gets all the raw data and converts it into a simple, clean list.
 * It also uses a cache to avoid too many API calls.
 * @returns A promise that resolves to an array of clean incident objects.
 */
export async function fetchIncidents(): Promise<Clean[]> {
	// If we have a recent cache, return that instead of fetching again.
	if (cache && Date.now() - cache.ts < 60_000) {
		return cache.data;
	}

	const url = `https://api.anwb.nl/v2/incidents?apikey=${ANWB_API_KEY}&polylines=true&polylineBounds=true&totals=true`;
	const res = await fetch(url);
	if (!res.ok) {
		throw error(502, { message: 'ANWB feed error' });
	}

	const json = await res.json();
	const clean: Clean[] = [];

	// The ANWB data is nested, so we need to loop through it to extract the incidents.
	for (const roadEntry of json.roads ?? []) {
		const road = roadEntry.road as string;
		for (const segment of roadEntry.segments ?? []) {
			const segmentStart = segment.start ?? '';
			const segmentEnd = segment.end ?? '';
			for (const jam of segment.jams ?? []) {
				clean.push(
					toClean(
						{ ...jam, location: jam.location ?? `${road} ${segmentStart}→${segmentEnd}` },
						'trafficJams',
						road
					)
				);
			}
			for (const roadwork of segment.roadworks ?? []) {
				clean.push(
					toClean(
						{ ...roadwork, location: roadwork.location ?? `${road} ${segmentStart}→${segmentEnd}` },
						'roadWorks',
						road
					)
				);
			}
			for (const radar of segment.radars ?? []) {
				clean.push(
					toClean(
						{ ...radar, location: radar.location ?? `${road} ${segmentStart}→${segmentEnd}` },
						'radars',
						road
					)
				);
			}
		}
	}

	// Sort the incidents by start time, so the newest ones are first.
	clean.sort((a, b) => (b.startISO ?? '').localeCompare(a.startISO ?? ''));

	// Save the data to the cache for next time.
	cache = { ts: Date.now(), data: clean };

	return clean;
}
