import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { RouterProvider } from '@tanstack/react-router';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { ErrorApi } from './api.ts';
import './estilos.css';
import { router } from './rutas.tsx';

const consultas = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 15_000,
      // Un 401 o 403 no se reintenta: la sesión venció o no hay permiso.
      retry: (intentos, error) =>
        !(error instanceof ErrorApi && error.estado >= 400 && error.estado < 500) && intentos < 2,
    },
  },
});

const raiz = document.getElementById('raiz');
if (raiz === null) throw new Error('Falta el contenedor #raiz');

createRoot(raiz).render(
  <StrictMode>
    <QueryClientProvider client={consultas}>
      <RouterProvider router={router} />
    </QueryClientProvider>
  </StrictMode>,
);
