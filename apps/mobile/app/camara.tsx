import type { Orientacion, TipoFoto } from '@campo/core';
import { CameraView, useCameraPermissions } from 'expo-camera';
import * as Location from 'expo-location';
import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useRef, useState, type ComponentRef } from 'react';
import {
  ActivityIndicator,
  Image,
  PixelRatio,
  Platform,
  Pressable,
  Text,
  View,
} from 'react-native';
import { captureRef } from 'react-native-view-shot';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { ejecucion as leerEjecucion, leerPaquete, unidad as leerUnidad } from '../src/campo.ts';
import { ubicacionActual } from '../src/eventos.ts';
import { guardarFotoEjecucion, tamanoFinal } from '../src/fotos.ts';
import { lineasSello, TIPO_FOTO_TEXTO } from '../src/sello.ts';
import { Aviso, Boton, C, e, Texto, tipoOracion } from '../src/ui.tsx';

const NOMBRE: Record<Orientacion, string> = { N: 'norte', S: 'sur', E: 'este', O: 'oeste' };
/** Si el sello no se pudo dibujar en este tiempo, la foto se guarda sin él (no se pierde). */
const ESPERA_SELLO_MS = 10_000;

interface Sello {
  readonly uri: string;
  /** Tamaño final en píxeles (≤ 2 048 px el lado mayor). */
  readonly ancho: number;
  readonly alto: number;
  readonly lineas: readonly string[];
}

/**
 * Cámara propia de la app (RN-16: sin galería). Cada foto se guarda con su ejecución, unidad,
 * tipo y orientación (F-02). Con fotos cardinales guía la secuencia N-S-E-O (F-03).
 *
 * Sello (decisión del usuario, 2026-11-08): tras disparar, la foto se dibuja fuera de la vista,
 * a su tamaño final, con una franja inferior de alto contraste (coordenadas y precisión, fecha y
 * hora, estación, método, unidad y tipo). Esa imagen sellada es la que se guarda, se resume
 * (SHA-256) y se sube. La coordenada sigue guardándose como dato del archivo.
 */
