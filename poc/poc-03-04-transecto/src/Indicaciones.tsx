import { Platform, Pressable, ScrollView, StyleSheet, Text } from "react-native";

const SECCIONES_ANDROID = [
  {
    titulo: "Antes de empezar",
    pasos: [
      'Acepte las notificaciones y elija la ubicación "Permitir siempre". Si no aparece esa opción, cámbiela en los ajustes de la app.',
      "Deje la batería como viene en el teléfono. Si tuvo que cambiarla para que funcione, anótelo: es parte del resultado.",
      "El transecto y la jornada de batería son pruebas separadas: hágalas en días distintos.",
    ],
  },
  {
    titulo: "Transecto (PoC-03): 1 a 2 horas",
    pasos: [
      "Active el modo avión. No toque \"Abrir jornada\".",
      'Toque "Iniciar transecto", apague la pantalla y guarde el teléfono en el bolsillo.',
      "Camine de 1 a 2 horas al aire libre, sin abrir la app.",
      'Al volver, abra la app y toque "Terminar transecto".',
      "Cumple con 95 % o más de los puntos y un mayor hueco cercano a 20 s. Anote si pasó por zonas techadas o edificios altos.",
      "Envíe una captura junto con la marca y el modelo del teléfono.",
    ],
  },
  {
    titulo: "Jornada de batería (PoC-04): 8 horas",
    pasos: [
      "Cargue el teléfono al 100 % y no use batería externa ni lo cargue durante la jornada.",
      'Anote la hora y la batería, encienda la Precisión de ubicación de Google y toque "Abrir jornada".',
      "Durante el día haga 1 hora de transecto, 30 fotos y 10 audios.",
      "Use además 30 minutos el mapa de la app de PoC-01.",
      'A las 8 horas, anote la batería y toque "Cerrar jornada".',
      "Cumple con 20 % o más. Anote el brillo, la temperatura y si hubo señal, y envíe los datos junto con la marca y el modelo.",
    ],
  },
];

const SECCIONES_IOS = [
  {
    titulo: "Antes de empezar",
    pasos: [
      "Permita las notificaciones y la ubicación cuando la app lo pida.",
      'En Ajustes > Privacidad y seguridad > Localización > PoC transecto, elija "Siempre" y active "Ubicación exacta".',
      "Desactive el Modo de bajo consumo.",
      "En iPhone solo se prueba el transecto. La jornada de batería (PoC-04) se mide en Android.",
    ],
  },
  {
    titulo: "Transecto (PoC-03): 1 a 2 horas",
    pasos: [
      'Active el modo avión. No toque "Abrir jornada".',
      'Toque "Iniciar transecto", bloquee la pantalla y guarde el iPhone en el bolsillo.',
      "No cierre la app desde el selector de apps: en iPhone eso detiene el transecto.",
      "Camine de 1 a 2 horas al aire libre, sin abrir la app.",
      'Al volver, abra la app y toque "Terminar transecto".',
      "Cumple con 95 % o más de los puntos y un mayor hueco cercano a 20 s. Anote si pasó por zonas techadas o edificios altos.",
      "Envíe una captura junto con el modelo del iPhone y su versión de iOS.",
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
