/**
 * This file is the main brain of the traffic bot. It orchestrates the conversation flow.
 */

import { fetchIncidents } from './anwb';
import { extractEntities, answerFromIncidents, nonTrafficReply, type TMessage } from './llm';

// Regular expression to detect simple greetings.
const greetingRE = /^(hi|hello|hey|hallo|good\s(morning|afternoon|evening))\b/i;

// Regular expressions to determine if a query is about traffic.
const roadRE = /\b([ABN]\d{1,3})\b/i;
const categoryRE = /(accident|construction|road ?works?|congestion|delay|obstruction|weather)/i;
const trafficKeywordsRE = /traffic|road|route|drive|driving|incident|closure|jam|delay|blockage/i;

const specificTrafficRE = new RegExp(roadRE.source + '|' + categoryRE.source, 'i');

/**
 * Checks if a given text is likely related to traffic.
 * This is a quick, preliminary check before sending to the more powerful LLM.
 * @param text The text to check.
 * @returns True if the text seems to be about traffic.
 */
function isTraffic(text: string): boolean {
	return specificTrafficRE.test(text) || trafficKeywordsRE.test(text);
}

/**
 * Checks if a traffic-related query is specific enough to provide a direct answer
 * or if the bot should ask for clarification.
 * @param text The text to check.
 * @returns True if the query contains a road number or an incident category.
 */
function isSpecificEnough(text: string): boolean {
	return specificTrafficRE.test(text);
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

	// 2. Determine if the conversation is about traffic.
	// We only check the user's last query for keywords.
	// The full history is used by the LLM later on.
	if (isTraffic(q)) {
		// This is a traffic-related query.

		// a. Check if the query is specific enough.
		if (!isSpecificEnough(q)) {
			return 'I can see you are asking about traffic. To give you the best information, could you please specify a road number (e.g., A12) or a type of incident (e.g., construction, congestion)?';
		}

		// b. Use the LLM to extract specific details like road names or incident types.
		const entities = await extractEntities(q, history);

		// c. Fetch all current traffic incidents from the ANWB API.
		const allIncidents = await fetchIncidents();

		// d. Filter the incidents based on what the user asked for.
		let relevantIncidents = allIncidents;
		if (entities.roads && entities.roads.length > 0) {
			const roadSet = new Set(entities.roads.map((r) => r.toUpperCase()));
			relevantIncidents = relevantIncidents.filter((i) => roadSet.has(i.road.toUpperCase()));
		}
		if (entities.categories && entities.categories.length > 0) {
			const categorySet = new Set(entities.categories);
			relevantIncidents = relevantIncidents.filter((i) => categorySet.has(i.category));
		}

		// e. Use the LLM to generate a natural language answer from the filtered incidents.
		return await answerFromIncidents(q, relevantIncidents, history);
	}

	// 3. Handle simple greetings.
	if (greetingRE.test(q)) {
		return 'Hello! How can I assist you with traffic information today?';
	}

	// 4. If it's not about traffic, let the LLM handle it as a general chat.
	return await nonTrafficReply(q, history);
}
