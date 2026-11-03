import {
  AudioModule,
  RecordingPresets,
  setAudioModeAsync,
  useAudioRecorder,
  type RecordingOptions,
} from "expo-audio";
import { CameraView, useCameraPermissions } from "expo-camera";
import { StatusBar } from "expo-status-bar";
import { useCallback, useEffect, useRef, useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";

import { type Evidencias, guardarEvidencias, leerEvidencias } from "./src/evidencias";
import { Indicaciones } from "./src/Indicaciones";
import {
  iniciarTransecto,
  leerPeriodo,
  leerPuntos,
  type Resumen,
  resumir,
  terminarTransecto,
  transectoActivo,
} from "./src/transecto";
import {
  abrirJornada,
  cerrarJornada,
  jornadaAbierta,
  pedirUbicacion,
  prepararAvisos,
} from "./src/vigilancia";

const META_FOTOS = 30;
const META_AUDIOS = 10;
const AUDIO_MS = 30_000;
const CUMPLE_PORCENTAJE = 95;
// Doc. 03 §2.1: AAC mono de 32 a 64 kbps.
const CALIDAD_AUDIO: RecordingOptions = {
  ...RecordingPresets.LOW_QUALITY,
  numberOfChannels: 1,
  bitRate: 48_000,
};

type PermisoUbicacion = "siempre" | "en-uso" | "denegada";

export default function App() {
  const [cargando, setCargando] = useState(true);
  const [ocupado, setOcupado] = useState(false);
  const [verIndicaciones, setVerIndicaciones] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [ubicacion, setUbicacion] = useState<PermisoUbicacion>("denegada");
  const [conAvisos, setConAvisos] = useState(false);
  const [jornada, setJornada] = useState(false);
  const [transecto, setTransecto] = useState(false);
  const [resumen, setResumen] = useState<Resumen | null>(null);
  const [evidencias, setEvidencias] = useState<Evidencias>({ fotos: 0, audios: 0 });
  const [enCamara, setEnCamara] = useState(false);
  const [grabando, setGrabando] = useState(false);
  const [permisoCamara, pedirCamara] = useCameraPermissions();
  const camara = useRef<CameraView>(null);
  const grabadora = useAudioRecorder(CALIDAD_AUDIO);

  const refrescar = useCallback(async () => {
    setJornada(await jornadaAbierta());
    setTransecto(await transectoActivo());
    const periodo = leerPeriodo();
    setResumen(periodo ? resumir(leerPuntos(), periodo, Date.now()) : null);
    setEvidencias(leerEvidencias());
  }, []);

  useEffect(() => {
    (async () => {
      setConAvisos(await prepararAvisos());
      setUbicacion(await pedirUbicacion());
      await refrescar();
    })()
      .catch((e: unknown) => setError(String(e)))
      .finally(() => setCargando(false));
  }, [refrescar]);

  useEffect(() => {
    if (!transecto) return;
    const temporizador = setInterval(() => {
      refrescar().catch((e: unknown) => setError(String(e)));
    }, 5_000);
    return () => clearInterval(temporizador);
  }, [transecto, refrescar]);

  async function ejecutar(accion: () => Promise<void>, mensaje: string) {
    setOcupado(true);
    setError(null);
    try {
      await accion();
      await refrescar();
    } catch {
      setError(mensaje);
    } finally {
      setOcupado(false);
    }
  }

  function sumar(cambio: Partial<Evidencias>) {
    const actual = { ...leerEvidencias(), ...cambio };
    guardarEvidencias(actual);
    setEvidencias(actual);
  }

  async function grabarAudio() {
    const { granted } = await AudioModule.requestRecordingPermissionsAsync();
    if (!granted) throw new Error("sin micrófono");
    await setAudioModeAsync({ allowsRecording: true, playsInSilentMode: true });
    setGrabando(true);
    try {
      await grabadora.prepareToRecordAsync();
      grabadora.record();
      await new Promise((resolver) => setTimeout(resolver, AUDIO_MS));
      await grabadora.stop();
      sumar({ audios: leerEvidencias().audios + 1 });
    } finally {
      setGrabando(false);
    }
  }

  if (cargando) {
    return (
      <View style={styles.centrado}>
        <ActivityIndicator size="large" />
        <Text style={styles.texto}>Preparando…</Text>
      </View>
    );
  }

  if (verIndicaciones) return <Indicaciones onCerrar={() => setVerIndicaciones(false)} />;

  if (enCamara) {
    return (
      <View style={styles.contenedor}>
        <CameraView ref={camara} style={styles.contenedor} />
        <Text style={styles.resultadoCamara}>Fotos: {evidencias.fotos} de {META_FOTOS}</Text>
        {error && <Text style={styles.alerta}>{error}</Text>}
        <Pressable
          style={styles.boton}
          disabled={ocupado}
          accessibilityRole="button"
          onPress={() =>
            ejecutar(async () => {
              await camara.current?.takePictureAsync({ quality: 0.9 });
              sumar({ fotos: leerEvidencias().fotos + 1 });
            }, "No se pudo tomar la foto.")
          }
        >
          <Text style={styles.textoBoton}>{ocupado ? "Un momento…" : "Tomar foto"}</Text>
        </Pressable>
        <Pressable style={styles.botonSecundario} accessibilityRole="button" onPress={() => setEnCamara(false)}>
          <Text style={styles.textoBotonSecundario}>Volver</Text>
        </Pressable>
      </View>
    );
  }

  return (
    <ScrollView contentContainerStyle={styles.lista}>
      <StatusBar style="dark" />
      <Text style={styles.titulo}>Transecto y batería</Text>
      <Pressable style={styles.botonSecundario} accessibilityRole="button" onPress={() => setVerIndicaciones(true)}>
        <Text style={styles.textoBotonSecundario}>Ver indicaciones</Text>
      </Pressable>

      {ubicacion !== "siempre" && (
        <Text style={styles.alerta}>
          {ubicacion === "denegada"
            ? "Sin permiso de ubicación: la prueba no puede funcionar."
            : 'Active la ubicación "Permitir siempre" en los ajustes.'}
        </Text>
      )}
      {!conAvisos && <Text style={styles.alerta}>Sin permiso de notificaciones: active los avisos en los ajustes.</Text>}
      {error && <Text style={styles.alerta}>{error}</Text>}

      <Text style={styles.subtitulo}>Transecto (PoC-03)</Text>
      <Text style={styles.texto}>Estado: {transecto ? "en curso" : "detenido"}</Text>
      {resumen ? (
        <>
          <Text style={styles.resultado}>
            Puntos esperados cubiertos: {resumen.porcentaje} % ({resumen.cubiertos} de {resumen.esperados})
          </Text>
          <Text style={styles.texto}>
            {resumen.porcentaje >= CUMPLE_PORCENTAJE ? "Cumple" : "No cumple"} el mínimo de {CUMPLE_PORCENTAJE} %
          </Text>
          <Text style={styles.texto}>Duración: {Math.round(resumen.duracionS / 60)} min · puntos guardados: {resumen.puntos}</Text>
          <Text style={styles.texto}>Mayor hueco: {resumen.mayorHuecoS} s</Text>
          <Text style={styles.texto}>
            Precisión mediana: {resumen.precisionMedianaM === null ? "—" : `${Math.round(resumen.precisionMedianaM)} m`}
          </Text>
        </>
      ) : (
        <Text style={styles.texto}>Sin transecto registrado.</Text>
      )}
      <Pressable
        style={[styles.boton, transecto && styles.botonCerrar]}
        disabled={ocupado || ubicacion === "denegada"}
        accessibilityRole="button"
        onPress={() =>
          transecto
            ? ejecutar(terminarTransecto, "No se pudo terminar el transecto.")
            : ejecutar(iniciarTransecto, "No se pudo iniciar el transecto. Verifique que el GPS esté encendido.")
        }
      >
        <Text style={styles.textoBoton}>{transecto ? "Terminar transecto" : "Iniciar transecto"}</Text>
      </Pressable>

      <Text style={styles.subtitulo}>Jornada de batería (PoC-04)</Text>
      <Text style={styles.texto}>Aviso de cercanía: {jornada ? "activo" : "apagado"}</Text>
      <Text style={styles.texto}>
        Fotos: {evidencias.fotos} de {META_FOTOS} · audios: {evidencias.audios} de {META_AUDIOS}
      </Text>
      <Pressable
        style={[styles.boton, jornada && styles.botonCerrar]}
        disabled={ocupado || ubicacion === "denegada"}
        accessibilityRole="button"
        onPress={() =>
          jornada
            ? ejecutar(cerrarJornada, "No se pudo cerrar la jornada.")
            : ejecutar(abrirJornada, "No se pudo abrir la jornada. Verifique que el GPS esté encendido.")
        }
      >
        <Text style={styles.textoBoton}>{jornada ? "Cerrar jornada" : "Abrir jornada"}</Text>
      </Pressable>
      <Pressable
        style={styles.botonSecundario}
        accessibilityRole="button"
        onPress={() =>
          ejecutar(async () => {
            const permiso = permisoCamara?.granted ? permisoCamara : await pedirCamara();
            if (!permiso.granted) throw new Error("sin cámara");
            setEnCamara(true);
          }, "Sin permiso de cámara: actívelo en los ajustes.")
        }
      >
        <Text style={styles.textoBotonSecundario}>Abrir cámara</Text>
      </Pressable>
      <Pressable
        style={styles.botonSecundario}
        disabled={grabando}
        accessibilityRole="button"
        onPress={() => ejecutar(grabarAudio, "No se pudo grabar el audio.")}
      >
        <Text style={styles.textoBotonSecundario}>{grabando ? "Grabando 30 s…" : "Grabar audio de 30 s"}</Text>
      </Pressable>
      <Pressable
        style={styles.botonSecundario}
        disabled={ocupado}
        accessibilityRole="button"
        onPress={() => {
          guardarEvidencias({ fotos: 0, audios: 0 });
          setEvidencias({ fotos: 0, audios: 0 });
        }}
      >
        <Text style={styles.textoBotonSecundario}>Reiniciar contadores</Text>
      </Pressable>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  contenedor: { flex: 1 },
  lista: { paddingBottom: 40 },
  centrado: { flex: 1, alignItems: "center", justifyContent: "center", gap: 12, padding: 24 },
  titulo: { fontSize: 24, fontWeight: "700", color: "#111", marginTop: 56, marginBottom: 12, marginHorizontal: 16 },
  subtitulo: { fontSize: 18, fontWeight: "700", color: "#111", marginTop: 16, marginBottom: 8, marginHorizontal: 16 },
  texto: { fontSize: 15, color: "#111", marginHorizontal: 16, marginBottom: 4 },
  resultado: { fontSize: 17, fontWeight: "700", color: "#111", marginHorizontal: 16, marginBottom: 4 },
  resultadoCamara: { fontSize: 17, fontWeight: "700", color: "#111", margin: 16, marginBottom: 0 },
  alerta: { fontSize: 15, color: "#A61B1B", marginHorizontal: 16, marginBottom: 8 },
  boton: {
    minHeight: 48,
    justifyContent: "center",
    alignItems: "center",
    margin: 16,
    marginBottom: 8,
    backgroundColor: "#0B4F5C",
    borderRadius: 8,
  },
  botonCerrar: { backgroundColor: "#111" },
  botonSecundario: {
    minHeight: 48,
    justifyContent: "center",
    alignItems: "center",
    marginHorizontal: 16,
    marginBottom: 16,
    borderWidth: 2,
    borderColor: "#0B4F5C",
    borderRadius: 8,
  },
  textoBoton: { color: "#fff", fontSize: 16, fontWeight: "700" },
  textoBotonSecundario: { color: "#0B4F5C", fontSize: 16, fontWeight: "700" },
});