export default function Camara() {
  const q = useLocalSearchParams<{
    ejecucionId: string;
    unidadId?: string;
    tipoFoto?: string;
    orientaciones?: string;
    objetivo?: string;
  }>();
  const insets = useSafeAreaInsets();
  const [permiso, pedirPermiso] = useCameraPermissions();
  const camara = useRef<CameraView>(null);
  const escenario = useRef<ComponentRef<typeof View>>(null);
  const espera = useRef<{ resolver: (uri: string) => void; rechazar: (e: Error) => void } | null>(
    null,
  );
  const [sello, setSello] = useState<Sello | null>(null);
  const [contexto, setContexto] = useState<{
    estacion: string | null;
    metodo: string | null;
    unidad: string | null;
  }>({ estacion: null, metodo: null, unidad: null });
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [tomadas, setTomadas] = useState(0);
  const tipo = (q.tipoFoto ?? 'contexto') as TipoFoto;
  const unidadId = q.unidadId === undefined || q.unidadId === '' ? null : q.unidadId;
  const orientaciones = (q.orientaciones ?? '')
    .split(',')
    .filter((x): x is Orientacion => ['N', 'S', 'E', 'O'].includes(x));
  const objetivo = Number(q.objetivo ?? '0');
  const actual = orientaciones[tomadas] ?? null;

  useEffect(() => {
    void Location.requestForegroundPermissionsAsync();
  }, []);

  // Estación, método y unidad para el sello: todo sale del celular, sin pedir nada.
  useEffect(() => {
    void (async () => {
      const [p, ej, u] = await Promise.all([
        leerPaquete(),
        leerEjecucion(q.ejecucionId),
        unidadId === null ? Promise.resolve(null) : leerUnidad(unidadId),
      ]);
      if (p === null || ej === null) return;
      setContexto({
        estacion: p.paquete.estaciones.find((x) => x.id === ej.estacion_id)?.codigo ?? null,
        metodo: ((n) => (n === undefined ? null : tipoOracion(n)))(
          p.paquete.metodos.find((x) => x.id === ej.metodo_id)?.nombre,
        ),
        unidad: u?.codigo ?? null,
      });
    })();
  }, [q.ejecucionId, unidadId]);

  if (permiso === null) return <View style={e.pantalla} />;
  if (!permiso.granted) {
    return (
      <View style={[e.pantalla, e.contenido, { paddingTop: insets.top + 16 }]}>
        <Texto>Para tomar las fotos de evidencia, la app necesita la cámara.</Texto>
        <Boton texto="Permitir la cámara" alPresionar={() => void pedirPermiso()} />
        <Boton texto="Volver" variante="secundario" alPresionar={() => router.back()} />
      </View>
    );
  }

  /** Dibuja la foto con su sello y la captura como JPEG a su tamaño final. */
  const sellar = (s: Sello) =>
    new Promise<string>((resolver, rechazar) => {
      const reloj = setTimeout(() => {
        espera.current = null;
        rechazar(new Error('El sello no se dibujó a tiempo'));
      }, ESPERA_SELLO_MS);
      espera.current = {
        resolver: (uri) => {
          clearTimeout(reloj);
          resolver(uri);
        },
        rechazar: (err) => {
          clearTimeout(reloj);
          rechazar(err);
        },
      };
      setSello(s);
    });

  const alCargarEscenario = () => {
    const s = sello;
    // Dos cuadros: la imagen ya decodificada y la franja dibujada antes de capturar.
    requestAnimationFrame(() =>
      requestAnimationFrame(() => {
        const w = espera.current;
        if (w === null || s === null) return;
        espera.current = null;
        captureRef(escenario, {
          format: 'jpg',
          quality: 0.85,
          width: s.ancho,
          height: s.alto,
          result: 'tmpfile',
          ...(Platform.OS === 'ios' ? { useRenderInContext: true } : {}),
        }).then(w.resolver, (err: unknown) =>
          w.rechazar(err instanceof Error ? err : new Error('No se pudo capturar el sello')),
        );
      }),
    );
  };

  const disparar = async () => {
    if (camara.current === null || guardando) return;
    setGuardando(true);
    setError(null);
    try {
      const foto = await camara.current.takePictureAsync({ quality: 1, skipProcessing: false });
      const ubicacion = await ubicacionActual();
      const capturadoEn = new Date();
      const final = tamanoFinal(foto.width, foto.height);
      const lineas = lineasSello({
        ubicacion,
        capturadoEn,
        estacion: contexto.estacion,
        metodo: contexto.metodo,
        unidad: contexto.unidad,
        tipoFoto: tipo,
        orientacion: actual,
      });
      let sellada: string | null = null;
      try {
        sellada = await sellar({ uri: foto.uri, ancho: final.ancho, alto: final.alto, lineas });
      } catch {
        sellada = null;
      } finally {
        setSello(null);
      }
      await guardarFotoEjecucion(
        sellada === null
          ? {
              uri: foto.uri,
              ancho: foto.width,
              alto: foto.height,
              ubicacion,
              capturadoEn: capturadoEn.toISOString(),
              sellada: false,
              temporales: [],
            }
          : {
              uri: sellada,
              ancho: final.ancho,
              alto: final.alto,
              ubicacion,
              capturadoEn: capturadoEn.toISOString(),
              sellada: true,
              temporales: [foto.uri],
            },
        { ejecucionId: q.ejecucionId, unidadId, tipoFoto: tipo, orientacion: actual },
      );
      if (sellada === null)
        setError('La foto se guardó sin el sello de coordenadas; sus datos sí quedaron guardados.');
      const n = tomadas + 1;
      setTomadas(n);
      if (objetivo > 0 && n >= objetivo && sellada !== null) router.back();
    } catch {
      setError('No se pudo guardar la foto. Intente de nuevo.');
    } finally {
      setGuardando(false);
    }
  };

  const indicacion =
    actual !== null
      ? `Mire al ${NOMBRE[actual]} (${actual}), encuadre amplio y sin zoom`
      : tipo === 'metodologica'
        ? 'Usted, la acción y el equipo, en plano lateral u oblicuo'
        : tipo === 'primer_plano'
          ? 'Acérquese al individuo o al indicio, con buena luz'
          : 'Encuadre amplio del hábitat, sin zoom';

  // Escenario del sello en puntos: al capturar con ancho/alto en píxeles sale a tamaño final.
  const pr = PixelRatio.get();
  const anchoDp = sello === null ? 0 : sello.ancho / pr;
  const altoDp = sello === null ? 0 : sello.alto / pr;
  const letra = Math.max(10, Math.min(anchoDp, altoDp) * 0.03);

  return (
    <View style={{ flex: 1, backgroundColor: '#000' }}>
      {sello === null ? null : (
        // Detrás de la cámara: no se ve, pero se dibuja para capturarlo.
        <View
          ref={escenario}
          collapsable={false}
          pointerEvents="none"
          accessibilityElementsHidden
          importantForAccessibility="no-hide-descendants"
          style={{ position: 'absolute', top: 0, left: 0, width: anchoDp, height: altoDp }}
        >
          <Image
            source={{ uri: sello.uri }}
            style={{ width: anchoDp, height: altoDp }}
            resizeMode="cover"
            fadeDuration={0}
            onLoad={alCargarEscenario}
            onError={() => espera.current?.rechazar(new Error('No se pudo leer la foto'))}
          />
          <View
            style={{
              position: 'absolute',
              left: 0,
              right: 0,
              bottom: 0,
              backgroundColor: 'rgba(0,0,0,0.72)',
              borderTopWidth: Math.max(1, letra * 0.12),
              borderTopColor: '#FFD23F',
              paddingHorizontal: letra * 0.8,
              paddingVertical: letra * 0.5,
            }}
          >
            {sello.lineas.map((l, i) => (
              <Text
                key={`${String(i)}-${l}`}
                style={{
                  color: '#FFFFFF',
                  fontSize: letra,
                  lineHeight: letra * 1.3,
                  fontWeight: i === 0 ? '800' : '600',
                  fontVariant: ['tabular-nums'],
                  textShadowColor: '#000000',
                  textShadowOffset: { width: 0, height: 1 },
                  textShadowRadius: 2,
                }}
              >
                {l}
              </Text>
            ))}
          </View>
        </View>
      )}
      <CameraView ref={camara} style={{ flex: 1 }} facing="back" />
      <View style={{ position: 'absolute', top: insets.top + 12, left: 16, right: 16, gap: 6 }}>
        <View
          style={{
            alignSelf: 'flex-start',
            backgroundColor: 'rgba(0,0,0,0.6)',
            borderRadius: 8,
            paddingHorizontal: 12,
            paddingVertical: 8,
          }}
        >
          <Text style={{ color: '#fff', fontSize: 15, fontWeight: '700' }}>
            {TIPO_FOTO_TEXTO[tipo]}
            {objetivo > 0
              ? ` · ${String(Math.min(tomadas + 1, objetivo))} de ${String(objetivo)}`
              : ''}
          </Text>
        </View>
        {actual === null ? null : (
          <View
            style={{
              alignSelf: 'flex-start',
              backgroundColor: '#fff',
              borderRadius: 10,
              minWidth: 64,
              height: 64,
              alignItems: 'center',
              justifyContent: 'center',
              paddingHorizontal: 12,
            }}
          >
            <Text
              style={{ color: C.tinta, fontSize: 34, fontWeight: '900' }}
              accessibilityLabel={`Orientación ${NOMBRE[actual]}`}
            >
              {actual}
            </Text>
          </View>
        )}
      </View>
      <View
        style={{
          position: 'absolute',
          left: 0,
          right: 0,
          bottom: 0,
          paddingBottom: insets.bottom + 16,
          paddingTop: 16,
          paddingHorizontal: 16,
          backgroundColor: 'rgba(0,0,0,0.6)',
          gap: 12,
        }}
      >
        {error === null ? null : <Aviso>{error}</Aviso>}
        <Text style={{ color: '#fff', fontSize: 16, fontWeight: '600', textAlign: 'center' }}>
          {guardando ? 'Guardando la foto con sus coordenadas…' : indicacion}
        </Text>
        <View
          style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}
        >
          <Pressable
            accessibilityRole="button"
            onPress={() => router.back()}
            disabled={guardando}
            style={{ minHeight: 56, minWidth: 96, justifyContent: 'center' }}
          >
            <Text style={{ color: '#fff', fontSize: 17, fontWeight: '700' }}>
              {tomadas > 0 ? 'Listo' : 'Volver'}
            </Text>
          </Pressable>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Tomar foto"
            onPress={() => void disparar()}
            disabled={guardando}
            style={{
              width: 84,
              height: 84,
              borderRadius: 42,
              borderWidth: 6,
              borderColor: '#fff',
              backgroundColor: guardando ? C.suave : C.liquen,
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            {guardando ? <ActivityIndicator color="#fff" /> : null}
          </Pressable>
          <View style={{ minWidth: 96, alignItems: 'flex-end' }}>
            <Text style={{ color: '#fff', fontSize: 15, fontWeight: '600' }}>
              {tomadas > 0 ? `${String(tomadas)} guardada${tomadas === 1 ? '' : 's'}` : ''}
            </Text>
          </View>
        </View>
      </View>
    </View>
  );
}
