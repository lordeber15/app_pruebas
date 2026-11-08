import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, Outlet, useParams } from '@tanstack/react-router';
import { useState, type ReactNode } from 'react';
import {
  api,
  ETIQUETA_ROL_BRIGADA,
  type Brigada,
  type Estacion,
  type Miembro,
  type Proyecto,
  type RolBrigada,
  type Usuario,
} from '../api.ts';
import { Mapa } from '../componentes/MapaDiferido.tsx';
import {
  AvisoError,
  Boton,
  Campo,
  Cargando,
  claseEntrada,
  Dialogo,
  Encabezado,
  Tabla,
  td,
  th,
  Vacio,
} from '../componentes/Ui.tsx';
import { puede, useYo } from '../sesion.ts';

export const useProyectoId = (): string => useParams({ from: '/p/$proyectoId' }).proyectoId;

/** Formulario en diálogo: un solo patrón para todas las altas. */
const FormularioDialogo = ({
  titulo,
  boton,
  abrir,
  alGuardar,
  children,
}: {
  titulo: string;
  boton: string;
  abrir: ReactNode;
  alGuardar: () => Promise<unknown>;
  children: ReactNode;
}) => {
  const [abierto, setAbierto] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [ocupado, setOcupado] = useState(false);
  const enviar = async (ev: React.SyntheticEvent<HTMLFormElement>) => {
    ev.preventDefault();
    setError(null);
    setOcupado(true);
    try {
      await alGuardar();
      setAbierto(false);
    } catch (e) {
      setError(e);
    } finally {
      setOcupado(false);
    }
  };
  return (
    <>
      <Boton onClick={() => setAbierto(true)}>{abrir}</Boton>
      <Dialogo abierto={abierto} titulo={titulo} alCerrar={() => setAbierto(false)}>
        <form onSubmit={(ev) => void enviar(ev)} className="flex flex-col gap-4">
          {children}
          <AvisoError error={error} />
          <div className="flex justify-end gap-2">
            <Boton variante="secundario" onClick={() => setAbierto(false)}>
              Cancelar
            </Boton>
            <Boton type="submit" ocupado={ocupado}>
              {boton}
            </Boton>
          </div>
        </form>
      </Dialogo>
    </>
  );
};
export { FormularioDialogo };

// ── Lista de proyectos ──

export const Proyectos = () => {
  const yo = useYo();
  const qc = useQueryClient();
  const q = useQuery({
    queryKey: ['proyectos'],
    queryFn: () => api.get<{ proyectos: Proyecto[] }>('/proyectos'),
  });
  const [nombre, setNombre] = useState('');
  const [validacion, setValidacion] = useState(true);
  const [originales, setOriginales] = useState(false);
  const activos = q.data?.proyectos.filter((p) => p.estado === 'activo').length ?? 0;

  return (
    <>
      <Encabezado titulo="Proyectos">
        {puede(yo.data).gestionar ? (
          <FormularioDialogo
            titulo="Nuevo proyecto"
            boton="Crear proyecto"
            abrir="Nuevo proyecto"
            alGuardar={async () => {
              await api.post('/proyectos', {
                nombre,
                validacion_activa: validacion,
                subir_originales: originales,
              });
              setNombre('');
              await qc.invalidateQueries({ queryKey: ['proyectos'] });
            }}
          >
            <Campo etiqueta="Nombre del proyecto">
              {(id) => (
                <input
                  id={id}
                  value={nombre}
                  onChange={(e) => setNombre(e.target.value)}
                  required
                  className={claseEntrada}
                />
              )}
            </Campo>
            <label className="flex min-h-11 items-center gap-3 text-sm">
              <input
                type="checkbox"
                checked={validacion}
                onChange={(e) => setValidacion(e.target.checked)}
                className="size-5 accent-liquen"
              />
              Las ejecuciones se validan antes de cerrarse (validación humana, C1)
            </label>
            <label className="flex min-h-11 items-center gap-3 text-sm">
              <input
                type="checkbox"
                checked={originales}
                onChange={(e) => setOriginales(e.target.checked)}
                className="size-5 accent-liquen"
              />
              Subir también las fotos originales (solo con WiFi)
            </label>
            <p className="text-xs text-tinta-suave">Hay {activos} de 6 proyectos activos.</p>
          </FormularioDialogo>
        ) : null}
      </Encabezado>
      {q.isPending ? <Cargando que="los proyectos" /> : null}
      <AvisoError error={q.error} />
      {q.data?.proyectos.length === 0 ? (
        <Vacio titulo="Aún no hay proyectos a su alcance">
          {puede(yo.data).gestionar
            ? 'Cree el primero con el botón Nuevo proyecto.'
            : 'Cuando lo incluyan en una brigada, su proyecto aparecerá aquí.'}
        </Vacio>
      ) : null}
      {q.data !== undefined && q.data.proyectos.length > 0 ? (
        <ul className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {q.data.proyectos.map((p) => (
            <li key={p.id}>
              <Link
                to="/p/$proyectoId"
                params={{ proyectoId: p.id }}
                className="flex h-full flex-col gap-2 rounded-md border border-linea bg-hoja p-4 hover:border-liquen"
              >
                <span className="text-lg font-semibold">{p.nombre}</span>
                <span className="text-sm text-tinta-suave">
                  {p.estado === 'activo' ? 'Activo' : 'Cerrado'}.{' '}
                  {p.validacion_activa ? 'Con validación' : 'Sin validación'}. Bloqueo a los{' '}
                  {p.dias_bloqueo} días sin sincronizar.
                </span>
              </Link>
            </li>
          ))}
        </ul>
      ) : null}
    </>
  );
};

