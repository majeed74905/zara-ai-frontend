import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import './styles/themes.css'; // Import theme variables
import { ThemeProvider } from './theme/ThemeContext';
import AnalyticsTracker from './components/AnalyticsTracker';

import { BrowserRouter } from 'react-router-dom';

const rootElement = document.getElementById('root');
if (!rootElement) {
  throw new Error("Could not find root element to mount to");
}

// MED-4: Hide the static hero section once React mounts (it was shown for slow/no-JS users)
const staticHero = document.getElementById('static-hero');
if (staticHero) {
  staticHero.style.display = 'none';
}

// LOW-1: Backend cold-start warning — Render free tier spins down after 15min inactivity.
// The first request after a cold start can take ~30s. The App component handles this via
// retry logic in sendMessageToBackend(). Consider pinging /health every 10min via UptimeRobot
// or upgrading to Render paid tier to keep the server warm.

const root = ReactDOM.createRoot(rootElement);
root.render(
  <React.StrictMode>
    <BrowserRouter>
      <AnalyticsTracker />
      <ThemeProvider>
        <App />
      </ThemeProvider>
    </BrowserRouter>
  </React.StrictMode>
);
