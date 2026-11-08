import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, type Revision } from '../api.ts';
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

/** Por qué un dato quedó en revisión (motivos de la API, RN-13). */
const SITUACION: Readonly<Record<string, string>> = {
  EJECUCION_CERRADA: 'Llegó después de cerrar la ejecución',
  UNIDAD_PENDIENTE: 'Foto de una unidad que aún no llega',
  VINCULO_PENDIENTE: 'Vínculo con una unidad que aún no llega',
};

const TIPO: Readonly<Record<string, string>> = {
  unidad_guardada: 'Unidad',
  track_registrado: 'Track',
  archivo_capturado: 'Foto',
  ejecucion_cerrada: 'Cierre',
};

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
        Llegaron tarde a una ejecución ya cerrada o dependen de algo que aún no llega. La ejecución
        no se reabre y nada se borra: decida si el dato se conserva en su historial o se descarta.
      </p>
      {q.isPending ? <Cargando que="las revisiones" /> : null}
      <AvisoError error={q.error ?? resolver.error} />
      {q.data?.revisiones.length === 0 ? (
        <Vacio titulo="No hay datos pendientes de revisión" />
      ) : null}
      {q.data !== undefined && q.data.revisiones.length > 0 ? (
        <Tabla titulo="Datos en revisión">
          <thead>
            <tr>
              <th className={th}>Estación y método</th>
              <th className={th}>Dato</th>
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
                  <span className="font-semibold">{r.estacion_codigo}</span> · {r.metodo_nombre}
                </td>
                <td className={td}>{TIPO[r.tipo] ?? r.tipo}</td>
                <td className={td}>
                  {r.estado === 'duplicado'
                    ? 'Repite un dato ya recibido'
                    : (SITUACION[r.motivo ?? ''] ?? 'En revisión')}
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
