import { Platform, Pressable, ScrollView, StyleSheet, Text } from "react-native";

const SECCIONES_ANDROID = [
  {
    titulo: "Antes de salir",
    pasos: [
      'Acepte las notificaciones y elija la ubicación "Permitir siempre". Si no aparece esa opción, cámbiela en los ajustes de la app.',
      "Encienda la Precisión de ubicación de Google, en Ajustes > Ubicación > Servicios de ubicación. Sin ella, los avisos con la app cerrada no llegan y no aparece ningún error.",
      "Desactive la optimización de batería para esta app. En Xiaomi o Huawei, permita además el inicio automático. Los nombres de los ajustes cambian según la marca.",
      'Toque "Probar aviso" y verifique que aparece.',
    ],
  },
  {
    titulo: "Prueba a pie, al aire libre",
    pasos: [
      'Con la app abierta, abra la jornada y camine 150 m al sur. Debe aparecer el aviso "Zona de trabajo".',
      "Cierre la jornada. Ábrala de nuevo, cierre la app desde recientes, active el modo avión, apague la pantalla y camine unos 300 m en cualquier dirección. Debe llegar un aviso de tarea.",
      "Repita el paso anterior sin modo avión. Debe llegar un aviso de tarea.",
      "Con la app cerrada, aléjese más de 1,5 km. La bitácora debe mostrar \"Lista recalculada\".",
      "Reinicie el teléfono con la jornada abierta y camine. Anote si sigue avisando.",
      "Cierre la jornada y camine. No debe llegar ningún aviso.",
    ],
  },
  {
    titulo: "Cómo guardar el resultado",
    pasos: [
      "Abrir una jornada borra la bitácora anterior: capture la pantalla antes de abrir otra.",
      "Anote si la app estaba cerrada y si había modo avión: la bitácora no lo registra.",
      "Cumple si el aviso llega a unos 20 m o más de la tarea, caminando. Equivale a 60 s o menos.",
      "Envíe las capturas junto con la marca y el modelo del teléfono.",
    ],
  },
];

const SECCIONES_IOS = [
  {
    titulo: "Antes de salir",
    pasos: [
      "Permita las notificaciones y la ubicación cuando la app lo pida.",
      'En Ajustes > Privacidad y seguridad > Localización > PoC cercanía, elija "Siempre" y active "Ubicación exacta".',
      "Desactive el Modo de bajo consumo.",
      'Toque "Probar aviso" y verifique que aparece.',
    ],
  },
  {
    titulo: "Prueba a pie, al aire libre",
    pasos: [
      'Con la app abierta, abra la jornada y camine 150 m al sur. Debe aparecer el aviso "Zona de trabajo".',
      "Cierre la jornada. Ábrala de nuevo, cierre la app deslizándola hacia arriba en el selector de apps, active el modo avión, bloquee la pantalla y camine unos 300 m en cualquier dirección. Debe llegar un aviso de tarea.",
      "Repita el paso anterior sin modo avión. Debe llegar un aviso de tarea.",
      'Con la app cerrada, aléjese más de 1,5 km. La bitácora debe mostrar "Lista recalculada".',
      "Reinicie el iPhone con la jornada abierta, desbloquéelo una vez y camine. Anote si sigue avisando.",
      "Cierre la jornada y camine. No debe llegar ningún aviso.",
    ],
  },
  {
    titulo: "Cómo guardar el resultado",
    pasos: [
      "Abrir una jornada borra la bitácora anterior: capture la pantalla antes de abrir otra.",
      "Anote si la app estaba cerrada y si había modo avión: la bitácora no lo registra.",
      "Cumple si el aviso llega a unos 20 m o más de la tarea, caminando. Equivale a 60 s o menos.",
      "Envíe las capturas junto con el modelo del iPhone y su versión de iOS.",
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
