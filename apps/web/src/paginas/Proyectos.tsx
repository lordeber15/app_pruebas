import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, Outlet, useParams } from '@tanstack/react-router';
import { useState, type ReactNode } from 'react';
import {
  api,
  type Cuaderno,
  type Brigada,
  type Estacion,
  type Metodologia,
  type Miembro,
  type Proyecto,
  type Usuario,
} from '../api.ts';
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
        {puede(yo.data).supervisor ? (
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
              Las tareas completadas se validan antes de cerrarse
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
          {puede(yo.data).supervisor
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
  { a: '/p/$proyectoId', texto: 'Tareas', exacto: true },
  { a: '/p/$proyectoId/mapa', texto: 'Mapa' },
  { a: '/p/$proyectoId/avance', texto: 'Avance' },
  { a: '/p/$proyectoId/equipo', texto: 'Equipo y cuadernos' },
  { a: '/p/$proyectoId/estaciones', texto: 'Estaciones' },
  { a: '/p/$proyectoId/revisiones', texto: 'Revisiones' },
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

// ── Equipo: brigadas, miembros y cuadernos ──

const useUsuarios = (habilitado: boolean) =>
  useQuery({
    queryKey: ['usuarios'],
    queryFn: () => api.get<{ usuarios: Usuario[] }>('/admin/usuarios'),
    enabled: habilitado,
  });

const MiembrosBrigada = ({
  brigada,
  supervisor,
}: {
  brigada: Brigada;
  supervisor: boolean;
}) => {
  const qc = useQueryClient();
  const q = useQuery({
    queryKey: ['miembros', brigada.id],
    queryFn: () => api.get<{ miembros: Miembro[] }>(`/brigadas/${brigada.id}/miembros`),
  });
  const usuarios = useUsuarios(supervisor);
  const [usuarioId, setUsuarioId] = useState('');
  const [rol, setRol] = useState<'especialista' | 'logistico'>('especialista');
  const jefe = useMutation({
    mutationFn: (jefeId: string | null) =>
      api.patch(`/brigadas/${brigada.id}`, { jefe_id: jefeId }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['brigadas'] }),
  });

  return (
    <section className="rounded-md border border-linea bg-hoja p-4">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div>
          <h3 className="text-lg font-semibold">{brigada.nombre}</h3>
          <p className="text-sm text-tinta-suave">Jefe: {brigada.jefe_nombre ?? 'sin asignar'}</p>
        </div>
        {supervisor ? (
          <div className="flex flex-wrap gap-2">
            <label className="sr-only" htmlFor={`jefe-${brigada.id}`}>
              Jefe de la brigada {brigada.nombre}
            </label>
            <select
              id={`jefe-${brigada.id}`}
              className={`${claseEntrada} w-56`}
              value={brigada.jefe_id ?? ''}
              onChange={(e) => jefe.mutate(e.target.value === '' ? null : e.target.value)}
            >
              <option value="">Sin jefe</option>
              {usuarios.data?.usuarios
                .filter((u) => u.estado === 'activo')
                .map((u) => (
                  <option key={u.id} value={u.id}>
                    {u.nombre}
                  </option>
                ))}
            </select>
            <FormularioDialogo
              titulo={`Agregar a ${brigada.nombre}`}
              boton="Agregar"
              abrir="Agregar persona"
              alGuardar={async () => {
                await api.post(`/brigadas/${brigada.id}/miembros`, {
                  usuario_id: usuarioId,
                  rol,
                });
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
              <Campo etiqueta="Rol en la brigada">
                {(id) => (
                  <select
                    id={id}
                    value={rol}
                    onChange={(e) =>
                      setRol(e.target.value === 'logistico' ? 'logistico' : 'especialista')
                    }
                    className={claseEntrada}
                  >
                    <option value="especialista">Especialista</option>
                    <option value="logistico">Responsable logístico</option>
                  </select>
                )}
              </Campo>
            </FormularioDialogo>
          </div>
        ) : null}
      </div>
      <AvisoError error={q.error ?? jefe.error} />
      {q.data?.miembros.length === 0 ? (
        <p className="text-sm text-tinta-suave">Aún no tiene integrantes.</p>
      ) : null}
      <ul className="divide-y divide-linea">
        {q.data?.miembros.map((m) => (
          <li key={m.id} className="flex min-h-11 items-center justify-between gap-2 py-1 text-sm">
            <span className="font-medium">{m.nombre}</span>
            <span className="text-tinta-suave">
              {m.rol === 'especialista' ? 'Especialista' : 'Logístico'}
              {m.estado === 'retirado' ? ', retirado' : ''}
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
  const cuadernos = useQuery({
    queryKey: ['cuadernos', proyectoId],
    queryFn: () => api.get<{ cuadernos: Cuaderno[] }>(`/proyectos/${proyectoId}/cuadernos`),
  });
  const [nombre, setNombre] = useState('');
  const [cBrigada, setCBrigada] = useState('');
  const [cResponsable, setCResponsable] = useState('');
  const [cTitulo, setCTitulo] = useState('');
  const miembros = useQuery({
    queryKey: ['miembros', cBrigada],
    queryFn: () => api.get<{ miembros: Miembro[] }>(`/brigadas/${cBrigada}/miembros`),
    enabled: cBrigada !== '',
  });
  const jefeOSupervisor = p.gestionarTareas;

  return (
    <div className="flex flex-col gap-8">
      <section>
        <Encabezado titulo="Brigadas">
          {p.supervisor ? (
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
        {brigadas.isPending ? <Cargando que="las brigadas" /> : null}
        <AvisoError error={brigadas.error} />
        {brigadas.data?.brigadas.length === 0 ? (
          <Vacio titulo="Este proyecto aún no tiene brigadas" />
        ) : null}
        <div className="grid gap-4 lg:grid-cols-2">
          {brigadas.data?.brigadas.map((c) =>
            jefeOSupervisor ? (
              <MiembrosBrigada key={c.id} brigada={c} supervisor={p.supervisor} />
            ) : (
              <section key={c.id} className="rounded-md border border-linea bg-hoja p-4">
                <h3 className="text-lg font-semibold">{c.nombre}</h3>
                <p className="text-sm text-tinta-suave">Jefe: {c.jefe_nombre ?? 'sin asignar'}</p>
              </section>
            ),
          )}
        </div>
      </section>

      <section>
        <Encabezado titulo="Cuadernos">
          {jefeOSupervisor ? (
            <FormularioDialogo
              titulo="Nuevo cuaderno"
              boton="Crear cuaderno"
              abrir="Nuevo cuaderno"
              alGuardar={async () => {
                await api.post('/cuadernos', {
                  brigada_id: cBrigada,
                  responsable_id: cResponsable,
                  titulo: cTitulo,
                });
                setCTitulo('');
                await qc.invalidateQueries({ queryKey: ['cuadernos', proyectoId] });
              }}
            >
              <Campo etiqueta="Título">
                {(id) => (
                  <input
                    id={id}
                    value={cTitulo}
                    onChange={(e) => setCTitulo(e.target.value)}
                    required
                    className={claseEntrada}
                  />
                )}
              </Campo>
              <Campo etiqueta="Brigada">
                {(id) => (
                  <select
                    id={id}
                    value={cBrigada}
                    onChange={(e) => {
                      setCBrigada(e.target.value);
                      setCResponsable('');
                    }}
                    required
                    className={claseEntrada}
                  >
                    <option value="">Elija una brigada</option>
                    {brigadas.data?.brigadas.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.nombre}
                      </option>
                    ))}
                  </select>
                )}
              </Campo>
              <Campo etiqueta="Responsable" ayuda="Recibe las tareas del cuaderno en su celular.">
                {(id) => (
                  <select
                    id={id}
                    value={cResponsable}
                    onChange={(e) => setCResponsable(e.target.value)}
                    required
                    disabled={cBrigada === ''}
                    className={claseEntrada}
                  >
                    <option value="">Elija un integrante</option>
                    {miembros.data?.miembros
                      .filter((m) => m.estado === 'activo')
                      .map((m) => (
                        <option key={m.usuario_id} value={m.usuario_id}>
                          {m.nombre}
                        </option>
                      ))}
                  </select>
                )}
              </Campo>
            </FormularioDialogo>
          ) : null}
        </Encabezado>
        <AvisoError error={cuadernos.error} />
        {cuadernos.data?.cuadernos.length === 0 ? (
          <Vacio titulo="Aún no hay cuadernos">
            Un cuaderno agrupa las tareas de un responsable.
          </Vacio>
        ) : null}
        {cuadernos.data !== undefined && cuadernos.data.cuadernos.length > 0 ? (
          <Tabla titulo="Cuadernos del proyecto">
            <thead>
              <tr>
                <th className={th}>Cuaderno</th>
                <th className={th}>Brigada</th>
                <th className={th}>Responsable</th>
                <th className={`${th} text-right`}>Tareas</th>
              </tr>
            </thead>
            <tbody>
              {cuadernos.data.cuadernos.map((c) => (
                <tr key={c.id}>
                  <td className={td}>{c.titulo}</td>
                  <td className={td}>{c.brigada_nombre}</td>
                  <td className={td}>{c.responsable_nombre}</td>
                  <td className={`${td} cifras text-right`}>{c.tareas ?? 0}</td>
                </tr>
              ))}
            </tbody>
          </Tabla>
        ) : null}
      </section>
    </div>
  );
};

// ── Estaciones y metodologías ──

export const Estaciones = () => {
  const proyectoId = useProyectoId();
  const yo = useYo();
  const qc = useQueryClient();
  const supervisor = puede(yo.data).supervisor;
  const est = useQuery({
    queryKey: ['estaciones', proyectoId],
    queryFn: () => api.get<{ estaciones: Estacion[] }>(`/proyectos/${proyectoId}/estaciones`),
  });
  const met = useQuery({
    queryKey: ['metodologias'],
    queryFn: () => api.get<{ metodologias: Metodologia[] }>('/metodologias'),
  });
  const [codigo, setCodigo] = useState('');
  const [lat, setLat] = useState('');
  const [lon, setLon] = useState('');
  const [mNombre, setMNombre] = useState('');
  const [mUnidad, setMUnidad] = useState('');
  const [prog, setProg] = useState({ estacion: '', metodologia: '', meta: '' });

  const invalidar = () => qc.invalidateQueries({ queryKey: ['estaciones', proyectoId] });

  return (
    <>
      <Encabezado titulo="Estaciones de muestreo">
        {supervisor ? (
          <>
            <FormularioDialogo
              titulo="Nueva estación"
              boton="Crear estación"
              abrir="Nueva estación"
              alGuardar={async () => {
                await api.post(`/proyectos/${proyectoId}/estaciones`, {
                  codigo,
                  lat: Number(lat),
                  lon: Number(lon),
                });
                setCodigo('');
                await invalidar();
              }}
            >
              <Campo etiqueta="Código">
                {(id) => (
                  <input
                    id={id}
                    value={codigo}
                    onChange={(e) => setCodigo(e.target.value)}
                    required
                    className={claseEntrada}
                  />
                )}
              </Campo>
              <div className="grid grid-cols-2 gap-3">
                <Campo etiqueta="Latitud" ayuda="Ej.: -12.0464">
                  {(id) => (
                    <input
                      id={id}
                      value={lat}
                      onChange={(e) => setLat(e.target.value)}
                      inputMode="decimal"
                      required
                      className={claseEntrada}
                    />
                  )}
                </Campo>
                <Campo etiqueta="Longitud" ayuda="Ej.: -77.0428">
                  {(id) => (
                    <input
                      id={id}
                      value={lon}
                      onChange={(e) => setLon(e.target.value)}
                      inputMode="decimal"
                      required
                      className={claseEntrada}
                    />
                  )}
                </Campo>
              </div>
            </FormularioDialogo>
            <FormularioDialogo
              titulo="Programar metodología"
              boton="Programar"
              abrir="Programar metodología"
              alGuardar={async () => {
                await api.post(`/estaciones/${prog.estacion}/metodologias`, {
                  metodologia_id: prog.metodologia,
                  meta_esfuerzo: prog.meta === '' ? null : Number(prog.meta),
                });
                await invalidar();
              }}
            >
              <Campo etiqueta="Estación">
                {(id) => (
                  <select
                    id={id}
                    value={prog.estacion}
                    onChange={(e) => setProg({ ...prog, estacion: e.target.value })}
                    required
                    className={claseEntrada}
                  >
                    <option value="">Elija una estación</option>
                    {est.data?.estaciones.map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.codigo}
                      </option>
                    ))}
                  </select>
                )}
              </Campo>
              <Campo etiqueta="Metodología">
                {(id) => (
                  <select
                    id={id}
                    value={prog.metodologia}
                    onChange={(e) => setProg({ ...prog, metodologia: e.target.value })}
                    required
                    className={claseEntrada}
                  >
                    <option value="">Elija una metodología</option>
                    {met.data?.metodologias.map((m) => (
                      <option key={m.id} value={m.id}>
                        {m.nombre} ({m.unidad})
                      </option>
                    ))}
                  </select>
                )}
              </Campo>
              <Campo etiqueta="Meta de esfuerzo" ayuda="Opcional. En la unidad de la metodología.">
                {(id) => (
                  <input
                    id={id}
                    value={prog.meta}
                    onChange={(e) => setProg({ ...prog, meta: e.target.value })}
                    inputMode="decimal"
                    className={claseEntrada}
                  />
                )}
              </Campo>
            </FormularioDialogo>
            <FormularioDialogo
              titulo="Nueva metodología"
              boton="Crear metodología"
              abrir="Nueva metodología"
              alGuardar={async () => {
                await api.post('/metodologias', { nombre: mNombre, unidad: mUnidad });
                setMNombre('');
                setMUnidad('');
                await qc.invalidateQueries({ queryKey: ['metodologias'] });
              }}
            >
              <Campo etiqueta="Nombre" ayuda="Ej.: Trampas Sherman">
                {(id) => (
                  <input
                    id={id}
                    value={mNombre}
                    onChange={(e) => setMNombre(e.target.value)}
                    required
                    className={claseEntrada}
                  />
                )}
              </Campo>
              <Campo etiqueta="Unidad de esfuerzo" ayuda="Ej.: trampas-noche">
                {(id) => (
                  <input
                    id={id}
                    value={mUnidad}
                    onChange={(e) => setMUnidad(e.target.value)}
                    required
                    className={claseEntrada}
                  />
                )}
              </Campo>
            </FormularioDialogo>
          </>
        ) : null}
      </Encabezado>
      {est.isPending ? <Cargando que="las estaciones" /> : null}
      <AvisoError error={est.error ?? met.error} />
      {est.data?.estaciones.length === 0 ? (
        <Vacio titulo="Aún no hay estaciones">
          Las tareas con esfuerzo se ubican en una estación.
        </Vacio>
      ) : null}
      {est.data !== undefined && est.data.estaciones.length > 0 ? (
        <Tabla titulo="Estaciones">
          <thead>
            <tr>
              <th className={th}>Código</th>
              <th className={th}>Ubicación</th>
              <th className={th}>Metodologías y meta</th>
            </tr>
          </thead>
          <tbody>
            {est.data.estaciones.map((s) => (
              <tr key={s.id}>
                <td className={`${td} font-semibold`}>{s.codigo}</td>
                <td className={`${td} cifras`}>
                  {s.lat.toFixed(5)}, {s.lon.toFixed(5)}
                </td>
                <td className={td}>
                  {s.metodologias.length === 0 ? (
                    <span className="text-tinta-suave">Ninguna</span>
                  ) : (
                    s.metodologias.map((m) => (
                      <span key={m.id} className="mr-3 inline-block">
                        {m.nombre}
                        {m.meta_esfuerzo === null ? '' : `: ${String(Number(m.meta_esfuerzo))}`}
                      </span>
                    ))
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </Tabla>
      ) : null}
    </>
  );
};
