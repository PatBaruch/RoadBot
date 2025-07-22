/**
 * Manages all interactions with the Large Language Model (LLM).
 * This module is responsible for interpreting user queries and generating natural language responses.
 */

import { env } from '$env/dynamic/private';
import OpenAI from 'openai';
import { z } from 'zod';
import type { Clean } from './anwb';

// --- LLM Configuration ---
// Establishes the connection to the LLM provider (Groq API) using the API key.
// Defines the specific model for generation and a default refusal message for irrelevant queries.
const GROQ_API_KEY = env.GROQ_API_KEY;
if (!GROQ_API_KEY) throw new Error('Missing GROQ_API_KEY');

const llm = new OpenAI({ apiKey: GROQ_API_KEY, baseURL: 'https://api.groq.com/openai/v1' });
const MODEL = 'llama3-8b-8192';
const REFUSAL = 'I can only answer questions related to traffic.';

// --- Data Schemas ---
// Defines the data structures for chat messages and requests.
// Zod is used for robust data validation and type safety.
export const Message = z.object({
	role: z.enum(['user', 'assistant']),
	content: z.string()
});
export type TMessage = z.infer<typeof Message>;

export const ChatRequest = z.object({
	query: z.string(),
	history: z.array(Message).optional()
});

// --- Prompt Engineering ---
// Contains the system prompts that instruct the LLM on how to perform specific tasks.
// Isolating prompts improves code clarity and maintainability.

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

// --- Core LLM Interaction ---
// A centralized function for making requests to the LLM.
// This abstraction simplifies API calls and centralizes error handling.
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
		// Return a generic error message to the user upon failure.
		return 'Sorry, I am having trouble connecting to the AI service right now.';
	}
}

/**
 * Extracts structured data (entities) from a user's query.
 * Identifies key information like road numbers, incident categories, origin, and destination.
 */
export async function extractEntities(
	query: string,
	history: TMessage[]
): Promise<{ roads?: string[]; categories?: string[]; origin?: string; destination?: string }> {
	const messages: TMessage[] = [...history, { role: 'user', content: query }];
	const jsonResponse = await callLLM(EXTRACT_ENTITIES_PROMPT, messages, 0, true);

	try {
		// Safely parse the JSON response from the LLM.
		return JSON.parse(jsonResponse);
	} catch (e) {
		console.error('Failed to parse entities from LLM JSON response', e);
		// On failure, return an empty object to prevent downstream errors.
		return {};
	}
}

/**
 * Generates a natural language response based on a provided list of traffic incidents.
 * It uses the data to answer the user's query in a conversational format.
 */
export async function answerFromIncidents(
	userQuery: string,
	incidents: Clean[],
	history: TMessage[]
): Promise<string> {
	if (incidents.length === 0) {
		return `I couldn't find any reported incidents for your request about "${userQuery}" at this time. The roads appear to be clear.`;
	}

	// Format the incident data into a markdown list for the LLM.
	const incidentMarkdown = markdownFromGroups(groupByCategory(incidents));
	const systemPromptWithData = `${ANSWER_INCIDENTS_PROMPT}\n\nLATEST TRAFFIC DATA:\n${incidentMarkdown}`;
	const messages: TMessage[] = [...history, { role: 'user', content: userQuery }];

	return callLLM(systemPromptWithData, messages, 0);
}

/**
 * Generates a helpful response for queries that are not related to traffic.
 * This ensures the bot stays on-topic and gracefully handles irrelevant questions.
 */
export async function nonTrafficReply(query: string, history: TMessage[]): Promise<string> {
	const messages: TMessage[] = [...history, { role: 'user', content: query }];
	return callLLM(NON_TRAFFIC_PROMPT, messages, 0.7);
}

/**
 * Summarizes relevant traffic incidents for a specified route.
 * Filters a list of incidents and provides a concise overview for the user.
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
	const systemPromptWithData = `You are RoadBuddy, a traffic assistant. Summarize the following traffic incidents for a route from ${origin} to ${destination}. Be concise and factual. Do not add any conversational filler or route suggestions.\n\nLATEST TRAFFIC DATA:\n${incidentMarkdown}`;
	const messages: TMessage[] = [{ role: 'user', content: `Route from ${origin} to ${destination}` }];

	return callLLM(systemPromptWithData, messages, 0);
}

// --- Data Formatting Utilities ---
// Utility functions for structuring and formatting data before sending it to the LLM.

export function groupByCategory(list: Clean[]) {
	return list.reduce<Record<Clean['category'], Clean[]>>(
		(acc, inc) => {
			(acc[inc.category] ||= []).push(inc);
			return acc;
		},
		{ accident: [], construction: [], congestion: [], obstruction: [], weather: [], other: [] } as any
	);
}

/**
 * Formats categorized incidents into a structured Markdown list.
 * @param groups A record of incident arrays, keyed by category.
 * @returns A single Markdown string of the formatted incidents.
 */
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