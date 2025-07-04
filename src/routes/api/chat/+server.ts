/**
 * This file defines the API endpoint for the chatbot.
 * It handles the web request and response, but the core logic is in bot.ts.
 */

import { json, type RequestHandler } from '@sveltejs/kit';
import { getReply } from '../../../lib/server/bot';
import { ChatRequest } from '../../../lib/server/llm';

export const POST: RequestHandler = async ({ request }) => {
	// 1. Get the user's query and conversation history from the request body.
	const body = await request.json();

	// 2. Validate the request body to make sure it has the correct format.
	const validation = ChatRequest.safeParse(body);
	if (!validation.success) {
		return json({ error: 'Invalid request body', details: validation.error.flatten() }, { status: 400 });
	}

	const { query, history = [] } = validation.data;

	// 3. Get the bot's reply using the main logic in bot.ts.
	const reply = await getReply(query, history);

	// 4. Send the reply back to the user.
	return json({ reply });
};
