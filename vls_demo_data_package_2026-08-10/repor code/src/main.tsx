import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import { MenuProvider } from './components/MenuProvider';
import { ToastProvider } from './components/Toast';
import './styles.css';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ToastProvider>
      <MenuProvider>
        <App />
      </MenuProvider>
    </ToastProvider>
  </StrictMode>,
);
