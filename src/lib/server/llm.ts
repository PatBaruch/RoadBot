/**
 * This file handles all interactions with the Language Model (LLM).
 * It is responsible for understanding user queries and generating natural language responses.
 */

import { env } from '$env/dynamic/private';
import OpenAI from 'openai';
import { z } from 'zod';
import type { Clean } from './anwb';

// Get the Groq API key from the environment variables.
const GROQ_API_KEY = env.GROQ_API_KEY;
if (!GROQ_API_KEY) throw new Error('Missing GROQ_API_KEY');

// Initialize the LLM client with the Groq API.
const llm = new OpenAI({ apiKey: GROQ_API_KEY, baseURL: 'https://api.groq.com/openai/v1' });
const MODEL = 'llama3-8b-8192';
const REFUSAL = 'I can only answer questions related to traffic.';

// Define the schema for a message in the conversation history.
export const Message = z.object({
	role: z.enum(['user', 'assistant']),
	content: z.string()
});
export type TMessage = z.infer<typeof Message>;

// Define the schema for a chat request from the user.
export const ChatRequest = z.object({
	query: z.string(),
	history: z.array(Message).optional()
});

/**
 * Uses the LLM to extract structured data (entities) from a user's query.
 * This helps the bot understand the user's intent.
 * @param query The user's latest message.
 * @param history The conversation history.
 * @returns A promise that resolves to an object containing the extracted entities (e.g., { road: 'A2', category: 'congestion' }).
 */
export async function extractEntities(
	query: string,
	history: TMessage[]
): Promise<{ roads?: string[]; categories?: string[] }> {
	try {
		const completion = await llm.chat.completions.create({
			model: MODEL,
			temperature: 0, // Low temperature for deterministic output
			response_format: { type: 'json_object' }, // We want the output to be JSON
			messages: [
				{
					role: 'system',
					content: `
						You are an entity extraction expert analyzing a conversation with a traffic bot.
						Your task is to identify the roads (e.g., A4, N57) and the incident categories the user is asking about, considering the full conversation history.
						Pay close attention to negations. If the user says "I am NOT interested in construction", you should not extract "construction" as a category.
						Valid categories are: "accident", "construction", "congestion", "obstruction", "weather".
						Map user terms like "road works" or "building" to "construction". Map "jams" to "congestion".
						Respond with a JSON object like {"roads": ["A58", "A2"], "categories": ["accident"]}.
						If a value isn't found in the conversation, omit its key. The values in the arrays should be strings.
					`
				},
				...(history as OpenAI.Chat.ChatCompletionMessageParam[]),
				{ role: 'user', content: query }
			]
		});

		try {
			const result = JSON.parse(completion.choices[0].message?.content ?? '{}');
			return {
				roads: result.roads,
				categories: result.categories
			};
		} catch (e) {
			console.error('Failed to parse entities from LLM response', e);
			return {};
		}
	} catch (e) {
		console.error('Error calling LLM for entity extraction:', e);
		return {}; // Return empty object on error
	}
}

/**
 * Groups a list of incidents by their category.
 * @param list The list of incidents.
 * @returns An object where keys are categories and values are lists of incidents.
 */
function groupByCategory(list: Clean[]) {
	return list.reduce<Record<Clean['category'], Clean[]>>(
		(acc, inc) => {
			(acc[inc.category] ||= []).push(inc);
			return acc;
		},
		{ accident: [], construction: [], congestion: [], obstruction: [], weather: [], other: [] } as any
	);
}

/**
 * Converts a list of grouped incidents into a markdown-formatted string.
 * @param groups The grouped incidents.
 * @returns A markdown string.
 */
function markdownFromGroups(groups: Record<string, Clean[]>): string {
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

/**
 * Generates a natural language answer based on a list of traffic incidents.
 * @param user The user's query.
 * @param subset The list of relevant incidents.
 * @param history The conversation history.
 * @returns A promise that resolves to a string containing the bot's reply.
 */
export async function answerFromIncidents(
	user: string,
	subset: Clean[],
	history: TMessage[]
): Promise<string> {
	if (subset.length === 0) {
		return `I couldn't find any information for that specific request. There might be no active incidents of that type right now.`;
	}

	// If there are too many incidents, just show a summary.
	if (subset.length > 15) {
		const groups = groupByCategory(subset.slice(0, 15));
		return markdownFromGroups(groups).slice(0, 1500);
	}

	const groups = groupByCategory(subset);
	const md = markdownFromGroups(groups);

	try {
		const completion = await llm.chat.completions.create({
			model: MODEL,
			temperature: 0.2, // Low temperature for more factual answers
			max_tokens: 250,
			messages: [
				{
					role: 'system',
					content: [
						'You are RoadBot, a friendly and concise traffic assistant for drivers in the Netherlands.',
						'Assume the user is traveling by car. Synthesize information from the conversation history with the user\'s latest query.',
						'Use ONLY the real-time traffic incidents provided below to answer. Do not add external info or make things up.',
						'Answer the user\'s question directly based on the provided data. Do not ask for information you should already have from the history (like origin/destination).',
						`If asked about something other than traffic, reply "${REFUSAL}" and nothing else.`
					].join(' ')
                },
                ...(history as OpenAI.Chat.ChatCompletionMessageParam[]),
                { role: 'system', content: `LATEST TRAFFIC DATA:\n${md}` },
                { role: 'user', content: user }
            ]
		});
		const reply = completion.choices[0].message?.content?.trim() ?? REFUSAL;
		return reply.length > 0 ? reply : REFUSAL;
	} catch (e) {
		console.error('Error calling LLM for incident answer:', e);
		return 'Sorry, I am having trouble connecting to the traffic information service right now. Please try again later.';
	}
}

/**
 * Generates a reply for a non-traffic-related query.
 * @param query The user's query.
 * @param history The conversation history.
 * @returns A promise that resolves to a string containing the bot's reply.
 */
export async function nonTrafficReply(query: string, history: TMessage[]): Promise<string> {
	try {
		const completion = await llm.chat.completions.create({
			model: MODEL,
			temperature: 0.7, // Higher temperature for more creative/natural conversation
			max_tokens: 200,
			messages: [
				{
					role: 'system',
					content:
						'You are a friendly chat assistant for a Dutch road-status app, designed for drivers. Assume the user is traveling by car. Answer in natural, helpful English, using the conversation history for context.'
				},
				...(history as OpenAI.Chat.ChatCompletionMessageParam[]),
				{ role: 'user', content: query }
			]
		});
		return completion.choices[0].message?.content?.trim() || 'I am not sure how to respond to that.';
	} catch (e) {
		console.error('Error calling LLM for non-traffic reply:', e);
		return 'Sorry, I am currently unable to process general questions. Please try again later.';
	}
}