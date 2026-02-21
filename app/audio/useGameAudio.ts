"use client";

import { useCallback, useEffect, useMemo, useRef } from "react";
import {
  FIREBALL_LOOP_SOUND_PATHS,
  MUSIC_PATH_BY_ID,
  SOUND_PATH_BY_ID,
  type MusicTrackId,
} from "../assets/gameAssets";

type SoundId = "coin" | "footsteps" | "goomba" | "jump" | "shoot";
type OneShotSoundId = Exclude<SoundId, "footsteps">;

const ONE_SHOT_GAIN: Record<OneShotSoundId, number> = {
  coin: 0.58,
  goomba: 0.6,
  jump: 0.42,
  shoot: 0.5,
};

const FOOTSTEPS_GAIN = 0.26;
const FIREBALL_LOOP_BASE_GAIN = 0.95;
const FIREBALL_LOOP_MIN_PLAYBACK_RATE = 0.93;
const FIREBALL_LOOP_PLAYBACK_RATE_RANGE = 0.14;
const MASTER_GAIN = 0.92;
const MUSIC_GAIN = 0.4;
const MUSIC_FADE_OUT_MS = 450;
const MUSIC_FADE_IN_MS = 650;
const MUSIC_NIGHT_ENTER_THRESHOLD = 0.62;
const MUSIC_DAY_ENTER_THRESHOLD = 0.38;

type AudioWindow = Window & {
  webkitAudioContext?: typeof AudioContext;
};

export interface FireballLoopController {
  setFireballLoopGain: (fireballId: string, gain: number) => void;
  stopFireballLoop: (fireballId: string) => void;
}

export interface GameAudioController {
  playCoin: () => void;
  playShoot: () => void;
  playJump: () => void;
  playGoombaDefeated: () => void;
  setFootstepsActive: (isActive: boolean) => void;
  setDayNightMusicBlend: (nightFactor: number) => void;
  fireballLoops: FireballLoopController;
}

