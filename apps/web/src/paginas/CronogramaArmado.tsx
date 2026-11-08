import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import {
  api,
  type Borrador,
  type Brigada,
  type CambioCronograma,
  type Estacion,
  type ItemCronograma,
} from '../api.ts';
import {
  AvisoError,
  Boton,
  Campo,
  Cargando,
  claseEntrada,
  Dialogo,
  Tabla,
  td,
  th,
  Vacio,
} from '../componentes/Ui.tsx';

/**
 * Armar el trabajo desde la web (RF-W12, RN-35, RN-36): asignar una estación a una brigada en el
 * cronograma vigente y, si el proyecto aún no tiene cronograma, armar y publicar el base.
 */

export const ACTIVIDAD: Readonly<Record<string, string>> = {
  estacion: 'Estación',
  movilizacion: 'Movilización',
  traslado: 'Traslado',
  desmovilizacion: 'Desmovilización',
  feriado: 'Feriado o descanso',
  procesamiento: 'Procesamiento',
  otro: 'Otro',
};

const fechaCorta = (iso: string): string => {
  const [a, m, d] = iso.split('-').map(Number);
  return new Intl.DateTimeFormat('es-PE', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
  }).format(new Date(a ?? 2000, (m ?? 1) - 1, d ?? 1));
};

const useEstaciones = (proyectoId: string, habilitado = true) =>
  useQuery({
    queryKey: ['estaciones', proyectoId],
    queryFn: () => api.get<{ estaciones: Estacion[] }>(`/proyectos/${proyectoId}/estaciones`),
    enabled: habilitado,
  });

const SelectorBrigada = ({
  brigadas,
  valor,
  alCambiar,
}: {
  brigadas: Brigada[];
  valor: string;
  alCambiar: (v: string) => void;
}) => (
  <Campo etiqueta="Brigada">
    {(id) => (
      <select
        id={id}
        required
        value={valor}
        onChange={(e) => alCambiar(e.target.value)}
        className={claseEntrada}
      >
        <option value="">Elija una brigada</option>
        {brigadas.map((b) => (
          <option key={b.id} value={b.id}>
            {b.codigo ?? b.nombre}
          </option>
        ))}
      </select>
    )}
  </Campo>
);

const CampoFecha = ({ valor, alCambiar }: { valor: string; alCambiar: (v: string) => void }) => (
  <Campo etiqueta="Fecha">
    {(id) => (
      <input
        id={id}
        type="date"
        required
        value={valor}
        onChange={(e) => alCambiar(e.target.value)}
        className={claseEntrada}
      />
    )}
  </Campo>
);

// ── Asignar una estación (agrega una fila al cronograma vigente) ──

