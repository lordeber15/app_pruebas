import { useQueryClient } from '@tanstack/react-query';
import {
  createRootRoute,
  createRoute,
  createRouter,
  Link,
  Outlet,
  useNavigate,
  useRouterState,
} from '@tanstack/react-router';
import { useEffect } from 'react';
import { api, ErrorApi } from './api.ts';
import { Cargando } from './componentes/Ui.tsx';
import { Dispositivos, Usuarios } from './paginas/Administracion.tsx';
import { Entrar } from './paginas/Entrar.tsx';
import { Equipo, Estaciones, MarcoProyecto, Proyectos } from './paginas/Proyectos.tsx';
import { Revisiones } from './paginas/Revisiones.tsx';
import { puede, useYo } from './sesion.ts';

const enlaceMenu =
  'flex min-h-11 items-center rounded-md px-3 text-sm font-medium text-tinta-suave hover:bg-liquen-claro hover:text-tinta';
const enlaceActivo = 'bg-liquen-claro text-liquen-oscuro font-semibold';

const Marco = () => {
  const ruta = useRouterState({ select: (s) => s.location.pathname });
  const yo = useYo();
  const navegar = useNavigate();
  const qc = useQueryClient();
  const esIngreso = ruta === '/entrar';

  useEffect(() => {
    if (!esIngreso && yo.error instanceof ErrorApi && yo.error.estado === 401) {
      void navegar({ to: '/entrar' });
    }
  }, [esIngreso, yo.error, navegar]);

  if (esIngreso) return <Outlet />;
  if (yo.isPending)
    return (
      <div className="p-8">
        <Cargando que="su sesión" />
      </div>
    );
  if (yo.data === undefined) return null;
  const p = puede(yo.data);

  const salir = async () => {
    await api.salir().catch(() => undefined);
    qc.clear();
    await navegar({ to: '/entrar' });
  };

  return (
    <div className="flex min-h-dvh flex-col md:flex-row">
      <a
        href="#contenido"
        className="sr-only focus:not-sr-only focus:absolute focus:left-2 focus:top-2 focus:z-50 focus:rounded-md focus:bg-hoja focus:px-3 focus:py-2"
      >
        Saltar al contenido
      </a>
      <aside className="border-b border-linea bg-hoja md:w-60 md:shrink-0 md:border-b-0 md:border-r">
        <div className="flex items-center gap-2 px-4 py-4">
          <svg width="22" height="22" viewBox="0 0 16 16" aria-hidden="true">
            <path
              d="M8 1.8 L14.2 8 L8 14.2 L1.8 8 Z"
              fill="none"
              stroke="#2e5e4e"
              strokeWidth="1.6"
            />
            <circle cx="8" cy="8" r="2.2" fill="#2e5e4e" />
          </svg>
          <span className="font-bold">Supervisión de campo</span>
        </div>
        <nav aria-label="Principal" className="flex gap-1 overflow-x-auto px-2 pb-3 md:flex-col">
          <Link
            to="/"
            className={enlaceMenu}
            activeProps={{ className: enlaceActivo }}
            activeOptions={{ exact: true }}
          >
            Proyectos
          </Link>
          {p.administrar ? (
            <>
              <Link
                to="/admin/usuarios"
                className={enlaceMenu}
                activeProps={{ className: enlaceActivo }}
              >
                Usuarios
              </Link>
              <Link
                to="/admin/dispositivos"
                className={enlaceMenu}
                activeProps={{ className: enlaceActivo }}
              >
                Dispositivos
              </Link>
            </>
          ) : null}
        </nav>
        <div className="hidden border-t border-linea px-4 py-4 text-sm md:block">
          <p className="font-semibold">{yo.data.nombre}</p>
          <p className="text-tinta-suave">
            {yo.data.tipo_documento} {yo.data.num_documento}
          </p>
          <button
            type="button"
            onClick={() => void salir()}
            className="mt-2 min-h-11 font-semibold text-liquen underline-offset-4 hover:underline"
          >
            Cerrar sesión
          </button>
        </div>
      </aside>
      <main id="contenido" className="min-w-0 flex-1 px-4 py-6 md:px-8">
        <Outlet />
      </main>
    </div>
  );
};

const raiz = createRootRoute({ component: Marco });
const entrar = createRoute({ getParentRoute: () => raiz, path: '/entrar', component: Entrar });
const inicio = createRoute({ getParentRoute: () => raiz, path: '/', component: Proyectos });
const proyecto = createRoute({
  getParentRoute: () => raiz,
  path: '/p/$proyectoId',
  component: MarcoProyecto,
});
const estaciones = createRoute({
  getParentRoute: () => proyecto,
  path: '/',
  component: Estaciones,
});
const equipo = createRoute({ getParentRoute: () => proyecto, path: '/equipo', component: Equipo });
const revisiones = createRoute({
  getParentRoute: () => proyecto,
  path: '/revisiones',
  component: Revisiones,
});
const usuarios = createRoute({
  getParentRoute: () => raiz,
  path: '/admin/usuarios',
  component: Usuarios,
});
const dispositivos = createRoute({
  getParentRoute: () => raiz,
  path: '/admin/dispositivos',
  component: Dispositivos,
});

export const router = createRouter({
  routeTree: raiz.addChildren([
    entrar,
    inicio,
    proyecto.addChildren([estaciones, equipo, revisiones]),
    usuarios,
    dispositivos,
  ]),
});

declare module '@tanstack/react-router' {
  interface Register {
    router: typeof router;
  }
}
