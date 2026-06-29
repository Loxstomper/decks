import './app.css';
import { mount } from 'svelte';
import App from './App.svelte';

// Svelte 5: components are mounted with mount() rather than `new Component()`.
// Our components use runes ($state/$props), so they compile in runes mode and
// are not instantiable with `new`.
const app = mount(App, {
  target: document.getElementById('app')!,
});

export default app;
