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

// Regular expression to detect simple greetings.
const greetingRE = /^(hi|hello|hey|hallo|good\s(morning|afternoon|evening))\b/i;

/**
 * Pre-processes the user's query to handle common synonyms or specific mappings
 * before sending it to the LLM for entity extraction.
 * @param query The raw user query.
 * @returns The pre-processed query.
 */
export function preprocessQuery(query: string, history: TMessage[]): string {
	let processedQuery = query;

	// Explicitly map common user terms to the exact categories the bot understands.
	processedQuery = processedQuery.replace(/\bjams\b/gi, 'congestion');
	processedQuery = processedQuery.replace(/\broad\s?works?\b|\bbuilding\b/gi, 'construction');
	processedQuery = processedQuery.replace(/\bproblems\b|\bissues\b|\binconveniences\b|\bdisruptions\b/gi, 'all_categories');
	processedQuery = processedQuery.replace(/\b(on\s+roads?|everywhere|general|overall)\b/gi, 'all_categories');

	return processedQuery;
}

/**
 * Simple heuristic to check if an incident is potentially on a route.
 * This is NOT a full routing algorithm, but checks for common highways between major cities.
 * @param incident The traffic incident object.
 * @param origin The origin city/location.
 * @param destination The destination city/location.
 * @returns True if the incident's road is likely on the route, false otherwise.
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
 * Main function to handle a user's query and generate a reply.
 * @param query The user's latest message.
 * @param history The previous messages in the conversation.
 * @returns A string containing the bot's reply.
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
	const processedQuery = preprocessQuery(q, history);

	// 3. Use the LLM to understand the user's intent by extracting entities.
	const entities = await extractEntities(processedQuery, history);
	console.log('Extracted Entities:', entities);

	// 4. Fetch all current traffic incidents from the ANWB API.
	// We do this now so we have the data ready for any traffic-related intent.
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
		return await answerFromIncidents(q, relevantIncidents, history, entities);
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
}