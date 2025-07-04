# RoadBot

This is a SvelteKit-powered chatbot that provides real-time traffic information for the Netherlands. It uses the ANWB API for traffic data and the Groq API for natural language processing.

## Features

- **Conversational Interface:** Ask about traffic in plain English.
- **Real-Time Data:** Get up-to-the-minute information on traffic jams, accidents, and road work from the ANWB.
- **Context-Aware:** The bot can remember the context of your conversation, so you can ask follow-up questions without repeating yourself.
- **Secure:** API keys are stored securely on the server and are never exposed to the client.

## Tech Stack

- **SvelteKit:** A modern web framework for building high-performance web applications.
- **Groq:** Provides the Large Language Model (LLM) for understanding and responding to user queries.
- **ANWB API:** The source of real-time traffic data.
- **TypeScript:** For type-safe code.
- **Vite:** A fast build tool for modern web projects.
- **Vitest:** A testing framework for running unit and integration tests.

## Getting Started

### Prerequisites

- Node.js (v18 or higher)
- npm, pnpm, or yarn

### Setup

1. **Clone the repository:**
   ```bash
   git clone <repository-url>
   cd traffic-bot
   ```

2. **Install the dependencies:**
   ```bash
   npm install
   ```

3. **Create a `.env` file:**
   Create a `.env` file in the root of the project and add your API keys:
   ```
   GROQ_API_KEY="your-groq-api-key"
   ANWB_API_KEY="your-anwb-api-key"
   ```

### Running the Development Server

To start the development server, run:
```bash
npm run dev
```

### Running Tests

To run the test suite, use:
```bash
npm test
```

## Building for Production

To create a production build of the application, run:
```bash
npm run build
```

You can preview the production build with `npm run preview`.