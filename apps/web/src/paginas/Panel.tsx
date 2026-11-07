import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useNavigate } from '@tanstack/react-router';
import { api, type Avance as DatosAvance, type EstadoTarea, type Revision } from '../api.ts';
import { ETIQUETA_ESTADO, LeyendaEstados, MarcaEstado } from '../componentes/Estado.tsx';
import { Mapa, type PuntoMapa } from '../componentes/MapaDiferido.tsx';
import {
  AvisoError,
  Boton,
  Cargando,
  Encabezado,
  fechaHora,
  Tabla,
  td,
  th,
  Vacio,
} from '../componentes/Ui.tsx';
import { useProyectoId } from './Proyectos.tsx';

const ORDEN: readonly EstadoTarea[] = [
  'asignada',
  'descargada',
  'en_transito',
  'completada',
  'observada',
  'validada',
  'cerrada',
];

// ── Mapa ──

interface Coleccion {
  features: {
    geometry: { coordinates: [number, number] };
    properties: {
      capa: 'tarea' | 'estacion';
      id: string;
      titulo?: string;
      codigo?: string;
      estado?: EstadoTarea;
    };
  }[];
}

export const MapaProyecto = () => {
  const proyectoId = useProyectoId();
  const navegar = useNavigate();
  const q = useQuery({
    queryKey: ['mapa', proyectoId],
    queryFn: () => api.get<Coleccion>(`/proyectos/${proyectoId}/mapa`),
  });
  const puntos: PuntoMapa[] =
    q.data?.features.map((f) => ({
      id: f.properties.id,
      lon: f.geometry.coordinates[0],
      lat: f.geometry.coordinates[1],
      capa: f.properties.capa,
      titulo: f.properties.titulo ?? f.properties.codigo ?? '',
      ...(f.properties.estado === undefined ? {} : { estado: f.properties.estado }),
    })) ?? [];
  return (
    <>
      <Encabezado titulo="Mapa de tareas" />
      <AvisoError error={q.error} />
      {q.isPending ? <Cargando que="el mapa" /> : null}
      <div className="mb-3">
        <LeyendaEstados estados={ORDEN} />
        <p className="mt-1 text-xs text-tinta-suave">
          Círculos blancos con borde: estaciones. Toque una tarea para abrirla.
        </p>
      </div>
      <Mapa
        puntos={puntos}
        alto="70vh"
        alElegir={(id) =>
          void navegar({
            to: '/p/$proyectoId/tareas/$tareaId',
            params: { proyectoId, tareaId: id },
          })
        }
      />
    </>
  );
};

// ── Avance ──

