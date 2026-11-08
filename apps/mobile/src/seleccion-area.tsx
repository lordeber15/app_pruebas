import { ladosBboxKm, validarAreaUsuario, type Bbox } from '@campo/core';
import {
  Camera,
  Map,
  type InitialViewState,
  type LngLatBounds,
  type MapRef,
} from '@maplibre/maplibre-react-native';
import { router, Stack } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, ScrollView, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { leerPaquete } from './campo.ts';
import { useApp } from './estado.ts';
import { estiloNeutro, prepararMapaBase, type MapaBase } from './mapa-base.ts';
import { ErrorMapa, solicitarArea } from './mapas.ts';
import { bboxDeMarco, textoLados } from './mapas-logica.ts';
import { ErrorServidor, servidor } from './sesion.ts';
import { Aviso, BarraEstado, Boton, C, Campo, e, Segmentado, T } from './ui.tsx';

/**
 * Marcar un área para descargarla sin conexión (como en los mapas sin conexión de Google): un marco
 * fijo sobre el mapa; el área es lo que queda dentro del marco. Se mueve y acerca el mapa, no el
 * marco. Rotación e inclinación desactivadas para que el marco sea un rectángulo norte-sur.
 * Pedir el área necesita señal; el servidor la genera y luego se descarga con WiFi.
 */

/** Margen del marco dentro del mapa, en dp. */
const MARGEN = 28;
const MARCO = { izquierda: MARGEN, arriba: MARGEN, derecha: MARGEN, abajo: MARGEN } as const;
/** Perú completo, si el paquete no trae estaciones. */
const VISTA_PERU: InitialViewState = { center: [-75.0, -9.2], zoom: 5 };
const VELO = '#18231F66';

interface Datos {
  vista: InitialViewState;
  base: MapaBase;
  proyectoId: string | null;
  brigadas: { id: string; texto: string }[];
}

const vistaDeEstaciones = (
  estaciones: readonly { lat: number; lon: number }[],
): InitialViewState => {
  if (estaciones.length === 0) return VISTA_PERU;
  let o = Infinity;
  let s = Infinity;
  let e2 = -Infinity;
  let n = -Infinity;
  for (const x of estaciones) {
    o = Math.min(o, x.lon);
    e2 = Math.max(e2, x.lon);
    s = Math.min(s, x.lat);
    n = Math.max(n, x.lat);
  }
  const m = 0.02;
  return {
    bounds: [o - m, s - m, e2 + m, n + m],
    padding: { top: 48, right: 48, bottom: 48, left: 48 },
  };
};

