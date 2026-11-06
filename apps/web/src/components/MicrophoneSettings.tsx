import type { AudioProcessingSettings } from "../media/useLessonSession";
import type { useAudioInputDevices } from "../media/useAudioInputDevices";

type Props = {
  inputs: ReturnType<typeof useAudioInputDevices>;
  enabled: boolean;
  processing: AudioProcessingSettings;
  onChange: (settings: AudioProcessingSettings) => void;
};

/** The same controls and capture policy apply to both participants. */
export function MicrophoneSettings({ inputs, enabled, processing, onChange }: Props) {
  return <fieldset>
    <legend>Microphone</legend>
    {inputs.permissionReady && inputs.devices.length > 0 ? <label>
      Input device
      <select aria-label="Microphone input" value={inputs.selectedDeviceId} onChange={(event) => inputs.setSelectedDeviceId(event.target.value)}>
        <option value="">System default</option>
        {inputs.devices.map((device) => <option key={device.deviceId} value={device.deviceId}>{device.label}</option>)}
      </select>
    </label> : <button className="meeting-permission-button" type="button" onClick={() => void inputs.requestAccess(enabled)}>Choose microphone</button>}
    {([
      ["echoCancellation", "Echo cancellation"],
      ["noiseSuppression", "Noise suppression"],
      ["autoGainControl", "Automatic microphone gain"]
    ] as const).map(([key, label]) => <label key={key} className="meeting-settings-check">
      <input type="checkbox" checked={processing[key]} onChange={(event) => onChange({ ...processing, [key]: event.target.checked })} />{label}
    </label>)}
    <p className="settings-help-copy">Keep echo cancellation on with speakers. With headphones, compare one setting at a time if speech sounds metallic or uneven. A change may briefly restart your microphone.</p>
    {inputs.error && <p className="settings-help-copy" role="status">{inputs.error}</p>}
  </fieldset>;
}
