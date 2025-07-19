# RoadBot

RoadBot is a sophisticated, SvelteKit-powered chatbot designed to deliver real-time traffic information for the Netherlands. It leverages the ANWB API for up-to-the-minute traffic data and the Groq API for advanced natural language processing, providing a seamless, conversational user experience.

## The "Why": Project Philosophy and Design Choices

This project was born from a simple idea: accessing traffic information should be as easy as having a conversation. Traditional traffic apps can be cumbersome, requiring users to navigate complex menus and maps. RoadBot, on the other hand, allows you to get the information you need by simply asking for it in plain English.

### Key Architectural Decisions:

*   **Conversational AI for a Natural User Experience:** We chose a chatbot interface to make the application feel intuitive and conversational. Instead of clicking buttons, users can ask questions like, "What's the traffic like on the A12?" or "Any accidents near Rotterdam?". This approach is not only more user-friendly but also more flexible, allowing for a wider range of queries.

*   **SvelteKit for a High-Performance Frontend:** SvelteKit was selected for its speed, simplicity, and server-side rendering (SSR) capabilities. SSR is crucial for a fast initial load time, which is essential for a good user experience. SvelteKit also provides a robust framework for building modern, reactive web applications.

*   **Groq for Real-Time Language Processing:** The Groq API provides access to a powerful Large Language Model (LLM) that is optimized for speed and real-time applications. This allows RoadBot to understand and respond to user queries almost instantly, which is critical for a chatbot that needs to feel responsive.

*   **ANWB API for Reliable Traffic Data:** The ANWB is the most trusted source of traffic information in the Netherlands. By using their API, we ensure that RoadBot provides accurate and up-to-date information on traffic jams, accidents, road work, and other incidents.

*   **Server-Side API Key Management for Security:** All API keys are stored and used exclusively on the server. This is a critical security measure that prevents the keys from being exposed to the client-side, where they could be compromised.

## Features

*   **Conversational Interface:** Ask about traffic in plain English.
*   **Real-Time Data:** Get up-to-the-minute information on traffic jams, accidents, and road work from the ANWB.
*   **Context-Aware:** The bot can remember the context of your conversation, so you can ask follow-up questions without repeating yourself.
*   **Secure:** API keys are stored securely on the server and are never exposed to the client.
*   **Robust Error Handling:** The bot is designed to handle a wide range of user inputs and edge cases, including ambiguous queries, negations, and mixed queries.

## Tech Stack

*   **SvelteKit:** A modern web framework for building high-performance web applications.
*   **Groq:** Provides the Large Language Model (LLM) for understanding and responding to user queries.
*   **ANWB API:** The source of real-time traffic data.
*   **TypeScript:** For type-safe code.
*   **Vite:** A fast build tool for modern web projects.


## Getting Started

### Prerequisites

*   Node.js (v18 or higher)
*   npm, pnpm, or yarn

### Setup

1.  **Clone the repository:**
    ```bash
    git clone <repository-url>
    cd traffic-bot
    ```

2.  **Install the dependencies:**
    ```bash
    npm install
    ```

3.  **Create a `.env` file:**
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



## Building for Production

To create a production build of the application, run:
```bash
npm run build
```

You can preview the production build with `npm run preview`.
