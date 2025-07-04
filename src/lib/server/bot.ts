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

/**
 * Checks if a given text is likely related to traffic.
 * This is a quick, preliminary check before sending to the more powerful LLM.
 * @param text The text to check.
 * @returns True if the text seems to be about traffic.
 */
function isTraffic(text: string): boolean {
	return roadRE.test(text) || categoryRE.test(text) || trafficKeywordsRE.test(text);
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

	// 2. Handle simple greetings.
	if (greetingRE.test(q)) {
		return 'Hello! How can I assist you with traffic information today?';
	}

	// 3. Determine if the conversation is about traffic.
	// We join the history and the new query to get the full context.
	const fullConversation = [...history.map((m) => m.content), q].join('\n');

	if (isTraffic(fullConversation)) {
		// This is a traffic-related query.

		// a. Use the LLM to extract specific details like road names or incident types.
		const entities = await extractEntities(q, history);

		// b. Fetch all current traffic incidents from the ANWB API.
		const allIncidents = await fetchIncidents();

		// c. Filter the incidents based on what the user asked for.
		let relevantIncidents = allIncidents;
		if (entities.road) {
			relevantIncidents = relevantIncidents.filter(
				(i) => i.road.toUpperCase() === entities.road!.toUpperCase()
			);
		}
		if (entities.category) {
			relevantIncidents = relevantIncidents.filter((i) => i.category === entities.category);
		}

		// d. Use the LLM to generate a natural language answer from the filtered incidents.
		return await answerFromIncidents(q, relevantIncidents, history);
	}

	// 4. If it's not about traffic, let the LLM handle it as a general chat.
	return await nonTrafficReply(q, history);
}
