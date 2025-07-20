/**
 * This file handles all interactions with the Language Model (LLM).
 * It is responsible for understanding user queries and generating natural language responses.
 */

import { env } from '$env/dynamic/private';
import OpenAI from 'openai';
import { z } from 'zod';
import type { Clean } from './anwb';

// --- SETUP ---
// Initialize the connection to the LLM with our API key.
const GROQ_API_KEY = env.GROQ_API_KEY;
if (!GROQ_API_KEY) throw new Error('Missing GROQ_API_KEY');

const llm = new OpenAI({ apiKey: GROQ_API_KEY, baseURL: 'https://api.groq.com/openai/v1' });
const MODEL = 'llama3-8b-8192';
const REFUSAL = 'I can only answer questions related to traffic.';

// --- SCHEMAS ---
// Define the structure for messages and requests for type safety.
export const Message = z.object({
	role: z.enum(['user', 'assistant']),
	content: z.string()
});
export type TMessage = z.infer<typeof Message>;

export const ChatRequest = z.object({
	query: z.string(),
	history: z.array(Message).optional()
});

// --- PROMPTS ---
// Storing prompts in constants makes the main functions cleaner and easier to read.

const EXTRACT_ENTITIES_PROMPT = `
	Your task is to identify roads (e.g., A4, N57), and incident categories from the user's query. The valid categories are: "accident", "construction", "congestion", "obstruction", "weather". When identifying categories, you MUST use these exact terms. Also identify origin and destination. Consider the full conversation history.
Pay close attention to negations. If the user says "I am NOT interested in construction", you should not extract "construction" as a category.
Respond with a JSON object like {"roads": ["A58"], "categories": ["accident", "congestion"], "origin": "Vlissingen", "destination": "Amsterdam"}.
If a value's not found in the conversation, omit its key. The values in the arrays should be strings.
`;

const ANSWER_INCIDENTS_PROMPT = `
	You are RoadBuddy, a friendly and concise traffic assistant for drivers in the Netherlands.
	Your ONLY source of information is the real-time traffic incidents provided below. You MUST NOT use any external information or make things up.
	Answer the user's question directly and concisely based SOLELY on the provided data. Do not re-interpret or filter the provided data based on the user's original query.
	CRITICAL RULE: If the user's query is about a location or topic that is NOT covered by the provided traffic data (e.g., outside the Netherlands), you MUST state that you can only provide information for the Netherlands. DO NOT invent information or use your general knowledge for topics outside the provided data.
	If asked about something other than traffic, reply "${REFUSAL}" and nothing else.
`;

const NON_TRAFFIC_PROMPT =
	'You are a friendly chat assistant for a Dutch road-status app. Your ONLY expertise is reporting on real-time traffic INCIDENTS (like jams, construction, accidents) in the Netherlands. You CANNOT provide route planning or travel time estimations. For any queries about routes or travel times (e.g., "how long from A to B?"), you MUST state that you cannot provide travel times and can only report on specific incidents. For queries outside the Netherlands, state that you only have data for the Netherlands. Be helpful, but DO NOT invent information or perform functions you are not designed for.';

const SUMMARIZE_ROUTE_INCIDENTS_PROMPT = `Given the user's query for a route from [origin] to [destination] and the following traffic data:

Your ONLY task is to provide a JSON response.

CRITICAL RULES:
- If there are relevant incidents in the provided data, respond with a JSON object like: {"status": "incidents", "summary": "[concise markdown summary of relevant incidents]"}.
- If there are NO relevant incidents found in the provided data, respond ONLY with the JSON object: {"status": "clear"}.
- DO NOT add any conversational filler, greetings, route suggestions, travel time estimates, or any other information.
- DO NOT mention geographic limitations unless the user's query explicitly involves locations outside the Netherlands.
`;

// --- REUSABLE LLM HELPER ---
/**
 * A single, reusable function to call the LLM. This avoids repeating code.
 * @param systemPrompt The specific instructions for the AI's persona and task.
 * @param messages The conversation history and the user's query.
 * @param temperature How creative the AI should be (0 = factual, >0 = creative).
 * @param isJsonMode Whether to force the AI to reply in JSON format.
 * @returns The AI's response content as a string.
 */
async function callLLM(
	systemPrompt: string,
	messages: TMessage[],
	temperature: number,
	isJsonMode = false
): Promise<string> {
	try {
		const completion = await llm.chat.completions.create({
			model: MODEL,
			temperature: temperature,
			response_format: isJsonMode ? { type: 'json_object' } : { type: 'text' },
			messages: [
				{ role: 'system', content: systemPrompt },
				...(messages as OpenAI.Chat.ChatCompletionMessageParam[])
			]
		});
		return completion.choices[0].message?.content ?? '';
	} catch (e) {
		console.error('Error calling LLM:', e);
		// Return a generic error message that can be shown to the user.
		return 'Sorry, I am having trouble connecting to the AI service right now.';
	}
}

// --- CORE FUNCTIONS (Now much simpler!) ---