export const Avance = () => {
  const proyectoId = useProyectoId();
  const q = useQuery({
    queryKey: ['avance', proyectoId],
    queryFn: () => api.get<DatosAvance>(`/proyectos/${proyectoId}/avance`),
  });
  if (q.isPending) return <Cargando que="el avance" />;
  if (q.data === undefined) return <AvisoError error={q.error} />;
  const { brigadas, esfuerzo } = q.data;
  const total = (c: (typeof brigadas)[number]) =>
    Object.values(c.estados).reduce((s, n) => s + n, 0);
  const terminadas = (c: (typeof brigadas)[number]) =>
    (c.estados.completada ?? 0) + (c.estados.validada ?? 0) + (c.estados.cerrada ?? 0);

  return (
    <div className="flex flex-col gap-8">
      <section>
        <Encabezado titulo="Avance por brigada" />
        {brigadas.length === 0 ? <Vacio titulo="Aún no hay tareas para medir el avance" /> : null}
        {brigadas.length > 0 ? (
          <Tabla titulo="Tareas por estado y brigada">
            <thead>
              <tr>
                <th className={th}>Brigada</th>
                {ORDEN.map((e) => (
                  <th key={e} className={`${th} text-right`}>
                    <span className="inline-flex items-center gap-1">
                      <MarcaEstado estado={e} tamano={12} />
                      {ETIQUETA_ESTADO[e]}
                    </span>
                  </th>
                ))}
                <th className={`${th} text-right`}>Terminadas</th>
              </tr>
            </thead>
            <tbody>
              {brigadas.map((c) => (
                <tr key={c.id}>
                  <td className={`${td} font-semibold`}>{c.nombre}</td>
                  {ORDEN.map((e) => (
                    <td key={e} className={`${td} cifras text-right`}>
                      {c.estados[e] ?? 0}
                    </td>
                  ))}
                  <td className={`${td} cifras text-right font-semibold`}>
                    {terminadas(c)} de {total(c)}
                  </td>
                </tr>
              ))}
            </tbody>
          </Tabla>
        ) : null}
      </section>

      <section>
        <Encabezado titulo="Esfuerzo de muestreo" />
        <p className="-mt-3 mb-4 text-sm text-tinta-suave">
          Suma del esfuerzo registrado por todas las personas, contra la meta de cada estación.
        </p>
        {esfuerzo.length === 0 ? (
          <Vacio titulo="Sin metodologías programadas">Programe metodologías en Estaciones.</Vacio>
        ) : null}
        {esfuerzo.length > 0 ? (
          <Tabla titulo="Esfuerzo por estación y metodología">
            <thead>
              <tr>
                <th className={th}>Estación</th>
                <th className={th}>Metodología</th>
                <th className={`${th} text-right`}>Registrado</th>
                <th className={`${th} w-1/3`}>Avance contra la meta</th>
              </tr>
            </thead>
            <tbody>
              {esfuerzo.map((x) => {
                const pct =
                  x.meta === null || x.meta === 0 ? null : Math.round((x.total / x.meta) * 100);
                return (
                  <tr key={x.id}>
                    <td className={`${td} font-semibold`}>{x.estacion}</td>
                    <td className={td}>{x.metodologia}</td>
                    <td className={`${td} cifras text-right`}>
                      {x.total} {x.unidad}
                    </td>
                    <td className={td}>
                      {pct === null ? (
                        <span className="text-tinta-suave">Sin meta</span>
                      ) : (
                        <div className="flex items-center gap-2">
                          <div
                            className="h-2 flex-1 rounded-full bg-liquen-claro"
                            aria-hidden="true"
                          >
                            <div
                              className="h-2 rounded-full bg-liquen"
                              style={{ width: `${String(Math.min(pct, 100))}%` }}
                            />
                          </div>
                          <span className="cifras w-24 text-right">
                            {pct} % de {x.meta}
                          </span>
                        </div>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </Tabla>
        ) : null}
      </section>
    </div>
  );
};

// ── Revisiones ──

export const Revisiones = () => {
  const proyectoId = useProyectoId();
  const qc = useQueryClient();
  const q = useQuery({
    queryKey: ['revisiones', proyectoId],
    queryFn: () => api.get<{ revisiones: Revision[] }>(`/proyectos/${proyectoId}/revisiones`),
  });
  const resolver = useMutation({
    mutationFn: ({ id, decision }: { id: string; decision: 'elegido' | 'descartado' }) =>
      api.post(`/revisiones/${id}/resolver`, { decision }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['revisiones', proyectoId] }),
  });
  return (
    <>
      <Encabezado titulo="Datos en revisión" />
      <p className="-mt-3 mb-4 max-w-prose text-sm text-tinta-suave">
        Llegaron de un celular cuya asignación fue revocada, o duplican el trabajo de otro
        responsable. Nada se borra: decida si se conserva o se descarta.
      </p>
      {q.isPending ? <Cargando que="las revisiones" /> : null}
      <AvisoError error={q.error ?? resolver.error} />
      {q.data?.revisiones.length === 0 ? (
        <Vacio titulo="No hay datos pendientes de revisión" />
      ) : null}
      {q.data !== undefined && q.data.revisiones.length > 0 ? (
        <Tabla titulo="Eventos en revisión">
          <thead>
            <tr>
              <th className={th}>Tarea</th>
              <th className={th}>Situación</th>
              <th className={th}>Enviado por</th>
              <th className={th}>Recibido</th>
              <th className={th}>Decisión</th>
            </tr>
          </thead>
          <tbody>
            {q.data.revisiones.map((r) => (
              <tr key={r.id}>
                <td className={td}>
                  <Link
                    to="/p/$proyectoId/tareas/$tareaId"
                    params={{ proyectoId, tareaId: r.tarea_id }}
                    className="font-semibold text-liquen-oscuro underline-offset-4 hover:underline"
                  >
                    {r.tarea_titulo}
                  </Link>
                </td>
                <td className={td}>
                  {r.estado === 'duplicado'
                    ? 'Duplica el trabajo de otro responsable'
                    : 'Asignación revocada'}
                </td>
                <td className={td}>{r.usuario_nombre}</td>
                <td className={`${td} cifras whitespace-nowrap`}>{fechaHora(r.hora_servidor)}</td>
                <td className={td}>
                  <div className="flex flex-wrap gap-2">
                    <Boton
                      variante="secundario"
                      onClick={() => resolver.mutate({ id: r.id, decision: 'elegido' })}
                    >
                      Conservar
                    </Boton>
                    <Boton
                      variante="secundario"
                      onClick={() => resolver.mutate({ id: r.id, decision: 'descartado' })}
                    >
                      Descartar
                    </Boton>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </Tabla>
      ) : null}
    </>
  );
};
