<script lang="ts">
	import { onMount } from 'svelte';

	// Defines the structure for a chat message, ensuring type consistency.
	type TMessage = {
		role: 'user' | 'assistant';
		content: string;
	};

	// Reactive Svelte state variables for managing the chat interface.
	let query = ''; // Stores the current user input.
	let history: TMessage[] = []; // Stores the conversation history.
	let loading = false; // Indicates if the bot is currently processing a request.
	let chatContainer: HTMLElement; // Binds to the chat display area for scroll management.

	// Lifecycle hook: Initializes the chat with a welcome message when the component mounts.
	onMount(() => {
		history = [{ role: 'assistant', content: 'Hello! How can I assist you with traffic information today?' }];
	});

	/**
	 * Handles the submission of a user query.
	 * - Prevents submission if the query is empty or the bot is already loading.
	 * - Updates the chat history with the user's message.
	 * - Calls the backend API to get the bot's reply.
	 * - Manages loading state and scrolls the chat view to the latest message.
	 * - Implements basic error handling for network requests.
	 */
	async function handleSubmit() {
		if (!query.trim() || loading) return;

		const userQuery = query;
		query = ''; // Clear the input field.
		loading = true; // Set loading state to true.
		history = [...history, { role: 'user', content: userQuery }]; // Add user message to history.

		// Scrolls to the bottom to show the latest message immediately after user input.
		setTimeout(() => {
			if (chatContainer) {
				chatContainer.scrollTop = chatContainer.scrollHeight;
			}
		}, 0);

		try {
			const res = await fetch('/api/chat', {
				method: 'POST',
				headers: {
					'Content-Type': 'application/json'
				},
				// Sends the current query and a slice of history (excluding the latest user message, as it's already added).
				body: JSON.stringify({ query: userQuery, history: history.slice(0, -1) })
			});

			if (!res.ok) {
				throw new Error('Network response was not ok');
			}

			const data = await res.json();
			history = [...history, { role: 'assistant', content: data.reply }]; // Add bot's reply to history.
		} catch (error) {
			console.error('Fetch error:', error);
			history = [
				...history,
				{ role: 'assistant', content: 'Sorry, something went wrong. Please try again.' } // Display error message.
			];
		} finally {
			loading = false; // Reset loading state.
			// Scrolls to the bottom again after the bot has replied.
			setTimeout(() => {
				if (chatContainer) {
					chatContainer.scrollTop = chatContainer.scrollHeight;
				}
			}, 0);
		}
	}
</script>

<!-- Main chat interface layout, using Tailwind CSS for styling. -->
<div class="flex flex-col h-screen max-w-3xl mx-auto p-4">
	<!-- Chat header with application title and description. -->
	<header class="py-4 border-b border-gray-700">
		<h1 class="text-2xl font-bold text-center text-gray-100">Traffic Bot</h1>
		<p class="text-center text-gray-400">Your real-time traffic assistant for the Netherlands</p>
	</header>

	<!-- Chat messages display area. Automatically scrolls to the bottom. -->
	<div bind:this={chatContainer} class="flex-1 overflow-y-auto py-4 space-y-6">
		{#each history as message, i (i)}
			<div class="flex items-start gap-4">
				<!-- Avatar for user or assistant. -->
				<div
					class="flex-shrink-0 h-8 w-8 rounded-full flex items-center justify-center font-bold text-white"
					class:bg-blue-600={message.role === 'assistant'}
					class:bg-gray-600={message.role === 'user'}
				>
					{message.role === 'assistant' ? 'B' : 'U'}
				</div>
				<!-- Message bubble, styled based on sender. -->
				<div
					class="p-4 rounded-lg max-w-xl"
					class:bg-gray-800={message.role === 'user'}
					class:bg-blue-950={message.role === 'assistant'}
				>
					<div class="whitespace-pre-wrap">{@html message.content}</div>
				</div>
			</div>
		{/each}

		<!-- Loading indicator displayed when the bot is processing. -->
		{#if loading}
			<div class="flex items-start gap-4">
				<div class="flex-shrink-0 h-8 w-8 rounded-full bg-blue-600 flex items-center justify-center">
					<div class="w-2 h-2 bg-white rounded-full animate-pulse"></div>
				</div>
				<div class="p-4 rounded-lg bg-blue-950">
					<p>Thinking...</p>
				</div>
			</div>
		{/if}
	</div>

	<!-- Chat input form. -->
	<footer class="py-4">
		<form on:submit|preventDefault={handleSubmit} class="flex items-center gap-2">
			<input
				bind:value={query}
				type="text"
				placeholder="Ask about traffic on the A2, construction, etc..."
				class="w-full px-4 py-2 bg-gray-800 border border-gray-700 rounded-full focus:outline-none focus:ring-2 focus:ring-blue-500 transition-shadow"
				autocomplete="off"
				spellcheck="false"
				aria-label="Chat input"
			/>
			<button
				type="submit"
				class="px-4 py-2 bg-blue-600 text-white font-semibold rounded-full hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:bg-gray-600 transition-colors"
				aria-label="Send message"
				disabled={loading || !query.trim()}
			>
				Send
			</button>
		</form>
	</footer>
</div>
