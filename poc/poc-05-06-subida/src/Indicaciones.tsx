import { Platform, Pressable, ScrollView, StyleSheet, Text } from "react-native";

const SECCIONES_ANDROID = [
  {
    titulo: "Hash (PoC-06): 2 minutos",
    pasos: [
      'Toque "Medir hash" y espere el resultado.',
      "Cumple si el máximo es menor a 1000 ms.",
      "Envíe una captura junto con la marca y el modelo del teléfono.",
    ],
  },
  {
    titulo: "Subida con cortes (PoC-05): 30 minutos",
    pasos: [
      "Esta prueba necesita el servidor de pruebas encendido en la Mac. Pídalo antes de empezar y anote su dirección, con la forma http://<IP de la Mac>:1080.",
      "Quite el modo avión y conecte el teléfono a la misma WiFi que la Mac.",
      'Escriba la dirección en "Servidor", toque "Generar fotos" y espere a que termine.',
      'Toque "Subir" y mantenga la pantalla encendida.',
      "Durante la subida, active y quite el modo avión 3 o 4 veces, dejando pasar unos 20 s cada vez.",
      "Apague y encienda el WiFi 2 veces, también con unos 20 s.",
      'Cierre la app desde recientes 2 veces. Al abrirla, toque "Continuar subida".',
      'Al ver "terminada", avise y envíe una captura junto con la marca y el modelo.',
      "El resultado se confirma en la Mac: cumple si se verifican 50 de 50, sin archivos perdidos ni corruptos.",
    ],
  },
];

const SECCIONES_IOS = [
  {
    titulo: "Hash (PoC-06): 2 minutos",
    pasos: [
      'Toque "Medir hash" y espere el resultado.',
      "Cumple si el máximo es menor a 1000 ms.",
      "Envíe una captura junto con el modelo del iPhone y su versión de iOS.",
    ],
  },
  {
    titulo: "Subida con cortes (PoC-05): 30 minutos",
    pasos: [
      "En la Mac, con Docker abierto, corra scripts/servidor.sh limpiar en la carpeta poc-05-06-subida. La dirección es http://<IP de la Mac>:1080; la IP se obtiene con ipconfig getifaddr en0.",
      "Quite el modo avión y conecte el iPhone a la misma WiFi que la Mac.",
      'Escriba la dirección en "Servidor" y toque "Generar fotos". Si el iPhone pide permiso para buscar dispositivos en la red local, toque Permitir.',
      'Cuando termine de generar, toque "Subir" y mantenga la pantalla encendida.',
      "Durante la subida, active y quite el modo avión 3 o 4 veces desde el Centro de control, dejando pasar unos 20 s cada vez.",
      "Apague y encienda el WiFi 2 veces desde Ajustes > Wi-Fi, también con unos 20 s. El botón del Centro de control solo desconecta y no sirve para esta prueba.",
      'Cierre la app deslizándola hacia arriba en el selector de apps, 2 veces. Al abrirla, toque "Continuar subida".',
      'Al ver "terminada", corra scripts/verificar.sh 50 en la Mac. Cumple si muestra 50 de 50 verificados, sin perdidos ni corruptos.',
      "Envíe la captura de la app y la salida del comando, junto con el modelo del iPhone.",
    ],
  },
];

const SECCIONES = Platform.OS === "ios" ? SECCIONES_IOS : SECCIONES_ANDROID;

export function Indicaciones({ onCerrar }: { onCerrar: () => void }) {
  return (
    <ScrollView contentContainerStyle={styles.lista}>
      <Text style={styles.titulo}>Indicaciones de la prueba</Text>
      {SECCIONES.map(({ titulo, pasos }) => (
        <Fragmento key={titulo} titulo={titulo} pasos={pasos} />
      ))}
      <Pressable style={styles.boton} accessibilityRole="button" onPress={onCerrar}>
        <Text style={styles.textoBoton}>Volver a la prueba</Text>
      </Pressable>
    </ScrollView>
  );
}

function Fragmento({ titulo, pasos }: { titulo: string; pasos: string[] }) {
  return (
    <>
      <Text style={styles.subtitulo} accessibilityRole="header">
        {titulo}
      </Text>
      {pasos.map((paso, indice) => (
        <Text key={paso} style={styles.paso}>
          {indice + 1}. {paso}
        </Text>
      ))}
    </>
  );
}

const styles = StyleSheet.create({
  lista: { paddingBottom: 40 },
  titulo: { fontSize: 24, fontWeight: "700", color: "#111", marginTop: 56, marginBottom: 12, marginHorizontal: 16 },
  subtitulo: { fontSize: 18, fontWeight: "700", color: "#111", marginTop: 16, marginBottom: 8, marginHorizontal: 16 },
  paso: { fontSize: 16, lineHeight: 23, color: "#111", marginHorizontal: 16, marginBottom: 10 },
  boton: {
    minHeight: 48,
    justifyContent: "center",
    alignItems: "center",
    margin: 16,
    backgroundColor: "#0B4F5C",
    borderRadius: 8,
  },
  textoBoton: { color: "#fff", fontSize: 16, fontWeight: "700" },
});
