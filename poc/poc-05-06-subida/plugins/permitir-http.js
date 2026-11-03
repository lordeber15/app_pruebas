// Solo para esta prueba: el servidor local no tiene TLS. La app final usa HTTPS.
const { withAndroidManifest } = require("expo/config-plugins");

module.exports = (config) =>
  withAndroidManifest(config, (resultado) => {
    resultado.modResults.manifest.application[0].$["android:usesCleartextTraffic"] = "true";
    return resultado;
  });
