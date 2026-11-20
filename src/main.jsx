import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { AuthProvider } from './lib/auth.jsx';
import App from './App.jsx';
import './index.css';

// After a deploy, a tab left open still points at the last build's code files, which are gone: loading a part of the app
// it hasn't used yet (a PDF builder, a page) then fails. Vite reports that here; reload once so the tab picks up the
// new build. The time check stops a loop if the file is missing for some other reason.
window.addEventListener('vite:preloadError', (event) => {
  let last = 0;
  try { last = Number(sessionStorage.getItem('kit.reloadedAt')) || 0; } catch { /* no storage */ }
  if (Date.now() - last < 30000) return; // just reloaded and it still fails: let the error show
  try { sessionStorage.setItem('kit.reloadedAt', String(Date.now())); } catch { /* no storage */ }
  event.preventDefault();
  window.location.reload();
});

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <BrowserRouter>
      <AuthProvider>
        <App />
      </AuthProvider>
    </BrowserRouter>
  </StrictMode>,
);
