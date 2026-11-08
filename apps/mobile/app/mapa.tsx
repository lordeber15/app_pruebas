import { ETIQUETA_ESTADO_ESTACION, type EstadoEstacion } from '@campo/core';
import {
  Camera,
  Map,
  Marker,
  UserLocation,
  type InitialViewState,
  type LngLatBounds,
  type TrackUserLocation,
} from '@maplibre/maplibre-react-native';
import * as Location from 'expo-location';
import { router, Stack, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { useCallback, useMemo, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import {
  avancesDeEstacionesLocales,
  textoAvance,
  type AvanceEstacionLocal,
} from '../src/avance.ts';
import { leerPaquete, type EstacionPaquete } from '../src/campo.ts';
import { useApp } from '../src/estado.ts';
import { estiloNeutro, prepararMapaBase, type MapaBase } from '../src/mapa-base.ts';
import { Aviso, BarraEstado, Boton, C, e, T } from '../src/ui.tsx';

/**
 * Mapa de estaciones (pedido del usuario, 2026-11-08): las estaciones del paquete de campo con su
 * estado según core (`avanceEstacion`), calculado con lo guardado en este celular. Cada estado
 * tiene color, símbolo y texto propios: el color nunca es el único indicador.
 *
 * Privacidad: el punto azul lo dibuja MapLibre; esta pantalla no lee, guarda ni registra la
 * posición del usuario.
 */

interface Apariencia {
  readonly fondo: string;
  readonly borde: string;
  readonly texto: string;
  readonly simbolo: string;
  /** Borde discontinuo: refuerza «sin datos» sin depender del color. */
  readonly discontinuo?: boolean;
}

const APARIENCIA: Readonly<Record<EstadoEstacion, Apariencia>> = {
  completa: { fondo: C.liquen, borde: C.liquenOscuro, texto: '#FFFFFF', simbolo: '✓' },
  en_curso: { fondo: C.ocreClaro, borde: C.ocre, texto: C.ocre, simbolo: '◐' },
  con_incumplimiento: { fondo: C.oxido, borde: '#6E1E15', texto: '#FFFFFF', simbolo: '!' },
  reprogramada: { fondo: '#E4E6F5', borde: '#3E4491', texto: '#3E4491', simbolo: '↻' },
  sin_datos: {
    fondo: '#FFFFFF',
    borde: C.suave,
    texto: C.suave,
    simbolo: '?',
    discontinuo: true,
  },
  sin_iniciar: { fondo: '#FFFFFF', borde: C.tinta, texto: C.tinta, simbolo: '○' },
};

const ORDEN_LEYENDA: readonly EstadoEstacion[] = [
  'completa',
  'en_curso',
  'con_incumplimiento',
  'reprogramada',
  'sin_datos',
  'sin_iniciar',
];

const FORMATO_DIA = new Intl.DateTimeFormat('es-PE', {
  weekday: 'short',
  day: 'numeric',
  month: 'short',
});
const diaCorto = (iso: string): string => {
  const [y, m, d] = iso.split('-').map(Number);
  return FORMATO_DIA.format(new Date(y ?? 2000, (m ?? 1) - 1, d ?? 1));
};

const textoFechas = (fechas: readonly string[]): string => {
  if (fechas.length === 0) return 'Sin fecha en el cronograma vigente';
  const [primera] = fechas;
  const ultima = fechas[fechas.length - 1];
  if (primera === undefined || ultima === undefined) return 'Sin fecha en el cronograma vigente';
  return fechas.length === 1
    ? `Programada: ${diaCorto(primera)}`
    : `Programada: ${diaCorto(primera)} al ${diaCorto(ultima)}`;
};

const Simbolo = ({ estado, tamano = 34 }: { estado: EstadoEstacion; tamano?: number }) => {
  const a = APARIENCIA[estado];
  return (
    <View
      style={{
        width: tamano,
        height: tamano,
        borderRadius: tamano / 2,
        backgroundColor: a.fondo,
        borderColor: a.borde,
        borderWidth: 2.5,
        borderStyle: a.discontinuo === true ? 'dashed' : 'solid',
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      <Text
        style={{
          color: a.texto,
          fontSize: tamano * 0.5,
          fontWeight: '800',
          lineHeight: tamano * 0.62,
        }}
      >
        {a.simbolo}
      </Text>
    </View>
  );
};

/** Encuadre de todas las estaciones, con un margen mínimo para no acercar de más. */
const encuadre = (estaciones: readonly EstacionPaquete[]): LngLatBounds | null => {
  if (estaciones.length === 0) return null;
  let oeste = Infinity;
  let sur = Infinity;
  let este = -Infinity;
  let norte = -Infinity;
  for (const x of estaciones) {
    oeste = Math.min(oeste, x.lon);
    este = Math.max(este, x.lon);
    sur = Math.min(sur, x.lat);
    norte = Math.max(norte, x.lat);
  }
  const m = 0.005;
  return [oeste - m, sur - m, este + m, norte + m];
};

type Estado =
  | { tipo: 'cargando' }
  | { tipo: 'error'; mensaje: string }
  | { tipo: 'vacio' }
  | {
      tipo: 'listo';
      estaciones: EstacionPaquete[];
      avances: globalThis.Map<string, AvanceEstacionLocal>;
    };

export default function MapaEstaciones() {
  const { estacionId } = useLocalSearchParams<{ estacionId?: string }>();
  const insets = useSafeAreaInsets();
  const version = useApp((s) => s.version);
  const conectado = useApp((s) => s.conectado);
  const [estado, setEstado] = useState<Estado>({ tipo: 'cargando' });
  const [base, setBase] = useState<MapaBase | null>(null);
  const [falloBase, setFalloBase] = useState(false);
  const [elegida, setElegida] = useState<string | null>(estacionId ?? null);
  const [conUbicacion, setConUbicacion] = useState(false);
  const [puedePedir, setPuedePedir] = useState(false);
  const [seguir, setSeguir] = useState<TrackUserLocation | undefined>(undefined);
  const [intento, setIntento] = useState(0);

  useFocusEffect(
    useCallback(() => {
      const c = { vigente: true };
      const sigue = () => c.vigente;
      void (async () => {
        try {
          const d = await leerPaquete();
          if (!sigue()) return;
          if (d === null || d.paquete.estaciones.length === 0) {
            setEstado({ tipo: 'vacio' });
            return;
          }
          const avances = await avancesDeEstacionesLocales(d.paquete);
          if (!sigue()) return;
          setBase((b) => b ?? prepararMapaBase());
          setEstado({ tipo: 'listo', estaciones: d.paquete.estaciones, avances });
          // Solo se consulta el permiso: el punto azul aparece si ya fue concedido.
          const permiso = await Location.getForegroundPermissionsAsync();
          if (!sigue()) return;
          setConUbicacion(permiso.granted);
          setPuedePedir(!permiso.granted && permiso.canAskAgain);
        } catch {
          if (sigue())
            setEstado({
              tipo: 'error',
              mensaje: 'No se pudieron leer las estaciones guardadas en el celular.',
            });
        }
      })();
      return () => {
        c.vigente = false;
      };
    }, [version, intento]),
  );

  const estaciones = estado.tipo === 'listo' ? estado.estaciones : null;
  const vistaInicial = useMemo((): InitialViewState | null => {
    if (estaciones === null) return null;
    const centro = estaciones.find((x) => x.id === estacionId);
    if (centro !== undefined) return { center: [centro.lon, centro.lat], zoom: 14 };
    const b = encuadre(estaciones);
    return b === null ? null : { bounds: b, padding: { top: 48, right: 48, bottom: 48, left: 48 } };
  }, [estaciones, estacionId]);

  if (estado.tipo === 'cargando')
    return (
      <View style={[e.pantalla, { alignItems: 'center', justifyContent: 'center', gap: 12 }]}>
        <Stack.Screen options={{ title: 'Mapa de estaciones' }} />
        <ActivityIndicator size="large" color={C.liquen} />
        <Text style={T.cuerpo}>Preparando el mapa…</Text>
      </View>
    );

  if (estado.tipo === 'error')
    return (
      <View style={[e.pantalla, { paddingBottom: insets.bottom }]}>
        <Stack.Screen options={{ title: 'Mapa de estaciones' }} />
        <BarraEstado />
        <View style={e.contenido}>
          <Aviso>{estado.mensaje}</Aviso>
          <Boton texto="Intentar de nuevo" alPresionar={() => setIntento((n) => n + 1)} />
        </View>
      </View>
    );

  if (estado.tipo === 'vacio' || vistaInicial === null)
    return (
      <View style={[e.pantalla, { paddingBottom: insets.bottom }]}>
        <Stack.Screen options={{ title: 'Mapa de estaciones' }} />
        <BarraEstado />
        <View style={[e.contenido, { gap: 12 }]}>
          <Text style={T.titular}>Todavía no hay estaciones</Text>
          <Text style={T.cuerpo}>
            Descargue el paquete de campo de su brigada desde Inicio para ver sus estaciones en el
            mapa.
          </Text>
          {conectado ? null : (
            <Text style={T.suave}>Necesita conexión solo para descargar el paquete.</Text>
          )}
          <Boton variante="secundario" texto="Volver a Inicio" alPresionar={() => router.back()} />
        </View>
      </View>
    );

  const estilo = base === null || falloBase ? estiloNeutro() : base.estilo;
  const sinFondo = base === null || !base.conTeselas || falloBase;
  const est = estado.estaciones.find((x) => x.id === elegida);
  const avance = est === undefined ? undefined : estado.avances.get(est.id);

  const pedirUbicacion = async () => {
    const r = await Location.requestForegroundPermissionsAsync();
    setConUbicacion(r.granted);
    setPuedePedir(!r.granted && r.canAskAgain);
  };

  return (
    <View style={[e.pantalla, { paddingBottom: insets.bottom }]}>
      <Stack.Screen options={{ title: 'Mapa de estaciones' }} />
      <BarraEstado />
      <View style={{ flex: 1 }}>
        <Map
          style={{ flex: 1 }}
          mapStyle={estilo}
          logo={false}
          attribution={false}
          compass={false}
          onPress={() => setElegida(null)}
          onDidFailLoadingMap={() => setFalloBase(true)}
        >
          <Camera
            initialViewState={vistaInicial}
            trackUserLocation={conUbicacion ? seguir : undefined}
            onTrackUserLocationChange={(ev) =>
              setSeguir(ev.nativeEvent.trackUserLocation ?? undefined)
            }
          />
          {estado.estaciones.map((x) => {
            const a = estado.avances.get(x.id);
            const s = a?.estado ?? 'sin_iniciar';
            const seleccionada = x.id === elegida;
            return (
              <Marker
                key={x.id}
                id={x.id}
                lngLat={[x.lon, x.lat]}
                anchor="top"
                onPress={(ev) => {
                  ev.stopPropagation();
                  setElegida(x.id);
                }}
              >
                <View
                  accessible
                  accessibilityRole="button"
                  accessibilityLabel={`Estación ${x.codigo}: ${ETIQUETA_ESTADO_ESTACION[s]}`}
                  style={{ alignItems: 'center', minWidth: 48, minHeight: 48, padding: 4 }}
                >
                  <Simbolo estado={s} tamano={seleccionada ? 42 : 34} />
                  <Text
                    style={{
                      marginTop: 2,
                      fontSize: 13,
                      fontWeight: '800',
                      color: C.tinta,
                      backgroundColor: seleccionada ? C.ocreClaro : '#FFFFFFE6',
                      borderColor: seleccionada ? C.ocre : 'transparent',
                      borderWidth: 1,
                      paddingHorizontal: 4,
                      borderRadius: 4,
                    }}
                  >
                    {x.codigo}
                  </Text>
                </View>
              </Marker>
            );
          })}
          {conUbicacion ? <UserLocation accuracy /> : null}
        </Map>

        {/* Leyenda siempre visible: símbolo + texto por estado. */}
        <View
          accessibilityLabel="Leyenda de estados"
          style={{
            position: 'absolute',
            top: 8,
            left: 8,
            right: 8,
            backgroundColor: '#FFFFFFF2',
            borderColor: C.linea,
            borderWidth: 1,
            borderRadius: 8,
          }}
        >
          <ScrollView
            horizontal
            contentContainerStyle={{ gap: 12, paddingHorizontal: 10, paddingVertical: 8 }}
          >
            {ORDEN_LEYENDA.map((s) => (
              <View key={s} style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                <Simbolo estado={s} tamano={22} />
                <Text style={{ fontSize: 13, color: C.tinta, fontWeight: '600' }}>
                  {ETIQUETA_ESTADO_ESTACION[s]}
                </Text>
              </View>
            ))}
          </ScrollView>
          {sinFondo ? (
            <Text style={[T.suave, { paddingHorizontal: 10, paddingBottom: 8, fontSize: 13 }]}>
              Mapa base no descargado: las estaciones se muestran sin fondo.
            </Text>
          ) : null}
        </View>

        {conUbicacion || puedePedir ? (
          <Pressable
            accessibilityRole="button"
            accessibilityState={{ selected: seguir !== undefined }}
            onPress={() =>
              conUbicacion
                ? setSeguir((x) => (x === undefined ? 'default' : undefined))
                : void pedirUbicacion()
            }
            style={{
              position: 'absolute',
              right: 12,
              bottom: est === undefined ? 16 : 236,
              minHeight: 48,
              justifyContent: 'center',
              paddingHorizontal: 16,
              borderRadius: 8,
              borderWidth: 1,
              borderColor: seguir === undefined ? C.linea : C.liquenOscuro,
              backgroundColor: seguir === undefined ? C.hoja : C.liquen,
            }}
          >
            <Text
              style={{
                fontSize: 16,
                fontWeight: '700',
                color: seguir === undefined ? C.tinta : '#FFFFFF',
              }}
            >
              {!conUbicacion
                ? 'Mostrar mi ubicación'
                : seguir === undefined
                  ? 'Seguir mi ubicación'
                  : 'Dejar de seguir'}
            </Text>
          </Pressable>
        ) : null}

        {est === undefined ? null : (
          <View
            accessibilityLiveRegion="polite"
            style={[
              e.tarjeta,
              {
                position: 'absolute',
                left: 12,
                right: 12,
                bottom: 12,
                gap: 8,
                shadowColor: '#000',
                shadowOpacity: 0.15,
                shadowRadius: 8,
                elevation: 6,
              },
            ]}
          >
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
              <Simbolo estado={avance?.estado ?? 'sin_iniciar'} tamano={30} />
              <View style={{ flex: 1 }}>
                <Text style={T.titulo}>{est.codigo}</Text>
                <Text style={T.subtitulo}>
                  {ETIQUETA_ESTADO_ESTACION[avance?.estado ?? 'sin_iniciar']}
                </Text>
              </View>
            </View>
            <Text style={T.cuerpo}>
              {avance === undefined ? 'Sin métodos aplicables en el paquete' : textoAvance(avance)}
            </Text>
            <Text style={T.suave}>{textoFechas(avance?.fechas ?? [])}</Text>
            <Text style={[T.suave, { fontSize: 13 }]}>
              Avance con lo registrado en este celular.
            </Text>
            <Boton
              texto="Abrir estación"
              alPresionar={() =>
                router.push({ pathname: '/estacion/[id]', params: { id: est.id } })
              }
            />
          </View>
        )}
      </View>
    </View>
  );
}
