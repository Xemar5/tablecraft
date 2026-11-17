import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import './styles.css';
import './motion.css';
import { applyTheme, loadSettings } from './settings';
import { applyUiScale } from './uiScale';

// Apply the saved theme and interface scale before the first render to avoid a flash.
const initialSettings = loadSettings();
applyTheme(initialSettings.theme);
applyUiScale(initialSettings.uiScale);

ReactDOM.createRoot(document.getElementById('root')!).render(<React.StrictMode><App /></React.StrictMode>);
