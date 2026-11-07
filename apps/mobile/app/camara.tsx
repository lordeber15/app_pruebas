import { CameraView, useCameraPermissions } from 'expo-camera';
import * as Location from 'expo-location';
import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { guardarFoto } from '../src/fotos.ts';
import { tarea as leerTarea } from '../src/tareas.ts';
import { Aviso, Boton, C, e, Texto } from '../src/ui.tsx';

/** Cámara propia de la app (RN-16). No hay acceso a la galería. */
export default function Camara() {
  const { tareaId, evidenciaId } = useLocalSearchParams<{
    tareaId: string;
    evidenciaId?: string;
  }>();
  const insets = useSafeAreaInsets();
  const [permiso, pedirPermiso] = useCameraPermissions();
  const camara = useRef<CameraView>(null);
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [tomadas, setTomadas] = useState(0);

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
      const t = await leerTarea(tareaId);
      if (t === null) throw new Error('tarea');
      await guardarFoto(
        foto.uri,
        foto.width,
        foto.height,
        t,
        evidenciaId === undefined || evidenciaId === '' ? null : evidenciaId,
      );
      setTomadas((n) => n + 1);
    } catch {
      setError('No se pudo guardar la foto. Intente de nuevo.');
    } finally {
      setGuardando(false);
    }
  };

  return (
    <View style={{ flex: 1, backgroundColor: '#000' }}>
      <CameraView ref={camara} style={{ flex: 1 }} facing="back" />
      <View
        style={{
          position: 'absolute',
          left: 0,
          right: 0,
          bottom: 0,
          paddingBottom: insets.bottom + 16,
          paddingTop: 16,
          paddingHorizontal: 16,
          backgroundColor: 'rgba(0,0,0,0.55)',
          gap: 12,
        }}
      >
        {error === null ? null : <Aviso>{error}</Aviso>}
        <Text style={{ color: '#fff', fontSize: 16, fontWeight: '600', textAlign: 'center' }}>
          {tomadas === 0
            ? 'Encuadre la evidencia y toque el botón'
            : `${String(tomadas)} ${tomadas === 1 ? 'foto guardada' : 'fotos guardadas'}`}
        </Text>
        <View
          style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}
        >
          <Pressable
            accessibilityRole="button"
            onPress={() => router.back()}
            style={{ minHeight: 56, minWidth: 96, justifyContent: 'center' }}
          >
            <Text style={{ color: '#fff', fontSize: 17, fontWeight: '700' }}>Listo</Text>
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
          <View style={{ minWidth: 96 }} />
        </View>
      </View>
    </View>
  );
}
