// Removes the "fetch" UIBackgroundModes entry. expo-task-manager is applied
// automatically as a legacy plugin whenever it is installed, and it always adds
// "fetch". The app defines no background-fetch task (TaskManager runs only the
// geofence task, which location events drive), and App Review rejects unused
// background modes under Guideline 2.5.4.
const { withInfoPlist } = require("expo/config-plugins");

module.exports = function withoutBackgroundFetch(config) {
  return withInfoPlist(config, (config) => {
    const modes = config.modResults.UIBackgroundModes;
    if (Array.isArray(modes)) {
      config.modResults.UIBackgroundModes = modes.filter((mode) => mode !== "fetch");
    }
    return config;
  });
};
