import type { AppSettings } from "../types/app-data";
import { useAppContext } from "../app-context";

export function useSettingsAutosave() {
  const { appData, updateAppSettings, deleteGlobalTag, settingsError } = useAppContext();

  async function save(change: Partial<AppSettings>) {
    await updateAppSettings((settings) => ({ ...settings, ...change }));
  }

  async function update(mutator: (settings: AppSettings) => AppSettings) {
    await updateAppSettings(mutator);
  }

  return { appData, save, update, deleteGlobalTag, settingsError };
}
