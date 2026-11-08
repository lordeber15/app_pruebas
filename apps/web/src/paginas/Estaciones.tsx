import { estacionNuevaSchema, fechaEnZona } from '@campo/core';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { api, ErrorApi, type AvanceEstaciones, type Estacion } from '../api.ts';
import { CeldaAvance, MapaAvance } from '../componentes/AvanceEstaciones.tsx';
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
import { useProyectoId } from './Proyectos.tsx';

const atributo = (v: string | null): string => (v === null || v === '' ? 'Sin dato' : v);

interface ResumenCarga {
  metodos: number;
  estaciones: number;
  brigadas: number;
  cronograma_items: number;
  reservas: number;
  estacion_metodo_pendientes: number;
  a01: boolean;
  fechas_corridas_dias: number | null;
  cronograma_base_existente: boolean;
  cronograma_desde: string | null;
}

/**
 * Carga D01 + A01 en el proyecto (Coordinación y JdP). Repetirla no duplica nada. Para la demo,
 * la fecha de inicio corre todas las fechas de A01 (solo al crear el cronograma base, RN-35).
 */
const CargarConfiguracion = ({
  proyectoId,
  hayDatos,
}: {
  proyectoId: string;
  hayDatos: boolean;
}) => {
  const qc = useQueryClient();
  const [abierto, setAbierto] = useState(false);
  const [fecha, setFecha] = useState(() => fechaEnZona(new Date()));
  const [correr, setCorrer] = useState(true);
  const [conA01, setConA01] = useState(true);
  const cargar = useMutation({
    mutationFn: () =>
      api.post<{ resumen: ResumenCarga }>(`/proyectos/${proyectoId}/configuracion/toce`, {
        fecha_inicio: conA01 && correr && fecha !== '' ? fecha : null,
        incluir_a01: conA01,
      }),
    onSuccess: async () => {
      setAbierto(false);
      await qc.invalidateQueries();
    },
  });
  const r = cargar.data?.resumen;
  return (
    <div className="flex flex-col items-end gap-2">
      <Boton variante={hayDatos ? 'secundario' : 'principal'} onClick={() => setAbierto(true)}>
        {hayDatos ? 'Volver a cargar D01 y A01' : 'Cargar configuración TOCE (D01 y A01)'}
      </Boton>
      <Dialogo
        abierto={abierto}
        titulo="Cargar configuración TOCE"
        alCerrar={() => setAbierto(false)}
      >
        <form
          className="flex flex-col gap-4"
          onSubmit={(ev) => {
            ev.preventDefault();
            cargar.mutate();
          }}
        >
          <p className="text-sm text-tinta-suave">
            D01 trae las especialidades y los 33 métodos con su configuración. A01 trae las 102
            estaciones, las brigadas, el cronograma base y las reservas. Repetir la carga no duplica
            nada.
          </p>
          <label className="flex min-h-11 items-center gap-3 text-sm">
            <input
              type="checkbox"
              checked={conA01}
              onChange={(e) => setConA01(e.target.checked)}
              className="size-5 accent-liquen"
            />
            Cargar también A01 (estaciones, brigadas y cronograma de TOCE)
          </label>
          {conA01 ? (
            <>
              <label className="flex min-h-11 items-center gap-3 text-sm">
                <input
                  type="checkbox"
                  checked={correr}
                  onChange={(e) => setCorrer(e.target.checked)}
                  className="size-5 accent-liquen"
                />
                Correr las fechas de A01
              </label>
              {correr ? (
                <Campo
                  etiqueta="Fecha de inicio del cronograma"
                  ayuda="Para la demo: corre todas las fechas de A01 para que empiecen en esta fecha. Se conservan el orden y los días entre actividades. Solo se aplica si el proyecto aún no tiene cronograma base."
                >
                  {(id) => (
                    <input
                      id={id}
                      type="date"
                      required
                      value={fecha}
                      onChange={(e) => setFecha(e.target.value)}
                      className={claseEntrada}
                    />
                  )}
                </Campo>
              ) : null}
            </>
          ) : (
            <p className="text-sm text-tinta-suave">
              Solo D01: luego cree las estaciones, las brigadas y el cronograma base desde la web.
            </p>
          )}
          <AvisoError error={cargar.error} />
          <div className="flex justify-end gap-2">
            <Boton variante="secundario" onClick={() => setAbierto(false)}>
              Cancelar
            </Boton>
            <Boton type="submit" ocupado={cargar.isPending}>
              Cargar
            </Boton>
          </div>
        </form>
      </Dialogo>
      {r === undefined ? null : (
        <p role="status" className="max-w-md text-right text-sm text-liquen-oscuro">
          Cargados: {r.metodos} métodos
          {r.a01
            ? `, ${String(r.estaciones)} estaciones, ${String(r.brigadas)} brigadas, ${String(r.cronograma_items)} filas del cronograma`
            : ''}{' '}
          y {r.reservas} reservas nuevas.
          {r.fechas_corridas_dias === null
            ? ''
            : ` Las fechas de A01 se corrieron ${String(Math.abs(r.fechas_corridas_dias))} días ${r.fechas_corridas_dias < 0 ? 'antes' : 'después'}: el cronograma empieza el ${r.cronograma_desde ?? '—'}.`}
          {r.cronograma_base_existente && r.a01
            ? ' El cronograma base ya existía: no se cambiaron sus fechas (el base nunca se modifica).'
            : ''}
          {r.estacion_metodo_pendientes > 0
            ? ` ${String(r.estacion_metodo_pendientes)} combinaciones estación–método esperan confirmación (P-01).`
            : ''}
        </p>
      )}
    </div>
  );
};