/**
 * "The Detective": Extracts structured data (entities) from a user's query.
 */
export async function extractEntities(
	query: string,
	history: TMessage[]
): Promise<{ roads?: string[]; categories?: string[]; origin?: string; destination?: string }> {
	const messages: TMessage[] = [...history, { role: 'user', content: query }];
	const jsonResponse = await callLLM(EXTRACT_ENTITIES_PROMPT, messages, 0, true);

	try {
		// Safely parse the JSON response from the AI.
		return JSON.parse(jsonResponse);
	} catch (e) {
		console.error('Failed to parse entities from LLM JSON response', e);
		return {}; // Return empty object on failure.
	}
}

/**
 * "The Journalist": Generates a natural language answer from a list of traffic incidents.
 */
export async function answerFromIncidents(
	userQuery: string,
	incidents: Clean[],
	history: TMessage[],
	entities: { roads?: string[]; categories?: string[]; origin?: string; destination?: string }
): Promise<string> {
	if (incidents.length === 0) {
		const hasRoads = entities.roads && entities.roads.length > 0;
		const hasCategories = entities.categories && entities.categories.length > 0;

		if (hasRoads && hasCategories) {
			return `I couldn\'t find any ${entities.categories.join(' and ')} incidents on ${entities.roads.join(' and ')} at this time. Would you like me to check for all types of incidents on ${entities.roads.join(' and ')}?`;
		} else if (hasCategories) {
			return `I couldn\'t find any ${entities.categories.join(' and ')} incidents at this time. Would you like me to list all ${entities.categories.join(' and ')} incidents in the Netherlands?`;
		} else if (hasRoads) {
			return `I couldn\'t find any reported incidents for your request about "${userQuery}" on ${entities.roads.join(' and ')} at this time. The route appears clear. However, I can check for all types of incidents on ${entities.roads.join(' and ')}.`;
		} else {
			return `I couldn\'t find any reported incidents for your request about "${userQuery}" at this time. The route appears clear. However, I can provide a general overview of all current traffic incidents in the Netherlands.`;
		}
	}

	// Format the incident data into a clean markdown list for the AI to read.
	const incidentMarkdown = markdownFromGroups(groupByCategory(incidents));
	const systemPromptWithData = `${ANSWER_INCIDENTS_PROMPT}

LATEST TRAFFIC DATA:
${incidentMarkdown}`;
	const messages: TMessage[] = [...history, { role: 'user', content: userQuery }];

	return callLLM(systemPromptWithData, messages, 0);
}

/**
 * "The Friendly Chatbot": Generates a reply for a non-traffic-related query.
 */
export async function nonTrafficReply(query: string, history: TMessage[]): Promise<string> {
	const messages: TMessage[] = [...history, { role: 'user', content: query }];
	return callLLM(NON_TRAFFIC_PROMPT, messages, 0.7);
}

/**
 * "The Route Analyst": Intelligently filters and summarizes incidents for a given route.
 */
export async function summarizeIncidentsForRoute(
	incidents: Clean[],
	origin: string,
	destination: string
): Promise<string> {
	if (incidents.length === 0) {
		return 'The route appears clear of reported incidents at this time.';
	}

	const incidentMarkdown = markdownFromGroups(groupByCategory(incidents));
	const systemPromptWithData = `You are RoadBuddy, a traffic assistant. Summarize the following traffic incidents for a route from ${origin} to ${destination}. Be concise and factual. Do not add any conversational filler or route suggestions.

LATEST TRAFFIC DATA:
${incidentMarkdown}`;
	const messages: TMessage[] = [{ role: 'user', content: `Route from ${origin} to ${destination}` }];

	return callLLM(systemPromptWithData, messages, 0);
}

// --- DATA FORMATTING HELPERS ---
// These functions are not directly related to the LLM calls, but prepare data for it.

export function groupByCategory(list: Clean[]) {
	return list.reduce<Record<Clean['category'], Clean[]>>(
		(acc, inc) => {
			(acc[inc.category] ||= []).push(inc);
			return acc;
		},
		{ accident: [], construction: [], congestion: [], obstruction: [], weather: [], other: [] } as any
	);
}

export function markdownFromGroups(groups: Record<string, Clean[]>): string {
	const order = ['accident', 'construction', 'congestion', 'obstruction', 'weather', 'other'];
	const labels: Record<string, string> = {
		accident: 'Accidents',
		construction: 'Construction',
		congestion: 'Congestion',
		obstruction: 'Obstruction',
		weather: 'Weather',
		other: 'Other'
	};
	let out = '';
	for (const cat of order) {
		if (!groups[cat]?.length) continue;
		out += `**${labels[cat]}**\n`;
		for (const inc of groups[cat]) {
			const pieces = [`${inc.road} — ${inc.location}`];
			if (inc.status === 'closed') pieces.push('closed');
			if (inc.closure) pieces.push(`closure ${inc.closure}`);
			if (inc.delay) pieces.push(`delay ~${inc.delay} min`);
			out += `• ${pieces.join(', ')}\n`;
		}
	}
	return out.trim();
}