import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { Pitch } from './views/Pitch';
import './pitch.css';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Pitch />
  </StrictMode>,
);
