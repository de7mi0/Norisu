import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
// The four typefaces, served from this site rather than from Google Fonts,
// which handed Google every visitor's network address on the first screen.
// All four are under the SIL Open Font License, which permits bundling them.
import '@fontsource/manrope/400.css';
import '@fontsource/manrope/500.css';
import '@fontsource/manrope/600.css';
import '@fontsource/manrope/700.css';
import '@fontsource/manrope/800.css';
import '@fontsource/cormorant-garamond/500.css';
import '@fontsource/cormorant-garamond/600.css';
import '@fontsource/cormorant-garamond/500-italic.css';
import '@fontsource/aref-ruqaa/400.css';
import '@fontsource/aref-ruqaa/700.css';
import '@fontsource/ibm-plex-sans-arabic/400.css';
import '@fontsource/ibm-plex-sans-arabic/500.css';
import '@fontsource/ibm-plex-sans-arabic/600.css';
import '@fontsource/ibm-plex-sans-arabic/700.css';
import './styles/global.css';

const container = document.getElementById('root');
if (!container) throw new Error('Root container #root is missing from index.html');

createRoot(container).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
