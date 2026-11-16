import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import './styles.css';
import './motion.css';
import { applyTheme, loadSettings } from './settings';

// Apply the saved theme before the first render to avoid a light flash.
applyTheme(loadSettings().theme);

ReactDOM.createRoot(document.getElementById('root')!).render(<React.StrictMode><App /></React.StrictMode>);