// ── Marco del proyecto ──

const PESTANAS = [
  { a: '/p/$proyectoId', texto: 'Estaciones', exacto: true },
  { a: '/p/$proyectoId/equipo', texto: 'Brigadas' },
  { a: '/p/$proyectoId/revisiones', texto: 'Revisiones' },
  { a: '/p/$proyectoId/alertas', texto: 'Alertas' },
] as const;

export const MarcoProyecto = () => {
  const proyectoId = useProyectoId();
  const q = useQuery({
    queryKey: ['proyecto', proyectoId],
    queryFn: () => api.get<Proyecto>(`/proyectos/${proyectoId}`),
  });
  return (
    <>
      <p className="mb-1 text-sm">
        <Link to="/" className="text-liquen underline-offset-4 hover:underline">
          Proyectos
        </Link>
      </p>
      <h1 className="mb-4 text-2xl font-bold tracking-tight">{q.data?.nombre ?? 'Proyecto'}</h1>
      <AvisoError error={q.error} />
      <nav
        aria-label="Secciones del proyecto"
        className="mb-6 flex gap-1 overflow-x-auto border-b border-linea"
      >
        {PESTANAS.map((p) => (
          <Link
            key={p.a}
            to={p.a}
            params={{ proyectoId }}
            activeOptions={{ exact: 'exacto' in p }}
            className="-mb-px flex min-h-11 items-center whitespace-nowrap border-b-2 border-transparent px-3 text-sm font-medium text-tinta-suave hover:text-tinta"
            activeProps={{ className: 'border-liquen! text-liquen-oscuro! font-semibold' }}
          >
            {p.texto}
          </Link>
        ))}
      </nav>
      <Outlet />
    </>
  );
};

// ── Brigadas y sus integrantes ──

const ROLES: readonly RolBrigada[] = ['especialista', 'supervisor_campo', 'jefe_brigada'];
const esRol = (x: string): x is RolBrigada => (ROLES as readonly string[]).includes(x);

const useUsuarios = (habilitado: boolean) =>
  useQuery({
    queryKey: ['usuarios'],
    queryFn: () => api.get<{ usuarios: Usuario[] }>('/admin/usuarios'),
    enabled: habilitado,
  });

const nombreBrigada = (b: Brigada): string =>
  b.codigo === null || b.codigo === b.nombre ? b.nombre : `${b.codigo} · ${b.nombre}`;

