import {
  fotosContextoRequeridas,
  geometriaRequerida,
  tiposConTrack,
  type GeometriaCapturada,
  type Orientacion,
  type ResultadoRegla,
} from '@campo/core';
import { router, Stack, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Image, ScrollView, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import {
  actualizarUnidad,
  agregarPuntoTrack,
  aplicarCambioUnidad,
  cerrarTrack,
  ejecucion as leerEjecucion,
  esperarUnidad,
  evaluarLocal,
  fotosDeEjecucion,
  leerPaquete,
  puntosDeTrack,
  unidad as leerUnidad,
  unidadesVinculables,
  type CambioUnidadEntrada,
  type EjecucionLocal,
  type EstadoUnidadEditable,
  type FotoLocal,
  type MetodoPaquete,
  type UnidadLocal,
} from '../../src/campo.ts';
import { useApp } from '../../src/estado.ts';
import { Formulario, guardarPendientes, type Valor } from '../../src/formulario.tsx';
import { mayuscula, NOMBRE_UNIDAD, sinCodigo } from '../../src/textos.ts';
import {
  formatoCoordenada,
  formatoPrecision,
  leerPosicion,
  seguirRecorrido,
  type Lectura,
} from '../../src/ubicacion.ts';
import {
  AccionInferior,
  Aviso,
  BarraEstado,
  Boton,
  C,
  e,
  Etiqueta,
  MarcaControl,
  Segmentado,
  Separador,
  T,
} from '../../src/ui.tsx';

const CARDINALES: readonly Orientacion[] = ['N', 'S', 'E', 'O'];
const HORA = new Intl.DateTimeFormat('es-PE', { hour: '2-digit', minute: '2-digit' });

interface Datos {
  u: UnidadLocal;
  ej: EjecucionLocal;
  metodo: MetodoPaquete;
  fotos: FotoLocal[];
  problemas: ResultadoRegla[];
  puntosTrack: number;
  vinculables: { id: string; codigo: string }[];
}

const json = <T,>(s: string | null, d: T): T => (s === null ? d : (JSON.parse(s) as T));

/** Bloque titulado con su marca de control. */
const Bloque = ({
  titulo,
  control,
  derecha,
  children,
}: {
  titulo: string;
  control?: 'obligatorio' | 'advertencia' | null;
  derecha?: string;
  children: React.ReactNode;
}) => (
  <View style={[e.tarjeta, { gap: 12, padding: 16 }]}>
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
      {control === undefined || control === null ? null : <MarcaControl control={control} />}
      <Text style={[T.subtitulo, { flex: 1 }]} accessibilityRole="header">
        {titulo}
      </Text>
      {derecha === undefined ? null : <Text style={T.dato}>{derecha}</Text>}
    </View>
    {children}
  </View>
);

const Lugar = ({ etiqueta, p }: { etiqueta: string; p: { lat: number; lon: number } | null }) => (
  <View style={{ flexDirection: 'row', justifyContent: 'space-between', gap: 8 }}>
    <Text style={T.etiqueta}>{etiqueta}</Text>
    <Text style={[T.cuerpo, { fontVariant: ['tabular-nums'] }]}>
      {p === null ? 'Pendiente' : formatoCoordenada(p.lat, p.lon)}
    </Text>
  </View>
);

export default function Unidad() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const insets = useSafeAreaInsets();
  const version = useApp((s) => s.version);
  const [d, setD] = useState<Datos | null>(null);
  const [leyendo, setLeyendo] = useState<string | null>(null);
  const [ultimaLectura, setUltimaLectura] = useState<Lectura | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);
  const [parte, setParte] = useState('principal');
  const [fila, setFila] = useState<Record<string, unknown>>({});
  const filaRef = useRef<Record<string, unknown>>({});
  const vigilante = useRef<{ remove: () => void } | null>(null);
  // Estado local más reciente de la unidad (incluye lo aún no escrito en SQLite) y cuántos
  // guardados siguen en la cola: mientras haya alguno, una relectura no pisa lo local.
  const uRef = useRef<UnidadLocal | null>(null);
  const enVuelo = useRef(0);

  const cargar = useCallback(async () => {
    const p = await leerPaquete();
    const leida = await leerUnidad(id);
    if (p === null || leida === null) return;
    const u = enVuelo.current > 0 && uRef.current !== null ? uRef.current : leida;
    uRef.current = u;
    const ej = await leerEjecucion(u.ejecucion_id);
    const ev = await evaluarLocal(p.paquete, u.ejecucion_id);
    if (ej === null || ev === null) return;
    const vinculo = ev.metodo.config.validaciones.find((v) => v.tipo === 'vinculo_unidad');
    setD({
      u,
      ej,
      metodo: ev.metodo,
      fotos: (await fotosDeEjecucion(u.ejecucion_id)).filter((f) => f.unidad_id === u.id),
      problemas: ev.evaluacion.resultados.filter(
        (r) => r.unidad_id === u.id && r.estado === 'incumple',
      ),
      puntosTrack: await puntosDeTrack(u.id),
      vinculables:
        vinculo === undefined
          ? []
          : await unidadesVinculables(p.paquete, ej.estacion_id, vinculo.metodo),
    });
  }, [id]);

  useFocusEffect(
    useCallback(() => {
      void cargar();
    }, [cargar, version]),
  );

  const cfg = d?.metodo.config;
  const conTrack = cfg !== undefined && d !== null && tiposConTrack(cfg).includes(d.u.tipo_unidad);
  const grabando = conTrack && d.u.inicio !== null && d.u.fin === null && d.u.estado === 'abierta';

  // RN-24: el track se registra solo mientras el recorrido está en curso (y esta pantalla abierta).
  useEffect(() => {
    if (!grabando) return;
    let activo = true;
    void seguirRecorrido((l) => {
      if (!activo) return;
      setUltimaLectura(l);
      void agregarPuntoTrack(d.u.ejecucion_id, d.u.id, l).then((n) =>
        setD((x) => (x === null ? x : { ...x, puntosTrack: n })),
      );
    }).then((s) => {
      if (activo) vigilante.current = s;
      else s.remove();
    });
    return () => {
      activo = false;
      vigilante.current?.remove();
      vigilante.current = null;
    };
  }, [grabando, d?.u.id, d?.u.ejecucion_id]);

  if (d === null || cfg === undefined) return <View style={e.pantalla} />;
  const { u } = d;
  const editable = d.ej.estado_local === 'en_curso';
  const requerida = geometriaRequerida(cfg, u.tipo_unidad);
  const geom = json<GeometriaCapturada | null>(u.geometria, null);
  const datos = json<Record<string, unknown>>(u.datos, {});
  const registros = json<Record<string, unknown>[]>(u.registros, []);
  const parametros = json<string[]>(u.parametros, []);
  /** Vértices vigentes al aplicar el cambio (no los del último render). */
  const vertices = (a: EstadoUnidadEditable) =>
    a.geometria?.tipo === 'vertices' ? a.geometria.vertices : [];
  const esPrincipal = u.tipo_unidad === cfg.unidad.tipo;
  const fotosReq = fotosContextoRequeridas(
    cfg,
    u.tipo_unidad,
    cfg.validaciones.find((v) => v.tipo === 'fotos_contexto')?.cantidad_por_unidad ?? null,
  );
  const fotosContexto = d.fotos.filter((f) => f.tipo_foto === 'contexto');
  const cardinales = cfg.fotos.contexto.cardinales && fotosReq !== null && fotosReq >= 4;
  const minRegistros = cfg.validaciones.find((v) => v.tipo === 'cantidad_registros');
  const parametrosReq = cfg.validaciones.find((v) => v.tipo === 'parametros_tecnicos');
  const vinculo = cfg.validaciones.find((v) => v.tipo === 'vinculo_unidad');

  /**
   * Guarda primero en la pantalla (optimista) y encola la escritura en SQLite, que vuelve a
   * aplicar el mismo cambio sobre lo guardado: dos ediciones seguidas nunca se pisan.
   */
  const guardar = (c: CambioUnidadEntrada) => {
    const actual = uRef.current;
    if (actual === null) return;
    setAviso(null);
    const nueva = aplicarCambioUnidad(actual, c);
    uRef.current = nueva;
    setD((x) => (x === null ? x : { ...x, u: nueva }));
    enVuelo.current += 1;
    void actualizarUnidad(actual.id, c)
      .catch(() => setAviso('No se pudo guardar. Intente de nuevo.'))
      .finally(() => {
        enVuelo.current -= 1;
        if (enVuelo.current === 0) void cargar();
      });
  };
  const cambiarDato = (clave: string, v: Valor) => {
    if (editable) guardar({ datos: { [clave]: v } });
  };
  const cambiarFila = (clave: string, v: Valor) => {
    filaRef.current = { ...filaRef.current, [clave]: v };
    setFila(filaRef.current);
  };

  const tomarPunto = async (clave: string, alLeer: (p: { lat: number; lon: number }) => void) => {
    setLeyendo(clave);
    setAviso(null);
    try {
      const l = await leerPosicion();
      if (l === null) {
        setAviso('Todavía no hay señal GPS. Espere al aire libre e intente de nuevo.');
        return;
      }
      setUltimaLectura(l);
      alLeer({ lat: l.lat, lon: l.lon });
    } finally {
      setLeyendo(null);
    }
  };

  // ── Geometría según D01 (RN-30) ──
  const geometria = () => {
    if (requerida === null || requerida === 'hereda') return null;
    if (requerida === 'vinculada') return null;
    const titulo =
      requerida === 'punto_opcional' ? 'Coordenada (si corresponde)' : 'Georreferenciación';
    const control = requerida === 'punto_opcional' ? null : 'obligatorio';
    if (requerida === 'punto' || requerida === 'punto_opcional') {
      const p = geom?.tipo === 'punto' ? geom.punto : null;
      return (
        <Bloque titulo={titulo} control={control}>
          <Lugar etiqueta="Punto" p={p} />
          {editable ? (
            <Boton
              variante={p === null ? 'principal' : 'secundario'}
              ocupado={leyendo === 'punto'}
              texto={p === null ? 'Tomar coordenada' : 'Volver a tomar'}
              alPresionar={() =>
                void tomarPunto('punto', (x) => guardar({ geometria: { tipo: 'punto', punto: x } }))
              }
            />
          ) : null}
        </Bloque>
      );
    }
    if (requerida === 'inicio_fin') {
      const ini =
        geom?.tipo === 'inicio_fin' ? geom.inicio : geom?.tipo === 'punto' ? geom.punto : null;
      const fin = geom?.tipo === 'inicio_fin' ? geom.fin : null;
      return (
        <Bloque titulo={titulo} control={control}>
          <Lugar etiqueta="Inicio" p={ini} />
          <Lugar etiqueta="Fin" p={fin} />
          {editable ? (
            <View style={{ flexDirection: 'row', gap: 8 }}>
              <View style={{ flex: 1 }}>
                <Boton
                  variante={ini === null ? 'principal' : 'secundario'}
                  ocupado={leyendo === 'inicio'}
                  texto={ini === null ? 'Marcar inicio' : 'Inicio de nuevo'}
                  alPresionar={() =>
                    void tomarPunto('inicio', (x) =>
                      guardar((a) => {
                        const f = a.geometria?.tipo === 'inicio_fin' ? a.geometria.fin : null;
                        return {
                          geometria:
                            f === null
                              ? { tipo: 'punto', punto: x }
                              : { tipo: 'inicio_fin', inicio: x, fin: f },
                        };
                      }),
                    )
                  }
                />
              </View>
              <View style={{ flex: 1 }}>
                <Boton
                  variante={ini !== null && fin === null ? 'principal' : 'secundario'}
                  deshabilitado={ini === null}
                  ocupado={leyendo === 'fin'}
                  texto="Marcar fin"
                  alPresionar={() =>
                    void tomarPunto('fin', (x) =>
                      guardar((a) => {
                        const i =
                          a.geometria?.tipo === 'inicio_fin'
                            ? a.geometria.inicio
                            : a.geometria?.tipo === 'punto'
                              ? a.geometria.punto
                              : null;
                        return i === null
                          ? {}
                          : { geometria: { tipo: 'inicio_fin', inicio: i, fin: x } };
                      }),
                    )
                  }
                />
              </View>
            </View>
          ) : null}
        </Bloque>
      );
    }
    const minimo = cfg.geometria.detalle?.vertices_minimos ?? 3;
    if (requerida === 'vertices') {
      const v = geom?.tipo === 'vertices' ? geom.vertices : [];
      return (
        <Bloque
          titulo="Vértices de la parcela"
          control="obligatorio"
          derecha={`${String(v.length)} de ${String(minimo)}`}
        >
          <Text style={T.suave}>{cfg.geometria.texto}</Text>
          {editable ? (
            <View style={{ flexDirection: 'row', gap: 8 }}>
              <View style={{ flex: 2 }}>
                <Boton
                  ocupado={leyendo === 'vertice'}
                  variante={v.length < minimo ? 'principal' : 'secundario'}
                  texto={`Marcar vértice ${String(v.length + 1)}`}
                  alPresionar={() =>
                    void tomarPunto('vertice', (x) =>
                      guardar((a) => ({
                        geometria: { tipo: 'vertices', vertices: [...vertices(a), x] },
                      })),
                    )
                  }
                />
              </View>
              <View style={{ flex: 1 }}>
                <Boton
                  variante="secundario"
                  deshabilitado={v.length === 0}
                  texto="Quitar último"
                  alPresionar={() =>
                    guardar((a) => {
                      const w = vertices(a);
                      return {
                        geometria:
                          w.length <= 1 ? null : { tipo: 'vertices', vertices: w.slice(0, -1) },
                      };
                    })
                  }
                />
              </View>
            </View>
          ) : null}
        </Bloque>
      );
    }
    // Parcela forestal compuesta (E-04): principal + subparcelas, cada una por vértices.
    const pf =
      geom?.tipo === 'parcela_forestal'
        ? geom
        : { tipo: 'parcela_forestal' as const, principal: [], subparcelas: [] };
    const partes = [
      { valor: 'principal', texto: 'Principal', n: pf.principal.length },
      ...(cfg.geometria.detalle?.subparcelas ?? []).flatMap((s) =>
        Array.from({ length: s.cantidad }, (_, i) => ({
          valor: `${s.tipo}:${String(i)}`,
          texto: `${mayuscula(s.tipo)} ${String(i + 1)}`,
          n: pf.subparcelas.filter((x) => x.tipo === s.tipo)[i]?.vertices.length ?? 0,
        })),
      ),
    ];
    const completas = partes.filter((x) => x.n >= minimo).length;
    const agregarVertice = (x: { lat: number; lon: number }) => {
      const destino = parte;
      guardar((a) => {
        const g =
          a.geometria?.tipo === 'parcela_forestal'
            ? a.geometria
            : { tipo: 'parcela_forestal' as const, principal: [], subparcelas: [] };
        if (destino === 'principal') return { geometria: { ...g, principal: [...g.principal, x] } };
        const [tipo, idx] = destino.split(':');
        const i = Number(idx);
        const delTipo = g.subparcelas.filter((s) => s.tipo === tipo);
        const otras = g.subparcelas.filter((s) => s.tipo !== tipo);
        while (delTipo.length <= i) delTipo.push({ tipo: tipo ?? '', vertices: [] });
        const nuevas = delTipo.map((s, k) =>
          k === i ? { ...s, vertices: [...s.vertices, x] } : s,
        );
        return { geometria: { ...g, subparcelas: [...otras, ...nuevas] } };
      });
    };
    return (
      <Bloque
        titulo="Parcela forestal"
        control="obligatorio"
        derecha={`${String(completas)} de ${String(partes.length)}`}
      >
        <Text style={T.suave}>
          Marque al menos {minimo} vértices en la parcela principal y en cada subparcela.
        </Text>
        <Segmentado
          etiqueta="Parte que está marcando"
          opciones={partes.map((x) => ({ valor: x.valor, texto: `${x.texto} · ${String(x.n)}` }))}
          valor={parte}
          alCambiar={setParte}
        />
        {editable ? (
          <Boton
            ocupado={leyendo === 'pf'}
            texto="Marcar vértice aquí"
            alPresionar={() => void tomarPunto('pf', agregarVertice)}
          />
        ) : null}
      </Bloque>
    );
  };

  const terminar = async () => {
    // Lo último escrito con el teclado abierto entra a la cola antes del cierre de la unidad.
    guardarPendientes();
    const ahora = new Date().toISOString();
    guardar((a) => ({ estado: 'cerrada', fin: a.fin ?? ahora }));
    await esperarUnidad(u.id);
    await cerrarTrack(u.id);
    router.back();
  };

  return (
    <View style={e.pantalla}>
      <Stack.Screen options={{ title: `${u.codigo} · ${NOMBRE_UNIDAD[u.tipo_unidad]}` }} />
      <BarraEstado />
      <ScrollView
        contentContainerStyle={[e.contenido, { gap: 16 }]}
        keyboardShouldPersistTaps="handled"
      >
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
          <Text style={T.titular}>{u.codigo}</Text>
          <Etiqueta
            tono={u.estado === 'cerrada' ? 'ok' : 'atencion'}
            texto={u.estado === 'cerrada' ? 'Terminada' : 'Abierta'}
          />
        </View>
        {aviso === null ? null : <Aviso tipo="atencion">{aviso}</Aviso>}
        {d.problemas.length > 0 ? (
          <View style={[e.tarjeta, { gap: 8, borderColor: C.ocre }]}>
            {d.problemas.map((r, i) => (
              <View
                key={`${r.regla}-${String(i)}`}
                style={{ flexDirection: 'row', gap: 10, alignItems: 'center' }}
              >
                <MarcaControl control={r.tipo_control} />
                <Text style={[T.cuerpo, { flex: 1 }]}>
                  {mayuscula(sinCodigo(r.mensaje, u.codigo))}
                </Text>
              </View>
            ))}
          </View>
        ) : null}

        <Bloque titulo="Tiempo">
          <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
            <Text style={T.etiqueta}>Inicio</Text>
            <Text style={T.dato}>
              {u.inicio === null ? 'Sin marcar' : HORA.format(new Date(u.inicio))}
            </Text>
          </View>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
            <Text style={T.etiqueta}>Fin</Text>
            <Text style={T.dato}>
              {u.fin === null ? 'Sin marcar' : HORA.format(new Date(u.fin))}
            </Text>
          </View>
          {editable && u.inicio === null ? (
            <Boton
              texto={conTrack ? 'Iniciar recorrido' : 'Iniciar ahora'}
              alPresionar={() => guardar({ inicio: new Date().toISOString() })}
            />
          ) : null}
          {conTrack ? (
            <View style={{ gap: 4 }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                <View
                  style={[
                    { width: 12, height: 12, borderRadius: 6 },
                    grabando
                      ? { backgroundColor: C.oxido }
                      : { borderWidth: 2, borderColor: C.suave },
                  ]}
                />
                <Text style={T.subtitulo}>{grabando ? 'Grabando track' : 'Track'}</Text>
                <Text style={[T.dato, { marginLeft: 'auto' }]}>{d.puntosTrack} puntos</Text>
              </View>
              {grabando ? (
                <Text style={T.suave}>
                  Mantenga esta pantalla abierta durante el recorrido.
                  {ultimaLectura === null
                    ? ''
                    : ` Última lectura ${formatoPrecision(ultimaLectura.precision_m)}.`}
                </Text>
              ) : null}
            </View>
          ) : null}
        </Bloque>

        {geometria()}

        {vinculo !== undefined && esPrincipal ? (
          <Bloque titulo="Vínculo" control="obligatorio">
            <Text style={T.suave}>{cfg.vinculo?.texto ?? vinculo.texto}</Text>
            {d.vinculables.length === 0 ? (
              <Text style={T.cuerpo}>
                Aún no hay unidades del método vinculado en esta estación, en este celular.
              </Text>
            ) : (
              <Segmentado
                etiqueta="Unidad vinculada"
                opciones={d.vinculables.map((x) => ({ valor: x.id, texto: x.codigo }))}
                valor={u.unidad_vinculada_id}
                alCambiar={(v) => editable && guardar({ unidad_vinculada_id: v })}
              />
            )}
          </Bloque>
        ) : null}

        {fotosReq !== null ? (
          <Bloque
            titulo="Fotos de contexto"
            control="obligatorio"
            derecha={`${String(fotosContexto.length)} de ${String(fotosReq)}`}
          >
            <Text style={T.suave}>{cfg.fotos.contexto.texto}</Text>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
              {fotosContexto.map((f) => (
                <View key={f.id} style={{ width: 84, gap: 4 }}>
                  {f.estado === 'verificado' ? (
                    <View
                      style={{
                        width: 84,
                        height: 64,
                        borderRadius: 6,
                        backgroundColor: C.liquenClaro,
                        alignItems: 'center',
                        justifyContent: 'center',
                      }}
                    >
                      <Text style={{ color: C.liquenOscuro, fontWeight: '700' }}>Enviada</Text>
                    </View>
                  ) : (
                    <Image
                      source={{ uri: f.uri }}
                      style={{ width: 84, height: 64, borderRadius: 6 }}
                      accessibilityLabel={`Foto de contexto ${f.orientacion ?? ''}`}
                    />
                  )}
                  <Text style={T.etiqueta}>{f.orientacion ?? 'Contexto'}</Text>
                </View>
              ))}
            </View>
            {editable && fotosContexto.length < fotosReq ? (
              <Boton
                texto={fotosContexto.length === 0 ? 'Tomar fotos de contexto' : 'Continuar fotos'}
                variante="secundario"
                alPresionar={() => {
                  const hechas = new Set(fotosContexto.map((f) => f.orientacion));
                  const faltan = cardinales ? CARDINALES.filter((o) => !hechas.has(o)) : [];
                  router.push({
                    pathname: '/camara',
                    params: {
                      ejecucionId: u.ejecucion_id,
                      unidadId: u.id,
                      tipoFoto: 'contexto',
                      orientaciones: faltan.join(','),
                      objetivo: String(fotosReq - fotosContexto.length),
                    },
                  });
                }}
              />
            ) : null}
          </Bloque>
        ) : null}

        {esPrincipal && cfg.campos.length > 0 ? (
          <Bloque
            titulo="Datos"
            control={
              cfg.validaciones.some((v) => v.tipo === 'campos_obligatorios') ? 'obligatorio' : null
            }
          >
            <Formulario campos={cfg.campos} datos={datos} alCambiar={cambiarDato} />
          </Bloque>
        ) : null}

        {esPrincipal && cfg.registros !== null ? (
          <Bloque
            titulo={cfg.registros.etiqueta}
            control={minRegistros === undefined ? null : 'obligatorio'}
            derecha={
              minRegistros === undefined
                ? String(registros.length)
                : `${String(registros.length)} de ${String(minRegistros.minimo)}`
            }
          >
            {registros.slice(-5).map((r, i) => (
              <View key={String(registros.length - 5 + i)}>
                {i > 0 ? <Separador /> : null}
                <Text style={[T.cuerpo, { paddingVertical: 6 }]} numberOfLines={2}>
                  {registros.length - Math.min(5, registros.length) + i + 1}.{' '}
                  {Object.values(r)
                    .filter((x) => x !== null && x !== '')
                    .map((x) =>
                      typeof x === 'boolean' ? (x ? 'sí' : 'no') : String(x as string | number),
                    )
                    .join(' · ')}
                </Text>
              </View>
            ))}
            {editable ? (
              <>
                <Formulario campos={cfg.registros.campos} datos={fila} alCambiar={cambiarFila} />
                <View style={{ flexDirection: 'row', gap: 8 }}>
                  <View style={{ flex: 1 }}>
                    <Boton
                      texto="Agregar fila"
                      deshabilitado={Object.values(fila).every((x) => x === null || x === '')}
                      alPresionar={() => {
                        guardarPendientes();
                        const nueva = filaRef.current;
                        guardar((a) => ({ registros: [...a.registros, nueva] }));
                        filaRef.current = {};
                        setFila({});
                      }}
                    />
                  </View>
                  {registros.length > 0 ? (
                    <View style={{ flex: 1 }}>
                      <Boton
                        variante="secundario"
                        texto="Repetir la anterior"
                        alPresionar={() =>
                          guardar((a) => ({
                            registros: [...a.registros, a.registros.at(-1) ?? {}],
                          }))
                        }
                      />
                    </View>
                  ) : null}
                </View>
                {registros.length > 0 ? (
                  <Boton
                    variante="secundario"
                    texto="Quitar la última fila"
                    alPresionar={() => guardar((a) => ({ registros: a.registros.slice(0, -1) }))}
                  />
                ) : null}
              </>
            ) : null}
          </Bloque>
        ) : null}

        {parametrosReq !== undefined && esPrincipal ? (
          <Bloque
            titulo="Parámetros del equipo"
            control="obligatorio"
            derecha={`${String(parametros.length)} de ${String(parametrosReq.parametros.length)}`}
          >
            <Text style={T.suave}>Confirme cada parámetro configurado en el detector.</Text>
            {parametrosReq.parametros.map((p) => (
              <Segmentado
                key={p}
                etiqueta={p}
                opciones={[
                  { valor: 'si', texto: 'Configurado' },
                  { valor: 'no', texto: 'No' },
                ]}
                valor={parametros.includes(p) ? 'si' : null}
                alCambiar={(v) =>
                  editable &&
                  guardar((a) => ({
                    parametros:
                      v === 'si'
                        ? [...new Set([...a.parametros, p])]
                        : a.parametros.filter((x) => x !== p),
                  }))
                }
              />
            ))}
          </Bloque>
        ) : null}
      </ScrollView>
      {editable ? (
        <AccionInferior abajo={insets.bottom}>
          {u.estado === 'abierta' ? (
            <Boton
              texto={grabando ? 'Terminar recorrido' : `Terminar ${NOMBRE_UNIDAD[u.tipo_unidad]}`}
              alPresionar={() => void terminar()}
            />
          ) : (
            <Boton
              variante="secundario"
              texto="Volver a abrir"
              alPresionar={() => guardar({ estado: 'abierta' })}
            />
          )}
        </AccionInferior>
      ) : null}
    </View>
  );
}