export const AsignarEstacion = ({
  proyectoId,
  items,
  brigadas,
  aplicaAhora,
}: {
  proyectoId: string;
  items: ItemCronograma[];
  brigadas: Brigada[];
  /** Solo el Jefe de Proyecto: solicitud y aprobación en un paso (RN-36). */
  aplicaAhora: boolean;
}) => {
  const qc = useQueryClient();
  const [abierto, setAbierto] = useState(false);
  const [estacion, setEstacion] = useState('');
  const [brigada, setBrigada] = useState('');
  const [fecha, setFecha] = useState('');
  const [motivo, setMotivo] = useState('');
  const estaciones = useEstaciones(proyectoId, abierto);
  const programadas = new Set(
    items.flatMap((i) => (i.estacion_id === null ? [] : [i.estacion_id])),
  );
  // Primero las que aún no están en el cronograma.
  const lista = [...(estaciones.data?.estaciones ?? [])].sort(
    (a, b) =>
      Number(programadas.has(a.id)) - Number(programadas.has(b.id)) ||
      a.codigo.localeCompare(b.codigo),
  );
  const enviar = useMutation({
    mutationFn: (ahora: boolean) => {
      const cambios: CambioCronograma[] = [
        {
          tipo: 'agregar',
          item: {
            // Identificador provisional: la versión nueva asigna los suyos.
            id: globalThis.crypto.randomUUID(),
            brigada_id: brigada,
            fecha,
            tipo_actividad: 'estacion',
            estacion_id: estacion,
            detalle: null,
            actividad_especial: null,
          },
        },
      ];
      return api.post(
        ahora
          ? `/proyectos/${proyectoId}/cronograma/aplicar`
          : `/proyectos/${proyectoId}/cronograma/solicitudes`,
        { motivo, cambios },
      );
    },
    onSuccess: async () => {
      setAbierto(false);
      setEstacion('');
      setMotivo('');
      await qc.invalidateQueries();
    },
  });
  const listo = estacion !== '' && brigada !== '' && fecha !== '' && motivo.trim() !== '';
  return (
    <>
      <Boton onClick={() => setAbierto(true)}>Asignar estación</Boton>
      <Dialogo
        abierto={abierto}
        titulo="Asignar estación a una brigada"
        alCerrar={() => setAbierto(false)}
      >
        <form
          className="flex flex-col gap-4"
          onSubmit={(e) => {
            e.preventDefault();
            enviar.mutate(false);
          }}
        >
          <p className="text-sm text-tinta-suave">
            Agrega la estación al cronograma vigente con su brigada y fecha. Las reservas de sus
            métodos pasan a esa brigada y llegan a los celulares en la siguiente descarga del
            paquete de campo.{' '}
            {aplicaAhora
              ? 'Como Jefe de Proyecto puede aplicarlo ahora: queda registrado como solicitud aprobada.'
              : 'El Jefe de Proyecto aprueba la solicitud.'}
          </p>
          <Campo etiqueta="Estación">
            {(id) => (
              <select
                id={id}
                required
                value={estacion}
                onChange={(e) => setEstacion(e.target.value)}
                className={claseEntrada}
              >
                <option value="">Elija una estación</option>
                {lista.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.codigo}
                    {programadas.has(s.id) ? ' (ya programada)' : ' (sin programar)'}
                  </option>
                ))}
              </select>
            )}
          </Campo>
          <div className="grid gap-3 sm:grid-cols-2">
            <SelectorBrigada brigadas={brigadas} valor={brigada} alCambiar={setBrigada} />
            <CampoFecha valor={fecha} alCambiar={setFecha} />
          </div>
          <Campo etiqueta="Motivo">
            {(id) => (
              <textarea
                id={id}
                required
                rows={2}
                maxLength={2000}
                value={motivo}
                onChange={(e) => setMotivo(e.target.value)}
                className={`${claseEntrada} py-2`}
              />
            )}
          </Campo>
          <AvisoError error={estaciones.error ?? enviar.error} />
          <div className="flex flex-wrap justify-end gap-2">
            <Boton variante="secundario" onClick={() => setAbierto(false)}>
              Cancelar
            </Boton>
            <Boton
              type="submit"
              variante={aplicaAhora ? 'secundario' : 'principal'}
              ocupado={enviar.isPending}
              disabled={!listo}
            >
              Enviar como solicitud
            </Boton>
            {aplicaAhora ? (
              <Boton
                ocupado={enviar.isPending}
                disabled={!listo}
                onClick={() => enviar.mutate(true)}
              >
                Aplicar ahora
              </Boton>
            ) : null}
          </div>
        </form>
      </Dialogo>
    </>
  );
};

// ── Borrador del cronograma base (proyecto sin A01) ──

const TIPOS_ACTIVIDAD = Object.keys(ACTIVIDAD);