export function useGameAudio(): GameAudioController {
  const audioContextRef = useRef<AudioContext | null>(null);
  const masterGainRef = useRef<GainNode | null>(null);
  const decodedBuffersRef = useRef<Map<SoundId, AudioBuffer>>(new Map());
  const bufferLoadByIdRef = useRef<Map<SoundId, Promise<AudioBuffer | null>>>(
    new Map(),
  );
  const footstepsSourceRef = useRef<AudioBufferSourceNode | null>(null);
  const footstepsGainRef = useRef<GainNode | null>(null);
  const footstepsActiveRef = useRef(false);
  const dayMusicRef = useRef<HTMLAudioElement | null>(null);
  const nightMusicRef = useRef<HTMLAudioElement | null>(null);
  const musicFadeFrameRef = useRef<number | null>(null);
  const currentMusicModeRef = useRef<MusicTrackId>("day");
  const desiredMusicModeRef = useRef<MusicTrackId>("day");
  const musicTransitioningRef = useRef(false);
  const musicUnlockedRef = useRef(false);
  const runMusicTransitionRef = useRef<() => void>(() => {});

  type FireballLoopEntry = {
    source: AudioBufferSourceNode;
    gain: GainNode;
  };
  const fireballLoopBuffersRef = useRef<AudioBuffer[] | null>(null);
  const fireballLoopBufferLoadRef = useRef<Promise<void> | null>(null);
  const fireballLoopEntriesRef = useRef<Map<string, FireballLoopEntry>>(
    new Map(),
  );

  const ensureAudioGraph = useCallback(() => {
    if (audioContextRef.current && masterGainRef.current) {
      return audioContextRef.current;
    }

    const AudioContextCtor =
      window.AudioContext ?? (window as AudioWindow).webkitAudioContext;
    if (!AudioContextCtor) {
      return null;
    }

    const context = new AudioContextCtor();
    const masterGain = context.createGain();
    masterGain.gain.value = MASTER_GAIN;
    masterGain.connect(context.destination);

    audioContextRef.current = context;
    masterGainRef.current = masterGain;
    return context;
  }, []);

  const unlockAudio = useCallback(async () => {
    const context = ensureAudioGraph();
    if (!context) {
      return;
    }
    if (context.state === "suspended") {
      await context.resume();
    }
  }, [ensureAudioGraph]);

  const loadBuffer = useCallback(
    (soundId: SoundId) => {
      const cached = decodedBuffersRef.current.get(soundId);
      if (cached) {
        return Promise.resolve(cached);
      }

      const inFlight = bufferLoadByIdRef.current.get(soundId);
      if (inFlight) {
        return inFlight;
      }

      const loadPromise = (async () => {
        const context = ensureAudioGraph();
        if (!context) {
          return null;
        }

        try {
          const response = await fetch(SOUND_PATH_BY_ID[soundId]);
          if (!response.ok) {
            return null;
          }
          const encodedBytes = await response.arrayBuffer();
          const decoded = await context.decodeAudioData(encodedBytes.slice(0));
          decodedBuffersRef.current.set(soundId, decoded);
          return decoded;
        } catch {
          return null;
        }
      })();

      bufferLoadByIdRef.current.set(soundId, loadPromise);
      return loadPromise;
    },
    [ensureAudioGraph],
  );

  const playOneShot = useCallback(
    (soundId: OneShotSoundId) => {
      void unlockAudio();
      void loadBuffer(soundId).then((buffer) => {
        if (!buffer) {
          return;
        }

        const context = audioContextRef.current;
        const masterGain = masterGainRef.current;
        if (!context || !masterGain) {
          return;
        }

        const source = context.createBufferSource();
        source.buffer = buffer;

        const gain = context.createGain();
        gain.gain.value = ONE_SHOT_GAIN[soundId];

        source.connect(gain);
        gain.connect(masterGain);
        source.start();
      });
    },
    [loadBuffer, unlockAudio],
  );

  const stopFootsteps = useCallback(() => {
    const source = footstepsSourceRef.current;
    const context = audioContextRef.current;
    const gain = footstepsGainRef.current;
    footstepsSourceRef.current = null;
    footstepsGainRef.current = null;

    if (!source) {
      return;
    }

    try {
      if (context && gain) {
        const now = context.currentTime;
        const stopAt = now + 0.03;
        gain.gain.cancelScheduledValues(now);
        gain.gain.setValueAtTime(gain.gain.value, now);
        gain.gain.linearRampToValueAtTime(0, stopAt);
        source.stop(stopAt);
      } else {
        source.stop();
      }
    } catch {
      // Ignore stop race when source already ended.
    }
  }, []);

  const startFootsteps = useCallback(() => {
    if (footstepsSourceRef.current) {
      return;
    }

    void unlockAudio();
    void loadBuffer("footsteps").then((buffer) => {
      if (
        !buffer ||
        !footstepsActiveRef.current ||
        footstepsSourceRef.current
      ) {
        return;
      }

      const context = audioContextRef.current;
      const masterGain = masterGainRef.current;
      if (!context || !masterGain) {
        return;
      }

      const source = context.createBufferSource();
      source.buffer = buffer;
      source.loop = true;

      const gain = context.createGain();
      gain.gain.value = FOOTSTEPS_GAIN;

      source.connect(gain);
      gain.connect(masterGain);
      source.start();

      footstepsSourceRef.current = source;
      footstepsGainRef.current = gain;

      source.onended = () => {
        if (footstepsSourceRef.current === source) {
          footstepsSourceRef.current = null;
          footstepsGainRef.current = null;
        }
      };
    });
  }, [loadBuffer, unlockAudio]);

  const setFootstepsActive = useCallback(
    (isActive: boolean) => {
      if (footstepsActiveRef.current === isActive) {
        return;
      }

      footstepsActiveRef.current = isActive;
      if (isActive) {
        startFootsteps();
      } else {
        stopFootsteps();
      }
    },
    [startFootsteps, stopFootsteps],
  );

  const loadFireballLoopBuffers = useCallback((): Promise<void> => {
    if (fireballLoopBuffersRef.current) {
      return Promise.resolve();
    }
    if (fireballLoopBufferLoadRef.current) {
      return fireballLoopBufferLoadRef.current;
    }
    const load = (async () => {
      const context = ensureAudioGraph();
      if (!context) {
        return;
      }
      try {
        const buffers = await Promise.all(
          FIREBALL_LOOP_SOUND_PATHS.map(async (path) => {
            const response = await fetch(path);
            if (!response.ok) {
              return null;
            }
            const bytes = await response.arrayBuffer();
            return context.decodeAudioData(bytes);
          }),
        );
        const valid = buffers.filter((b): b is AudioBuffer => b !== null);
        if (valid.length > 0) {
          fireballLoopBuffersRef.current = valid;
          // Play each buffer silently for one sample to warm up the audio
          // pipeline. Without this, the first real playback causes a frame drop
          // as the browser sets up its internal audio processing for these buffers.
          const masterGain = masterGainRef.current;
          if (masterGain) {
            for (const buffer of valid) {
              const warmSource = context.createBufferSource();
              warmSource.buffer = buffer;
              const silentGain = context.createGain();
              silentGain.gain.value = 0;
              warmSource.connect(silentGain);
              silentGain.connect(masterGain);
              warmSource.start();
              warmSource.stop(context.currentTime + 1 / context.sampleRate);
            }
          }
        }
      } catch {
        // Silently ignore — loops are non-critical
      }
    })();
    fireballLoopBufferLoadRef.current = load;
    return load;
  }, [ensureAudioGraph]);

  const hashFireballId = (id: string): number => {
    let hash = 2166136261;
    for (let i = 0; i < id.length; i += 1) {
      hash ^= id.charCodeAt(i);
      hash = Math.imul(hash, 16777619);
    }
    return hash >>> 0;
  };

  const setFireballLoopGain = useCallback(
    (fireballId: string, gain: number) => {
      const context = audioContextRef.current;
      const masterGain = masterGainRef.current;
      if (!context || !masterGain || context.state !== "running") {
        return;
      }

      let entry = fireballLoopEntriesRef.current.get(fireballId);
      if (!entry) {
        const buffers = fireballLoopBuffersRef.current;
        if (!buffers || buffers.length === 0) {
          void loadFireballLoopBuffers();
          return;
        }
        const hash = hashFireballId(fireballId);
        const clipIndex = hash % buffers.length;
        const normalizedHash = hash / 0xffffffff;
        const playbackRate =
          FIREBALL_LOOP_MIN_PLAYBACK_RATE +
          normalizedHash * FIREBALL_LOOP_PLAYBACK_RATE_RANGE;

        const source = context.createBufferSource();
        source.buffer = buffers[clipIndex];
        source.loop = true;
        source.playbackRate.value = playbackRate;

        const gainNode = context.createGain();
        gainNode.gain.value = gain * FIREBALL_LOOP_BASE_GAIN;

        source.connect(gainNode);
        gainNode.connect(masterGain);
        source.start();

        entry = { source, gain: gainNode };
        fireballLoopEntriesRef.current.set(fireballId, entry);
      } else {
        entry.gain.gain.value = gain * FIREBALL_LOOP_BASE_GAIN;
      }
    },
    [loadFireballLoopBuffers],
  );

  const stopFireballLoop = useCallback((fireballId: string) => {
    const entry = fireballLoopEntriesRef.current.get(fireballId);
    if (!entry) {
      return;
    }
    fireballLoopEntriesRef.current.delete(fireballId);
    try {
      entry.source.stop();
    } catch {
      // Ignore stop race when source already ended.
    }
    entry.source.disconnect();
    entry.gain.disconnect();
  }, []);

  const cancelMusicFade = useCallback(() => {
    if (musicFadeFrameRef.current === null) {
      return;
    }
    cancelAnimationFrame(musicFadeFrameRef.current);
    musicFadeFrameRef.current = null;
  }, []);

  const getTrackForMode = useCallback((mode: MusicTrackId) => {
    return mode === "day" ? dayMusicRef.current : nightMusicRef.current;
  }, []);

  const getOppositeMode = useCallback(
    (mode: MusicTrackId): MusicTrackId => (mode === "day" ? "night" : "day"),
    [],
  );

  const ensureMusicTracks = useCallback(() => {
    if (dayMusicRef.current && nightMusicRef.current) {
      return;
    }

    const dayTrack = new Audio(MUSIC_PATH_BY_ID.day);
    dayTrack.preload = "auto";
    dayTrack.loop = true;

    const nightTrack = new Audio(MUSIC_PATH_BY_ID.night);
    nightTrack.preload = "auto";
    nightTrack.loop = true;

    dayMusicRef.current = dayTrack;
    nightMusicRef.current = nightTrack;
  }, []);

  const rampTrackVolume = useCallback(
    (
      track: HTMLAudioElement,
      targetVolume: number,
      durationMs: number,
      onComplete?: () => void,
    ) => {
      cancelMusicFade();
      const clampedTarget = Math.max(0, Math.min(MUSIC_GAIN, targetVolume));
      if (durationMs <= 0) {
        track.volume = clampedTarget;
        onComplete?.();
        return;
      }

      const startVolume = track.volume;
      const volumeDelta = clampedTarget - startVolume;
      const startedAtMs = performance.now();

      const step = () => {
        const elapsedMs = performance.now() - startedAtMs;
        const progress = Math.min(1, elapsedMs / durationMs);
        track.volume = startVolume + volumeDelta * progress;
        if (progress >= 1) {
          musicFadeFrameRef.current = null;
          onComplete?.();
          return;
        }
        musicFadeFrameRef.current = requestAnimationFrame(step);
      };

      musicFadeFrameRef.current = requestAnimationFrame(step);
    },
    [cancelMusicFade],
  );

  const runMusicTransition = useCallback(() => {
    if (!musicUnlockedRef.current || musicTransitioningRef.current) {
      return;
    }
    if (desiredMusicModeRef.current === currentMusicModeRef.current) {
      return;
    }

    ensureMusicTracks();
    const fromMode = currentMusicModeRef.current;
    const toMode = desiredMusicModeRef.current;
    const fromTrack = getTrackForMode(fromMode);
    const toTrack = getTrackForMode(toMode);
    if (!fromTrack || !toTrack) {
      return;
    }

    musicTransitioningRef.current = true;
    rampTrackVolume(fromTrack, 0, MUSIC_FADE_OUT_MS, () => {
      fromTrack.pause();
      fromTrack.currentTime = 0;

      toTrack.currentTime = 0;
      toTrack.volume = 0;
      void toTrack.play().catch(() => {});
      rampTrackVolume(toTrack, MUSIC_GAIN, MUSIC_FADE_IN_MS, () => {
        currentMusicModeRef.current = toMode;
        musicTransitioningRef.current = false;
        if (desiredMusicModeRef.current !== currentMusicModeRef.current) {
          runMusicTransitionRef.current();
        }
      });
    });
  }, [ensureMusicTracks, getTrackForMode, rampTrackVolume]);

  useEffect(() => {
    runMusicTransitionRef.current = runMusicTransition;
  }, [runMusicTransition]);

  const resumeMusicPlayback = useCallback(() => {
    musicUnlockedRef.current = true;
    ensureMusicTracks();
    cancelMusicFade();

    const startingMode = desiredMusicModeRef.current;
    currentMusicModeRef.current = startingMode;

    const activeTrack = getTrackForMode(startingMode);
    const inactiveTrack = getTrackForMode(getOppositeMode(startingMode));
    if (!activeTrack || !inactiveTrack) {
      return;
    }

    inactiveTrack.pause();
    inactiveTrack.currentTime = 0;
    inactiveTrack.volume = 0;

    activeTrack.volume = MUSIC_GAIN;
    void activeTrack.play().catch(() => {});
  }, [cancelMusicFade, ensureMusicTracks, getOppositeMode, getTrackForMode]);

  const setDayNightMusicBlend = useCallback((nightFactor: number) => {
    const clampedNightFactor = Math.max(0, Math.min(1, nightFactor));
    const desiredMode = desiredMusicModeRef.current;
    const nextMode =
      desiredMode === "day"
        ? clampedNightFactor >= MUSIC_NIGHT_ENTER_THRESHOLD
          ? "night"
          : "day"
        : clampedNightFactor <= MUSIC_DAY_ENTER_THRESHOLD
          ? "day"
          : "night";

    desiredMusicModeRef.current = nextMode;
    if (!musicUnlockedRef.current) {
      currentMusicModeRef.current = nextMode;
      return;
    }
    runMusicTransitionRef.current();
  }, []);

  useEffect(() => {
    const warmAudio = () => {
      void unlockAudio();
      void loadBuffer("coin");
      void loadBuffer("footsteps");
      void loadBuffer("goomba");
      void loadBuffer("jump");
      void loadBuffer("shoot");
      void loadFireballLoopBuffers();
      resumeMusicPlayback();
    };

    window.addEventListener("pointerdown", warmAudio, { passive: true });
    window.addEventListener("keydown", warmAudio);
    return () => {
      window.removeEventListener("pointerdown", warmAudio);
      window.removeEventListener("keydown", warmAudio);
    };
  }, [loadBuffer, loadFireballLoopBuffers, resumeMusicPlayback, unlockAudio]);

  useEffect(() => {
    const fireballEntries = fireballLoopEntriesRef.current;
    return () => {
      for (const [id] of fireballEntries) {
        stopFireballLoop(id);
      }
      fireballEntries.clear();
      fireballLoopBuffersRef.current = null;
      fireballLoopBufferLoadRef.current = null;
      footstepsActiveRef.current = false;
      stopFootsteps();
      cancelMusicFade();
      musicUnlockedRef.current = false;
      musicTransitioningRef.current = false;

      const context = audioContextRef.current;
      audioContextRef.current = null;
      masterGainRef.current = null;
      const dayTrack = dayMusicRef.current;
      const nightTrack = nightMusicRef.current;
      dayMusicRef.current = null;
      nightMusicRef.current = null;
      if (dayTrack) {
        dayTrack.pause();
        dayTrack.src = "";
      }
      if (nightTrack) {
        nightTrack.pause();
        nightTrack.src = "";
      }
      if (context) {
        void context.close();
      }
    };
  }, [cancelMusicFade, stopFireballLoop, stopFootsteps]);

  const fireballLoops = useMemo(
    () => ({ setFireballLoopGain, stopFireballLoop }),
    [setFireballLoopGain, stopFireballLoop],
  );

  return useMemo(
    () => ({
      playCoin: () => playOneShot("coin"),
      playShoot: () => playOneShot("shoot"),
      playJump: () => playOneShot("jump"),
      playGoombaDefeated: () => playOneShot("goomba"),
      setFootstepsActive,
      setDayNightMusicBlend,
      fireballLoops,
    }),
    [playOneShot, setDayNightMusicBlend, setFootstepsActive, fireballLoops],
  );
}
