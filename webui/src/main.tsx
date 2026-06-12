import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './index.css';
import NetJepaApp from './app/NetJepaApp';
import ErrorBoundary from './app/ErrorBoundary';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ErrorBoundary>
      <NetJepaApp />
    </ErrorBoundary>
  </StrictMode>,
);
