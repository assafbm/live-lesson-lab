type CameraSourceEntry = {
  referenceCount: number;
  stream?: MediaStream;
  streamPromise: Promise<MediaStream>;
  releaseTimer?: ReturnType<typeof setTimeout>;
};

export type CameraLease = {
  stream: Promise<MediaStream>;
  release: () => void;
};

/**
 * Owns one capture per physical device ID. Multiple logical roles can lease
 * the same entry, so choosing one camera twice does not call getUserMedia twice.
 */
class CameraSourceManager {
  private readonly entries = new Map<string, CameraSourceEntry>();

  acquire(deviceId: string): CameraLease {
    let entry = this.entries.get(deviceId);

    if (!entry) {
      const newEntry = {} as CameraSourceEntry;
      newEntry.referenceCount = 0;
      newEntry.streamPromise = navigator.mediaDevices
        .getUserMedia({
          audio: false,
          video: { deviceId: { exact: deviceId } }
        })
        .then((stream) => {
          newEntry.stream = stream;

          // getUserMedia cannot be cancelled. If every consumer left while the
          // permission prompt was open, stop the stream as soon as it resolves.
          if (newEntry.referenceCount === 0) this.dispose(deviceId, newEntry);
          return stream;
        })
        .catch((error: unknown) => {
          if (this.entries.get(deviceId) === newEntry) this.entries.delete(deviceId);
          throw error;
        });
      entry = newEntry;
      this.entries.set(deviceId, entry);
    }

    if (entry.releaseTimer) {
      clearTimeout(entry.releaseTimer);
      entry.releaseTimer = undefined;
    }
    entry.referenceCount += 1;

    let released = false;
    return {
      stream: entry.streamPromise,
      release: () => {
        if (released) return;
        released = true;
        entry!.referenceCount -= 1;

        if (entry!.referenceCount === 0) {
          // Deferring one tick allows React StrictMode's development-only
          // cleanup/setup cycle to reuse the same in-flight camera request.
          entry!.releaseTimer = setTimeout(() => {
            if (entry!.referenceCount === 0 && entry!.stream) {
              this.dispose(deviceId, entry!);
            }
          }, 0);
        }
      }
    };
  }

  private dispose(deviceId: string, entry: CameraSourceEntry) {
    if (this.entries.get(deviceId) === entry) this.entries.delete(deviceId);
    if (entry.releaseTimer) clearTimeout(entry.releaseTimer);
    entry.stream?.getTracks().forEach((track) => track.stop());
    entry.stream = undefined;
  }
}

// One manager instance shares camera captures across both role previews.
export const cameraSourceManager = new CameraSourceManager();
