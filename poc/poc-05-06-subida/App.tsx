import { StatusBar } from "expo-status-bar";
import { useEffect, useRef, useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, TextInput } from "react-native";

import { medirHash, type MedicionHash } from "./src/archivos";
import { Indicaciones } from "./src/Indicaciones";
import { type Avance, type Estado, generarLote, leerEstado, subirTodo, TOTAL_FOTOS } from "./src/subida";

const LIMITE_HASH_MS = 1_000;
const SERVIDOR_EMULADOR = "http://10.0.2.2:1080";

export default function App() {
  const [servidor, setServidor] = useState(SERVIDOR_EMULADOR);
  const [estado, setEstado] = useState<Estado | null>(null);
  const [ocupado, setOcupado] = useState<string | null>(null);
  const [avance, setAvance] = useState<Avance | null>(null);
  const [hash, setHash] = useState<MedicionHash | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [verIndicaciones, setVerIndicaciones] = useState(false);
  const seguir = useRef(false);

  useEffect(() => {
    try {
      const guardado = leerEstado();
      setEstado(guardado);
      if (guardado) setServidor(guardado.servidor);
    } catch {
      setError("No se pudo leer el estado guardado.");
    }
  }, []);

  async function ejecutar(etiqueta: string, accion: () => Promise<void>) {
    setOcupado(etiqueta);
    setError(null);
    // Da tiempo a pintar la etiqueta: el trabajo con archivos corre en este mismo hilo.
    await new Promise((resolver) => setTimeout(resolver, 50));
    try {
      await accion();
    } catch (e: unknown) {
      setError(`${etiqueta}: ${String(e)}`);
    } finally {
      setOcupado(null);
    }
  }

  const subidas = estado?.fotos.filter(({ subida }) => subida).length ?? 0;
  const total = estado?.fotos.length ?? 0;
  const terminada = total > 0 && subidas === total;

  if (verIndicaciones) return <Indicaciones onCerrar={() => setVerIndicaciones(false)} />;

  return (
    <ScrollView contentContainerStyle={styles.contenedor} keyboardShouldPersistTaps="handled">
      <StatusBar style="dark" />
      <Text style={styles.titulo}>Subida y hash</Text>
      <Pressable style={styles.botonSecundario} accessibilityRole="button" onPress={() => setVerIndicaciones(true)}>
        <Text style={styles.textoBotonSecundario}>Ver indicaciones</Text>
      </Pressable>
      {error && <Text style={styles.alerta}>{error}</Text>}

      <Text style={styles.subtitulo}>Hash de una foto de 6 MB</Text>
      {hash ? (
        <>
          <Text style={styles.resultado} testID="hash-resultado">
            Mediana: {hash.medianaMs} ms · máximo: {hash.maximoMs} ms
          </Text>
          <Text style={styles.texto}>
            {hash.maximoMs < LIMITE_HASH_MS ? "Cumple" : "No cumple"} el límite de {LIMITE_HASH_MS} ms
          </Text>
          <Text style={styles.texto}>Mediciones: {hash.medicionesMs.join(", ")} ms</Text>
        </>
      ) : (
        <Text style={styles.texto}>Sin medir.</Text>
      )}
      <Pressable
        style={styles.boton}
        disabled={ocupado !== null}
        accessibilityRole="button"
        onPress={() => ejecutar("Midiendo", async () => setHash(await medirHash(10)))}
      >
        <Text style={styles.textoBoton}>{ocupado === "Midiendo" ? "Midiendo…" : "Medir hash"}</Text>
      </Pressable>

      <Text style={styles.subtitulo}>Subida de {TOTAL_FOTOS} fotos sintéticas</Text>
      <Text style={styles.etiqueta}>Servidor</Text>
      <TextInput
        style={styles.campo}
        value={servidor}
        onChangeText={setServidor}
        autoCapitalize="none"
        autoCorrect={false}
        keyboardType="url"
        accessibilityLabel="Dirección del servidor"
      />
      <Text style={styles.resultado} testID="subida-resultado">
        Subidas: {subidas} de {total}
        {terminada ? " · terminada" : ""}
      </Text>
      {estado && (
        <Text style={styles.texto}>
          Reintentos: {estado.reintentos} · bloqueos: {estado.bloqueos} · aperturas: {estado.aperturas}
        </Text>
      )}
      {avance && ocupado === "Subiendo" && (
        <Text style={styles.texto}>
          {avance.mensaje}: {(avance.bytesActual / 1024 / 1024).toFixed(1)} MB de la foto actual
        </Text>
      )}
      {ocupado?.startsWith("Generando") && <Text style={styles.texto}>{ocupado}</Text>}

      <Pressable
        style={styles.botonSecundario}
        disabled={ocupado !== null}
        accessibilityRole="button"
        onPress={() =>
          ejecutar("Generando", async () => {
            setEstado(
              await generarLote(servidor.replace(/\/+$/, ""), (hechas) =>
                setOcupado(`Generando ${hechas} de ${TOTAL_FOTOS}`),
              ),
            );
          })
        }
      >
        <Text style={styles.textoBotonSecundario}>Generar fotos</Text>
      </Pressable>
      {ocupado === "Subiendo" ? (
        <Pressable
          style={styles.boton}
          accessibilityRole="button"
          onPress={() => {
            seguir.current = false;
          }}
        >
          <Text style={styles.textoBoton}>Detener</Text>
        </Pressable>
      ) : (
        <Pressable
          style={styles.boton}
          disabled={ocupado !== null || !estado || terminada}
          accessibilityRole="button"
          onPress={() =>
            ejecutar("Subiendo", async () => {
              if (!estado) return;
              estado.servidor = servidor.replace(/\/+$/, "");
              seguir.current = true;
              await subirTodo(estado, () => seguir.current, (nuevo) => {
                setAvance(nuevo);
                setEstado({ ...estado });
              });
              setEstado({ ...estado });
            })
          }
        >
          <Text style={styles.textoBoton}>{subidas > 0 ? "Continuar subida" : "Subir"}</Text>
        </Pressable>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  contenedor: { paddingBottom: 40 },
  titulo: { fontSize: 24, fontWeight: "700", color: "#111", marginTop: 56, marginBottom: 12, marginHorizontal: 16 },
  subtitulo: { fontSize: 18, fontWeight: "700", color: "#111", marginTop: 16, marginBottom: 8, marginHorizontal: 16 },
  texto: { fontSize: 15, color: "#111", marginHorizontal: 16, marginBottom: 4 },
  resultado: { fontSize: 17, fontWeight: "700", color: "#111", marginHorizontal: 16, marginBottom: 4 },
  etiqueta: { fontSize: 15, fontWeight: "700", color: "#111", marginHorizontal: 16, marginBottom: 4 },
  alerta: { fontSize: 15, color: "#A61B1B", marginHorizontal: 16, marginBottom: 8 },
  campo: {
    minHeight: 48,
    fontSize: 16,
    color: "#111",
    borderWidth: 1,
    borderColor: "#555",
    borderRadius: 8,
    paddingHorizontal: 12,
    marginHorizontal: 16,
    marginBottom: 12,
  },
  boton: {
    minHeight: 48,
    justifyContent: "center",
    alignItems: "center",
    margin: 16,
    marginBottom: 8,
    backgroundColor: "#0B4F5C",
    borderRadius: 8,
  },
  botonSecundario: {
    minHeight: 48,
    justifyContent: "center",
    alignItems: "center",
    marginHorizontal: 16,
    marginTop: 8,
    borderWidth: 2,
    borderColor: "#0B4F5C",
    borderRadius: 8,
  },
  textoBoton: { color: "#fff", fontSize: 16, fontWeight: "700" },
  textoBotonSecundario: { color: "#0B4F5C", fontSize: 16, fontWeight: "700" },
});