// ── Alta y corrección de estaciones (Coordinación y JdP) ──

interface Formulario {
  codigo: string;
  zona_utm: string;
  este: string;
  norte: string;
  aid_aii: string;
  uv: string;
  za_ef: string;
  region: string;
}

const VACIO: Formulario = {
  codigo: '',
  zona_utm: '18S',
  este: '',
  norte: '',
  aid_aii: 'AID',
  uv: '',
  za_ef: '',
  region: '',
};

const desdeEstacion = (s: Estacion): Formulario => ({
  codigo: s.codigo,
  zona_utm: s.zona_utm ?? '',
  este: s.este === null ? '' : String(Number(s.este)),
  norte: s.norte === null ? '' : String(Number(s.norte)),
  aid_aii: s.aid_aii ?? 'AID',
  uv: s.uv ?? '',
  za_ef: s.za_ef ?? '',
  region: s.region ?? '',
});

const DialogoEstacion = ({
  proyectoId,
  estacion,
  abierto,
  alCerrar,
}: {
  proyectoId: string;
  /** `null`: estación nueva. */
  estacion: Estacion | null;
  abierto: boolean;
  alCerrar: () => void;
}) => {
  const qc = useQueryClient();
  const [f, setF] = useState<Formulario>(
    estacion === null ? VACIO : desdeEstacion(estacion),
  );
  const cambiar = (k: keyof Formulario) => (v: string) => setF((x) => ({ ...x, [k]: v }));
  const guardar = useMutation({
    mutationFn: async () => {
      // Mismo esquema que la API (core).
      const r = estacionNuevaSchema.safeParse({
        ...f,
        este: Number(f.este),
        norte: Number(f.norte),
        za_ef: f.za_ef,
        region: f.region === '' ? null : f.region,
      });
      if (!r.success) {
        throw new ErrorApi(400, 'DATOS_INVALIDOS', r.error.issues[0]?.message ?? 'Revise los datos.');
      }
      return estacion === null
        ? api.post(`/proyectos/${proyectoId}/estaciones`, r.data)
        : api.patch(`/estaciones/${estacion.id}`, r.data);
    },
    onSuccess: async () => {
      alCerrar();
      await qc.invalidateQueries({ queryKey: ['estaciones', proyectoId] });
      await qc.invalidateQueries({ queryKey: ['avance-estaciones', proyectoId] });
    },
  });
  const texto = (k: keyof Formulario, etiqueta: string, ayuda?: string, requerido = true) => (
    <Campo etiqueta={etiqueta} {...(ayuda === undefined ? {} : { ayuda })}>
      {(id) => (
        <input
          id={id}
          value={f[k]}
          required={requerido}
          onChange={(e) => cambiar(k)(e.target.value)}
          className={claseEntrada}
        />
      )}
    </Campo>
  );
  return (
    <Dialogo
      abierto={abierto}
      titulo={estacion === null ? 'Agregar estación' : `Corregir ${estacion.codigo}`}
      alCerrar={alCerrar}
    >
      <form
        className="flex flex-col gap-4"
        onSubmit={(ev) => {
          ev.preventDefault();
          guardar.mutate();
        }}
      >
        {texto(
          'codigo',
          'Código',
          estacion === null
            ? 'Único en el proyecto.'
            : 'Si la estación ya tiene ejecuciones, su código no se puede cambiar.',
        )}
        <div className="grid gap-3 sm:grid-cols-3">
          {texto('zona_utm', 'Zona UTM', 'Por ejemplo 17S, 18S o 19S.')}
          <Campo etiqueta="Este (m)">
            {(id) => (
              <input
                id={id}
                type="number"
                inputMode="decimal"
                step="any"
                required
                value={f.este}
                onChange={(e) => cambiar('este')(e.target.value)}
                className={claseEntrada}
              />
            )}
          </Campo>
          <Campo etiqueta="Norte (m)">
            {(id) => (
              <input
                id={id}
                type="number"
                inputMode="decimal"
                step="any"
                required
                value={f.norte}
                onChange={(e) => cambiar('norte')(e.target.value)}
                className={claseEntrada}
              />
            )}
          </Campo>
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <Campo etiqueta="AID / AII">
            {(id) => (
              <select
                id={id}
                value={f.aid_aii}
                onChange={(e) => cambiar('aid_aii')(e.target.value)}
                className={claseEntrada}
              >
                <option value="AID">AID</option>
                <option value="AII">AII</option>
              </select>
            )}
          </Campo>
          <Campo
            etiqueta="Región"
            ayuda="Define qué métodos condicionales aplican (RN-28)."
          >
            {(id) => (
              <select
                id={id}
                value={f.region}
                onChange={(e) => cambiar('region')(e.target.value)}
                className={claseEntrada}
              >
                <option value="">Sin región (quedan pendientes)</option>
                <option value="COSTA">Costa</option>
                <option value="SIERRA">Sierra</option>
                <option value="SELVA">Selva</option>
              </select>
            )}
          </Campo>
        </div>
        {texto('uv', 'Unidad de vegetación (UV)')}
        {texto('za_ef', 'ZA/EF', 'Déjelo vacío si la estación no está en ZA ni en EF.', false)}
        <AvisoError error={guardar.error} />
        <div className="flex justify-end gap-2">
          <Boton variante="secundario" onClick={alCerrar}>
            Cancelar
          </Boton>
          <Boton type="submit" ocupado={guardar.isPending}>
            {estacion === null ? 'Agregar estación' : 'Guardar cambios'}
          </Boton>
        </div>
      </form>
    </Dialogo>
  );
};

