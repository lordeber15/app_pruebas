import {
  ACTIVIDADES_ESPECIALES,
  AID_AII,
  CAMPOS_FILA_PROGRAMACION,
  ESTADOS_FILA_CRONOGRAMA,
  ETIQUETA_ESTADO_FILA_A01,
  ETIQUETA_TIPO_ACTIVIDAD_A01,
  FILAS_MAXIMAS_PROGRAMACION,
  REGIONES_PROGRAMACION,
  SIN_ZA_EF,
  TIPOS_ACTIVIDAD_CRONOGRAMA,
  TIPOS_PROGRAMACION_A01,
  validarFilaProgramacion,
  type FilaProgramacionEntrada,
  type HojaProgramacion,
} from '@campo/core';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useId, useState } from 'react';
import {
  api,
  type AccionCarga,
  type Brigada,
  type ImportacionResumen,
  type ResultadoCarga,
  type VistaCarga,
} from '../api.ts';
import {
  AvisoError,
  Boton,
  Campo,
  claseEntrada,
  fechaHora,
  Tabla,
  td,
  th,
  Vacio,
} from '../componentes/Ui.tsx';
import { Paginacion, usePaginaCliente } from '../componentes/Paginacion.tsx';

/**
 * Cargar la programación A01 por Excel o llenándola en la web (RF-W09). La plantilla trae las
 * hojas y columnas de A01 con listas desplegables; la carga muestra primero una vista previa
 * (nuevas, cambios, sin cambio, no incluidas y errores por fila) y nada se aplica hasta
 * confirmarlo. Sin cronograma base, va al borrador; con base, es una solicitud de reprogramación
 * que aprueba el Jefe de Proyecto (RN-35, RN-36). El Supervisor de campo solo sugiere para sus
 * brigadas. La API vuelve a autorizar cada acción.
 */

const ACCION: Readonly<Record<AccionCarga, { texto: string; icono: string; clase: string }>> = {
  nueva: { texto: 'Nueva', icono: '+', clase: 'text-liquen font-semibold' },
  cambio: { texto: 'Cambio', icono: '↻', clase: 'text-ocre font-semibold' },
  sin_cambio: { texto: 'Sin cambio', icono: '=', clase: 'text-tinta-suave' },
  no_incluida: { texto: 'No incluida', icono: '·', clase: 'text-tinta-suave' },
  error: { texto: 'Error', icono: '✕', clase: 'text-oxido font-semibold' },
};

const fechaCorta = (iso: string | null): string => {
  if (iso === null) return '—';
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  return m === null ? iso : `${m[3] ?? ''}/${m[2] ?? ''}/${m[1] ?? ''}`;
};

// ── Vista previa ──

const ResumenCarga = ({ v }: { v: VistaCarga }) => {
  const r = v.resumen;
  const datos: [string, number][] = [
    ['Filas leídas', r.filas],
    ['Nuevas', r.nuevas],
    ['Cambios', r.cambios],
    ['Sin cambio', r.sin_cambio],
    ['No incluidas (se conservan)', r.no_incluidas],
    ['Estaciones nuevas', r.estaciones_nuevas],
    ['Con errores', r.errores],
  ];
  return (
    <dl className="grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-7">
      {datos.map(([t, n]) => (
        <div
          key={t}
          className={`rounded-md border px-3 py-2 ${t === 'Con errores' && n > 0 ? 'border-oxido bg-oxido-claro' : 'border-linea bg-hoja'}`}
        >
          <dt className="text-xs text-tinta-suave">{t}</dt>
          <dd className="cifras text-lg font-semibold">{n}</dd>
        </div>
      ))}
    </dl>
  );
};

