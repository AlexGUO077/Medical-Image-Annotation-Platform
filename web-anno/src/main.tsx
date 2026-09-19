import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

import 'antd/dist/reset.css';
import './styles/global.css';
import { App } from './app/App';

const rootElement = document.getElementById('root');

if (!rootElement) {
  throw new Error('Application root is unavailable');
}

createRoot(rootElement).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
