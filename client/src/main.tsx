import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './styles/global.css';
import { App } from './App.tsx';
import { CardGallery } from './dev/CardGallery.tsx';

const isDevGallery = new URLSearchParams(location.search).get('dev') === 'cards';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <div className="app-bg" />
    {isDevGallery ? <CardGallery /> : <App />}
  </StrictMode>,
);