const VistaPrevia = ({
  vista,
  gestion,
  aprueba,
  alTerminar,
}: {
  vista: VistaCarga;
  gestion: boolean;
  aprueba: boolean;
  alTerminar: (mensaje: string) => void;
}) => {
  const qc = useQueryClient();
  const [filtro, setFiltro] = useState<AccionCarga | ''>(vista.resumen.errores > 0 ? 'error' : '');
  const [motivo, setMotivo] = useState(vista.motivo ?? '');
  const filas = vista.filas.filter((f) => filtro === '' || f.accion === filtro);
  const pag = usePaginaCliente(filas, `${vista.importacion_id}|${filtro}`);
  const abierta = vista.estado === 'pendiente' || vista.estado === 'propuesta';
  const conErrores = vista.resumen.errores > 0;
  const sinCambios = vista.resumen.nuevas + vista.resumen.cambios === 0;

  const refrescar = () => qc.invalidateQueries();
  const aplicar = useMutation({
    mutationFn: (ahora: boolean) =>
      api.post<ResultadoCarga>(`/importaciones-programacion/${vista.importacion_id}/aplicar`, {
        motivo,
        aplicar_ahora: ahora,
      }),
    onSuccess: async (r) => {
      await refrescar();
      const estaciones =
        r.estaciones_creadas > 0 ? ` Se crearon ${String(r.estaciones_creadas)} estaciones.` : '';
      alTerminar(
        r.destino === 'borrador'
          ? `Se agregaron ${String(r.filas_agregadas)} filas y se cambiaron ${String(r.filas_cambiadas)} en el borrador del cronograma base.${estaciones} Publíquelo cuando esté completo.`
          : r.destino === 'aplicada_ahora'
            ? `Cambios aplicados: el cronograma vigente es ahora la versión ${String(r.version_numero)}.${estaciones}`
            : `Se envió una solicitud de reprogramación con ${String(r.filas_agregadas)} filas nuevas y ${String(r.filas_cambiadas)} cambios. La aprueba el Jefe de Proyecto.${estaciones}`,
      );
    },
  });
  const proponer = useMutation({
    mutationFn: () =>
      api.post(`/importaciones-programacion/${vista.importacion_id}/proponer`, { motivo }),
    onSuccess: async () => {
      await refrescar();
      alTerminar('Su sugerencia se envió a Coordinación y al Jefe de Proyecto para su revisión.');
    },
  });
  const descartar = useMutation({
    mutationFn: () =>
      api.post(`/importaciones-programacion/${vista.importacion_id}/descartar`, { motivo }),
    onSuccess: async () => {
      await refrescar();
      alTerminar('La carga se descartó. No se aplicó ningún cambio.');
    },
  });
  const ocupado = aplicar.isPending || proponer.isPending || descartar.isPending;

  return (
    <section
      aria-labelledby="titulo-vista-previa"
      className="flex flex-col gap-4 rounded-md border border-linea bg-papel p-4"
    >
      <div>
        <h3 id="titulo-vista-previa" className="text-base font-semibold">
          Vista previa {vista.nombre_archivo === null ? '' : `de «${vista.nombre_archivo}»`}
        </h3>
        <p className="text-sm text-tinta-suave">
          {vista.estado === 'propuesta'
            ? `Sugerencia de ${vista.autor ?? 'un Supervisor de campo'}${vista.motivo === null ? '' : `: «${vista.motivo}»`}. `
            : ''}
          Aún no se aplicó nada.{' '}
          {vista.destino === 'borrador'
            ? 'El proyecto no tiene cronograma base: al aplicar, las filas pasan al borrador.'
            : 'El proyecto ya tiene cronograma base: al aplicar, los cambios se envían como una solicitud de reprogramación.'}{' '}
          Una estación que no venga en el archivo se conserva tal como está.
        </p>
      </div>
      <ResumenCarga v={vista} />
      {conErrores ? (
        <p
          role="alert"
          className="rounded-md border border-oxido bg-oxido-claro px-3 py-2 text-sm text-oxido"
        >
          Hay {vista.resumen.errores} filas con errores. Corríjalas en el archivo (o en la tabla) y
          vuelva a cargarlo: con errores no se aplica nada.
        </p>
      ) : null}

      <div className="max-w-xs">
        <Campo etiqueta="Mostrar">
          {(id) => (
            <select
              id={id}
              value={filtro}
              onChange={(e) => setFiltro(e.target.value as AccionCarga | '')}
              className={claseEntrada}
            >
              <option value="">Todas las filas ({vista.filas.length})</option>
              {(Object.keys(ACCION) as AccionCarga[]).map((a) => (
                <option key={a} value={a}>
                  {ACCION[a].texto} ({vista.filas.filter((f) => f.accion === a).length})
                </option>
              ))}
            </select>
          )}
        </Campo>
      </div>

      {filas.length === 0 ? (
        <Vacio titulo="No hay filas con ese filtro" />
      ) : (
        <Tabla titulo="Vista previa de la carga de programación">
          <thead>
            <tr>
              <th className={th}>Acción</th>
              <th className={th}>Hoja · fila</th>
              <th className={th}>Fecha</th>
              <th className={th}>Brigada</th>
              <th className={th}>Actividad</th>
              <th className={th}>Detalle</th>
            </tr>
          </thead>
          <tbody>
            {pag.visibles.map((f, i) => {
              const a = ACCION[f.accion];
              return (
                <tr key={`${f.hoja ?? 'x'}-${String(f.fila ?? i)}-${String(i)}`}>
                  <td className={`${td} whitespace-nowrap ${a.clase}`}>
                    <span aria-hidden="true">{a.icono} </span>
                    {a.texto}
                  </td>
                  <td className={`${td} cifras whitespace-nowrap`}>
                    {f.hoja === null
                      ? '—'
                      : `${f.hoja === 'programacion' ? '01' : '02'} · ${String(f.fila ?? '')}`}
                  </td>
                  <td className={`${td} cifras whitespace-nowrap`}>{fechaCorta(f.fecha)}</td>
                  <td className={td}>{f.brigada ?? '—'}</td>
                  <td className={td}>
                    {f.estacion === null
                      ? (f.actividad ?? '—')
                      : `${f.estacion}${f.actividad !== null && f.actividad !== 'ESTACIÓN' ? ` · ${f.actividad}` : ''}`}
                    {f.estacion_nueva ? (
                      <span className="ml-1 text-xs text-liquen">(estación nueva)</span>
                    ) : null}
                  </td>
                  <td className={td}>
                    <p>{f.detalle}</p>
                    {f.errores.length > 0 ? (
                      <ul className="mt-1 list-disc pl-5 text-oxido">
                        {f.errores.map((x) => (
                          <li key={x}>{x}</li>
                        ))}
                      </ul>
                    ) : null}
                    {f.avisos.length > 0 ? (
                      <ul className="mt-1 list-disc pl-5 text-ocre">
                        {f.avisos.map((x) => (
                          <li key={x}>
                            <span className="sr-only">Aviso: </span>
                            {x}
                          </li>
                        ))}
                      </ul>
                    ) : null}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </Tabla>
      )}
      <Paginacion etiqueta="Páginas de la vista previa" {...pag.props} />

      {abierta ? (
        <form
          className="flex flex-col gap-3"
          onSubmit={(e) => {
            e.preventDefault();
            if (gestion) aplicar.mutate(false);
            else proponer.mutate();
          }}
        >
          <Campo
            etiqueta={gestion ? 'Motivo del cambio' : 'Motivo de la sugerencia'}
            ayuda="Queda registrado en la solicitud o en el historial de la carga."
          >
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
          <AvisoError error={aplicar.error ?? proponer.error ?? descartar.error} />
          <div className="flex flex-wrap gap-2">
            {gestion ? (
              <>
                <Boton
                  type="submit"
                  disabled={conErrores || sinCambios || ocupado}
                  ocupado={aplicar.isPending}
                >
                  {vista.destino === 'borrador' ? 'Aplicar al borrador' : 'Aplicar como solicitud'}
                </Boton>
                {aprueba && vista.destino === 'solicitud' ? (
                  <Boton
                    variante="atencion"
                    disabled={conErrores || sinCambios || ocupado || motivo.trim() === ''}
                    onClick={() => aplicar.mutate(true)}
                  >
                    Aplicar ahora
                  </Boton>
                ) : null}
              </>
            ) : vista.estado === 'pendiente' ? (
              <Boton
                type="submit"
                disabled={conErrores || sinCambios || ocupado}
                ocupado={proponer.isPending}
              >
                Enviar como sugerencia
              </Boton>
            ) : null}
            <Boton
              variante="secundario"
              disabled={ocupado || motivo.trim() === ''}
              onClick={() => descartar.mutate()}
            >
              Descartar
            </Boton>
          </div>
          {sinCambios && !conErrores ? (
            <p className="text-sm text-tinta-suave">
              La carga no trae actividades nuevas ni cambios.
            </p>
          ) : null}
        </form>
      ) : (
        <p className="text-sm text-tinta-suave">Esta carga ya está {vista.estado}.</p>
      )}
    </section>
  );
};

// ── Llenado en la web ──

type FilaEditable = Omit<FilaProgramacionEntrada, 'fila'> & { clave: string };

const filaVaciaWeb = (hoja: HojaProgramacion = 'programacion'): FilaEditable => ({
  clave: globalThis.crypto.randomUUID(),
  hoja,
  tipo_programacion: hoja === 'programacion' ? 'REGULAR' : null,
  region: null,
  actividad: null,
  brigada: null,
  fecha: null,
  tipo_actividad: 'ESTACIÓN',
  estacion: null,
  zona_utm: null,
  este: null,
  norte: null,
  aid_aii: null,
  uv: null,
  za_ef: null,
  detalle: null,
  estado: 'OK',
});

const SelectCelda = ({
  etiqueta,
  valor,
  opciones,
  alCambiar,
}: {
  etiqueta: string;
  valor: string;
  opciones: readonly string[];
  alCambiar: (v: string) => void;
}) => (
  <select
    aria-label={etiqueta}
    value={valor}
    onChange={(e) => alCambiar(e.target.value)}
    className={`${claseEntrada} min-w-32`}
  >
    <option value="">—</option>
    {opciones.map((o) => (
      <option key={o} value={o}>
        {o}
      </option>
    ))}
  </select>
);

const TextoCelda = ({
  etiqueta,
  valor,
  alCambiar,
  tipo = 'text',
  ancho = 'min-w-28',
}: {
  etiqueta: string;
  valor: string;
  alCambiar: (v: string) => void;
  tipo?: 'text' | 'date' | 'number';
  ancho?: string;
}) => (
  <input
    aria-label={etiqueta}
    type={tipo}
    value={valor}
    onChange={(e) => alCambiar(e.target.value)}
    className={`${claseEntrada} ${ancho}`}
  />
);

const TablaWeb = ({
  proyectoId,
  brigadas,
  alVista,
}: {
  proyectoId: string;
  brigadas: readonly Brigada[];
  alVista: (v: VistaCarga) => void;
}) => {
  const [filas, setFilas] = useState<FilaEditable[]>([filaVaciaWeb()]);
  const enviar = useMutation({
    mutationFn: () =>
      api.post<VistaCarga>(`/proyectos/${proyectoId}/programacion/filas`, {
        filas: filas.map((f, i) => ({
          hoja: f.hoja,
          fila: i + 1,
          ...Object.fromEntries(CAMPOS_FILA_PROGRAMACION.map((c) => [c, f[c] ?? null])),
        })),
      }),
    onSuccess: alVista,
  });
  const cambiar = (clave: string, campo: keyof FilaEditable, valor: string) =>
    setFilas((fs) =>
      fs.map((f) => {
        if (f.clave !== clave) return f;
        const v = valor === '' ? null : valor;
        const numerico = campo === 'este' || campo === 'norte';
        return { ...f, [campo]: numerico && v !== null ? Number(v) : v };
      }),
    );
  const nombresBrigada = brigadas.map((b) => b.codigo ?? b.nombre);
  const tiposActividad = TIPOS_ACTIVIDAD_CRONOGRAMA.map((t) => ETIQUETA_TIPO_ACTIVIDAD_A01[t]);
  const estados = ESTADOS_FILA_CRONOGRAMA.map((x) => ETIQUETA_ESTADO_FILA_A01[x]);
  const errores = filas.map((f, i) => validarFilaProgramacion({ ...f, fila: i + 1 }).errores);
  const conErrores = errores.filter((e) => e.length > 0).length;
  const txt = (v: string | number | null | undefined): string =>
    v === null || v === undefined ? '' : String(v);

  return (
    <div className="flex flex-col gap-3">
      <p className="text-sm text-tinta-suave">
        Las mismas columnas de la plantilla. Cada fila se valida mientras la escribe; al revisar
        verá la misma vista previa que con un Excel.
      </p>
      <Tabla titulo="Programación llenada en la web">
        <thead>
          <tr>
            <th className={th}>#</th>
            <th className={th}>Hoja</th>
            <th className={th}>Tipo programación / Actividad</th>
            <th className={th}>Región</th>
            <th className={th}>Brigada</th>
            <th className={th}>Fecha TH</th>
            <th className={th}>Tipo actividad</th>
            <th className={th}>Estación</th>
            <th className={th}>Zona UTM</th>
            <th className={th}>Este</th>
            <th className={th}>Norte</th>
            <th className={th}>AID/AII</th>
            <th className={th}>UV preliminar</th>
            <th className={th}>ZA/EF</th>
            <th className={th}>Detalle operativo</th>
            <th className={th}>Estado</th>
            <th className={th}>
              <span className="sr-only">Quitar</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {filas.map((f, i) => {
            const n = String(i + 1);
            const errs = errores[i] ?? [];
            const especial = f.hoja === 'actividades_especiales';
            return (
              <tr key={f.clave} className={errs.length > 0 ? 'bg-oxido-claro/40' : ''}>
                <td className={`${td} cifras`}>
                  {n}
                  {errs.length > 0 ? <span className="sr-only"> (con errores)</span> : null}
                </td>
                <td className={td}>
                  <select
                    aria-label={`Hoja de la fila ${n}`}
                    value={f.hoja}
                    onChange={(e) => {
                      const hoja = e.target.value as HojaProgramacion;
                      setFilas((fs) =>
                        fs.map((x) =>
                          x.clave === f.clave
                            ? {
                                ...x,
                                hoja,
                                tipo_programacion: hoja === 'programacion' ? 'REGULAR' : null,
                                region: hoja === 'programacion' ? x.region : null,
                                actividad: hoja === 'programacion' ? null : x.actividad,
                              }
                            : x,
                        ),
                      );
                    }}
                    className={`${claseEntrada} min-w-36`}
                  >
                    <option value="programacion">01 Programación</option>
                    <option value="actividades_especiales">02 Actividades especiales</option>
                  </select>
                </td>
                <td className={td}>
                  {especial ? (
                    <SelectCelda
                      etiqueta={`Actividad de la fila ${n}`}
                      valor={txt(f.actividad)}
                      opciones={ACTIVIDADES_ESPECIALES}
                      alCambiar={(v) => cambiar(f.clave, 'actividad', v)}
                    />
                  ) : (
                    <SelectCelda
                      etiqueta={`Tipo programación de la fila ${n}`}
                      valor={txt(f.tipo_programacion)}
                      opciones={TIPOS_PROGRAMACION_A01}
                      alCambiar={(v) => cambiar(f.clave, 'tipo_programacion', v)}
                    />
                  )}
                </td>
                <td className={td}>
                  {especial ? (
                    <span className="text-tinta-suave">No aplica</span>
                  ) : (
                    <SelectCelda
                      etiqueta={`Región de la fila ${n}`}
                      valor={txt(f.region)}
                      opciones={REGIONES_PROGRAMACION}
                      alCambiar={(v) => cambiar(f.clave, 'region', v)}
                    />
                  )}
                </td>
                <td className={td}>
                  <SelectCelda
                    etiqueta={`Brigada de la fila ${n}`}
                    valor={txt(f.brigada)}
                    opciones={nombresBrigada}
                    alCambiar={(v) => cambiar(f.clave, 'brigada', v)}
                  />
                </td>
                <td className={td}>
                  <TextoCelda
                    etiqueta={`Fecha TH de la fila ${n}`}
                    tipo="date"
                    valor={txt(f.fecha)}
                    alCambiar={(v) => cambiar(f.clave, 'fecha', v)}
                    ancho="min-w-40"
                  />
                </td>
                <td className={td}>
                  <SelectCelda
                    etiqueta={`Tipo actividad de la fila ${n}`}
                    valor={txt(f.tipo_actividad)}
                    opciones={tiposActividad}
                    alCambiar={(v) => cambiar(f.clave, 'tipo_actividad', v)}
                  />
                </td>
                <td className={td}>
                  <TextoCelda
                    etiqueta={`Estación de la fila ${n}`}
                    valor={txt(f.estacion)}
                    alCambiar={(v) => cambiar(f.clave, 'estacion', v)}
                  />
                </td>
                <td className={td}>
                  <TextoCelda
                    etiqueta={`Zona UTM de la fila ${n}`}
                    valor={txt(f.zona_utm)}
                    alCambiar={(v) => cambiar(f.clave, 'zona_utm', v)}
                    ancho="min-w-20"
                  />
                </td>
                <td className={td}>
                  <TextoCelda
                    etiqueta={`Este de la fila ${n}`}
                    tipo="number"
                    valor={txt(f.este)}
                    alCambiar={(v) => cambiar(f.clave, 'este', v)}
                  />
                </td>
                <td className={td}>
                  <TextoCelda
                    etiqueta={`Norte de la fila ${n}`}
                    tipo="number"
                    valor={txt(f.norte)}
                    alCambiar={(v) => cambiar(f.clave, 'norte', v)}
                  />
                </td>
                <td className={td}>
                  <SelectCelda
                    etiqueta={`AID/AII de la fila ${n}`}
                    valor={txt(f.aid_aii)}
                    opciones={AID_AII}
                    alCambiar={(v) => cambiar(f.clave, 'aid_aii', v)}
                  />
                </td>
                <td className={td}>
                  <TextoCelda
                    etiqueta={`UV preliminar de la fila ${n}`}
                    valor={txt(f.uv)}
                    alCambiar={(v) => cambiar(f.clave, 'uv', v)}
                    ancho="min-w-44"
                  />
                </td>
                <td className={td}>
                  <TextoCelda
                    etiqueta={`ZA/EF de la fila ${n} («${SIN_ZA_EF}» si no aplica)`}
                    valor={txt(f.za_ef)}
                    alCambiar={(v) => cambiar(f.clave, 'za_ef', v)}
                    ancho="min-w-36"
                  />
                </td>
                <td className={td}>
                  <TextoCelda
                    etiqueta={`Detalle operativo de la fila ${n}`}
                    valor={txt(f.detalle)}
                    alCambiar={(v) => cambiar(f.clave, 'detalle', v)}
                    ancho="min-w-44"
                  />
                </td>
                <td className={td}>
                  <SelectCelda
                    etiqueta={`Estado de la fila ${n}`}
                    valor={txt(f.estado)}
                    opciones={estados}
                    alCambiar={(v) => cambiar(f.clave, 'estado', v)}
                  />
                </td>
                <td className={td}>
                  <Boton
                    variante="secundario"
                    aria-label={`Quitar la fila ${n}`}
                    disabled={filas.length === 1}
                    onClick={() => setFilas((fs) => fs.filter((x) => x.clave !== f.clave))}
                  >
                    Quitar
                  </Boton>
                </td>
              </tr>
            );
          })}
        </tbody>
      </Tabla>
      {conErrores > 0 ? (
        <div
          className="rounded-md border border-oxido bg-oxido-claro px-3 py-2 text-sm text-oxido"
          role="status"
        >
          <p className="font-semibold">{conErrores} filas con errores:</p>
          <ul className="list-disc pl-5">
            {errores.flatMap((es, i) =>
              es.map((x) => (
                <li key={`${String(i)}-${x}`}>
                  Fila {i + 1}: {x}
                </li>
              )),
            )}
          </ul>
        </div>
      ) : null}
      <AvisoError error={enviar.error} />
      <div className="flex flex-wrap gap-2">
        <Boton
          variante="secundario"
          disabled={filas.length >= FILAS_MAXIMAS_PROGRAMACION}
          onClick={() => setFilas((fs) => [...fs, filaVaciaWeb()])}
        >
          Agregar fila
        </Boton>
        <Boton
          variante="secundario"
          onClick={() => setFilas((fs) => [...fs, filaVaciaWeb('actividades_especiales')])}
        >
          Agregar actividad especial
        </Boton>
        <Boton disabled={conErrores > 0} ocupado={enviar.isPending} onClick={() => enviar.mutate()}>
          Revisar la vista previa
        </Boton>
      </div>
    </div>
  );
};

// ── Propuestas pendientes (Coordinación y JdP) ──

const Propuestas = ({
  proyectoId,
  alRevisar,
}: {
  proyectoId: string;
  alRevisar: (id: string) => void;
}) => {
  const q = useQuery({
    queryKey: ['importaciones', proyectoId, 'propuesta'],
    queryFn: () =>
      api.get<{ importaciones: ImportacionResumen[] }>(
        `/proyectos/${proyectoId}/programacion/importaciones?estado=propuesta`,
      ),
  });
  const lista = q.data?.importaciones ?? [];
  return (
    <div className="flex flex-col gap-2">
      <h3 className="text-base font-semibold">Sugerencias de los Supervisores de campo</h3>
      <AvisoError error={q.error} />
      {q.isPending ? (
        <p role="status" className="text-sm text-tinta-suave">
          Cargando las sugerencias…
        </p>
      ) : null}
      {!q.isPending && lista.length === 0 ? (
        <p className="text-sm text-tinta-suave">No hay sugerencias pendientes.</p>
      ) : null}
      <ul className="flex flex-col gap-2">
        {lista.map((i) => (
          <li
            key={i.id}
            className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-linea bg-hoja px-3 py-2"
          >
            <div className="text-sm">
              <p className="font-semibold">
                {i.autor} · {fechaHora(i.propuesta_en ?? i.creado_en)}
              </p>
              <p className="text-tinta-suave">
                {i.resumen.nuevas} nuevas, {i.resumen.cambios} cambios
                {i.motivo === null ? '' : ` · «${i.motivo}»`}
              </p>
            </div>
            <Boton variante="secundario" onClick={() => alRevisar(i.id)}>
              Revisar
            </Boton>
          </li>
        ))}
      </ul>
    </div>
  );
};

// ── Sección ──

export const CargarProgramacion = ({
  proyectoId,
  brigadas,
  gestion,
  aprueba,
}: {
  proyectoId: string;
  /** Brigadas que la persona puede programar (el Supervisor de campo, solo las suyas). */
  brigadas: readonly Brigada[];
  /** Coordinación o JdP: aplican. Si no, la carga solo se envía como sugerencia. */
  gestion: boolean;
  aprueba: boolean;
}) => {
  const idArchivo = useId();
  const [archivo, setArchivo] = useState<File | null>(null);
  const [vista, setVista] = useState<VistaCarga | null>(null);
  const [modo, setModo] = useState<'excel' | 'web'>('excel');
  const [mensaje, setMensaje] = useState<string | null>(null);
  const descargar = useMutation({
    mutationFn: (conDatos: boolean) =>
      api.descargar(
        `/proyectos/${proyectoId}/programacion/plantilla?con_datos=${conDatos ? '1' : '0'}`,
        'programacion.xlsx',
      ),
  });
  const subir = useMutation({
    mutationFn: (f: File) =>
      api.subir<VistaCarga>(`/proyectos/${proyectoId}/programacion/importar`, f),
    onSuccess: (v) => {
      setMensaje(null);
      setVista(v);
    },
  });
  const revisar = useMutation({
    mutationFn: (id: string) => api.get<VistaCarga>(`/importaciones-programacion/${id}`),
    onSuccess: (v) => {
      setMensaje(null);
      setVista(v);
    },
  });

  return (
    <section className="mt-8 flex flex-col gap-4" aria-labelledby="titulo-carga">
      <div>
        <h2 id="titulo-carga" className="text-lg font-semibold">
          Cargar programación por Excel
        </h2>
        <p className="max-w-prose text-sm text-tinta-suave">
          Descargue la plantilla con las columnas de A01, llénela (o llene la tabla aquí mismo) y
          súbala: verá una vista previa antes de aplicar nada.{' '}
          {gestion
            ? 'Sin cronograma base, las filas van al borrador; con base, se envían como solicitud de reprogramación.'
            : 'Como Supervisor de campo, su carga se envía como sugerencia para sus brigadas; la aplican Coordinación o el Jefe de Proyecto.'}
        </p>
      </div>
      <div className="flex flex-wrap gap-2">
        <Boton
          variante="secundario"
          ocupado={descargar.isPending && !descargar.variables}
          onClick={() => descargar.mutate(false)}
        >
          Descargar plantilla vacía
        </Boton>
        <Boton
          variante="secundario"
          ocupado={descargar.isPending && descargar.variables}
          onClick={() => descargar.mutate(true)}
        >
          Descargar con la programación actual
        </Boton>
      </div>
      <AvisoError error={descargar.error} />

      <div role="tablist" aria-label="Cómo cargar la programación" className="flex gap-2">
        {(['excel', 'web'] as const).map((m) => (
          <button
            key={m}
            type="button"
            role="tab"
            aria-selected={modo === m}
            onClick={() => setModo(m)}
            className={`min-h-11 rounded-md border px-4 text-sm font-semibold ${modo === m ? 'border-liquen bg-liquen-claro text-liquen-oscuro' : 'border-linea bg-hoja text-tinta'}`}
          >
            {m === 'excel' ? 'Subir un Excel' : 'Llenar en la web'}
          </button>
        ))}
      </div>

      {modo === 'excel' ? (
        <form
          className="flex flex-wrap items-end gap-3"
          onSubmit={(e) => {
            e.preventDefault();
            if (archivo !== null) subir.mutate(archivo);
          }}
        >
          <div className="flex flex-col gap-1">
            <label htmlFor={idArchivo} className="text-sm font-semibold">
              Archivo .xlsx (máximo 5 MB)
            </label>
            <input
              id={idArchivo}
              type="file"
              accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
              onChange={(e) => setArchivo(e.target.files?.[0] ?? null)}
              className="min-h-11 text-sm"
            />
          </div>
          <Boton type="submit" disabled={archivo === null} ocupado={subir.isPending}>
            Revisar la vista previa
          </Boton>
        </form>
      ) : (
        <TablaWeb
          proyectoId={proyectoId}
          brigadas={brigadas}
          alVista={(v) => {
            setMensaje(null);
            setVista(v);
          }}
        />
      )}
      <AvisoError error={subir.error ?? revisar.error} />

      {mensaje === null ? null : (
        <p
          role="status"
          className="rounded-md border border-liquen bg-liquen-claro px-3 py-2 text-sm"
        >
          <span aria-hidden="true">✓ </span>
          {mensaje}
        </p>
      )}
      {vista === null ? null : (
        <VistaPrevia
          key={vista.importacion_id}
          vista={vista}
          gestion={gestion}
          aprueba={aprueba}
          alTerminar={(m) => {
            setVista(null);
            setMensaje(m);
          }}
        />
      )}
      {gestion ? (
        <Propuestas proyectoId={proyectoId} alRevisar={(id) => revisar.mutate(id)} />
      ) : null}
    </section>
  );
};