// ── Página ──

export const Estaciones = () => {
  const proyectoId = useProyectoId();
  const yo = useYo();
  const gestionar = puede(yo.data).gestionar;
  const est = useQuery({
    queryKey: ['estaciones', proyectoId],
    queryFn: () => api.get<{ estaciones: Estacion[] }>(`/proyectos/${proyectoId}/estaciones`),
  });
  const avance = useQuery({
    queryKey: ['avance-estaciones', proyectoId],
    queryFn: () => api.get<AvanceEstaciones>(`/proyectos/${proyectoId}/estaciones/avance`),
  });
  // Diálogo: `undefined` cerrado, `null` estación nueva.
  const [editando, setEditando] = useState<Estacion | null | undefined>(undefined);
  const lista = est.data?.estaciones ?? [];
  const porId = new Map((avance.data?.estaciones ?? []).map((a) => [a.id, a]));

  return (
    <>
      <Encabezado titulo="Estaciones de muestreo">
        {gestionar && est.data !== undefined ? (
          <>
            <Boton variante="secundario" onClick={() => setEditando(null)}>
              Agregar estación
            </Boton>
            <CargarConfiguracion proyectoId={proyectoId} hayDatos={lista.length > 0} />
          </>
        ) : null}
      </Encabezado>
      {editando === undefined ? null : (
        <DialogoEstacion
          key={editando?.id ?? 'nueva'}
          proyectoId={proyectoId}
          estacion={editando}
          abierto
          alCerrar={() => setEditando(undefined)}
        />
      )}
      <p className="-mt-3 mb-4 max-w-prose text-sm text-tinta-suave">
        Atributos precargados desde A01 o registrados aquí por Coordinación: nunca se piden al
        especialista. El avance de cada estación es la cantidad de métodos completos sobre los
        métodos que le aplican.
      </p>
      {est.isPending ? <Cargando que="las estaciones" /> : null}
      <AvisoError error={est.error ?? avance.error} />
      {est.data !== undefined && lista.length === 0 ? (
        <Vacio titulo="Aún no hay estaciones">
          {gestionar
            ? 'Use «Cargar configuración TOCE» para crear las 102 estaciones de A01, o cargue solo D01 y agregue las estaciones con «Agregar estación».'
            : 'Las estaciones llegan con la carga de A01 del proyecto.'}
        </Vacio>
      ) : null}
      {lista.length > 0 ? (
        <div className="flex flex-col gap-6">
          {avance.data === undefined ? (
            <Cargando que="el avance de las estaciones" />
          ) : (
            <MapaAvance estaciones={avance.data.estaciones} />
          )}
          <Tabla titulo="Estaciones">
            <thead>
              <tr>
                <th className={th}>Código</th>
                <th className={th}>Avance</th>
                <th className={th}>Brigada y fecha</th>
                <th className={th}>Región</th>
                <th className={th}>UV</th>
                <th className={th}>AID/AII</th>
                <th className={th}>ZA/EF</th>
                <th className={th}>UTM</th>
                {gestionar ? (
                  <th className={th}>
                    <span className="sr-only">Acciones</span>
                  </th>
                ) : null}
              </tr>
            </thead>
            <tbody>
              {lista.map((s) => {
                const a = porId.get(s.id);
                return (
                  <tr key={s.id}>
                    <td className={`${td} font-semibold`}>{s.codigo}</td>
                    <td className={td}>
                      {a === undefined ? (
                        <span className="text-tinta-suave">—</span>
                      ) : (
                        <CeldaAvance a={a.avance} />
                      )}
                    </td>
                    <td className={`${td} whitespace-nowrap`}>
                      {a?.brigada == null ? (
                        <span className="text-tinta-suave">Sin asignar</span>
                      ) : (
                        <>
                          {a.brigada}
                          <br />
                          <span className="cifras text-tinta-suave">
                            {a.fecha_programada}
                            {a.reprogramada ? ' (reprogramada)' : ''}
                          </span>
                        </>
                      )}
                    </td>
                    <td className={td}>{atributo(s.region)}</td>
                    <td className={td}>{atributo(s.uv)}</td>
                    <td className={td}>{atributo(s.aid_aii)}</td>
                    <td className={td}>{s.za_ef === null || s.za_ef === '' ? 'No' : s.za_ef}</td>
                    <td className={`${td} cifras whitespace-nowrap`}>
                      {s.zona_utm === null
                        ? `${s.lat.toFixed(5)}, ${s.lon.toFixed(5)}`
                        : `${s.zona_utm} ${String(Number(s.este))} E ${String(Number(s.norte))} N`}
                    </td>
                    {gestionar ? (
                      <td className={td}>
                        <Boton
                          variante="secundario"
                          onClick={() => setEditando(s)}
                          aria-label={`Corregir la estación ${s.codigo}`}
                        >
                          Corregir
                        </Boton>
                      </td>
                    ) : null}
                  </tr>
                );
              })}
            </tbody>
          </Tabla>
        </div>
      ) : null}
    </>
  );
};
