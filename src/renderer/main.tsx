import React from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { initStore } from './store';
import './styles.css';

async function boot(): Promise<void> {
  await initStore();
  createRoot(document.getElementById('root')!).render(<App />);
}

void boot();