export const BorradorBase = ({
  proyectoId,
  brigadas,
}: {
  proyectoId: string;
  brigadas: Brigada[];
}) => {
  const qc = useQueryClient();
  const [tipo, setTipo] = useState('estacion');
  const [estacion, setEstacion] = useState('');
  const [brigada, setBrigada] = useState('');
  const [fecha, setFecha] = useState('');
  const [detalle, setDetalle] = useState('');
  const borrador = useQuery({
    queryKey: ['borrador', proyectoId],
    queryFn: () => api.get<Borrador>(`/proyectos/${proyectoId}/cronograma/borrador`),
  });
  const estaciones = useEstaciones(proyectoId);
  const refrescar = () => qc.invalidateQueries({ queryKey: ['borrador', proyectoId] });
  const agregar = useMutation({
    mutationFn: () =>
      api.post(`/proyectos/${proyectoId}/cronograma/borrador`, {
        brigada_id: brigada,
        fecha,
        tipo_actividad: tipo,
        estacion_id: tipo === 'estacion' ? estacion : null,
        detalle: detalle.trim() === '' ? null : detalle.trim(),
      }),
    onSuccess: async () => {
      setEstacion('');
      setDetalle('');
      await refrescar();
    },
  });
  const quitar = useMutation({
    mutationFn: (id: string) => api.post(`/cronograma/borrador/${id}/descartar`),
    onSuccess: refrescar,
  });
  const publicar = useMutation({
    mutationFn: () => api.post(`/proyectos/${proyectoId}/cronograma/borrador/publicar`),
    onSuccess: () => qc.invalidateQueries(),
  });
  const filas = borrador.data?.filas ?? [];
  const enBorrador = new Set(filas.flatMap((f) => (f.estacion_id === null ? [] : [f.estacion_id])));

  return (
    <section aria-labelledby="titulo-borrador" className="flex flex-col gap-4">
      <h2 id="titulo-borrador" className="text-lg font-semibold">
        Armar el cronograma base
      </h2>
      <p className="max-w-prose text-sm text-tinta-suave">
        Este proyecto aún no tiene cronograma. Agregue las actividades de cada brigada (estaciones,
        movilizaciones, descansos) y publíquelo: se convierte en el cronograma base, que ya no se
        modifica, y las reservas de cada estación pasan a su brigada y fecha. Después, todo cambio
        se propone como reprogramación.
      </p>
      {brigadas.length === 0 ? (
        <Vacio titulo="Primero cree las brigadas">
          Use la pestaña Brigadas. Las estaciones se crean en la pestaña Estaciones.
        </Vacio>
      ) : (
        <form
          className="grid gap-3 rounded-md border border-linea bg-hoja p-4 sm:grid-cols-2 lg:grid-cols-5"
          aria-label="Agregar actividad al borrador"
          onSubmit={(e) => {
            e.preventDefault();
            agregar.mutate();
          }}
        >
          <SelectorBrigada brigadas={brigadas} valor={brigada} alCambiar={setBrigada} />
          <CampoFecha valor={fecha} alCambiar={setFecha} />
          <Campo etiqueta="Actividad">
            {(id) => (
              <select
                id={id}
                value={tipo}
                onChange={(e) => setTipo(e.target.value)}
                className={claseEntrada}
              >
                {TIPOS_ACTIVIDAD.map((t) => (
                  <option key={t} value={t}>
                    {ACTIVIDAD[t]}
                  </option>
                ))}
              </select>
            )}
          </Campo>
          {tipo === 'estacion' ? (
            <Campo etiqueta="Estación">
              {(id) => (
                <select
                  id={id}
                  required
                  value={estacion}
                  onChange={(e) => setEstacion(e.target.value)}
                  className={claseEntrada}
                >
                  <option value="">Elija una estación</option>
                  {estaciones.data?.estaciones.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.codigo}
                      {enBorrador.has(s.id) ? ' (ya en el borrador)' : ''}
                    </option>
                  ))}
                </select>
              )}
            </Campo>
          ) : (
            <Campo etiqueta="Detalle">
              {(id) => (
                <input
                  id={id}
                  value={detalle}
                  maxLength={500}
                  onChange={(e) => setDetalle(e.target.value)}
                  placeholder="Por ejemplo: Lima – Huánuco"
                  className={claseEntrada}
                />
              )}
            </Campo>
          )}
          <div className="flex items-end">
            <Boton type="submit" ocupado={agregar.isPending} className="w-full">
              Agregar al borrador
            </Boton>
          </div>
        </form>
      )}
      <AvisoError error={borrador.error ?? agregar.error ?? quitar.error ?? publicar.error} />
      {borrador.isPending ? <Cargando que="el borrador" /> : null}
      {borrador.data !== undefined && filas.length === 0 ? (
        <Vacio titulo="El borrador está vacío" />
      ) : null}
      {filas.length > 0 ? (
        <Tabla titulo="Borrador del cronograma base">
          <thead>
            <tr>
              <th className={th}>Fecha</th>
              <th className={th}>Brigada</th>
              <th className={th}>Actividad</th>
              <th className={th}>
                <span className="sr-only">Acciones</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {filas.map((f) => (
              <tr key={f.id}>
                <td className={`${td} cifras whitespace-nowrap`}>{fechaCorta(f.fecha)}</td>
                <td className={td}>{f.brigada_codigo ?? f.brigada_nombre}</td>
                <td className={`${td} ${f.tipo_actividad === 'estacion' ? 'font-semibold' : ''}`}>
                  {f.tipo_actividad === 'estacion'
                    ? (f.estacion_codigo ?? 'Estación')
                    : `${ACTIVIDAD[f.tipo_actividad] ?? f.tipo_actividad}${f.detalle === null ? '' : `: ${f.detalle}`}`}
                </td>
                <td className={td}>
                  <Boton
                    variante="secundario"
                    onClick={() => quitar.mutate(f.id)}
                    aria-label={`Quitar la actividad del ${f.fecha}`}
                  >
                    Quitar
                  </Boton>
                </td>
              </tr>
            ))}
          </tbody>
        </Tabla>
      ) : null}
      <div>
        <Boton
          ocupado={publicar.isPending}
          disabled={filas.length === 0}
          onClick={() => publicar.mutate()}
        >
          Publicar cronograma base
        </Boton>
      </div>
    </section>
  );
};