export const SeleccionArea = () => {
  const insets = useSafeAreaInsets();
  const conectado = useApp((s) => s.conectado);
  const mapa = useRef<MapRef>(null);
  const [datos, setDatos] = useState<Datos | null>(null);
  const [falloLectura, setFalloLectura] = useState(false);
  const [falloBase, setFalloBase] = useState(false);
  const [tamano, setTamano] = useState<{ ancho: number; alto: number } | null>(null);
  const [vista, setVista] = useState<LngLatBounds | null>(null);
  const [nombre, setNombre] = useState('');
  const [brigada, setBrigada] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const c = { vigente: true };
    void (async () => {
      try {
        const d = await leerPaquete();
        const url = useApp.getState().conectado ? await servidor().catch(() => null) : null;
        const base = await prepararMapaBase(url);
        if (!c.vigente) return;
        const brigadas =
          d?.paquete.brigadas.map((b) => ({ id: b.id, texto: b.codigo ?? b.nombre })) ?? [];
        setDatos({
          vista: vistaDeEstaciones(d?.paquete.estaciones ?? []),
          base,
          proyectoId: d?.paquete.proyectos[0]?.id ?? null,
          brigadas,
        });
        if (brigadas.length === 1) setBrigada(brigadas[0]?.id ?? null);
      } catch {
        if (c.vigente) setFalloLectura(true);
      }
    })();
    return () => {
      c.vigente = false;
    };
  }, []);

  const bbox: Bbox | null =
    vista === null || tamano === null ? null : bboxDeMarco(vista, tamano, MARCO);
  const lados = bbox === null ? null : ladosBboxKm(bbox);
  const validacion = bbox === null ? null : validarAreaUsuario(bbox);
  const grande = validacion !== null && !validacion.ok ? validacion.mensaje : null;
  const variasBrigadas = (datos?.brigadas.length ?? 0) > 1;
  const listo =
    conectado &&
    bbox !== null &&
    grande === null &&
    nombre.trim() !== '' &&
    datos?.proyectoId !== null &&
    (!variasBrigadas || brigada !== null);

  const pedirArea = async () => {
    if (bbox === null || datos?.proyectoId === null || datos?.proyectoId === undefined) return;
    setEnviando(true);
    setError(null);
    try {
      await solicitarArea({
        proyectoId: datos.proyectoId,
        nombre: nombre.trim(),
        bbox,
        ...(brigada === null ? {} : { brigadaId: brigada }),
      });
      if (router.canGoBack()) router.back();
      else router.replace('/mapas');
    } catch (err) {
      setError(
        err instanceof ErrorMapa || err instanceof ErrorServidor
          ? err.message
          : 'No se pudo pedir el área. Intente de nuevo.',
      );
    } finally {
      setEnviando(false);
    }
  };

  const titulo = <Stack.Screen options={{ title: 'Marcar un área' }} />;

  if (falloLectura)
    return (
      <View style={[e.pantalla, { paddingBottom: insets.bottom }]}>
        {titulo}
        <BarraEstado />
        <View style={e.contenido}>
          <Aviso>No se pudo preparar el mapa. Vuelva e intente de nuevo.</Aviso>
          <Boton variante="secundario" texto="Volver" alPresionar={() => router.back()} />
        </View>
      </View>
    );

  if (datos === null)
    return (
      <View style={[e.pantalla, { alignItems: 'center', justifyContent: 'center', gap: 12 }]}>
        {titulo}
        <ActivityIndicator size="large" color={C.liquen} />
        <Text style={T.cuerpo}>Preparando el mapa…</Text>
      </View>
    );

  const estilo = falloBase ? estiloNeutro() : datos.base.estilo;
  const sinFondo = falloBase || !datos.base.conTeselas;

  return (
    <View style={[e.pantalla, { paddingBottom: insets.bottom }]}>
      {titulo}
      <BarraEstado />
      <View style={{ paddingHorizontal: 16, paddingVertical: 10, gap: 2 }}>
        <Text style={T.cuerpo}>
          Mueva y acerque el mapa hasta que el área que necesita quede dentro del marco.
        </Text>
        {sinFondo ? (
          <Text style={T.suave}>
            Sin mapa base en este celular: guíese por la ubicación de sus estaciones.
          </Text>
        ) : null}
      </View>
      <View
        style={{ flex: 1 }}
        onLayout={(ev) =>
          setTamano({ ancho: ev.nativeEvent.layout.width, alto: ev.nativeEvent.layout.height })
        }
      >
        <Map
          ref={mapa}
          style={{ flex: 1 }}
          mapStyle={estilo}
          logo={false}
          attribution={false}
          compass={false}
          touchRotate={false}
          touchPitch={false}
          onDidFailLoadingMap={() => setFalloBase(true)}
          onDidFinishLoadingMap={() => {
            void mapa.current
              ?.getBounds()
              .then(setVista)
              .catch(() => undefined);
          }}
          onRegionDidChange={(ev) => setVista(ev.nativeEvent.bounds)}
        >
          <Camera initialViewState={datos.vista} />
        </Map>
        {/* Velo fuera del marco y marco con doble borde: se distingue sobre cualquier fondo. */}
        <View
          pointerEvents="none"
          style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 }}
        >
          <View style={{ height: MARGEN, backgroundColor: VELO }} />
          <View style={{ flex: 1, flexDirection: 'row' }}>
            <View style={{ width: MARGEN, backgroundColor: VELO }} />
            <View
              accessibilityLabel="Marco del área"
              style={{ flex: 1, borderWidth: 3, borderColor: '#FFFFFF' }}
            >
              <View style={{ flex: 1, borderWidth: 2, borderColor: C.tinta }} />
            </View>
            <View style={{ width: MARGEN, backgroundColor: VELO }} />
          </View>
          <View style={{ height: MARGEN, backgroundColor: VELO }} />
        </View>
      </View>
      <ScrollView
        style={{
          maxHeight: 320,
          borderTopWidth: 1,
          borderTopColor: C.linea,
          backgroundColor: C.hoja,
        }}
        contentContainerStyle={{ padding: 16, gap: 12 }}
        keyboardShouldPersistTaps="handled"
      >
        <Text style={T.dato} accessibilityLiveRegion="polite">
          {lados === null ? 'Calculando el tamaño del área…' : `Área: ${textoLados(lados)}`}
        </Text>
        {grande === null ? null : <Aviso tipo="atencion">{grande}</Aviso>}
        {conectado ? null : (
          <Aviso tipo="atencion">
            Sin conexión: para pedir un área necesita señal. El servidor prepara el mapa y después
            usted lo descarga con WiFi.
          </Aviso>
        )}
        {datos.proyectoId === null ? (
          <Aviso>Descargue primero el paquete de campo desde Inicio.</Aviso>
        ) : null}
        <Campo
          etiqueta="Nombre del área"
          placeholder="Por ejemplo: Quebrada norte"
          value={nombre}
          onChangeText={setNombre}
          maxLength={80}
        />
        {variasBrigadas ? (
          <Segmentado
            etiqueta="Brigada"
            opciones={datos.brigadas.map((b) => ({ valor: b.id, texto: b.texto }))}
            valor={brigada}
            alCambiar={setBrigada}
          />
        ) : null}
        {error === null ? null : <Aviso>{error}</Aviso>}
        <Boton
          texto="Pedir esta área"
          ocupado={enviando}
          deshabilitado={!listo}
          alPresionar={() => void pedirArea()}
        />
        <Boton variante="secundario" texto="Cancelar" alPresionar={() => router.back()} />
      </ScrollView>
    </View>
  );
};
