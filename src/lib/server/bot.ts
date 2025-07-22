/**
 * This file is the main brain of the traffic bot. It orchestrates the conversation flow.
 */

import { fetchIncidents } from './anwb';
import {
	extractEntities,
	answerFromIncidents,
	nonTrafficReply,
	summarizeIncidentsForRoute,
	type TMessage
} from './llm';

// Simple regex to catch common greetings. Helps us respond quickly without hitting the LLM.
const greetingRE = /^(hi|hello|hey|hallo|good\s(morning|afternoon|evening))\b/i;

/**
 * Cleans up the user's query by replacing synonyms with standardized terms.
 * This makes it easier for the LLM to understand the user's intent.
 * For example, "jams" becomes "congestion".
 * @param query The raw user's message.
 * @returns The cleaned-up query string.
 */
export function preprocessQuery(query: string): string {
	let processedQuery = query;

	// Explicitly map common user terms to the exact categories the bot understands.
	processedQuery = processedQuery.replace(/\bjams\b/gi, 'congestion');
	processedQuery = processedQuery.replace(/\broad\s?works?\b|\bbuilding\b/gi, 'construction');
	processedQuery = processedQuery.replace(/\bproblems\b|\bissues\b|\binconveniences\b|\bdisruptions\b/gi, 'all_categories');
	processedQuery = processedQuery.replace(/\b(on\s+roads?|everywhere|general|overall)\b/gi, 'all_categories');

	return processedQuery;
}

/**
 * A simple check to see if a traffic incident is likely on a given route.
 * This isn't a full routing engine, just a quick way to filter incidents for common highways between cities.
 * @param incident The traffic incident object.
 * @param origin The starting city/location.
 * @param destination The ending city/location.
 * @returns True if the incident's road is probably on the route, false otherwise.
 */
function isIncidentOnRoute(incident: any, origin: string, destination: string): boolean {
	const routeMap: { [key: string]: string[] } = {
		'vlissingen-amsterdam': ['A58', 'A4', 'A2', 'A10', 'N57', 'N59'], // Common highways
		'amsterdam-rotterdam': ['A4', 'A2', 'A13'],
		// Add more common routes and their associated highways here
	};

	const normalizedOrigin = origin.toLowerCase().trim();
	const normalizedDestination = destination.toLowerCase().trim();
	const routeKey = `${normalizedOrigin}-${normalizedDestination}`;

	const relevantRoads = routeMap[routeKey] || [];

	// Check if the incident's road is in our list of relevant roads for this route
	return relevantRoads.includes(incident.road.toUpperCase());
}

/**
 * The main function that takes a user's message and generates the bot's reply.
 * It orchestrates everything: processing the query, understanding intent with the LLM,
 * fetching traffic data, and deciding how to respond.
 * @param query The user's latest message.
 * @param history The previous messages in the conversation, for context.
 * @returns A promise that resolves to the bot's reply as a string.
 */
export async function getReply(query: string, history: TMessage[] = []): Promise<string> {
	const q = query.trim();

	// 1. Handle empty queries.
	if (!q) {
		return "I didn't receive a message. Please try again.";
	}

	// 2. Handle simple greetings before doing any complex logic.
	if (greetingRE.test(q)) {
		return 'Hello! How can I assist you with traffic information today?';
	}

	// Pre-process the query before sending it to the LLM.
	const processedQuery = preprocessQuery(q);

	// 3. Use the LLM to understand the user's intent by extracting entities.
	const entities = await extractEntities(processedQuery, history);

	// 4. Fetch all current traffic incidents from the ANWB API.
	// We do this now so we have the data ready for any traffic-related intent.
	try {
		const allIncidents = await fetchIncidents();

		// 5. Decide what to do based on the extracted entities.

		// Case 1: The user is asking about a specific road or incident type.
		if (entities.roads || entities.categories) {
			let relevantIncidents = allIncidents;
			if (entities.roads && entities.roads.length > 0) {
				const roadSet = new Set(entities.roads.map((r) => r.toUpperCase()));
				relevantIncidents = relevantIncidents.filter((i) => roadSet.has(i.road.toUpperCase()));
			}
			if (entities.categories && entities.categories.length > 0) {
				let categoriesToFilter = entities.categories;
				// If 'all_categories' was requested, expand it to all valid categories.
				if (categoriesToFilter.includes('all_categories')) {
					categoriesToFilter = ['accident', 'construction', 'congestion', 'obstruction', 'weather'];
				}
				const categorySet = new Set(categoriesToFilter);
				relevantIncidents = relevantIncidents.filter((i) => categorySet.has(i.category));
			}
			return await answerFromIncidents(q, relevantIncidents, history);
		}

		// Case 2: The user is asking for a route between two places.
		if (entities.origin && entities.destination) {
			const relevantIncidents = allIncidents.filter((inc) =>
				isIncidentOnRoute(inc, entities.origin!, entities.destination!)
			);
			return await summarizeIncidentsForRoute(
				relevantIncidents,
				entities.origin!,
				entities.destination!
			);
		}

		// Case 3: If no specific intent is found, handle as a general chat.
		return await nonTrafficReply(q, history);
	} catch (error) {
		console.error('Error fetching incidents:', error);
		return 'Sorry, I am having trouble connecting to the traffic data service right now.';
	}
}