import type { Orientacion, TipoFoto } from '@campo/core';
import { CameraView, useCameraPermissions } from 'expo-camera';
import * as Location from 'expo-location';
import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { guardarFotoEjecucion } from '../src/fotos.ts';
import { Aviso, Boton, C, e, Texto } from '../src/ui.tsx';

const NOMBRE: Record<Orientacion, string> = { N: 'norte', S: 'sur', E: 'este', O: 'oeste' };
const TITULO: Record<TipoFoto, string> = {
  contexto: 'Foto de contexto',
  metodologica: 'Foto metodológica',
  primer_plano: 'Primer plano',
  cientifica: 'Foto científica',
};

/**
 * Cámara propia de la app (RN-16: sin galería). Cada foto se guarda con su ejecución, unidad,
 * tipo y orientación (F-02). Con fotos cardinales guía la secuencia N-S-E-O (F-03).
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
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [tomadas, setTomadas] = useState(0);
  const tipo = (q.tipoFoto ?? 'contexto') as TipoFoto;
  const orientaciones = (q.orientaciones ?? '')
    .split(',')
    .filter((x): x is Orientacion => ['N', 'S', 'E', 'O'].includes(x));
  const objetivo = Number(q.objetivo ?? '0');
  const actual = orientaciones[tomadas] ?? null;

  useEffect(() => {
    void Location.requestForegroundPermissionsAsync();
  }, []);

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

  const disparar = async () => {
    if (camara.current === null || guardando) return;
    setGuardando(true);
    setError(null);
    try {
      const foto = await camara.current.takePictureAsync({ quality: 1, skipProcessing: false });
      await guardarFotoEjecucion(foto.uri, foto.width, foto.height, {
        ejecucionId: q.ejecucionId,
        unidadId: q.unidadId === undefined || q.unidadId === '' ? null : q.unidadId,
        tipoFoto: tipo,
        orientacion: actual,
      });
      const n = tomadas + 1;
      setTomadas(n);
      if (objetivo > 0 && n >= objetivo) router.back();
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
        : 'Encuadre amplio del hábitat, sin zoom';

  return (
    <View style={{ flex: 1, backgroundColor: '#000' }}>
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
            {TITULO[tipo]}
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
          {indicacion}
        </Text>
        <View
          style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}
        >
          <Pressable
            accessibilityRole="button"
            onPress={() => router.back()}
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
