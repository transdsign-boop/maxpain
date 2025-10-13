import { createRoot } from "react-dom/client";
import App from "./App";
import { ErrorBoundary } from "./components/ErrorBoundary";
import "./index.css";

// Prevent Vite HMR WebSocket errors from crashing the app
window.addEventListener('unhandledrejection', (event) => {
  const error = event.reason;
  
  // Suppress Vite HMR WebSocket errors (expected in Replit environment)
  if (error?.message?.includes('WebSocket') && error?.message?.includes('localhost:undefined')) {
    console.warn('Suppressed Vite HMR WebSocket error (expected in Replit)');
    event.preventDefault();
    return;
  }
});

createRoot(document.getElementById("root")!).render(
  <ErrorBoundary>
    <App />
  </ErrorBoundary>
);