const MiembrosBrigada = ({ brigada, gestionar }: { brigada: Brigada; gestionar: boolean }) => {
  const qc = useQueryClient();
  const q = useQuery({
    queryKey: ['miembros', brigada.id],
    queryFn: () => api.get<{ miembros: Miembro[] }>(`/brigadas/${brigada.id}/miembros`),
  });
  const usuarios = useUsuarios(gestionar);
  const [usuarioId, setUsuarioId] = useState('');
  const [rol, setRol] = useState<RolBrigada>('especialista');
  const retirar = useMutation({
    mutationFn: (id: string) => api.patch(`/miembros/${id}`, { estado: 'retirado' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['miembros', brigada.id] }),
  });

  return (
    <section className="rounded-md border border-linea bg-hoja p-4">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div>
          <h3 className="text-lg font-semibold">{nombreBrigada(brigada)}</h3>
          <p className="text-sm text-tinta-suave">
            {brigada.region === null ? 'Sin región' : brigada.region}
            {brigada.tipo === 'regular' ? '' : `, ${brigada.tipo}`}
          </p>
        </div>
        {gestionar ? (
          <FormularioDialogo
            titulo={`Agregar a ${nombreBrigada(brigada)}`}
            boton="Agregar"
            abrir="Agregar persona"
            alGuardar={async () => {
              await api.post(`/brigadas/${brigada.id}/miembros`, { usuario_id: usuarioId, rol });
              await qc.invalidateQueries({ queryKey: ['miembros', brigada.id] });
            }}
          >
            <Campo etiqueta="Persona">
              {(id) => (
                <select
                  id={id}
                  value={usuarioId}
                  onChange={(e) => setUsuarioId(e.target.value)}
                  required
                  className={claseEntrada}
                >
                  <option value="">Elija una persona</option>
                  {usuarios.data?.usuarios
                    .filter((u) => u.estado === 'activo' && u.rol_global === 'ninguno')
                    .map((u) => (
                      <option key={u.id} value={u.id}>
                        {u.nombre} ({u.tipo_documento} {u.num_documento})
                      </option>
                    ))}
                </select>
              )}
            </Campo>
            <Campo
              etiqueta="Rol en la brigada"
              ayuda="El Jefe de Brigada es el rol logístico: no ejecuta métodos (ERS §2.2)."
            >
              {(id) => (
                <select
                  id={id}
                  value={rol}
                  onChange={(e) => {
                    if (esRol(e.target.value)) setRol(e.target.value);
                  }}
                  className={claseEntrada}
                >
                  {ROLES.map((r) => (
                    <option key={r} value={r}>
                      {ETIQUETA_ROL_BRIGADA[r]}
                    </option>
                  ))}
                </select>
              )}
            </Campo>
          </FormularioDialogo>
        ) : null}
      </div>
      <AvisoError error={q.error ?? retirar.error} />
      {q.data?.miembros.length === 0 ? (
        <p className="text-sm text-tinta-suave">Aún no tiene integrantes.</p>
      ) : null}
      <ul className="divide-y divide-linea">
        {q.data?.miembros.map((m) => (
          <li key={m.id} className="flex min-h-11 items-center justify-between gap-2 py-1 text-sm">
            <span className="font-medium">{m.nombre}</span>
            <span className="flex items-center gap-3 text-tinta-suave">
              {ETIQUETA_ROL_BRIGADA[m.rol]}
              {m.estado === 'retirado' ? ', retirado' : ''}
              {gestionar && m.estado === 'activo' ? (
                <Boton variante="secundario" onClick={() => retirar.mutate(m.id)}>
                  Retirar
                </Boton>
              ) : null}
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
};

export const Equipo = () => {
  const proyectoId = useProyectoId();
  const yo = useYo();
  const qc = useQueryClient();
  const p = puede(yo.data);
  const brigadas = useQuery({
    queryKey: ['brigadas', proyectoId],
    queryFn: () => api.get<{ brigadas: Brigada[] }>(`/proyectos/${proyectoId}/brigadas`),
  });
  const [nombre, setNombre] = useState('');

  return (
    <section>
      <Encabezado titulo="Brigadas">
        {p.gestionar ? (
          <FormularioDialogo
            titulo="Nueva brigada"
            boton="Crear brigada"
            abrir="Nueva brigada"
            alGuardar={async () => {
              await api.post(`/proyectos/${proyectoId}/brigadas`, { nombre });
              setNombre('');
              await qc.invalidateQueries({ queryKey: ['brigadas', proyectoId] });
            }}
          >
            <Campo etiqueta="Nombre de la brigada">
              {(id) => (
                <input
                  id={id}
                  value={nombre}
                  onChange={(e) => setNombre(e.target.value)}
                  required
                  className={claseEntrada}
                />
              )}
            </Campo>
          </FormularioDialogo>
        ) : null}
      </Encabezado>
      <p className="-mt-3 mb-4 max-w-prose text-sm text-tinta-suave">
        Las brigadas y su programación llegan con la carga de A01. Aquí se arma cada brigada con sus
        integrantes: cada especialista registra su propia ejecución en el celular.
      </p>
      {brigadas.isPending ? <Cargando que="las brigadas" /> : null}
      <AvisoError error={brigadas.error} />
      {brigadas.data?.brigadas.length === 0 ? (
        <Vacio titulo="Este proyecto aún no tiene brigadas">
          Cargue D01 y A01 o cree una brigada con el botón Nueva brigada.
        </Vacio>
      ) : null}
      <div className="grid gap-4 lg:grid-cols-2">
        {brigadas.data?.brigadas.map((b) =>
          p.verMiembros(b.id) ? (
            <MiembrosBrigada key={b.id} brigada={b} gestionar={p.gestionar} />
          ) : (
            <section key={b.id} className="rounded-md border border-linea bg-hoja p-4">
              <h3 className="text-lg font-semibold">{nombreBrigada(b)}</h3>
              <p className="text-sm text-tinta-suave">{b.region ?? 'Sin región'}</p>
            </section>
          ),
        )}
      </div>
    </section>
  );
};

// ── Estaciones (A01) ──

const atributo = (v: string | null): string => (v === null || v === '' ? 'Sin dato' : v);

export const Estaciones = () => {
  const proyectoId = useProyectoId();
  const est = useQuery({
    queryKey: ['estaciones', proyectoId],
    queryFn: () => api.get<{ estaciones: Estacion[] }>(`/proyectos/${proyectoId}/estaciones`),
  });
  const lista = est.data?.estaciones ?? [];

  return (
    <>
      <Encabezado titulo="Estaciones de muestreo" />
      <p className="-mt-3 mb-4 max-w-prose text-sm text-tinta-suave">
        Atributos precargados desde A01: nunca se piden al especialista. El anillo ocre marca las
        estaciones en zona de amortiguamiento o ecosistema frágil (ZA/EF).
      </p>
      {est.isPending ? <Cargando que="las estaciones" /> : null}
      <AvisoError error={est.error} />
      {est.data !== undefined && lista.length === 0 ? (
        <Vacio titulo="Aún no hay estaciones">
          Las estaciones llegan con la carga de A01 del proyecto.
        </Vacio>
      ) : null}
      {lista.length > 0 ? (
        <div className="flex flex-col gap-6">
          <Mapa
            puntos={lista.map((s) => ({
              id: s.id,
              lat: s.lat,
              lon: s.lon,
              titulo: s.codigo,
              zaEf: s.za_ef !== null && s.za_ef !== '',
            }))}
            alto="24rem"
          />
          <Tabla titulo="Estaciones">
            <thead>
              <tr>
                <th className={th}>Código</th>
                <th className={th}>Región</th>
                <th className={th}>UV</th>
                <th className={th}>AID/AII</th>
                <th className={th}>ZA/EF</th>
                <th className={th}>UTM</th>
              </tr>
            </thead>
            <tbody>
              {lista.map((s) => (
                <tr key={s.id}>
                  <td className={`${td} font-semibold`}>{s.codigo}</td>
                  <td className={td}>{atributo(s.region)}</td>
                  <td className={td}>{atributo(s.uv)}</td>
                  <td className={td}>{atributo(s.aid_aii)}</td>
                  <td className={td}>{s.za_ef === null || s.za_ef === '' ? 'No' : s.za_ef}</td>
                  <td className={`${td} cifras whitespace-nowrap`}>
                    {s.zona_utm === null
                      ? `${s.lat.toFixed(5)}, ${s.lon.toFixed(5)}`
                      : `${s.zona_utm} ${String(Number(s.este))} E ${String(Number(s.norte))} N`}
                  </td>
                </tr>
              ))}
            </tbody>
          </Tabla>
        </div>
      ) : null}
    </>
  );
};
