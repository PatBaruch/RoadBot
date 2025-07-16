// svelte.config.js
import adapter from '@sveltejs/adapter-auto';

/** @type {import('@sveltejs/kit').Config} */
export default {
  preprocess: [], // Or just omit the preprocess line if it's not needed
  kit: {
    adapter: adapter()
  }
};